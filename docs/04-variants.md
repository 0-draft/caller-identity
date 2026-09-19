**English** | [日本語](04-variants.ja.md)

# Presigned URLs and SigV4a

[Back to notes](README.md)

Two variations on the same signature. One moves it into a URL, the other makes it
asymmetric. Both are worth understanding because both change what the signature protects.

## Presigned URLs

The auth moves from the `Authorization` header into the query string. Everything else
about the canonical request is unchanged.

```text
https://examplebucket.s3.amazonaws.com/test.txt
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request
  &X-Amz-Date=20130524T000000Z
  &X-Amz-Expires=86400
  &X-Amz-SignedHeaders=host
  &X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404
```

Two differences from header auth carry the lesson.

**The payload hash is the literal `UNSIGNED-PAYLOAD`.** At signing time nobody knows what
will be uploaded, so the body cannot be covered. A presigned `PUT` therefore authorises a
destination, not a set of bytes: whoever holds the URL chooses the content.

**The session token is a query parameter**, part of the canonical request, rather than a
signed header.

### What it actually is

A bearer credential with an expiry.

```mermaid
flowchart LR
  you["You<br/>hold the credential"] -->|sign locally| url["A URL"]
  url --> anyone["Anyone at all<br/>no AWS identity needed"]
  anyone -->|"plain GET"| s3["S3"]
  s3 -->|"CloudTrail records you"| log["Your principal"]

  style url stroke:#ff9900
  style log stroke:#ff6b6b
```

Three consequences that follow directly and surprise people anyway.

- **It cannot be revoked individually.** Signing registers nothing with AWS. Killing one
  presigned URL means rotating or disabling the credential that signed it.
- **CloudTrail attributes the call to you**, not to whoever used the URL.
- **URLs leak in ordinary ways.** Browser history, referrer headers, proxy logs, chat
  messages. A presigned URL pasted into a ticket is a credential in a ticket.

`X-Amz-Expires` is the only thing bounding the damage. S3 caps it at 604800 seconds,
seven days, because the signing key itself is valid only that long.

## SigV4a

For a signature that must be valid in more than one region, such as an S3 Multi-Region
Access Point. Symmetric signing cannot do this without shipping the shared secret to every
region that verifies, so the scheme goes asymmetric.

### Key derivation

The keypair comes from the secret access key you already have.

```text
input_key = "AWS4A" || secret
label     = "AWS4-ECDSA-P256-SHA256"
context   = access_key_id || counter        (counter is one byte)

key = KDF(input_key, label, context, 256)   NIST SP 800-108, counter mode, HMAC-SHA256
c   = Oct2Int(key)
if c > n - 2: counter++ and retry
else:         k = c + 1        private key
              Q = k * G        public key
```

The retry loop is not decoration. A uniformly random 256-bit integer can land above the
P-256 group order, and a scalar out of range is not a valid key. In practice the first
candidate works.

The single KDF block expands to:

```text
HMAC(input_key, uint32be(1) || label || 0x00 || access_key_id || counter || uint32be(256))
```

### What changes

```mermaid
flowchart TB
  subgraph v4["SigV4"]
    a1["scope: date/region/service/aws4_request"]
    a2["HMAC, shared secret"]
    a3["every verifying region needs the secret"]
    a1 --> a2 --> a3
  end

  subgraph v4a["SigV4a"]
    b1["scope: date/service/aws4_request<br/>no region"]
    b2["ECDSA P-256, keypair"]
    b3["verifying regions need only the public key"]
    b1 --> b2 --> b3
  end
```

The region leaves the credential scope and reappears in `X-Amz-Region-Set`, which is
itself a signed header, so the set of regions a signature claims to be valid in is covered
by the signature. Wildcards are allowed: `us-west-*`, or `*`.

Because the key is no longer scoped by date, region or service, SigV4's blast-radius
control is gone. The same keypair signs everything. That is the trade for multi-region
validity.

### A practical note

WebCrypto cannot implement this alone. Deriving the public key means multiplying the base
point by a scalar you chose, and `SubtleCrypto` exposes no scalar multiplication, so the
curve arithmetic has to come from a library. This repository uses `@noble/curves`.

One consequence worth stating: `@noble/curves` defaults to the RFC 6979 deterministic
nonce, so signing the same request twice here gives identical bytes. AWS SDKs sign through
libcrypto and will not. Both verify; only one is reproducible, which matters if you ever
try to write a fixed test vector for a SigV4a signature.
