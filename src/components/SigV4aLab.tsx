import { useEffect, useState } from "react";
import { signSigV4a, verifySigV4a, type SigV4aResult } from "../lib/sigv4a";
import type { Lang } from "../lib/types";

const DEMO = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

const REGION_SETS: string[][] = [
  ["us-east-1"],
  ["us-east-1", "us-west-2"],
  ["us-west-*"],
  ["*"],
];

const COPY = {
  heading: {
    en: "One signature, several regions",
    ja: "1つの署名を複数リージョンで",
  },
  sub: {
    en: "The keypair is derived from the same secret access key, and the region moves out of the scope and into a header. Derived and signed here.",
    ja: "鍵ペアは同じ secret access key から導出する。リージョンは scope から出てヘッダに移る。ここで導出して署名している。",
  },
  regionSet: { en: "Valid in", ja: "有効なリージョン" },
  scope: { en: "Credential scope", ja: "credential scope" },
  scopeNote: {
    en: "No region. SigV4 would read 20260919/us-east-1/s3/aws4_request here; the regions are asserted by the X-Amz-Region-Set header instead, which is itself a signed header.",
    ja: "リージョンが無い。SigV4 ならここは 20260919/us-east-1/s3/aws4_request になる。リージョンは X-Amz-Region-Set ヘッダが主張し、そのヘッダ自体が署名対象になる。",
  },
  keys: { en: "Derived keypair", ja: "導出された鍵ペア" },
  keysNote: {
    en: "The private half never leaves your process and AWS never holds it. AWS stores only the public half, which is what makes the same signature checkable in more than one region without shipping a shared secret everywhere.",
    ja: "秘密鍵側はプロセスの外に出ず、AWS も保持しない。AWS が持つのは公開鍵側だけ。だから共有秘密をあちこちに配らなくても、同じ署名を複数リージョンで検証できる。",
  },
  sts: { en: "String to sign", ja: "string to sign" },
  signature: { en: "Signature (DER, hex)", ja: "署名 (DER, hex)" },
  verified: {
    en: "verifies against the public key alone",
    ja: "公開鍵だけで検証が通る",
  },
  notVerified: { en: "does not verify", ja: "検証が通らない" },
  determinism: {
    en: "Reproducible here because this implementation uses the RFC 6979 deterministic nonce. AWS SDKs sign through libcrypto and will produce different bytes for the same request. Both verify; only one is reproducible.",
    ja: "この実装は RFC 6979 の決定的 nonce を使うので再現する。AWS SDK は libcrypto 経由で署名するため、同じリクエストでも毎回バイト列が変わる。どちらも検証は通り、再現するのは一方だけ。",
  },
} as const;

function canonicalRequestFor(regionSet: string[]): string {
  return [
    "GET",
    "/key.txt",
    "",
    "host:my-bucket.accesspoint.s3-global.amazonaws.com",
    "x-amz-date:20260919T120000Z",
    `x-amz-region-set:${regionSet.join(",")}`,
    "",
    "host;x-amz-date;x-amz-region-set",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  ].join("\n");
}

export function SigV4aLab({ lang }: { lang: Lang }) {
  const [regionSet, setRegionSet] = useState<string[]>(REGION_SETS[1]);
  const [result, setResult] = useState<SigV4aResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void signSigV4a(
      canonicalRequestFor(regionSet),
      DEMO,
      "host;x-amz-date;x-amz-region-set",
      { service: "s3", datetime: "20260919T120000Z", regionSet },
    ).then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [regionSet]);

  if (!result) return null;

  const ok = verifySigV4a(
    result.signature,
    result.stringToSign,
    result.keyPair.publicKeyHex,
  );

  return (
    <section className="rounded-lg border border-line bg-panel">
      <header className="border-b border-line bg-panel-2 px-3 py-2">
        <h3 className="text-[13px] font-semibold">{COPY.heading[lang]}</h3>
        <p className="text-[11.5px] text-muted">{COPY.sub[lang]}</p>
      </header>

      <div className="space-y-3 px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.regionSet[lang]}
          </span>
          {REGION_SETS.map((set) => (
            <button
              key={set.join(",")}
              type="button"
              onClick={() => setRegionSet(set)}
              className={`cursor-pointer rounded border px-2 py-1 font-mono text-[11.5px] transition-colors ${
                regionSet.join(",") === set.join(",")
                  ? "border-amber bg-amber/10 text-amber"
                  : "border-line text-muted hover:text-fg"
              }`}
            >
              {set.join(",")}
            </button>
          ))}
        </div>

        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.scope[lang]}
          </h4>
          <pre className="wire overflow-x-auto rounded-md border border-line bg-ink px-3 py-2 text-amber">
            {result.credentialScope}
          </pre>
          <p className="mt-1 text-[12px] leading-relaxed text-fg/85">
            {COPY.scopeNote[lang]}
          </p>
        </div>

        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.keys[lang]}
          </h4>
          <pre className="wire overflow-x-auto rounded-md border border-line bg-ink px-3 py-2">
            {`private  ${result.keyPair.privateKeyHex}
public   ${result.keyPair.publicKeyHex}
counter  ${result.keyPair.counter}`}
          </pre>
          <p className="mt-1 text-[12px] leading-relaxed text-fg/85">
            {COPY.keysNote[lang]}
          </p>
        </div>

        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.sts[lang]}
          </h4>
          <pre className="wire overflow-x-auto rounded-md border border-line bg-ink px-3 py-2">
            {result.stringToSign}
          </pre>
        </div>

        <div>
          <h4 className="mb-1 font-mono text-[11px] tracking-wider text-muted uppercase">
            {COPY.signature[lang]}
          </h4>
          <div
            className={`wire rounded-md border px-3 py-2 ${
              ok
                ? "border-good bg-good/10 text-good"
                : "border-danger bg-danger/10 text-danger"
            }`}
          >
            {result.signature}
            <div className="mt-1 text-[11px] opacity-80">
              {ok ? `✓ ${COPY.verified[lang]}` : `✗ ${COPY.notVerified[lang]}`}
            </div>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {COPY.determinism[lang]}
          </p>
        </div>
      </div>
    </section>
  );
}
