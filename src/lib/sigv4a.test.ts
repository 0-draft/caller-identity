import { describe, expect, it } from "vitest";
import {
  bigIntTo32Bytes,
  deriveSigV4aKeyPair,
  signSigV4a,
  SIGV4A_ALGORITHM,
  toHex,
  verifySigV4a,
} from "./sigv4a";

/**
 * A note on what these tests do and do not prove.
 *
 * AWS publishes the SigV4a derivation as pseudocode but, unlike SigV4, does not
 * publish a worked example with an expected derived key that we could assert
 * against. So the derived values below are not AWS-blessed vectors. They were
 * produced by this implementation and independently reproduced by a separate
 * Python implementation of the same published pseudocode, written from the
 * documentation rather than from this code. Two implementations agreeing is
 * weaker evidence than a vendor vector, and this comment exists so nobody
 * mistakes one for the other.
 *
 * The signature is a separate matter. ECDSA is randomised in general, so a
 * SigV4a signature is not something a vendor could publish as a fixed vector
 * anyway. @noble/curves happens to default to the deterministic RFC 6979 nonce,
 * which makes ours reproducible, but AWS's own implementations sign through
 * libcrypto and theirs will not be. What is portable across both is that the
 * signature verifies against the derived public key, which is the check AWS
 * actually performs.
 */

const AWS_EXAMPLE = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

describe("key derivation", () => {
  it("is deterministic for a given access key id and secret", async () => {
    const first = await deriveSigV4aKeyPair(
      AWS_EXAMPLE.accessKeyId,
      AWS_EXAMPLE.secretAccessKey,
    );
    const second = await deriveSigV4aKeyPair(
      AWS_EXAMPLE.accessKeyId,
      AWS_EXAMPLE.secretAccessKey,
    );

    expect(first.privateKeyHex).toBe(second.privateKeyHex);
    expect(first.publicKeyHex).toBe(second.publicKeyHex);
  });

  it("matches the independent Python implementation of the published pseudocode", async () => {
    const keyPair = await deriveSigV4aKeyPair(
      AWS_EXAMPLE.accessKeyId,
      AWS_EXAMPLE.secretAccessKey,
    );

    expect(keyPair.privateKeyHex).toBe(
      "7efc8c0e65a324242818c5a50c891c6060b6a00717b7ba3cbe3c5d765be9259c",
    );
    expect(keyPair.counter).toBe(1);
  });

  it("depends on the access key id, not only the secret", async () => {
    const a = await deriveSigV4aKeyPair("AKIAIOSFODNN7EXAMPLE", "same-secret");
    const b = await deriveSigV4aKeyPair("ASIAIOSFODNN7EXAMPLE", "same-secret");

    expect(a.privateKeyHex).not.toBe(b.privateKeyHex);
  });

  it("produces a compressed SEC1 public key", async () => {
    const keyPair = await deriveSigV4aKeyPair(
      AWS_EXAMPLE.accessKeyId,
      AWS_EXAMPLE.secretAccessKey,
    );

    // 33 bytes: a 0x02 or 0x03 prefix plus the 32-byte x coordinate.
    expect(keyPair.publicKeyHex).toHaveLength(66);
    expect(["02", "03"]).toContain(keyPair.publicKeyHex.slice(0, 2));
  });
});

describe("bigIntTo32Bytes", () => {
  it("pads on the left", () => {
    expect(toHex(bigIntTo32Bytes(1n))).toBe(
      "0000000000000000000000000000000000000000000000000000000000000001",
    );
  });

  it("is big-endian", () => {
    expect(toHex(bigIntTo32Bytes(0x0102n)).slice(-4)).toBe("0102");
  });
});

describe("signing", () => {
  const canonicalRequest = [
    "GET",
    "/key.txt",
    "",
    "host:my-bucket.accesspoint.s3-global.amazonaws.com",
    "x-amz-date:20260919T120000Z",
    "x-amz-region-set:us-east-1,us-west-2",
    "",
    "host;x-amz-date;x-amz-region-set",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  ].join("\n");

  const options = {
    service: "s3",
    datetime: "20260919T120000Z",
    regionSet: ["us-east-1", "us-west-2"],
  };

  it("leaves the region out of the credential scope", async () => {
    const result = await signSigV4a(
      canonicalRequest,
      AWS_EXAMPLE,
      "host;x-amz-date;x-amz-region-set",
      options,
    );

    // SigV4 would be 20260919/us-east-1/s3/aws4_request.
    expect(result.credentialScope).toBe("20260919/s3/aws4_request");
    expect(result.credentialScope).not.toContain("us-east-1");
  });

  it("names the ECDSA algorithm in the string to sign", async () => {
    const result = await signSigV4a(
      canonicalRequest,
      AWS_EXAMPLE,
      "host;x-amz-date;x-amz-region-set",
      options,
    );

    expect(result.stringToSign.split("\n")[0]).toBe(SIGV4A_ALGORITHM);
    expect(result.authorizationHeader.startsWith(SIGV4A_ALGORITHM)).toBe(true);
  });

  it("carries the region set separately from the scope", async () => {
    const result = await signSigV4a(
      canonicalRequest,
      AWS_EXAMPLE,
      "host;x-amz-date;x-amz-region-set",
      options,
    );

    expect(result.regionSet).toBe("us-east-1,us-west-2");
  });

  it("verifies against the public half alone", async () => {
    const result = await signSigV4a(
      canonicalRequest,
      AWS_EXAMPLE,
      "host;x-amz-date;x-amz-region-set",
      options,
    );

    expect(
      verifySigV4a(
        result.signature,
        result.stringToSign,
        result.keyPair.publicKeyHex,
      ),
    ).toBe(true);
  });

  it("fails verification when the signed material is altered", async () => {
    const result = await signSigV4a(
      canonicalRequest,
      AWS_EXAMPLE,
      "host;x-amz-date;x-amz-region-set",
      options,
    );

    // The region set lives in the canonical request, so it reaches the string
    // to sign only through the hash on the last line. Altering a line that is
    // actually present is what tests the signature.
    expect(
      verifySigV4a(
        result.signature,
        result.stringToSign.replace("20260919T120000Z", "20260920T120000Z"),
        result.keyPair.publicKeyHex,
      ),
    ).toBe(false);
  });

  it("covers the canonical request through its hash", async () => {
    const original = await signSigV4a(
      canonicalRequest,
      AWS_EXAMPLE,
      "host;x-amz-date;x-amz-region-set",
      options,
    );
    const widened = await signSigV4a(
      canonicalRequest.replace("us-east-1,us-west-2", "us-east-1,eu-west-1"),
      AWS_EXAMPLE,
      "host;x-amz-date;x-amz-region-set",
      options,
    );

    // Changing the region set changes the hash, so it changes the signature
    // even though the credential scope is identical.
    expect(widened.credentialScope).toBe(original.credentialScope);
    expect(widened.signature).not.toBe(original.signature);
  });

  it("is deterministic, because this implementation signs per RFC 6979", async () => {
    const a = await signSigV4a(canonicalRequest, AWS_EXAMPLE, "host", options);
    const b = await signSigV4a(canonicalRequest, AWS_EXAMPLE, "host", options);

    // Worth stating rather than assuming: ECDSA is randomised in general, and
    // AWS's own implementations sign through libcrypto, so the same request
    // signed twice by an AWS SDK will not produce identical bytes. @noble's
    // default is the deterministic RFC 6979 nonce, so ours does. Both verify;
    // only one is reproducible.
    expect(a.signature).toBe(b.signature);
    expect(verifySigV4a(a.signature, a.stringToSign, a.keyPair.publicKeyHex)).toBe(
      true,
    );
  });
});
