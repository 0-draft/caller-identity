import { useEffect, useMemo, useState } from "react";
import { scenarios } from "./data/scenarios";
import { signRequest } from "./lib/sigv4";
import {
  ACTOR_LABEL,
  PHASES,
  PHASE_LABEL,
  t,
  type Lang,
  type Step,
  type Tone,
} from "./lib/types";
import { Wire } from "./components/Wire";
import { SignatureLab } from "./components/SignatureLab";

const TONE_TEXT: Record<Tone, string> = {
  key: "text-key",
  warn: "text-warn",
  good: "text-good",
  info: "text-info",
};

const COPY = {
  tagline: {
    en: "What actually goes over the wire when AWS decides who you are.",
    ja: "AWS が「お前は誰か」を決めるとき、ワイヤー上で実際に何が流れているか。",
  },
  blurb: {
    en: "Pick a path a credential can take. Step through it. Every signature on this page is computed in your browser by WebCrypto, from the same algorithm AWS runs on its side, and verified in CI against the signature examples AWS publishes.",
    ja: "クレデンシャルが辿る経路を選んで、1ステップずつ進む。このページの署名は全て WebCrypto がブラウザ内で計算している。AWS 側と同じアルゴリズムで、CI では AWS 公開の署名例と一致することを検証している。",
  },
  credential: { en: "Credential", ja: "クレデンシャル" },
  why: { en: "Why this path exists", ja: "この経路が存在する理由" },
  request: { en: "Request", ja: "リクエスト" },
  response: { en: "Response", ja: "レスポンス" },
  serverSide: { en: "On the AWS side", ja: "AWS 側の処理" },
  railNote: {
    en: "Lit bands are the ones this step touches. A dark band is one this path skips: the unsigned OIDC exchange never reaches Sign, and a bearer token skips Issue and Sign both.",
    ja: "点灯しているのがこのステップが触れるバンド。暗いバンドはこの経路が飛ばしている。未署名の OIDC 交換は Sign に到達せず、bearer token は Issue と Sign の両方を飛ばす。",
  },
  steps: { en: "Steps", ja: "ステップ" },
  prev: { en: "Previous", ja: "前へ" },
  next: { en: "Next", ja: "次へ" },
  noSecrets: {
    en: "The keys throughout are AWS's own published example values. Nothing here is a real secret, and nothing leaves this tab.",
    ja: "ここで使っているキーは全て AWS 公開のサンプル値。本物の秘密は一つも無く、このタブから何も出ていかない。",
  },
} as const;

function useSignedHeaders(step: Step): Array<[string, string]> {
  const [header, setHeader] = useState<Array<[string, string]>>([]);

  useEffect(() => {
    if (!step.signing) {
      setHeader([]);
      return;
    }
    let cancelled = false;
    const { request, credentials, options } = step.signing;
    signRequest(request, credentials, options).then((result) => {
      if (!cancelled) setHeader([["Authorization", result.authorizationHeader]]);
    });
    return () => {
      cancelled = true;
    };
  }, [step]);

  return header;
}

export default function App() {
  const [lang, setLang] = useState<Lang>("en");
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [stepIndex, setStepIndex] = useState(0);

  const scenario = useMemo(
    () => scenarios.find((s) => s.id === scenarioId) ?? scenarios[0],
    [scenarioId],
  );
  const step = scenario.steps[Math.min(stepIndex, scenario.steps.length - 1)];
  const authHeader = useSignedHeaders(step);

  const copy = (key: keyof typeof COPY) => COPY[key][lang];
  const scenarioPhases = new Set(scenario.steps.flatMap((s) => s.phases));
  const stepPhases = new Set(step.phases);

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-start justify-between gap-4 px-4 py-5">
          <div className="min-w-0">
            <h1 className="font-mono text-[22px] font-semibold tracking-tight">
              caller-identity
            </h1>
            <p className="mt-1 text-[13px] text-muted">{copy("tagline")}</p>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
            {(["en", "ja"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`cursor-pointer px-3 py-1.5 font-mono text-[12px] transition-colors ${
                  lang === code
                    ? "bg-key/15 text-key"
                    : "text-muted hover:text-fg"
                }`}
              >
                {code === "en" ? "EN" : "日本語"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-4">
        <p className="max-w-3xl py-4 text-[13px] leading-relaxed text-muted">
          {copy("blurb")}
        </p>

        <nav className="flex flex-wrap gap-2 pb-4">
          {scenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setScenarioId(s.id);
                setStepIndex(0);
              }}
              className={`cursor-pointer rounded-md border px-3 py-2 text-left transition-colors ${
                s.id === scenario.id
                  ? "border-key bg-key/10"
                  : "border-line bg-panel hover:border-muted"
              }`}
            >
              <span className="block text-[13px] font-medium">
                {t(s.title, lang)}
              </span>
              <span className="block max-w-[22rem] text-[11.5px] text-muted">
                {t(s.tagline, lang)}
              </span>
            </button>
          ))}
        </nav>

        <ol className="mb-5 flex flex-wrap items-center gap-1 text-[11px]">
          {PHASES.map((phase, i) => {
            const inScenario = scenarioPhases.has(phase);
            const current = stepPhases.has(phase);
            return (
              <li key={phase} className="flex items-center gap-1">
                <span
                  className={`rounded px-2 py-1 font-mono tracking-wider uppercase ${
                    current
                      ? "bg-key/20 text-key"
                      : inScenario
                        ? "bg-panel-2 text-fg"
                        : "bg-panel text-muted/40"
                  }`}
                >
                  {t(PHASE_LABEL[phase], lang)}
                </span>
                {i < PHASES.length - 1 && (
                  <span className="text-muted/40">&rarr;</span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mb-5 max-w-3xl text-[11.5px] leading-relaxed text-muted">
          {copy("railNote")}
        </p>

        <main className="grid gap-4 pb-10 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
          <aside className="space-y-4">
            <div className="rounded-lg border border-line bg-panel p-3">
              <h2 className="font-mono text-[11px] tracking-wider text-muted uppercase">
                {copy("credential")}
              </h2>
              <p className="wire mt-1 text-key">{t(scenario.credential, lang)}</p>
              <h2 className="mt-3 font-mono text-[11px] tracking-wider text-muted uppercase">
                {copy("why")}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed">
                {t(scenario.why, lang)}
              </p>
            </div>

            <div className="rounded-lg border border-line bg-panel p-3">
              <h2 className="mb-2 font-mono text-[11px] tracking-wider text-muted uppercase">
                {copy("steps")}
              </h2>
              <ol className="space-y-1">
                {scenario.steps.map((s, i) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setStepIndex(i)}
                      className={`w-full cursor-pointer rounded px-2 py-1.5 text-left text-[12px] transition-colors ${
                        i === stepIndex
                          ? "bg-key/15 text-key"
                          : "text-muted hover:bg-white/5 hover:text-fg"
                      }`}
                    >
                      <span className="font-mono opacity-60">{i + 1}. </span>
                      {t(s.title, lang)}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          <section className="min-w-0 space-y-4">
            <div className="rounded-lg border border-line bg-panel p-4">
              <p className="font-mono text-[11px] text-muted">
                {t(ACTOR_LABEL[step.from], lang)} &rarr;{" "}
                {t(ACTOR_LABEL[step.to], lang)}
              </p>
              <h2 className="mt-1 text-[17px] font-semibold">
                {t(step.title, lang)}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed">
                {t(step.narrative, lang)}
              </p>
            </div>

            {step.request && (
              <Wire
                label={copy("request")}
                message={step.request}
                lang={lang}
                extraHeaders={authHeader}
              />
            )}
            {step.response && (
              <Wire label={copy("response")} message={step.response} lang={lang} />
            )}
            {step.signing && <SignatureLab demo={step.signing} lang={lang} />}

            <div className="flex justify-between gap-2">
              <button
                type="button"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="cursor-pointer rounded-md border border-line px-3 py-2 text-[12px] text-muted hover:text-fg disabled:cursor-default disabled:opacity-30"
              >
                &larr; {copy("prev")}
              </button>
              <button
                type="button"
                disabled={stepIndex >= scenario.steps.length - 1}
                onClick={() =>
                  setStepIndex((i) => Math.min(scenario.steps.length - 1, i + 1))
                }
                className="cursor-pointer rounded-md border border-line px-3 py-2 text-[12px] text-muted hover:text-fg disabled:cursor-default disabled:opacity-30"
              >
                {copy("next")} &rarr;
              </button>
            </div>
          </section>

          <aside className="min-w-0">
            <div className="rounded-lg border border-line bg-panel">
              <header className="border-b border-line bg-panel-2 px-3 py-2">
                <h2 className="font-mono text-[11px] tracking-wider text-muted uppercase">
                  {copy("serverSide")}
                </h2>
              </header>
              <ol className="divide-y divide-line">
                {step.serverSide.map((note) => (
                  <li key={note.title.en} className="px-3 py-2.5">
                    <h3
                      className={`text-[12.5px] font-medium ${TONE_TEXT[note.tone ?? "key"]}`}
                    >
                      {t(note.title, lang)}
                    </h3>
                    <p className="mt-1 text-[12px] leading-relaxed text-fg/85">
                      {t(note.detail, lang)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </aside>
        </main>

        <footer className="border-t border-line py-5 text-[11.5px] text-muted">
          <p>{copy("noSecrets")}</p>
          <p className="mt-1">
            <a
              className="text-key hover:underline"
              href="https://github.com/0-draft/caller-identity"
            >
              github.com/0-draft/caller-identity
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
