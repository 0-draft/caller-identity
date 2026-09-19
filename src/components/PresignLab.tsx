import { useEffect, useState } from "react";
import { presignUrl, type PresignResult } from "../lib/sigv4";
import type { Lang } from "../lib/types";

const DEMO = {
  accessKeyId: "ASIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  sessionToken: "IQoJb3JpZ2luX2VjEBYaCXVzLWVhc3QtMSJHMEUCIQDEXAMPLE",
};

const EXPIRY_CHOICES = [60, 300, 900, 86400, 604800] as const;

const COPY = {
  heading: {
    en: "Sign it into a URL instead",
    ja: "ヘッダではなく URL に署名する",
  },
  sub: {
    en: "The same canonical request, with the auth moved into the query string. Computed here, live.",
    ja: "canonical request は同じで、認証情報をクエリ文字列に移しただけ。ここでライブに計算している。",
  },
  expiry: { en: "Valid for", ja: "有効期間" },
  url: { en: "The URL", ja: "できた URL" },
  canonical: { en: "Canonical request", ja: "canonical request" },
  note: {
    en: "Nothing else is needed to use it. No header, no SDK, no key. Whoever holds this string is the caller until it expires, which is why a presigned URL in a log or a chat message is a credential leak.",
    ja: "使うのに他は何も要らない。ヘッダも SDK もキーも不要。この文字列を持っている者が期限まで呼び出し元になる。だからログやチャットに貼られた presigned URL はクレデンシャル漏洩そのもの。",
  },
  payload: {
    en: "The last line of the canonical request is the literal UNSIGNED-PAYLOAD, because at signing time nobody knows what will be uploaded. A presigned PUT therefore covers the destination, not the bytes.",
    ja: "canonical request の最終行は文字列 UNSIGNED-PAYLOAD そのもの。署名時点では何がアップロードされるか分からないから。つまり presigned な PUT が保証するのは宛先であって中身ではない。",
  },
  token: {
    en: "With temporary credentials the session token goes in the query string and is signed there, not as a header.",
    ja: "一時クレデンシャルの場合、session token はヘッダではなくクエリ文字列に入り、そこで署名対象になる。",
  },
  maxNote: {
    en: "604800 seconds is seven days, the ceiling S3 allows, because the signing key itself is only valid that long.",
    ja: "604800 秒は7日で、S3 が許す上限。signing key 自体がその期間しか有効でないため。",
  },
} as const;

function humanExpiry(seconds: number, lang: Lang): string {
  if (seconds >= 86400) {
    const days = seconds / 86400;
    return lang === "en" ? `${days} day${days > 1 ? "s" : ""}` : `${days}日`;
  }
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return lang === "en" ? `${minutes} min` : `${minutes}分`;
  }
  return lang === "en" ? `${seconds}s` : `${seconds}秒`;
}

export function PresignLab({ lang }: { lang: Lang }) {
  const [expiresIn, setExpiresIn] = useState<number>(900);
  const [result, setResult] = useState<PresignResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void presignUrl(
      {
        method: "GET",
        path: "/key.txt",
        headers: { host: "my-bucket.s3.us-east-1.amazonaws.com" },
      },
      DEMO,
      {
        region: "us-east-1",
        service: "s3",
        datetime: "20260919T120000Z",
        expiresIn,
        doubleEncodePath: false,
      },
    ).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [expiresIn]);

  if (!result) return null;

  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="border-b border-line bg-panel-2 px-3 py-2">
        <h3 className="text-[13px] font-semibold">{COPY.heading[lang]}</h3>
        <p className="text-[11.5px] text-muted">{COPY.sub[lang]}</p>
      </header>

      <div className="space-y-3 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.expiry[lang]}
          </span>
          {EXPIRY_CHOICES.map((seconds) => (
            <button
              key={seconds}
              type="button"
              onClick={() => setExpiresIn(seconds)}
              className={`cursor-pointer rounded border px-2 py-1 font-mono text-[11.5px] transition-colors ${
                expiresIn === seconds
                  ? "border-amber bg-amber/10 text-amber"
                  : "border-line text-muted hover:text-fg"
              }`}
            >
              {humanExpiry(seconds, lang)}
            </button>
          ))}
          {expiresIn === 604800 && (
            <span className="text-[11.5px] text-warn">{COPY.maxNote[lang]}</span>
          )}
        </div>

        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.url[lang]}
          </h4>
          <pre className="wire overflow-x-auto rounded-md border border-amber/50 bg-amber/5 px-3 py-2 text-amber">
            {result.url.replace(/&/g, "\n  &")}
          </pre>
          <p className="mt-1 text-[12px] leading-relaxed text-fg/85">
            {COPY.note[lang]}
          </p>
        </div>

        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.canonical[lang]}
          </h4>
          <pre className="wire overflow-x-auto rounded-md border border-line bg-ink px-3 py-2">
            {result.canonicalRequest}
          </pre>
          <p className="mt-1 text-[12px] leading-relaxed text-fg/85">
            {COPY.payload[lang]}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-fg/85">
            {COPY.token[lang]}
          </p>
        </div>
      </div>
    </section>
  );
}
