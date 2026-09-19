import { useState } from "react";
import { t, type HandoffTab, type Lang } from "../lib/types";

const COPY = {
  heading: {
    en: "Inside your process",
    ja: "プロセスの内側",
  },
  sub: {
    en: "No HTTP here. This is the step that usually gets skipped in diagrams, which is why the next signed request looks like it appears from nowhere.",
    ja: "ここに HTTP は無い。図で省略されがちなのがこのステップで、だから次の署名済みリクエストがどこからともなく現れたように見える。",
  },
} as const;

export function Handoff({ tabs, lang }: { tabs: HandoffTab[]; lang: Lang }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active];

  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="border-b border-line bg-panel-2 px-3 py-2">
        <h3 className="text-[13px] font-semibold">{COPY.heading[lang]}</h3>
        <p className="text-[11.5px] text-muted">{COPY.sub[lang]}</p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-line px-3 pt-2">
        {tabs.map((candidate, i) => (
          <button
            key={candidate.label.en}
            type="button"
            onClick={() => setActive(i)}
            className={`cursor-pointer rounded-t-md border-b-2 px-3 py-1.5 text-[12px] transition-colors ${
              i === active
                ? "border-amber text-amber"
                : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {t(candidate.label, lang)}
          </button>
        ))}
      </div>

      <div className="space-y-2 px-3 py-3">
        <pre className="wire overflow-x-auto rounded-md border border-line bg-ink px-3 py-2">
          {tab.code}
        </pre>
        <p className="text-[12px] leading-relaxed text-fg/85">
          {t(tab.note, lang)}
        </p>
      </div>
    </section>
  );
}
