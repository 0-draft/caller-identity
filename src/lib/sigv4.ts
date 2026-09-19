/**
 * A real AWS Signature Version 4 implementation running on WebCrypto.
 *
 * Every intermediate value is returned, not just the final signature, because
 * the intermediates are the whole point: the canonical request is what AWS
 * rebuilds on its side, and the signing-key chain is what scopes a leaked key
 * to one day, one region and one service.
 *
 * Verified against the signature examples published by AWS. See sigv4.test.ts.
 */

const encoder = new TextEncoder();

export const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** Payload hash sentinel accepted by S3 in place of a real body hash. */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface SigV4Request {
  method: string;
  /** Path only, already in the form the server will see, e.g. `/-/vaults/examplevault`. */
  path: string;
  /** Query parameters as ordered pairs. They are sorted during canonicalisation. */
  query?: Array<[string, string]>;
  /** Headers to sign. Names are case-insensitive; `host` is required. */
  headers: Record<string, string>;
  body?: string;
}

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** Present only for temporary credentials issued by STS. */
  sessionToken?: string;
}

export interface SigV4Options {
  region: string;
  service: string;
  /** ISO8601 basic format, e.g. `20120525T002453Z`. */
  datetime: string;
  /**
   * S3 signs the path as-is; every other service URI-encodes it a second time.
   * Defaults to `true` (the non-S3 behaviour).
   */
  doubleEncodePath?: boolean;
  /**
   * Overrides the computed body hash. Use {@link UNSIGNED_PAYLOAD} for large
   * S3 uploads, or supply a precomputed digest.
   */
  payloadHash?: string;
}

export interface DerivationStep {
  /** Human-readable label, e.g. `kDate = HMAC("AWS4" + secret, "20120525")`. */
  label: string;
  input: string;
  keyHex: string;
}

export interface SigV4Result {
  canonicalRequest: string;
  canonicalRequestHash: string;
  credentialScope: string;
  stringToSign: string;
  signedHeaders: string;
  payloadHash: string;
  derivation: DerivationStep[];
  signature: string;
  authorizationHeader: string;
  /** The headers as they go on the wire, including Authorization. */
  wireHeaders: Record<string, string>;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(data)));
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

/**
 * RFC 3986 percent-encoding. AWS treats only `A-Za-z0-9-_.~` as unreserved,
 * which is stricter than `encodeURIComponent` (it leaves `!*'()` alone).
 */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const char of value) {
    if (/[A-Za-z0-9\-_.~]/.test(char)) {
      out += char;
    } else if (char === "/" && !encodeSlash) {
      out += char;
    } else {
      for (const byte of encoder.encode(char)) {
        out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

function canonicalPath(path: string, doubleEncode: boolean): string {
  if (path === "") return "/";
  if (!doubleEncode) return path;
  return path
    .split("/")
    .map((segment) => uriEncode(segment))
    .join("/");
}

function canonicalQuery(query: Array<[string, string]>): string {
  return query
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

interface CanonicalHeaders {
  canonical: string;
  signedHeaders: string;
}

function canonicalHeaders(headers: Record<string, string>): CanonicalHeaders {
  const normalised = Object.entries(headers)
    .map(
      ([name, value]) =>
        [name.toLowerCase().trim(), value.trim().replace(/\s+/g, " ")] as const,
    )
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return {
    canonical: normalised.map(([n, v]) => `${n}:${v}\n`).join(""),
    signedHeaders: normalised.map(([n]) => n).join(";"),
  };
}

/**
 * Everything after the canonical request is identical for header auth and
 * query auth, so both paths share this.
 */
async function finishSignature(
  canonicalRequest: string,
  credentials: SigV4Credentials,
  options: SigV4Options,
): Promise<{
  canonicalRequestHash: string;
  credentialScope: string;
  stringToSign: string;
  derivation: DerivationStep[];
  signature: string;
}> {
  const { region, service, datetime } = options;
  const date = datetime.slice(0, 8);

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    credentialScope,
    canonicalRequestHash,
  ].join("\n");

  const kDate = await hmac(
    encoder.encode(`AWS4${credentials.secretAccessKey}`),
    date,
  );
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  return {
    canonicalRequestHash,
    credentialScope,
    stringToSign,
    signature,
    derivation: [
      {
        label: 'kDate = HMAC("AWS4" + secret, date)',
        input: date,
        keyHex: toHex(kDate),
      },
      {
        label: "kRegion = HMAC(kDate, region)",
        input: region,
        keyHex: toHex(kRegion),
      },
      {
        label: "kService = HMAC(kRegion, service)",
        input: service,
        keyHex: toHex(kService),
      },
      {
        label: 'kSigning = HMAC(kService, "aws4_request")',
        input: "aws4_request",
        keyHex: toHex(kSigning),
      },
    ],
  };
}

export interface PresignOptions extends SigV4Options {
  /** Seconds the URL stays valid. S3 caps this at 604800 (seven days). */
  expiresIn: number;
}

export interface PresignResult extends SigV4Result {
  /** The full URL, signature included. */
  url: string;
  /** The auth parameters added to the query, in the order they are appended. */
  authParams: Array<[string, string]>;
}

/**
 * Signs a request into a URL instead of a header.
 *
 * Two differences from header auth matter. The payload hash is the literal
 * UNSIGNED-PAYLOAD, because at signing time nobody knows what will be uploaded.
 * And the session token travels as a query parameter that is part of the
 * canonical request, rather than as a signed header. The result is a bearer
 * credential: the URL alone is enough, for anyone holding it, until it expires.
 */
export async function presignUrl(
  request: SigV4Request,
  credentials: SigV4Credentials,
  options: PresignOptions,
): Promise<PresignResult> {
  const { region, service, datetime, expiresIn } = options;
  const credentialScope = `${datetime.slice(0, 8)}/${region}/${service}/aws4_request`;
  const doubleEncode = options.doubleEncodePath ?? true;

  const { canonical, signedHeaders } = canonicalHeaders(request.headers);

  const authParams: Array<[string, string]> = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${credentials.accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", datetime],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  if (credentials.sessionToken) {
    authParams.push(["X-Amz-Security-Token", credentials.sessionToken]);
  }

  const payloadHash = options.payloadHash ?? UNSIGNED_PAYLOAD;
  const query = [...(request.query ?? []), ...authParams];

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(request.path, doubleEncode),
    canonicalQuery(query),
    canonical,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const finished = await finishSignature(canonicalRequest, credentials, options);

  const host = request.headers.host ?? request.headers.Host ?? "";
  const encodedQuery = [...query, ["X-Amz-Signature", finished.signature]]
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
    .join("&");

  return {
    ...finished,
    canonicalRequest,
    signedHeaders,
    payloadHash,
    authorizationHeader: "",
    wireHeaders: { ...request.headers },
    authParams,
    url: `https://${host}${canonicalPath(request.path, false)}?${encodedQuery}`,
  };
}

export async function signRequest(
  request: SigV4Request,
  credentials: SigV4Credentials,
  options: SigV4Options,
): Promise<SigV4Result> {
  // Scope, string to sign and the key chain all come from finishSignature.
  const doubleEncode = options.doubleEncodePath ?? true;

  // The session token is part of the signed material. Omitting it from
  // SignedHeaders is the classic cause of SignatureDoesNotMatch.
  const headers: Record<string, string> = { ...request.headers };
  if (credentials.sessionToken) {
    headers["x-amz-security-token"] = credentials.sessionToken;
  }

  const payloadHash =
    options.payloadHash ??
    (request.body ? await sha256Hex(request.body) : EMPTY_PAYLOAD_SHA256);

  const { canonical, signedHeaders } = canonicalHeaders(headers);

  const canonicalRequest = [
    request.method.toUpperCase(),
    canonicalPath(request.path, doubleEncode),
    canonicalQuery(request.query ?? []),
    canonical,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const finished = await finishSignature(canonicalRequest, credentials, options);

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${finished.credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${finished.signature}`;

  return {
    ...finished,
    canonicalRequest,
    signedHeaders,
    payloadHash,
    authorizationHeader,
    wireHeaders: { ...headers, authorization: authorizationHeader },
  };
}
