import { useEffect, useMemo, useState } from "react";
import { signRequest, type SigV4Result } from "../lib/sigv4";
import type { Lang, SigningDemo } from "../lib/types";

const COPY = {
  heading: { en: "Signature, computed here", ja: "署名をこの場で計算" },
  sub: {
    en: "Nothing is sent anywhere. WebCrypto runs the same HMAC chain AWS runs, in this tab.",
    ja: "どこにも送信しない。AWS と同じ HMAC チェーンを WebCrypto がこのタブ内で回している。",
  },
  canonical: { en: "Canonical request", ja: "canonical request" },
  canonicalNote: {
    en: "The string AWS rebuilds from your request to check your work.",
    ja: "AWS が受け取ったリクエストから組み立て直して照合する文字列。",
  },
  sts: { en: "String to sign", ja: "string to sign" },
  stsNote: {
    en: "Algorithm, timestamp, credential scope, and the hash of the canonical request.",
    ja: "アルゴリズム、タイムスタンプ、credential scope、canonical request のハッシュ。",
  },
  chain: { en: "Signing key derivation", ja: "signing key の導出" },
  chainNote: {
    en: "Date, region and service are baked into the key. A leaked signing key works for that day, that region, that service, and nothing else.",
    ja: "日付・リージョン・サービスが鍵に焼き込まれる。signing key が漏れても、その日・そのリージョン・そのサービスにしか使えない。",
  },
  signature: { en: "Signature", ja: "signature" },
  tamper: { en: "Break it", ja: "壊してみる" },
  tamperNote: {
    en: "Edit anything below. The signature is recomputed on every keystroke; AWS would reject every value that differs from the original.",
    ja: "下の値を書き換えると署名が即座に再計算される。元の値と違うものは AWS が全部拒否する。",
  },
  method: { en: "Method", ja: "メソッド" },
  path: { en: "Path", ja: "パス" },
  omitToken: {
    en: "Drop x-amz-security-token from SignedHeaders",
    ja: "SignedHeaders から x-amz-security-token を外す",
  },
  omitTokenNote: {
    en: "The single most common cause of SignatureDoesNotMatch when hand-rolling SigV4.",
    ja: "SigV4 を手で実装したときに SignatureDoesNotMatch が出る最頻出の原因。",
  },
  intact: { en: "matches the original", ja: "元の署名と一致" },
  broken: { en: "SignatureDoesNotMatch", ja: "SignatureDoesNotMatch" },
  reset: { en: "Reset", ja: "戻す" },
} as const;

function Block({
  title,
  note,
  body,
}: {
  title: string;
  note?: string;
  body: string;
}) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <h4 className="font-mono text-[11px] tracking-wider text-muted uppercase">
          {title}
        </h4>
        {note && <p className="text-[11.5px] text-muted">{note}</p>}
      </div>
      <pre className="wire overflow-x-auto rounded-md border border-line bg-ink px-3 py-2">
        {body}
      </pre>
    </div>
  );
}

export function SignatureLab({ demo, lang }: { demo: SigningDemo; lang: Lang }) {
  const [method, setMethod] = useState(demo.request.method);
  const [path, setPath] = useState(demo.request.path);
  const [headers, setHeaders] = useState<Record<string, string>>(
    demo.request.headers,
  );
  const [omitToken, setOmitToken] = useState(false);

  const [pristine, setPristine] = useState<SigV4Result | null>(null);
  const [live, setLive] = useState<SigV4Result | null>(null);

  const hasSessionToken = Boolean(demo.credentials.sessionToken);

  // The untampered signature, for comparison. Switching steps remounts this
  // component (App keys it by step id), so the editable state above is
  // reinitialised from props rather than reset inside an effect.
  useEffect(() => {
    let cancelled = false;
    void signRequest(demo.request, demo.credentials, demo.options).then(
      (result) => {
        if (!cancelled) setPristine(result);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [demo]);

  useEffect(() => {
    let cancelled = false;
    const credentials = omitToken
      ? { ...demo.credentials, sessionToken: undefined }
      : demo.credentials;

    void signRequest(
      { ...demo.request, method, path, headers },
      credentials,
      demo.options,
    ).then((result) => {
      if (!cancelled) setLive(result);
    });

    return () => {
      cancelled = true;
    };
  }, [demo, method, path, headers, omitToken]);

  const dirty = useMemo(
    () => Boolean(pristine && live && pristine.signature !== live.signature),
    [pristine, live],
  );

  if (!live || !pristine) return null;

  const copy = (key: keyof typeof COPY) => COPY[key][lang];

  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="border-b border-line bg-panel-2 px-3 py-2">
        <h3 className="text-[13px] font-semibold">{copy("heading")}</h3>
        <p className="text-[11.5px] text-muted">{copy("sub")}</p>
      </header>

      <div className="space-y-4 px-3 py-3">
        <Block
          title={copy("canonical")}
          note={copy("canonicalNote")}
          body={live.canonicalRequest}
        />
        <Block
          title={copy("sts")}
          note={copy("stsNote")}
          body={live.stringToSign}
        />

        <div>
          <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
            <h4 className="font-mono text-[11px] tracking-wider text-muted uppercase">
              {copy("chain")}
            </h4>
            <p className="text-[11.5px] text-muted">{copy("chainNote")}</p>
          </div>
          <ol className="space-y-1">
            {live.derivation.map((step) => (
              <li
                key={step.label}
                className="wire flex flex-col gap-0.5 rounded-md border border-line bg-ink px-3 py-1.5 sm:flex-row sm:items-baseline sm:gap-3"
              >
                <span className="shrink-0 text-info">{step.label}</span>
                <span className="truncate text-muted">{step.keyHex}</span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {copy("signature")}
          </h4>
          <div
            className={`wire rounded-md border px-3 py-2 ${
              dirty
                ? "border-danger bg-danger/10 text-danger"
                : "border-good bg-good/10 text-good"
            }`}
          >
            {live.signature}
            <div className="mt-1 text-[11px] opacity-80">
              {dirty ? `✗ ${copy("broken")}` : `✓ ${copy("intact")}`}
            </div>
          </div>
        </div>

        <div className="rounded-md border border-line bg-panel-2 p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h4 className="text-[12px] font-semibold text-warn">
                {copy("tamper")}
              </h4>
              <p className="text-[11.5px] text-muted">{copy("tamperNote")}</p>
            </div>
            {(dirty || omitToken) && (
              <button
                type="button"
                onClick={() => {
                  setMethod(demo.request.method);
                  setPath(demo.request.path);
                  setHeaders(demo.request.headers);
                  setOmitToken(false);
                }}
                className="cursor-pointer rounded border border-line px-2 py-1 text-[11px] text-muted hover:text-fg"
              >
                {copy("reset")}
              </button>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
            <label className="self-center font-mono text-[11px] text-muted">
              {copy("method")}
            </label>
            <input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="wire w-full rounded border border-line bg-ink px-2 py-1 outline-none focus:border-key"
            />

            <label className="self-center font-mono text-[11px] text-muted">
              {copy("path")}
            </label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="wire w-full rounded border border-line bg-ink px-2 py-1 outline-none focus:border-key"
            />

            {Object.entries(headers).map(([name, value]) => (
              <div key={name} className="contents">
                <label className="self-center truncate font-mono text-[11px] text-muted">
                  {name}
                </label>
                <input
                  value={value}
                  onChange={(e) =>
                    setHeaders((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                  className="wire w-full rounded border border-line bg-ink px-2 py-1 outline-none focus:border-key"
                />
              </div>
            ))}
          </div>

          {hasSessionToken && (
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={omitToken}
                onChange={(e) => setOmitToken(e.target.checked)}
                className="mt-0.5 cursor-pointer"
              />
              <span>
                <span className="font-mono text-[11.5px] text-warn">
                  {copy("omitToken")}
                </span>
                <span className="block text-[11.5px] text-muted">
                  {copy("omitTokenNote")}
                </span>
              </span>
            </label>
          )}
        </div>
      </div>
    </section>
  );
}
