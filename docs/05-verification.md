**English** | [日本語](05-verification.ja.md)

# Verification

[Back to notes](README.md)

How the claims in this repository were checked, and what is still assumed. The point of
writing this down is that "verified" covers a range, and the range matters.

## The ladder

Not all of it is equally solid, so it is worth saying which rung each piece sits on.

| Rung | Evidence | Used for |
| --- | --- | --- |
| Strongest | AWS publishes a worked example with expected values, and we reproduce it | SigV4 header auth, presigned URLs |
| Strong | AWS states the rule in reference documentation, and behaviour follows from it | Key limits, durations, condition semantics |
| Medium | Two independent implementations of published pseudocode agree | SigV4a key derivation |
| Weak | Reasoning from mechanism, no vendor statement | Internal handling of the session token |

Anything on the bottom rung is phrased as mechanism rather than fact in the site copy. For
example, the session token is described as something AWS resolves to a session secret, not
as something AWS decrypts, because AWS does not document the format.

## What reproduces exactly

Two AWS-published examples are asserted in CI, byte for byte.

**Glacier Create Vault**, from the request signing reference. Given the published key,
secret, timestamp and headers, the page states the canonical request, the string to sign
and the signature. All three match.

**S3 presigned `test.txt`**, from the query-parameter auth reference, which explicitly
offers itself as a test case. The canonical request, its hash, the signature and the
complete URL all match.

If either breaks, every signature the site renders is wrong, so both run as their own CI
job.

## An error in the AWS documentation

The Glacier signing page publishes a second example, for the streaming `Upload Archive`
call. Its published signature is not reproducible from the canonical request the same page
prints.

```text
page's canonical request  →  reproduces exactly
page's published signature:  b092397439375d59119072764a1e9a144677c43d9906fd98a5742c57a2855de6
this implementation:         e8ba379a747bc294584102fd2430f7a563696740882e149c87b15754e7c10a89
independent Python:          e8ba379a747bc294584102fd2430f7a563696740882e149c87b15754e7c10a89
```

Ruling out the obvious explanation: the page's request syntax shows
`x-amz-archive-description` and `x-amz-sha256-tree-hash` headers that its canonical request
omits. Adding them gives a third value, `9ba94dab5c...`, so that is not it either.

The payload hash on that page is correct, incidentally:
`sha256("Welcome to Amazon Glacier.")` is the stated
`726e392cb4d09924dbad1cc0ba3b00c3643d03d14cb4b823e2f041cff612a628`. Only the final
signature does not follow.

The test therefore asserts the canonical request against the documentation, and the
signature against the cross-check, with a comment explaining which is which. Silently
deleting the failing case would have been the easier option and the wrong one.

## Where the evidence is weaker

**SigV4a key derivation.** AWS publishes the derivation as pseudocode but not as a worked
example with an expected key, so there is no vendor vector. The derived key is
cross-checked against a separate Python implementation written from the documentation
rather than from the TypeScript. Two implementations of the same prose agreeing rules out
transcription slips; it does not rule out both having read the prose the same wrong way.

**SigV4a signatures.** Not pinnable in principle: ECDSA is randomised. What is asserted
instead is that a signature verifies against the derived public key, which is the check
AWS performs. (This implementation happens to be deterministic because `@noble/curves`
defaults to RFC 6979; AWS's is not.)

## Corrections found while reviewing

Reviewing against the documentation turned up six errors in material already written.
Listed because the pattern is more useful than the individual fixes.

1. The `CreateAccessKey` response was missing `CreateDate`.
2. "Two active keys per user" is wrong: the limit is two at a time, Active or Inactive.
3. `AssumeRole` expiry conflated `DurationSeconds` (900s upward) with the
   `MaxSessionDuration` setting (1 to 12 hours), and omitted the one-hour ceiling on role
   chaining.
4. The session token was described as being decrypted. AWS does not document the format.
5. Clock skew was given as 15 minutes. That is S3's figure; AWS's general guidance is five.
6. GitHub's token URL already carries a query string, so the audience is appended with `&`,
   not `?`.

Most were plausible, none were guesses at the time of writing, and all six were wrong.

## Two assumptions the tests caught

Worth recording separately because neither was a documentation problem.

A tamper test altered the region set inside the string to sign, where it does not appear.
The region set reaches the signature only through the canonical request hash, so the edit
changed nothing and the signature still verified. The test was wrong, not the code.

Another asserted that signing twice produces different bytes, on the grounds that ECDSA is
randomised. `@noble/curves` defaults to the deterministic RFC 6979 nonce, so it does not.

## Reproducing all of it

```bash
npm ci
npm test
```

Each check also runs as its own CI job, alongside typecheck, lint, formatting and
markdown lint.
