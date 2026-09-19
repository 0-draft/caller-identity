import { describe, expect, it } from "vitest";
import {
  EMPTY_PAYLOAD_SHA256,
  signRequest,
  uriEncode,
  type SigV4Credentials,
} from "./sigv4";

/**
 * Test vectors published by AWS in the Amazon Glacier "Example Signature
 * Calculation" reference. They are the oracle: if our canonical request, our
 * string to sign and our final signature all match theirs byte for byte, the
 * signer is computing what AWS computes.
 *
 * https://docs.aws.amazon.com/amazonglacier/latest/dev/amazon-glacier-signing-requests.html
 */
const AWS_EXAMPLE: SigV4Credentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("signRequest against the AWS published vectors", () => {
  it("reproduces the Create Vault signature", async () => {
    const result = await signRequest(
      {
        method: "PUT",
        path: "/-/vaults/examplevault",
        headers: {
          host: "glacier.us-east-1.amazonaws.com",
          "x-amz-date": "20120525T002453Z",
          "x-amz-glacier-version": "2012-06-01",
        },
      },
      AWS_EXAMPLE,
      { region: "us-east-1", service: "glacier", datetime: "20120525T002453Z" },
    );

    expect(result.canonicalRequest).toBe(
      [
        "PUT",
        "/-/vaults/examplevault",
        "",
        "host:glacier.us-east-1.amazonaws.com",
        "x-amz-date:20120525T002453Z",
        "x-amz-glacier-version:2012-06-01",
        "",
        "host;x-amz-date;x-amz-glacier-version",
        EMPTY_PAYLOAD_SHA256,
      ].join("\n"),
    );

    expect(result.canonicalRequestHash).toBe(
      "5f1da1a2d0feb614dd03d71e87928b8e449ac87614479332aced3a701f916743",
    );

    expect(result.stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20120525T002453Z",
        "20120525/us-east-1/glacier/aws4_request",
        "5f1da1a2d0feb614dd03d71e87928b8e449ac87614479332aced3a701f916743",
      ].join("\n"),
    );

    expect(result.signature).toBe(
      "3ce5b2f2fffac9262b4da9256f8d086b4aaf42eba5f111c21681a65a127b7c2a",
    );

    expect(result.authorizationHeader).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20120525/us-east-1/glacier/aws4_request, " +
        "SignedHeaders=host;x-amz-date;x-amz-glacier-version, " +
        "Signature=3ce5b2f2fffac9262b4da9256f8d086b4aaf42eba5f111c21681a65a127b7c2a",
    );
  });

  /**
   * The same page publishes a second example, for the streaming Upload Archive
   * call. Its canonical request reproduces exactly, but its published signature
   * (b092397439375d59119072764a1e9a144677c43d9906fd98a5742c57a2855de6) does
   * not: from the canonical request the page itself prints, both this signer
   * and an independent Python implementation produce e8ba379a74... instead.
   * Adding the x-amz-archive-description and x-amz-sha256-tree-hash headers
   * that the page's request syntax shows but its canonical request omits gives
   * a third value, so that is not the explanation either.
   *
   * The AWS-published signature appears to be stale, so we assert the part that
   * is verifiable: the canonical request, which is what AWS rebuilds on its
   * side, matches the documentation byte for byte.
   */
  it("reproduces the streaming Upload Archive canonical request", async () => {
    const payloadHash =
      "726e392cb4d09924dbad1cc0ba3b00c3643d03d14cb4b823e2f041cff612a628";

    const result = await signRequest(
      {
        method: "POST",
        path: "/-/vaults/examplevault",
        headers: {
          host: "glacier.us-east-1.amazonaws.com",
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": "20120507T000000Z",
          "x-amz-glacier-version": "2012-06-01",
        },
      },
      AWS_EXAMPLE,
      {
        region: "us-east-1",
        service: "glacier",
        datetime: "20120507T000000Z",
        payloadHash,
      },
    );

    expect(result.canonicalRequest).toBe(
      [
        "POST",
        "/-/vaults/examplevault",
        "",
        "host:glacier.us-east-1.amazonaws.com",
        `x-amz-content-sha256:${payloadHash}`,
        "x-amz-date:20120507T000000Z",
        "x-amz-glacier-version:2012-06-01",
        "",
        "host;x-amz-content-sha256;x-amz-date;x-amz-glacier-version",
        payloadHash,
      ].join("\n"),
    );

    // Cross-checked against an independent implementation, not against the
    // page's published value. See the comment above.
    expect(result.signature).toBe(
      "e8ba379a747bc294584102fd2430f7a563696740882e149c87b15754e7c10a89",
    );
  });

  it("derives the payload hash from the body itself", async () => {
    // AWS states this body hashes to the x-amz-content-sha256 above, so hashing
    // it ourselves is an independent check on the digest path.
    const result = await signRequest(
      {
        method: "POST",
        path: "/-/vaults/examplevault",
        headers: { host: "glacier.us-east-1.amazonaws.com" },
        body: "Welcome to Amazon Glacier.",
      },
      AWS_EXAMPLE,
      { region: "us-east-1", service: "glacier", datetime: "20120507T000000Z" },
    );

    expect(result.payloadHash).toBe(
      "726e392cb4d09924dbad1cc0ba3b00c3643d03d14cb4b823e2f041cff612a628",
    );
  });
});

describe("what the signature actually covers", () => {
  const base = {
    method: "GET",
    path: "/my-bucket/key.txt",
    headers: {
      host: "s3.us-east-1.amazonaws.com",
      "x-amz-date": "20260919T120000Z",
    },
  } as const;

  const opts = {
    region: "us-east-1",
    service: "s3",
    datetime: "20260919T120000Z",
    doubleEncodePath: false,
  };

  it("changes when a signed header value is tampered with", async () => {
    const original = await signRequest(base, AWS_EXAMPLE, opts);
    const tampered = await signRequest(
      { ...base, headers: { ...base.headers, host: "s3.us-west-2.amazonaws.com" } },
      AWS_EXAMPLE,
      opts,
    );

    expect(tampered.signature).not.toBe(original.signature);
  });

  it("changes when the body is tampered with", async () => {
    const original = await signRequest(
      { ...base, method: "PUT", body: "hello" },
      AWS_EXAMPLE,
      opts,
    );
    const tampered = await signRequest(
      { ...base, method: "PUT", body: "hellp" },
      AWS_EXAMPLE,
      opts,
    );

    expect(tampered.signature).not.toBe(original.signature);
  });

  it("scopes the signing key to date, region and service", async () => {
    const s3 = await signRequest(base, AWS_EXAMPLE, opts);
    const dynamodb = await signRequest(base, AWS_EXAMPLE, {
      ...opts,
      service: "dynamodb",
    });
    const tomorrow = await signRequest(base, AWS_EXAMPLE, {
      ...opts,
      datetime: "20260920T120000Z",
    });

    const kSigning = (r: Awaited<ReturnType<typeof signRequest>>) =>
      r.derivation.at(-1)!.keyHex;

    expect(kSigning(dynamodb)).not.toBe(kSigning(s3));
    expect(kSigning(tomorrow)).not.toBe(kSigning(s3));
  });
});

describe("temporary credentials", () => {
  it("folds the session token into SignedHeaders", async () => {
    const result = await signRequest(
      {
        method: "GET",
        path: "/",
        headers: {
          host: "s3.us-east-1.amazonaws.com",
          "x-amz-date": "20260919T120000Z",
        },
      },
      {
        accessKeyId: "ASIAIOSFODNN7EXAMPLE",
        secretAccessKey: AWS_EXAMPLE.secretAccessKey,
        sessionToken: "IQoJb3JpZ2luX2VjEExampleSessionToken",
      },
      { region: "us-east-1", service: "s3", datetime: "20260919T120000Z" },
    );

    expect(result.signedHeaders).toBe("host;x-amz-date;x-amz-security-token");
    expect(result.wireHeaders["x-amz-security-token"]).toBe(
      "IQoJb3JpZ2luX2VjEExampleSessionToken",
    );
  });

  it("produces a different signature than the same request without the token", async () => {
    const request = {
      method: "GET",
      path: "/",
      headers: {
        host: "s3.us-east-1.amazonaws.com",
        "x-amz-date": "20260919T120000Z",
      },
    };
    const opts = {
      region: "us-east-1",
      service: "s3",
      datetime: "20260919T120000Z",
    };

    const withToken = await signRequest(
      request,
      { ...AWS_EXAMPLE, sessionToken: "IQoJb3JpZ2luX2Vj" },
      opts,
    );
    const withoutToken = await signRequest(request, AWS_EXAMPLE, opts);

    expect(withToken.signature).not.toBe(withoutToken.signature);
  });
});

describe("uriEncode", () => {
  it("is stricter than encodeURIComponent", () => {
    expect(uriEncode("a!b*c'd(e)")).toBe("a%21b%2Ac%27d%28e%29");
  });

  it("leaves unreserved characters alone", () => {
    expect(uriEncode("AZaz09-_.~")).toBe("AZaz09-_.~");
  });

  it("encodes multi-byte characters per UTF-8 byte", () => {
    expect(uriEncode("あ")).toBe("%E3%81%82");
  });
});
