import { p256 } from "@noble/curves/nist.js";

/**
 * SigV4a: the asymmetric variant, used when one signature has to be valid in
 * more than one region (S3 Multi-Region Access Points).
 *
 * Two things make it different from SigV4, and both are visible here.
 *
 * The key is a P-256 keypair derived from the same secret access key, so AWS
 * only ever stores the public half. SigV4's signing key is a shared secret;
 * this one is not.
 *
 * And the credential scope drops the region, because the regions the request is
 * valid in travel in the X-Amz-Region-Set header instead. The key is therefore
 * not scoped per region at all: the same keypair signs every request.
 *
 * WebCrypto cannot do this alone. Deriving the public key requires multiplying
 * the base point by a scalar we chose ourselves, and SubtleCrypto has no API
 * for that, so the curve arithmetic comes from @noble/curves.
 */

const encoder = new TextEncoder();

export const SIGV4A_ALGORITHM = "AWS4-ECDSA-P256-SHA256";

/** Order of the NIST P-256 group. */
const N = p256.Point.CURVE().n;

/** The maximum counter value AWS's derivation pseudocode allows. */
const MAX_COUNTER = 254;

function uint32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  parts.reduce((offset, part) => {
    out.set(part, offset);
    return offset + part.length;
  }, 0);
  return out;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}

export function bigIntTo32Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number((value >> BigInt((31 - i) * 8)) & 0xffn);
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacRaw(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, data as BufferSource),
  );
}

export interface DerivedKeyPair {
  /** The private scalar, as AWS's pseudocode produces it. */
  privateKey: bigint;
  privateKeyHex: string;
  /** Compressed SEC1 encoding of Q = k * G. */
  publicKeyHex: string;
  /** How many candidates were rejected before one landed in range. */
  counter: number;
}

/**
 * The derivation AWS documents:
 *
 *   input_key = "AWS4A" || secret
 *   context   = access_key_id || counter        (counter is one byte)
 *   key       = KDF(input_key, label, context, 256)
 *   c         = Oct2Int(key)
 *   k         = c + 1, provided c <= n - 2, else retry with counter + 1
 *
 * KDF is the NIST SP 800-108 counter-mode construction over HMAC-SHA256, whose
 * single 256-bit block is
 *
 *   HMAC(input_key, uint32be(1) || label || 0x00 || context || uint32be(256))
 *
 * The retry loop exists because a uniformly random 256-bit integer can land
 * above the group order, and a scalar out of range would not be a valid key.
 * In practice the first candidate almost always works.
 */
export async function deriveSigV4aKeyPair(
  accessKeyId: string,
  secretAccessKey: string,
): Promise<DerivedKeyPair> {
  const inputKey = encoder.encode(`AWS4A${secretAccessKey}`);
  const label = encoder.encode(SIGV4A_ALGORITHM);
  const akid = encoder.encode(accessKeyId);

  for (let counter = 1; counter <= MAX_COUNTER; counter += 1) {
    const fixedInput = concatBytes(
      uint32be(1),
      label,
      Uint8Array.of(0),
      akid,
      Uint8Array.of(counter),
      uint32be(256),
    );

    const candidate = bytesToBigInt(await hmacRaw(inputKey, fixedInput));
    if (candidate > N - 2n) continue;

    const privateKey = candidate + 1n;
    const privateBytes = bigIntTo32Bytes(privateKey);

    return {
      privateKey,
      counter,
      privateKeyHex: toHex(privateBytes),
      publicKeyHex: toHex(p256.getPublicKey(privateBytes)),
    };
  }

  throw new Error("SigV4a key derivation exhausted all 254 counter values");
}

export interface SigV4aOptions {
  service: string;
  /** ISO8601 basic format. */
  datetime: string;
  /** The regions this signature is valid in, e.g. ["us-east-1", "us-west-2"]. */
  regionSet: string[];
}

export interface SigV4aResult {
  algorithm: string;
  /** Note the missing region: `YYYYMMDD/service/aws4_request`. */
  credentialScope: string;
  stringToSign: string;
  regionSet: string;
  keyPair: DerivedKeyPair;
  /** DER-encoded ECDSA signature, lowercase hex. */
  signature: string;
  authorizationHeader: string;
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return toHex(new Uint8Array(digest));
}

/**
 * Signs an already-built canonical request. The canonical request itself is
 * produced exactly as for SigV4, except that `x-amz-region-set` is one of the
 * signed headers.
 */
export async function signSigV4a(
  canonicalRequest: string,
  credentials: { accessKeyId: string; secretAccessKey: string },
  signedHeaders: string,
  options: SigV4aOptions,
): Promise<SigV4aResult> {
  const { service, datetime, regionSet } = options;
  const date = datetime.slice(0, 8);

  // No region here. That is the whole point of the variant.
  const credentialScope = `${date}/${service}/aws4_request`;

  const stringToSign = [
    SIGV4A_ALGORITHM,
    datetime,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const keyPair = await deriveSigV4aKeyPair(
    credentials.accessKeyId,
    credentials.secretAccessKey,
  );

  const signature = p256.sign(
    encoder.encode(stringToSign),
    bigIntTo32Bytes(keyPair.privateKey),
    { format: "der" },
  );

  return {
    algorithm: SIGV4A_ALGORITHM,
    credentialScope,
    stringToSign,
    keyPair,
    regionSet: regionSet.join(","),
    signature: toHex(signature),
    authorizationHeader:
      `${SIGV4A_ALGORITHM} Credential=${credentials.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${toHex(signature)}`,
  };
}

/**
 * Verifies a SigV4a signature with the public half only, which is what AWS
 * does on its side.
 */
export function verifySigV4a(
  signatureHex: string,
  stringToSign: string,
  publicKeyHex: string,
): boolean {
  const signature = Uint8Array.from(
    signatureHex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? [],
  );
  const publicKey = Uint8Array.from(
    publicKeyHex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? [],
  );

  return p256.verify(signature, encoder.encode(stringToSign), publicKey, {
    format: "der",
  });
}
