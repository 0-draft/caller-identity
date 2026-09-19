import { describe, expect, it } from "vitest";
import {
  evaluateTrustPolicy,
  wildcardMatch,
  type AssumeContext,
} from "./trustPolicy";

const PROVIDER =
  "arn:aws:iam::111111111111:oidc-provider/token.actions.githubusercontent.com";
const HOST = "token.actions.githubusercontent.com";

const context = (overrides: Partial<AssumeContext> = {}): AssumeContext => ({
  action: "sts:AssumeRoleWithWebIdentity",
  federatedPrincipal: PROVIDER,
  keys: {
    [`${HOST}:aud`]: "sts.amazonaws.com",
    [`${HOST}:sub`]: "repo:0-draft/caller-identity:ref:refs/heads/main",
    ...overrides.keys,
  },
  ...overrides,
});

const policy = (condition: unknown, action = "sts:AssumeRoleWithWebIdentity") =>
  JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: PROVIDER },
        Action: action,
        Condition: condition,
      },
    ],
  });

const codes = (result: ReturnType<typeof evaluateTrustPolicy>) =>
  result.findings.map((f) => f.code);

describe("wildcardMatch", () => {
  it("treats * as any sequence and ? as one character", () => {
    expect(wildcardMatch("repo:0-draft/*", "repo:0-draft/caller-identity")).toBe(
      true,
    );
    expect(wildcardMatch("repo:0-draft/?", "repo:0-draft/x")).toBe(true);
    expect(wildcardMatch("repo:0-draft/?", "repo:0-draft/xy")).toBe(false);
  });

  it("does not treat regex metacharacters as special", () => {
    expect(wildcardMatch("a.b", "axb")).toBe(false);
    expect(wildcardMatch("a.b", "a.b")).toBe(true);
  });

  it("anchors at both ends", () => {
    expect(wildcardMatch("repo:0-draft/x", "repo:0-draft/x:ref:main")).toBe(false);
  });
});

describe("the policy that works", () => {
  it("allows the exact repository and ref", () => {
    const result = evaluateTrustPolicy(
      policy({
        StringEquals: { [`${HOST}:aud`]: "sts.amazonaws.com" },
        StringLike: {
          [`${HOST}:sub`]: "repo:0-draft/caller-identity:ref:refs/heads/main",
        },
      }),
      context(),
    );

    expect(result.decision).toBe("Allow");
    expect(codes(result)).toEqual([
      "principal.match",
      "action.match",
      "condition.pass",
      "condition.pass",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("denies a different branch", () => {
    const result = evaluateTrustPolicy(
      policy({
        StringEquals: { [`${HOST}:aud`]: "sts.amazonaws.com" },
        StringLike: {
          [`${HOST}:sub`]: "repo:0-draft/caller-identity:ref:refs/heads/main",
        },
      }),
      context({
        keys: {
          [`${HOST}:aud`]: "sts.amazonaws.com",
          [`${HOST}:sub`]:
            "repo:0-draft/caller-identity:ref:refs/heads/attacker-branch",
        },
      }),
    );

    expect(result.decision).toBe("ImplicitDeny");
    expect(codes(result)).toContain("condition.fail");
  });
});

describe("the mistakes this page exists to show", () => {
  it("flags a sub with no constraint at all", () => {
    const result = evaluateTrustPolicy(
      policy({ StringEquals: { [`${HOST}:aud`]: "sts.amazonaws.com" } }),
      context(),
    );

    // It still allows, which is exactly the danger.
    expect(result.decision).toBe("Allow");
    expect(result.warnings.map((w) => w.code)).toContain("sub.unconstrained");
  });

  it("flags repo:* as matching any repository on GitHub", () => {
    const result = evaluateTrustPolicy(
      policy({
        StringEquals: { [`${HOST}:aud`]: "sts.amazonaws.com" },
        StringLike: { [`${HOST}:sub`]: "repo:*" },
      }),
      context({
        keys: {
          [`${HOST}:aud`]: "sts.amazonaws.com",
          [`${HOST}:sub`]: "repo:someone-else/evil:ref:refs/heads/main",
        },
      }),
    );

    expect(result.decision).toBe("Allow");
    expect(result.warnings.map((w) => w.code)).toContain("sub.wildcard-broad");
  });

  it("flags an owner-wide wildcard as looser than it looks", () => {
    const result = evaluateTrustPolicy(
      policy({
        StringEquals: { [`${HOST}:aud`]: "sts.amazonaws.com" },
        StringLike: { [`${HOST}:sub`]: "repo:0-draft/*" },
      }),
      context({
        keys: {
          [`${HOST}:aud`]: "sts.amazonaws.com",
          [`${HOST}:sub`]: "repo:0-draft/some-other-repo:ref:refs/heads/main",
        },
      }),
    );

    expect(result.decision).toBe("Allow");
    expect(result.warnings.map((w) => w.code)).toContain("sub.wildcard-owner");
  });

  it("flags a policy with no conditions whatsoever", () => {
    const result = evaluateTrustPolicy(policy(undefined), context());
    expect(result.decision).toBe("Allow");
    expect(result.warnings.map((w) => w.code)).toContain("no-conditions");
  });

  it("rejects sts:AssumeRole written where the OIDC action belongs", () => {
    const result = evaluateTrustPolicy(
      policy(
        { StringEquals: { [`${HOST}:aud`]: "sts.amazonaws.com" } },
        "sts:AssumeRole",
      ),
      context(),
    );

    expect(result.decision).toBe("ImplicitDeny");
    expect(codes(result)).toContain("action.mismatch");
  });

  it("rejects a provider that is not the one registered", () => {
    const result = evaluateTrustPolicy(
      policy({ StringEquals: { [`${HOST}:aud`]: "sts.amazonaws.com" } }),
      context({
        federatedPrincipal:
          "arn:aws:iam::111111111111:oidc-provider/token.actions.example.com",
      }),
    );

    expect(result.decision).toBe("ImplicitDeny");
    expect(codes(result)).toContain("principal.mismatch");
  });
});

describe("evaluation mechanics", () => {
  it("lets an explicit Deny beat an Allow", () => {
    const text = JSON.stringify({
      Statement: [
        {
          Effect: "Allow",
          Principal: { Federated: PROVIDER },
          Action: "sts:AssumeRoleWithWebIdentity",
        },
        {
          Effect: "Deny",
          Principal: { Federated: PROVIDER },
          Action: "sts:AssumeRoleWithWebIdentity",
        },
      ],
    });

    expect(evaluateTrustPolicy(text, context()).decision).toBe("Deny");
  });

  it("fails a condition whose key the token does not carry", () => {
    const result = evaluateTrustPolicy(
      policy({ StringEquals: { [`${HOST}:environment`]: "production" } }),
      context(),
    );

    expect(result.decision).toBe("ImplicitDeny");
    expect(codes(result)).toContain("condition.key-missing");
  });

  it("reports unsupported operators rather than silently passing", () => {
    const result = evaluateTrustPolicy(
      policy({ ArnLike: { [`${HOST}:sub`]: "repo:0-draft/*" } }),
      context(),
    );

    expect(result.decision).toBe("ImplicitDeny");
    expect(codes(result)).toContain("condition.operator-unsupported");
  });

  it("reports a parse error instead of throwing", () => {
    const result = evaluateTrustPolicy("{ not json", context());
    expect(result.decision).toBe("ImplicitDeny");
    expect(result.parseError).toBeTruthy();
  });
});
