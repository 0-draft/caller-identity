import { type ReactNode, useMemo, useState } from "react";
import type { Annotation, Lang, Tone, WireMessage } from "../lib/types";
import { t } from "../lib/types";

const TONE_TEXT: Record<Tone, string> = {
  key: "text-key",
  warn: "text-warn",
  good: "text-good",
  info: "text-info",
};

const TONE_BORDER: Record<Tone, string> = {
  key: "border-key",
  warn: "border-warn",
  good: "border-good",
  info: "border-info",
};

/**
 * Splits the wire text on the annotated substrings and wraps each one in a
 * button, so the literal bytes stay readable while every interesting token is
 * clickable.
 */
function annotate(
  text: string,
  annotations: Annotation[],
  lang: Lang,
  active: string | null,
  onPick: (match: string | null) => void,
): ReactNode[] {
  if (annotations.length === 0) return [text];

  const found = annotations
    .map((a) => ({ annotation: a, index: text.indexOf(a.match) }))
    .filter((hit) => hit.index >= 0)
    .sort((a, b) => a.index - b.index);

  const out: ReactNode[] = [];
  let cursor = 0;

  found.forEach(({ annotation, index }, i) => {
    if (index < cursor) return;
    if (index > cursor) out.push(text.slice(cursor, index));

    const tone = annotation.tone ?? "info";
    const isActive = active === annotation.match;

    out.push(
      <button
        key={`${annotation.match}-${i}`}
        type="button"
        title={t(annotation.note, lang)}
        onClick={() => onPick(isActive ? null : annotation.match)}
        className={`cursor-pointer rounded-sm border-b border-dashed px-0.5 text-left transition-colors ${
          TONE_TEXT[tone]
        } ${TONE_BORDER[tone]} ${isActive ? "bg-white/10" : "hover:bg-white/5"}`}
      >
        {annotation.match}
      </button>,
    );
    cursor = index + annotation.match.length;
  });

  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

interface WireProps {
  label: string;
  message: WireMessage;
  lang: Lang;
  /** Injected live from the signer for steps that compute a real signature. */
  extraHeaders?: Array<[string, string]>;
}

export function Wire({ label, message, lang, extraHeaders = [] }: WireProps) {
  const [active, setActive] = useState<string | null>(null);

  const text = useMemo(() => {
    const headers = [...message.headers, ...extraHeaders]
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");
    const head = `${message.start}\n${headers}`;
    return message.body ? `${head}\n\n${message.body}` : head;
  }, [message, extraHeaders]);

  const annotations = message.annotations ?? [];
  const picked = annotations.find((a) => a.match === active);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-panel">
      <header className="flex items-center justify-between border-b border-line bg-panel-2 px-3 py-2">
        <span className="font-mono text-[11px] tracking-wider text-muted uppercase">
          {label}
        </span>
        {annotations.length > 0 && (
          <span className="text-[11px] text-muted">
            {lang === "en"
              ? `${annotations.length} annotated`
              : `注釈 ${annotations.length} 件`}
          </span>
        )}
      </header>

      <div className="wire overflow-x-auto px-3 py-3">
        {annotate(text, annotations, lang, active, setActive)}
      </div>

      {picked && (
        <footer
          className={`border-t border-line bg-panel-2 px-3 py-2 text-[12.5px] leading-relaxed ${
            TONE_TEXT[picked.tone ?? "info"]
          }`}
        >
          <span className="font-mono text-[11px] opacity-70">{picked.match}</span>
          <p className="mt-1 text-fg">{t(picked.note, lang)}</p>
        </footer>
      )}
    </section>
  );
}
