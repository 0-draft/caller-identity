import { useMemo, type CSSProperties } from "react";
import {
  ACTOR_LABEL,
  ACTOR_SIDE,
  SIDE_LABEL,
  t,
  type Actor,
  type Lang,
  type Phase,
  type Scenario,
  type Side,
  type Step,
} from "../lib/types";

/**
 * Lifelines are tinted by which side of the trust boundary the actor sits on,
 * so a request leaving your own trust domain reads as a colour change instead
 * of something you have to already know.
 */
const SIDE_COLOR: Record<Side, string> = {
  you: "var(--color-fg)",
  aws: "var(--color-key)",
  "third-party": "var(--color-info)",
  local: "var(--color-warn)",
};

const PHASE_COLOR: Record<Phase, string> = {
  issue: "var(--color-info)",
  sign: "var(--color-key)",
  verify: "var(--color-warn)",
  authorize: "var(--color-good)",
};

// Geometry, in viewBox units. The SVG scales to the container width.
const WIDTH = 1000;
const HEADER_H = 70;
const REQUEST_DY = 34;
const RESPONSE_DY = 32;
const STEP_GAP = 20;
const TOP_PAD = 14;

/** The bracket of an actor box, wide enough for the longest label. */
const BOX_W = 148;
const BOX_H = 34;

/** Width of the loop drawn for a step that calls back into its own lifeline. */
const SELF_W = 58;

/** Extra vertical room the loop occupies. */
const SELF_DROP = 22;

/**
 * SVG has no text wrapping and no way to measure before layout, so actor labels
 * are fitted by estimating their width. CJK glyphs are roughly one em wide and
 * Latin ones a little over half, which is close enough to keep a label such as
 * "IMDS (リンクローカル)" inside its box.
 */
function fitFontSize(label: string, max = 12.5): number {
  const ems = [...label].reduce(
    // Escaped rather than literal: a literal U+3000 in source is an irregular
    // whitespace character.
    (sum, char) => sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 1 : 0.55),
    0,
  );
  const inner = BOX_W - 14;
  const natural = ems * max;
  return natural <= inner ? max : Math.max(8.5, (max * inner) / natural);
}

interface Placed {
  step: Step;
  index: number;
  requestY: number;
  responseY: number | null;
  height: number;
  top: number;
}

/** Method and path, which is the part of the request worth reading at a glance. */
function requestLabel(step: Step): string {
  if (!step.request) return "";
  const [method, path] = step.request.start.split(" ");
  const shown = path && path.length > 46 ? `${path.slice(0, 44)}…` : (path ?? "");
  return `${method} ${shown}`;
}

function responseLabel(step: Step, lang: Lang): string {
  if (!step.response) return "";
  if (step.response.summary) return t(step.response.summary, lang);
  return step.response.start.replace(/^HTTP\/[\d.]+\s*/, "");
}

export function SequenceDiagram({
  scenario,
  activeIndex,
  onSelect,
  lang,
}: {
  scenario: Scenario;
  activeIndex: number;
  onSelect: (index: number) => void;
  lang: Lang;
}) {
  const actors = useMemo(() => {
    const seen: Actor[] = [];
    for (const step of scenario.steps) {
      for (const actor of [step.from, step.to]) {
        if (!seen.includes(actor)) seen.push(actor);
      }
    }
    return seen;
  }, [scenario]);

  const placed = useMemo(() => {
    // Heights first, then prefix sums, so the layout is a pure derivation of
    // the scenario rather than a running cursor.
    const heights = scenario.steps.map(
      (s) =>
        REQUEST_DY +
        (s.response ? RESPONSE_DY : 0) +
        (s.from === s.to ? SELF_DROP : 0) +
        STEP_GAP,
    );

    return scenario.steps.map((step, index): Placed => {
      const top = heights
        .slice(0, index)
        .reduce((sum, h) => sum + h, HEADER_H + TOP_PAD);
      const requestY = top + REQUEST_DY;

      return {
        step,
        index,
        top,
        height: heights[index],
        requestY,
        responseY: step.response ? requestY + RESPONSE_DY : null,
      };
    });
  }, [scenario]);

  const totalHeight = placed.reduce(
    (sum, p) => sum + p.height,
    HEADER_H + TOP_PAD + 10,
  );

  const span = WIDTH - BOX_W;
  const x = (actor: Actor) => {
    const i = actors.indexOf(actor);
    if (actors.length === 1) return WIDTH / 2;
    return BOX_W / 2 + (span * i) / (actors.length - 1);
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-panel">
      <svg
        viewBox={`0 0 ${WIDTH} ${totalHeight}`}
        className="h-auto w-full min-w-[680px]"
        role="img"
        aria-label={
          lang === "en"
            ? `Sequence of ${scenario.steps.length} steps`
            : `${scenario.steps.length} ステップのシーケンス`
        }
      >
        <defs>
          {(["issue", "sign", "verify", "authorize"] as Phase[]).map((phase) => (
            <marker
              key={phase}
              id={`arrow-${phase}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={PHASE_COLOR[phase]} />
            </marker>
          ))}
          <marker
            id="arrow-response"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-muted)" />
          </marker>
        </defs>

        {/* Lifelines, drawn first so arrows sit on top. */}
        {actors.map((actor) => (
          <line
            key={`life-${actor}`}
            x1={x(actor)}
            y1={HEADER_H}
            x2={x(actor)}
            y2={totalHeight - 6}
            stroke={SIDE_COLOR[ACTOR_SIDE[actor]]}
            strokeWidth="1.5"
            strokeDasharray="4 5"
            opacity="0.3"
          />
        ))}

        {/* Actor headers, tinted by trust boundary. */}
        {actors.map((actor) => {
          const side = ACTOR_SIDE[actor];
          const colour = SIDE_COLOR[side];
          const label = t(ACTOR_LABEL[actor], lang);
          return (
            <g key={`head-${actor}`}>
              <rect
                x={x(actor) - BOX_W / 2}
                y={HEADER_H - BOX_H - 18}
                width={BOX_W}
                height={BOX_H}
                rx="7"
                fill="var(--color-panel-2)"
                stroke={colour}
                strokeOpacity="0.55"
              />
              <text
                x={x(actor)}
                y={HEADER_H - BOX_H / 2 - 18}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--color-fg)"
                fontSize={fitFontSize(label)}
                fontFamily="var(--font-sans)"
              >
                {label}
              </text>
              <text
                x={x(actor)}
                y={HEADER_H - 8}
                textAnchor="middle"
                fill={colour}
                fontSize="9.5"
                opacity="0.85"
                fontFamily="var(--font-mono)"
                letterSpacing="0.6"
              >
                {t(SIDE_LABEL[side], lang).toUpperCase()}
              </text>
            </g>
          );
        })}

        {placed.map(({ step, index, requestY, responseY, height, top }) => {
          const active = index === activeIndex;
          const from = x(step.from);
          const to = x(step.to);
          const selfCall = step.from === step.to;
          const mid = selfCall ? from + SELF_W / 2 + 8 : (from + to) / 2;
          const colour = PHASE_COLOR[step.phases[0]];
          const label = requestLabel(step) || t(step.title, lang);

          return (
            <g
              key={step.id}
              onClick={() => onSelect(index)}
              className="cursor-pointer"
              opacity={active ? 1 : 0.34}
            >
              {/* Generous hit area so the whole band is clickable. */}
              <rect
                x="0"
                y={top}
                width={WIDTH}
                height={height}
                rx="6"
                fill={active ? colour : "transparent"}
                opacity={active ? 0.08 : 0}
              />
              {active && (
                <rect
                  x="0"
                  y={top}
                  width="3"
                  height={height}
                  fill={colour}
                  rx="1.5"
                />
              )}

              <circle cx={from} cy={requestY} r={active ? 5 : 3.5} fill={colour} />

              {selfCall ? (
                // A step that happens inside the caller, drawn the way sequence
                // diagrams have always drawn one: a loop back to the same
                // lifeline.
                <path
                  key={`self-${index}-${activeIndex}`}
                  className={active ? "wire-draw" : undefined}
                  style={
                    active
                      ? ({ "--wire-len": `${SELF_W * 2 + 40}px` } as CSSProperties)
                      : undefined
                  }
                  d={`M ${from} ${requestY} h ${SELF_W} v 20 h ${-SELF_W}`}
                  fill="none"
                  stroke={colour}
                  strokeWidth={active ? 2.4 : 1.6}
                  markerEnd={`url(#arrow-${step.phases[0]})`}
                />
              ) : (
                <>
                  <line
                    key={`arrow-${index}-${activeIndex}`}
                    className={active ? "wire-draw" : undefined}
                    style={
                      active
                        ? ({
                            "--wire-len": `${Math.abs(to - from)}px`,
                          } as CSSProperties)
                        : undefined
                    }
                    x1={from}
                    y1={requestY}
                    x2={to}
                    y2={requestY}
                    stroke={colour}
                    strokeWidth={active ? 2.4 : 1.6}
                    markerEnd={`url(#arrow-${step.phases[0]})`}
                  />
                  {active && (
                    // The packet. Translating a <g> is the portable way to move
                    // something along an SVG line from CSS.
                    <g
                      key={`packet-${index}-${activeIndex}`}
                      className="packet"
                      style={{ "--packet-dx": `${to - from}px` } as CSSProperties}
                    >
                      <circle cx={from} cy={requestY} r="4.5" fill={colour} />
                      <circle
                        cx={from}
                        cy={requestY}
                        r="9"
                        fill={colour}
                        opacity="0.25"
                      />
                    </g>
                  )}
                </>
              )}

              <text
                x={selfCall ? mid : mid}
                y={requestY - 9}
                textAnchor={selfCall ? "start" : "middle"}
                fill={colour}
                fontSize="12"
                fontWeight={active ? 600 : 400}
                fontFamily="var(--font-mono)"
              >
                {label}
              </text>

              {responseY !== null && (
                <>
                  <line
                    x1={to}
                    y1={responseY}
                    x2={from}
                    y2={responseY}
                    stroke="var(--color-muted)"
                    strokeWidth="1.4"
                    strokeDasharray="6 4"
                    markerEnd="url(#arrow-response)"
                  />
                  <text
                    x={mid}
                    y={responseY - 8}
                    textAnchor="middle"
                    fill="var(--color-muted)"
                    fontSize="11"
                    fontFamily="var(--font-mono)"
                  >
                    {responseLabel(step, lang)}
                  </text>
                </>
              )}

              <text
                x="10"
                y={requestY + 4}
                fill={active ? colour : "var(--color-muted)"}
                fontSize="11"
                fontWeight={active ? 700 : 400}
                fontFamily="var(--font-mono)"
              >
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
