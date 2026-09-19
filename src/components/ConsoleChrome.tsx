import { useState } from "react";
import type { Lang } from "../lib/types";

/**
 * Console-flavoured chrome. Deliberately an homage rather than a copy: no AWS
 * logo, no wordmark, no claim of affiliation, and the footer says so. The
 * borrowed layout is doing a job here, because the page is about the thing that
 * console sits on top of.
 */

const COPY = {
  search: {
    en: "Search for services, features, and requests you cannot replay",
    ja: "サービス、機能、リプレイできないリクエストを検索",
  },
  account: { en: "example-account", ja: "example-account" },
  regionNote: {
    en: "The signing key is scoped to one region. This selector is not.",
    ja: "signing key はリージョンに紐づく。このセレクタは紐づかない。",
  },
  breadcrumb: { en: "Trust relationships", ja: "信頼関係" },
  cost: { en: "Estimated monthly cost", ja: "月額見積もり" },
  costValue: {
    en: "$0.00 · static page, no backend",
    ja: "$0.00 · 静的ページ、バックエンド無し",
  },
  signOut: { en: "Sign out", ja: "サインアウト" },
  signOutNote: {
    en: "You were never signed in. Nothing here talks to AWS.",
    ja: "そもそもサインインしていない。ここから AWS には一切通信しない。",
  },
} as const;

const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1"] as const;

export function ConsoleChrome({
  lang,
  onLangChange,
}: {
  lang: Lang;
  onLangChange: (lang: Lang) => void;
}) {
  const [region, setRegion] = useState<string>(REGIONS[0]);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  };

  return (
    <>
      <div className="border-b border-black/40 bg-squid">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-2">
          <span className="font-mono text-[15px] font-semibold tracking-tight text-amber">
            caller-identity
          </span>

          <div className="hidden min-w-0 flex-1 items-center sm:flex">
            <div className="w-full max-w-md truncate rounded border border-line bg-ink/60 px-3 py-1.5 text-[12px] text-muted">
              {COPY.search[lang]}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <select
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                flash(COPY.regionNote[lang]);
              }}
              title={COPY.regionNote[lang]}
              className="cursor-pointer rounded border border-line bg-ink/60 px-2 py-1.5 font-mono text-[11.5px] text-fg"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <span className="hidden rounded border border-line px-2 py-1.5 font-mono text-[11.5px] text-muted md:inline">
              {COPY.account[lang]}
            </span>

            <button
              type="button"
              onClick={() => flash(COPY.signOutNote[lang])}
              className="cursor-pointer rounded border border-line px-2 py-1.5 text-[11.5px] text-muted hover:text-fg"
            >
              {COPY.signOut[lang]}
            </button>

            <div className="flex overflow-hidden rounded border border-line">
              {(["en", "ja"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => onLangChange(code)}
                  className={`cursor-pointer px-2.5 py-1.5 font-mono text-[11.5px] transition-colors ${
                    lang === code
                      ? "bg-amber/20 text-amber"
                      : "text-muted hover:text-fg"
                  }`}
                >
                  {code === "en" ? "EN" : "日本語"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-4 py-2 font-mono text-[11.5px] text-muted">
          <span>IAM</span>
          <span className="opacity-40">/</span>
          <span>Roles</span>
          <span className="opacity-40">/</span>
          <span>AppRole</span>
          <span className="opacity-40">/</span>
          <span className="text-amber">{COPY.breadcrumb[lang]}</span>

          <span className="ml-auto hidden items-center gap-2 lg:flex">
            <span className="opacity-70">{COPY.cost[lang]}:</span>
            <span className="text-good">{COPY.costValue[lang]}</span>
          </span>
        </div>
      </div>

      {toast && (
        <div className="fixed right-4 bottom-4 z-50 max-w-xs rounded-md border border-amber/60 bg-panel-2 px-3 py-2 text-[12px] shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
