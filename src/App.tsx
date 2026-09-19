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
import { SequenceDiagram } from "./components/SequenceDiagram";
import { Handoff } from "./components/Handoff";
import { ConsoleChrome } from "./components/ConsoleChrome";
import { TrustPolicyLab } from "./components/TrustPolicyLab";
import { PresignLab } from "./components/PresignLab";

const TONE_TEXT: Record<Tone, string> = {
  key: "text-key",
  warn: "text-warn",
  good: "text-good",
  info: "text-info",
};

/** How long each step is held during autoplay. */
const PLAY_INTERVAL_MS = 3400;

const COPY = {
  tagline: {
    en: "What actually goes over the wire when AWS decides who you are.",
    ja: "AWS が「お前は誰か」を決めるとき、ワイヤー上で実際に何が流れているか。",
  },
  blurb: {
    en: "Pick a path a credential can take and walk it. Each arrow is a real HTTP request; below it you get the bytes, and beside it what AWS does with them. Every signature is computed in your browser by WebCrypto, from the same algorithm AWS runs, and checked in CI against the signature examples AWS publishes.",
    ja: "クレデンシャルが辿る経路を選んで歩く。矢印の一本一本が実際の HTTP リクエストで、下にそのバイト列、横に AWS 側の処理が出る。署名は全て WebCrypto がブラウザ内で計算していて、AWS と同じアルゴリズム、CI では AWS 公開の署名例と照合している。",
  },
  credential: { en: "Credential", ja: "クレデンシャル" },
  why: { en: "Why this path exists", ja: "この経路が存在する理由" },
  request: { en: "Request", ja: "リクエスト" },
  response: { en: "Response", ja: "レスポンス" },
  serverSide: { en: "On the AWS side", ja: "AWS 側の処理" },
  railNote: {
    en: "Lit bands are the ones this step touches. A dark band is one this path skips: the unsigned OIDC exchange never reaches Sign, and a bearer token skips Issue and Sign both. Arrow keys step through.",
    ja: "点灯しているのがこのステップが触れるバンド。暗いバンドはこの経路が飛ばしている。未署名の OIDC 交換は Sign に到達せず、bearer token は Issue と Sign の両方を飛ばす。矢印キーで移動できる。",
  },
  play: { en: "Play", ja: "再生" },
  pause: { en: "Pause", ja: "停止" },
  replay: { en: "Replay", ja: "最初から" },
  prev: { en: "Previous", ja: "前へ" },
  next: { en: "Next", ja: "次へ" },
  nowShowing: { en: "Now showing", ja: "表示中" },
  noSecrets: {
    en: "Every key on this page is an example value AWS publishes in its own documentation. Nothing here is a real secret, no request leaves this tab, and there is no backend to send one to.",
    ja: "このページのキーは全て AWS が自身のドキュメントで公開しているサンプル値。本物の秘密は一つも無く、このタブからリクエストは一切出ていかないし、送る先のバックエンドも存在しない。",
  },
  disclaimer: {
    en: "Not an AWS product and not affiliated with Amazon Web Services. The layout is an homage; the protocol details are the point.",
    ja: "AWS の製品ではなく、Amazon Web Services とは無関係。レイアウトはオマージュで、中身のプロトコルの方が本題。",
  },
} as const;

/**
 * Signs the step's request and returns the Authorization header to splice into
 * the wire. The result is tagged with the step it belongs to and matched during
 * render, so switching steps needs no state reset and a late-arriving signature
 * for the previous step is simply ignored.
 */
function useSignedHeaders(step: Step): Array<[string, string]> {
  // Keyed by the step object itself rather than its id: ids repeat across
  // scenarios, and the scenario list is a module constant so identity is stable.
  const [signed, setSigned] = useState<{
    step: Step;
    header: Array<[string, string]>;
  } | null>(null);

  useEffect(() => {
    if (!step.signing) return;
    let cancelled = false;
    const { request, credentials, options } = step.signing;

    void signRequest(request, credentials, options).then((result) => {
      if (cancelled) return;
      setSigned({
        step,
        header: [["Authorization", result.authorizationHeader]],
      });
    });

    return () => {
      cancelled = true;
    };
  }, [step]);

  return signed?.step === step ? signed.header : [];
}

export default function App() {
  const [lang, setLang] = useState<Lang>("en");
  const [scenarioId, setScenarioId] = useState(scenarios[0].id);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const scenario = useMemo(
    () => scenarios.find((s) => s.id === scenarioId) ?? scenarios[0],
    [scenarioId],
  );
  const lastIndex = scenario.steps.length - 1;
  const current = Math.min(stepIndex, lastIndex);
  const step = scenario.steps[current];
  const authHeader = useSignedHeaders(step);

  // Autoplay. The state change happens inside the timer callback rather than in
  // the effect body, so no render cascade.
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (stepIndex >= lastIndex) setPlaying(false);
      else setStepIndex(stepIndex + 1);
    }, PLAY_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [playing, stepIndex, lastIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.isContentEditable))
        return;
      if (event.key === "ArrowRight")
        setStepIndex((i) => Math.min(lastIndex, i + 1));
      if (event.key === "ArrowLeft") setStepIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lastIndex]);

  const copy = (key: keyof typeof COPY) => COPY[key][lang];
  const scenarioPhases = new Set(scenario.steps.flatMap((s) => s.phases));
  const stepPhases = new Set(step.phases);

  const selectStep = (index: number) => {
    setPlaying(false);
    setStepIndex(index);
  };

  const progress = ((current + 1) / scenario.steps.length) * 100;

  return (
    <div className="min-h-screen">
      <ConsoleChrome lang={lang} onLangChange={setLang} />

      <div className="mx-auto max-w-[1500px] px-4">
        <div className="py-4">
          <h1 className="text-[20px] font-semibold tracking-tight">
            {copy("tagline")}
          </h1>
          <p className="mt-2 max-w-4xl text-[13px] leading-relaxed text-muted">
            {copy("blurb")}
          </p>
        </div>

        <nav className="grid gap-2 pb-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {scenarios.map((s) => {
            const selected = s.id === scenario.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setScenarioId(s.id);
                  setStepIndex(0);
                  setPlaying(false);
                }}
                className={`cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                  selected
                    ? "border-amber bg-amber/10"
                    : "border-line bg-panel hover:border-muted"
                }`}
              >
                <span
                  className={`block text-[13px] font-medium ${selected ? "text-amber" : ""}`}
                >
                  {t(s.title, lang)}
                </span>
                <span className="mt-1 block font-mono text-[10.5px] text-muted">
                  {t(s.credential, lang)}
                </span>
                <span className="mt-1.5 block text-[11.5px] leading-snug text-muted">
                  {t(s.tagline, lang)}
                </span>
              </button>
            );
          })}
        </nav>

        <section className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (playing) {
                  setPlaying(false);
                } else {
                  if (stepIndex >= lastIndex) setStepIndex(0);
                  setPlaying(true);
                }
              }}
              className="cursor-pointer rounded-md border border-amber bg-amber/10 px-3 py-1.5 text-[12px] font-medium text-amber hover:bg-amber/20"
            >
              {playing
                ? `❙❙ ${copy("pause")}`
                : stepIndex >= lastIndex
                  ? `↻ ${copy("replay")}`
                  : `▶ ${copy("play")}`}
            </button>
            <button
              type="button"
              disabled={current === 0}
              onClick={() => selectStep(Math.max(0, current - 1))}
              className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg disabled:cursor-default disabled:opacity-30"
            >
              &larr; {copy("prev")}
            </button>
            <button
              type="button"
              disabled={current >= lastIndex}
              onClick={() => selectStep(Math.min(lastIndex, current + 1))}
              className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-[12px] text-muted hover:text-fg disabled:cursor-default disabled:opacity-30"
            >
              {copy("next")} &rarr;
            </button>

            <span className="font-mono text-[12px] text-muted">
              {current + 1} / {scenario.steps.length}
            </span>

            <ol className="ml-auto flex flex-wrap items-center gap-1 text-[10.5px]">
              {PHASES.map((phase, i) => (
                <li key={phase} className="flex items-center gap-1">
                  <span
                    className={`rounded px-2 py-1 font-mono tracking-wider uppercase transition-colors ${
                      stepPhases.has(phase)
                        ? "bg-amber/20 text-amber"
                        : scenarioPhases.has(phase)
                          ? "bg-panel-2 text-fg"
                          : "bg-panel text-muted/30"
                    }`}
                  >
                    {t(PHASE_LABEL[phase], lang)}
                  </span>
                  {i < PHASES.length - 1 && (
                    <span className="text-muted/30">&rarr;</span>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <div className="h-1 overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full rounded-full bg-amber transition-[width] duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>

          <SequenceDiagram
            scenario={scenario}
            activeIndex={current}
            onSelect={selectStep}
            lang={lang}
          />

          {/* Repeated right under the diagram so an autoplay tick is visible
              without scrolling to the detail panel. */}
          <div className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-line bg-panel-2 px-3 py-2">
            <span className="font-mono text-[10.5px] tracking-wider text-muted uppercase">
              {copy("nowShowing")}
            </span>
            <span className="text-[13px] font-medium text-amber">
              {current + 1}. {t(step.title, lang)}
            </span>
            <span className="font-mono text-[11px] text-muted">
              {t(ACTOR_LABEL[step.from], lang)} &rarr;{" "}
              {t(ACTOR_LABEL[step.to], lang)}
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-muted">
            {copy("railNote")}
          </p>
        </section>

        <main className="grid gap-4 pb-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="min-w-0 space-y-4">
            <div className="rounded-lg border border-line bg-panel p-4">
              <h2 className="text-[17px] font-semibold">{t(step.title, lang)}</h2>
              <p className="mt-2 text-[13px] leading-relaxed">
                {t(step.narrative, lang)}
              </p>
            </div>

            {step.handoff && (
              <Handoff
                key={`${scenario.id}:${step.id}`}
                tabs={step.handoff}
                lang={lang}
              />
            )}
            {step.presignLab && <PresignLab lang={lang} />}
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
            {step.signing && (
              // Step ids repeat across scenarios, so the key carries both.
              <SignatureLab
                key={`${scenario.id}:${step.id}:sig`}
                demo={step.signing}
                lang={lang}
              />
            )}
            {step.trustPolicyLab && <TrustPolicyLab lang={lang} />}
          </section>

          <aside className="min-w-0 space-y-4">
            <div className="rounded-lg border border-line bg-panel p-3">
              <h2 className="font-mono text-[11px] tracking-wider text-muted uppercase">
                {copy("credential")}
              </h2>
              <p className="wire mt-1 text-amber">{t(scenario.credential, lang)}</p>
              <h2 className="mt-3 font-mono text-[11px] tracking-wider text-muted uppercase">
                {copy("why")}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed">
                {t(scenario.why, lang)}
              </p>
            </div>

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

        <footer className="space-y-1 border-t border-line py-5 text-[11.5px] text-muted">
          <p>{copy("noSecrets")}</p>
          <p>{copy("disclaimer")}</p>
          <p>
            <a
              className="text-amber hover:underline"
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
