**English** | [日本語](README.ja.md)

# caller-identity

What actually goes over the wire when AWS decides who you are.

Pick a path a credential can take, step through it, and read the real HTTP request at each
hop alongside what AWS does with it on its side. Every signature on the page is computed in
the browser by WebCrypto rather than pasted in, so you can edit a header and watch the
signature stop matching.

Live at <https://0-draft.github.io/caller-identity/>.

## Why this exists

The AWS documentation explains SigV4 correctly and explains STS correctly, but it explains
them in separate places, and neither lets you break anything. The gap this fills is the
one between "I have read how the signature is computed" and "I can look at a failing
request and say which of the three components is missing."

## What it covers

Five paths, from the one nobody should use to the one that did not exist two years ago.

| Path | Credential it ends in | The point |
| --- | --- | --- |
| Long-term access key | `AKIA...` + secret | The baseline. IAM issues it, STS is never involved, and nothing expires. |
| AssumeRole | `ASIA...` + secret + session token | The chicken-and-egg case: you need credentials to get credentials. |
| GitHub Actions OIDC | OIDC ID token, then `ASIA...` | The only STS calls that need no AWS credential at all. |
| EC2 instance profile (IMDSv2) | `ASIA...` + secret + session token | Why an EC2 instance needs no key on disk, and why the `PUT` matters. |
| Bedrock API key | Opaque bearer token | The path that skips SigV4 entirely, and quietly creates an IAM user. |

Each step also declares which of the four bands it touches: issue, sign, verify, authorize.
A band left dark is one that path skips, which is how the unsigned OIDC exchange and the
bearer token show what they are actually bypassing.

## The signer

`src/lib/sigv4.ts` is a full SigV4 implementation on `crypto.subtle` that returns every
intermediate value, not just the final hex string, because the intermediates are the part
worth seeing: the canonical request is what AWS rebuilds to check your work, and the
`kDate → kRegion → kService → kSigning` chain is what scopes a leaked key to one day, one
region and one service.

It is verified in CI against the signature example AWS publishes for Amazon Glacier, byte
for byte, including the canonical request and the string to sign.

One note on that page: it publishes a second example, for the streaming `Upload Archive`
call, whose canonical request reproduces exactly but whose published signature does not.
Both this signer and an independent Python implementation produce `e8ba379a74...` from the
canonical request the page itself prints, rather than the `b09239743937...` it claims.
Adding the two headers the page's request syntax shows but its canonical request omits
gives a third value, so that is not the explanation either. The test asserts the canonical
request against the documentation and the signature against the cross-check.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173/caller-identity/
npm test           # the signer against the AWS vectors
npm run build
```

## Nothing here is a secret

Every key on the page is AWS's own published example value, chosen so that signatures are
deterministic and obviously fake. There is no backend, no telemetry and no network call:
the page is static, and the signing runs in your tab.
