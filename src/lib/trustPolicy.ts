/**
 * A small IAM trust-policy evaluator, enough to answer the question the policy
 * is actually there to answer: given this token, may this principal assume the
 * role, and is the policy as tight as its author probably thinks it is.
 *
 * The engine returns codes rather than prose so the UI can render them in
 * either language and the tests can assert on something stable.
 */

export type Decision = "Allow" | "Deny" | "ImplicitDeny";

export interface PolicyStatement {
  Effect?: string;
  Principal?: Record<string, string | string[]>;
  Action?: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

export interface TrustPolicy {
  Version?: string;
  Statement?: PolicyStatement | PolicyStatement[];
}

export interface AssumeContext {
  /** The STS API being called, e.g. `sts:AssumeRoleWithWebIdentity`. */
  action: string;
  /** Value matched against `Principal.Federated`, normally the OIDC provider ARN. */
  federatedPrincipal: string;
  /** Condition keys available to the request, e.g. `<host>:sub`. */
  keys: Record<string, string>;
}

export type FindingCode =
  | "principal.match"
  | "principal.mismatch"
  | "principal.missing"
  | "action.match"
  | "action.mismatch"
  | "condition.pass"
  | "condition.fail"
  | "condition.key-missing"
  | "condition.operator-unsupported";

export interface Finding {
  code: FindingCode;
  ok: boolean;
  /** Literal values, interpolated by the UI. */
  subject: string;
  expected?: string;
  actual?: string;
  operator?: string;
}

export type WarningCode =
  | "sub.unconstrained"
  | "sub.wildcard-owner"
  | "sub.wildcard-broad"
  | "aud.unconstrained"
  | "no-conditions";

export interface Warning {
  code: WarningCode;
  subject?: string;
}

export interface Evaluation {
  decision: Decision;
  findings: Finding[];
  warnings: Warning[];
  /** Parse failure, if the policy text was not valid JSON. */
  parseError?: string;
}

/**
 * IAM's StringLike wildcards: `*` matches any sequence including empty, `?`
 * matches exactly one character. Everything else is literal.
 */
export function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `^${escaped.replace(/\*/g, "[\\s\\S]*").replace(/\?/g, "[\\s\\S]")}$`,
  );
  return regex.test(value);
}

const asArray = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

interface OperatorResult {
  supported: boolean;
  matched: boolean;
}

function applyOperator(
  operator: string,
  expected: string[],
  actual: string,
): OperatorResult {
  switch (operator) {
    case "StringEquals":
      return { supported: true, matched: expected.includes(actual) };
    case "StringNotEquals":
      return { supported: true, matched: !expected.includes(actual) };
    case "StringEqualsIgnoreCase":
      return {
        supported: true,
        matched: expected.some((e) => e.toLowerCase() === actual.toLowerCase()),
      };
    case "StringLike":
      return {
        supported: true,
        matched: expected.some((e) => wildcardMatch(e, actual)),
      };
    case "StringNotLike":
      return {
        supported: true,
        matched: !expected.some((e) => wildcardMatch(e, actual)),
      };
    default:
      return { supported: false, matched: false };
  }
}

/**
 * Flags the mistakes that turn a plausible-looking GitHub Actions trust policy
 * into one any repository on GitHub can assume.
 */
function auditConditions(
  statement: PolicyStatement,
  context: AssumeContext,
): Warning[] {
  const warnings: Warning[] = [];
  const conditions = statement.Condition ?? {};

  if (Object.keys(conditions).length === 0) {
    warnings.push({ code: "no-conditions" });
    return warnings;
  }

  const entries = Object.entries(conditions).flatMap(([operator, block]) =>
    Object.entries(block).map(([key, expected]) => ({
      operator,
      key,
      expected: asArray(expected),
    })),
  );

  const subKeys = Object.keys(context.keys).filter((k) => k.endsWith(":sub"));
  const audKeys = Object.keys(context.keys).filter((k) => k.endsWith(":aud"));

  for (const subKey of subKeys) {
    const constraints = entries.filter((e) => e.key === subKey);
    if (constraints.length === 0) {
      warnings.push({ code: "sub.unconstrained", subject: subKey });
      continue;
    }
    for (const { expected } of constraints) {
      for (const pattern of expected) {
        // `repo:*` and `repo:my-org/*:*` are the two shapes that look specific
        // and are not.
        if (/^\*$/.test(pattern) || /^repo:\*/.test(pattern)) {
          warnings.push({ code: "sub.wildcard-broad", subject: pattern });
        } else if (/^repo:[^/*]+\/\*/.test(pattern)) {
          warnings.push({ code: "sub.wildcard-owner", subject: pattern });
        }
      }
    }
  }

  for (const audKey of audKeys) {
    if (!entries.some((e) => e.key === audKey)) {
      warnings.push({ code: "aud.unconstrained", subject: audKey });
    }
  }

  return warnings;
}

function evaluateStatement(
  statement: PolicyStatement,
  context: AssumeContext,
): { matched: boolean; findings: Finding[] } {
  const findings: Finding[] = [];

  const federated = asArray(statement.Principal?.Federated);
  if (federated.length === 0) {
    findings.push({
      code: "principal.missing",
      ok: false,
      subject: "Principal.Federated",
      actual: context.federatedPrincipal,
    });
    return { matched: false, findings };
  }

  const principalOk = federated.some(
    (p) => p === context.federatedPrincipal || p === "*",
  );
  findings.push({
    code: principalOk ? "principal.match" : "principal.mismatch",
    ok: principalOk,
    subject: "Principal.Federated",
    expected: federated.join(", "),
    actual: context.federatedPrincipal,
  });

  const actions = asArray(statement.Action);
  const actionOk = actions.some((a) => wildcardMatch(a, context.action));
  findings.push({
    code: actionOk ? "action.match" : "action.mismatch",
    ok: actionOk,
    subject: "Action",
    expected: actions.join(", "),
    actual: context.action,
  });

  let conditionsOk = true;
  for (const [operator, block] of Object.entries(statement.Condition ?? {})) {
    for (const [key, rawExpected] of Object.entries(block)) {
      const expected = asArray(rawExpected);
      const actual = context.keys[key];

      if (actual === undefined) {
        // An absent key fails every String* operator except the IfExists forms,
        // which this engine does not implement.
        conditionsOk = false;
        findings.push({
          code: "condition.key-missing",
          ok: false,
          subject: key,
          expected: expected.join(", "),
          operator,
        });
        continue;
      }

      const { supported, matched } = applyOperator(operator, expected, actual);
      if (!supported) {
        conditionsOk = false;
        findings.push({
          code: "condition.operator-unsupported",
          ok: false,
          subject: key,
          operator,
          expected: expected.join(", "),
          actual,
        });
        continue;
      }

      if (!matched) conditionsOk = false;
      findings.push({
        code: matched ? "condition.pass" : "condition.fail",
        ok: matched,
        subject: key,
        operator,
        expected: expected.join(", "),
        actual,
      });
    }
  }

  return {
    matched: principalOk && actionOk && conditionsOk,
    findings,
  };
}

export function evaluateTrustPolicy(
  policyText: string,
  context: AssumeContext,
): Evaluation {
  let policy: TrustPolicy;
  try {
    policy = JSON.parse(policyText) as TrustPolicy;
  } catch (error) {
    return {
      decision: "ImplicitDeny",
      findings: [],
      warnings: [],
      parseError: error instanceof Error ? error.message : String(error),
    };
  }

  const statements = Array.isArray(policy.Statement)
    ? policy.Statement
    : policy.Statement
      ? [policy.Statement]
      : [];

  const findings: Finding[] = [];
  const warnings: Warning[] = [];
  let allowed = false;
  let denied = false;

  for (const statement of statements) {
    const { matched, findings: statementFindings } = evaluateStatement(
      statement,
      context,
    );
    findings.push(...statementFindings);

    const effect = statement.Effect ?? "Allow";
    if (matched && effect === "Deny") denied = true;
    if (matched && effect === "Allow") {
      allowed = true;
      warnings.push(...auditConditions(statement, context));
    }
  }

  // An explicit Deny beats any Allow, and no Allow at all is a denial too.
  return {
    decision: denied ? "Deny" : allowed ? "Allow" : "ImplicitDeny",
    findings,
    warnings,
  };
}
