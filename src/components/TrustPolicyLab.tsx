import { useMemo, useState } from "react";
import {
  evaluateTrustPolicy,
  type Finding,
  type FindingCode,
  type Warning,
  type WarningCode,
} from "../lib/trustPolicy";
import type { L, Lang } from "../lib/types";
import { t } from "../lib/types";

const HOST = "token.actions.githubusercontent.com";
const PROVIDER = `arn:aws:iam::111111111111:oidc-provider/${HOST}`;

const DEFAULT_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "${PROVIDER}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${HOST}:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "${HOST}:sub": "repo:0-draft/caller-identity:ref:refs/heads/main"
        }
      }
    }
  ]
}`;

const DEFAULT_CLAIMS = `{
  "aud": "sts.amazonaws.com",
  "sub": "repo:0-draft/caller-identity:ref:refs/heads/main"
}`;

const COPY = {
  heading: { en: "Would this token be allowed?", ja: "このトークンは通るか" },
  sub: {
    en: "Both panels are editable and evaluated on every keystroke. The conditions are applied the way IAM applies them, so you can reproduce the mistake rather than read about it.",
    ja: "両方とも編集でき、打つたびに評価される。condition は IAM と同じ規則で適用するので、事故を読むのではなく自分で再現できる。",
  },
  policy: { en: "Role trust policy", ja: "ロールの trust policy" },
  claims: {
    en: "Token claims presented to STS",
    ja: "STS に提示されるトークンの claim",
  },
  decision: { en: "Decision", ja: "判定" },
  warnings: { en: "Looser than it looks", ja: "見た目より緩い" },
  invalidJson: { en: "Not valid JSON", ja: "JSON として不正" },
  presets: { en: "Try", ja: "試す" },
} as const;

const DECISION_COPY: Record<string, L> = {
  Allow: { en: "Allow", ja: "許可" },
  Deny: { en: "Deny (explicit)", ja: "拒否 (明示的)" },
  ImplicitDeny: {
    en: "Deny (no matching Allow)",
    ja: "拒否 (一致する Allow 無し)",
  },
};

const FINDING_COPY: Record<FindingCode, L> = {
  "principal.match": {
    en: "The registered OIDC provider matches",
    ja: "登録済み OIDC provider と一致",
  },
  "principal.mismatch": {
    en: "The token's issuer is not this Principal.Federated",
    ja: "トークンの発行者が Principal.Federated と違う",
  },
  "principal.missing": {
    en: "No Principal.Federated, so no federated identity can match",
    ja: "Principal.Federated が無いので federated な身元は一致しようがない",
  },
  "action.match": {
    en: "Action matches the API being called",
    ja: "Action が呼び出す API と一致",
  },
  "action.mismatch": {
    en: "Wrong Action. The API name you call is the Action name the policy needs",
    ja: "Action が違う。呼び出す API 名がそのまま必要な Action 名になる",
  },
  "condition.pass": { en: "Condition satisfied", ja: "condition を満たす" },
  "condition.fail": { en: "Condition not satisfied", ja: "condition を満たさない" },
  "condition.key-missing": {
    en: "The token carries no such claim, so the condition cannot pass",
    ja: "トークンにその claim が無いので condition は通らない",
  },
  "condition.operator-unsupported": {
    en: "Operator not modelled here. IAM supports more than this page does",
    ja: "この評価器が未対応の演算子。IAM はこのページより多くをサポートする",
  },
};

const WARNING_COPY: Record<WarningCode, L> = {
  "sub.unconstrained": {
    en: "sub is never checked. Any repository that can reach this provider can assume the role.",
    ja: "sub を一度も検査していない。この provider に到達できるリポジトリなら何でも assume できる。",
  },
  "sub.wildcard-broad": {
    en: "This pattern matches every repository on GitHub, not just yours.",
    ja: "このパターンは GitHub 上の全リポジトリに一致する。自分のものだけではない。",
  },
  "sub.wildcard-owner": {
    en: "Every repository under that owner matches, including ones added later and forks pushed by others.",
    ja: "その owner 配下の全リポジトリに一致する。後から追加されたものや、他人が push した fork も含む。",
  },
  "aud.unconstrained": {
    en: "aud is never checked, so a token minted for a different audience is accepted.",
    ja: "aud を検査していないので、別の audience 向けに発行されたトークンも受け入れる。",
  },
  "no-conditions": {
    en: "No conditions at all. Anyone the provider will issue a token to can assume this role.",
    ja: "condition が一つも無い。provider がトークンを発行する相手なら誰でもこのロールを assume できる。",
  },
};

interface Preset {
  label: L;
  policy: string;
  claims: string;
}

const PRESETS: Preset[] = [
  {
    label: { en: "Correct", ja: "正しい設定" },
    policy: DEFAULT_POLICY,
    claims: DEFAULT_CLAIMS,
  },
  {
    label: { en: "sub not checked", ja: "sub 未検査" },
    policy: DEFAULT_POLICY.replace(/,\n {8}"StringLike": \{[\s\S]*?\n {8}\}/, ""),
    claims: `{
  "aud": "sts.amazonaws.com",
  "sub": "repo:someone-else/evil:ref:refs/heads/main"
}`,
  },
  {
    label: { en: "Owner-wide wildcard", ja: "owner 全体のワイルドカード" },
    policy: DEFAULT_POLICY.replace(
      "repo:0-draft/caller-identity:ref:refs/heads/main",
      "repo:0-draft/*",
    ),
    claims: `{
  "aud": "sts.amazonaws.com",
  "sub": "repo:0-draft/some-other-repo:ref:refs/heads/main"
}`,
  },
  {
    label: { en: "Wrong Action", ja: "Action の取り違え" },
    policy: DEFAULT_POLICY.replace(
      "sts:AssumeRoleWithWebIdentity",
      "sts:AssumeRole",
    ),
    claims: DEFAULT_CLAIMS,
  },
];

export function TrustPolicyLab({ lang }: { lang: Lang }) {
  const [policyText, setPolicyText] = useState(DEFAULT_POLICY);
  const [claimsText, setClaimsText] = useState(DEFAULT_CLAIMS);

  const { result, claimsError } = useMemo(() => {
    let keys: Record<string, string> = {};
    let error: string | null = null;

    try {
      const parsed = JSON.parse(claimsText) as Record<string, unknown>;
      keys = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [`${HOST}:${k}`, String(v)]),
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    return {
      claimsError: error,
      result: evaluateTrustPolicy(policyText, {
        action: "sts:AssumeRoleWithWebIdentity",
        federatedPrincipal: PROVIDER,
        keys,
      }),
    };
  }, [policyText, claimsText]);

  const decisionAllow = result.decision === "Allow";
  const risky = decisionAllow && result.warnings.length > 0;

  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="border-b border-line bg-panel-2 px-3 py-2">
        <h3 className="text-[13px] font-semibold">{COPY.heading[lang]}</h3>
        <p className="text-[11.5px] text-muted">{COPY.sub[lang]}</p>
      </header>

      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
        <span className="mr-1 font-mono text-[10.5px] tracking-wider text-muted uppercase">
          {COPY.presets[lang]}
        </span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label.en}
            type="button"
            onClick={() => {
              setPolicyText(preset.policy);
              setClaimsText(preset.claims);
            }}
            className="cursor-pointer rounded border border-line px-2 py-1 text-[11.5px] text-muted hover:border-amber hover:text-amber"
          >
            {t(preset.label, lang)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 px-3 py-3 lg:grid-cols-2">
        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.policy[lang]}
          </h4>
          <textarea
            value={policyText}
            onChange={(e) => setPolicyText(e.target.value)}
            spellCheck={false}
            rows={18}
            className="wire w-full resize-y rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-amber"
          />
          {result.parseError && (
            <p className="mt-1 text-[11.5px] text-danger">
              {COPY.invalidJson[lang]}: {result.parseError}
            </p>
          )}
        </div>

        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.claims[lang]}
          </h4>
          <textarea
            value={claimsText}
            onChange={(e) => setClaimsText(e.target.value)}
            spellCheck={false}
            rows={18}
            className="wire w-full resize-y rounded-md border border-line bg-ink px-3 py-2 outline-none focus:border-amber"
          />
          {claimsError && (
            <p className="mt-1 text-[11.5px] text-danger">
              {COPY.invalidJson[lang]}: {claimsError}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-line px-3 py-3">
        <div
          className={`rounded-md border px-3 py-2 ${
            risky
              ? "border-warn bg-warn/10 text-warn"
              : decisionAllow
                ? "border-good bg-good/10 text-good"
                : "border-danger bg-danger/10 text-danger"
          }`}
        >
          <span className="font-mono text-[10.5px] tracking-wider uppercase opacity-80">
            {COPY.decision[lang]}
          </span>
          <p className="wire text-[14px] font-semibold">
            {decisionAllow ? "✓" : "✗"} {t(DECISION_COPY[result.decision], lang)}
            {risky && ` · ${COPY.warnings[lang]}`}
          </p>
        </div>

        <ol className="space-y-1">
          {result.findings.map((finding: Finding, i) => (
            <li
              key={`${finding.code}-${finding.subject}-${i}`}
              className="rounded-md border border-line bg-ink px-3 py-1.5"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={finding.ok ? "text-good" : "text-danger"}>
                  {finding.ok ? "✓" : "✗"}
                </span>
                <span className="wire text-key">{finding.subject}</span>
                {finding.operator && (
                  <span className="wire text-muted">{finding.operator}</span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-fg/85">
                {t(FINDING_COPY[finding.code], lang)}
              </p>
              {finding.expected !== undefined && (
                <p className="wire mt-0.5 text-[11.5px] text-muted">
                  policy: {finding.expected || "(none)"}
                  {finding.actual !== undefined && ` · token: ${finding.actual}`}
                </p>
              )}
            </li>
          ))}
        </ol>

        {result.warnings.length > 0 && (
          <ul className="space-y-1">
            {result.warnings.map((warning: Warning, i) => (
              <li
                key={`${warning.code}-${i}`}
                className="rounded-md border border-warn/50 bg-warn/5 px-3 py-1.5 text-[12px] text-warn"
              >
                {warning.subject && (
                  <span className="wire mr-2 opacity-80">{warning.subject}</span>
                )}
                {t(WARNING_COPY[warning.code], lang)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
