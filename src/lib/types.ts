import type { SigV4Credentials, SigV4Options, SigV4Request } from "./sigv4";

/** Every user-facing string carries both languages. English is the default. */
export interface L {
  en: string;
  ja: string;
}

export type Lang = keyof L;

export const t = (text: L, lang: Lang): string => text[lang];

/** The four bands every credential passes through, left to right. */
export type Phase = "issue" | "sign" | "verify" | "authorize";

export const PHASES: Phase[] = ["issue", "sign", "verify", "authorize"];

export const PHASE_LABEL: Record<Phase, L> = {
  issue: { en: "Issue", ja: "発行" },
  sign: { en: "Sign", ja: "署名" },
  verify: { en: "Verify", ja: "検証" },
  authorize: { en: "Authorize", ja: "認可" },
};

export type Actor =
  | "client"
  | "idp"
  | "imds"
  | "sts"
  | "iam"
  | "service"
  | "external";

export const ACTOR_LABEL: Record<Actor, L> = {
  client: { en: "Your workload", ja: "自分のワークロード" },
  idp: { en: "External IdP", ja: "外部 IdP" },
  imds: { en: "IMDS (link-local)", ja: "IMDS (リンクローカル)" },
  sts: { en: "AWS STS", ja: "AWS STS" },
  iam: { en: "AWS IAM", ja: "AWS IAM" },
  service: { en: "AWS service", ja: "AWS サービス" },
  external: { en: "External service", ja: "外部サービス" },
};

export type Tone = "key" | "warn" | "good" | "info";

/** Highlights a literal substring of the wire text and explains it. */
export interface Annotation {
  match: string;
  note: L;
  tone?: Tone;
}

export interface WireMessage {
  /** Request line or status line, verbatim. */
  start: string;
  headers: Array<[string, string]>;
  body?: string;
  annotations?: Annotation[];
}

/** A note about what AWS does with the message, on its side of the wire. */
export interface ServerNote {
  title: L;
  detail: L;
  tone?: Tone;
}

/**
 * When present, the step's signature is computed in the browser rather than
 * hardcoded, and the Authorization header on the wire is the real output.
 */
export interface SigningDemo {
  request: SigV4Request;
  credentials: SigV4Credentials;
  options: SigV4Options;
}

export interface Step {
  id: string;
  /**
   * The bands this step touches. A single step often spans several: signing an
   * S3 call is sign, verify and authorize at once. Steps that skip a band say
   * so by omitting it, which is how the rail shows that an unsigned
   * AssumeRoleWithWebIdentity never reaches "sign" at all.
   */
  phases: Phase[];
  from: Actor;
  to: Actor;
  title: L;
  narrative: L;
  request?: WireMessage;
  response?: WireMessage;
  serverSide: ServerNote[];
  signing?: SigningDemo;
}

export interface Scenario {
  id: string;
  title: L;
  tagline: L;
  /** The shape of credential this path ends up using. */
  credential: L;
  /** One-line statement of why this path exists. */
  why: L;
  steps: Step[];
}
