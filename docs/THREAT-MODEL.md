# Threat model

Scope: the Inkwell eSign application — its web interface, REST API, signing sessions,
document storage and evidence record. Out of scope: the hosting platform, TLS
termination, and the client's corporate identity provider.

## 1. Assets

| Asset | Why it matters |
| --- | --- |
| Executed documents | The legal instrument itself |
| Audit trail and evidence seal | What makes a signature defensible in a dispute |
| Signing links | Possession of one is authority to sign as that recipient |
| Signature images | Biometric-adjacent personal data |
| Credentials (passwords, API keys, session cookies) | Full access to a tenant |
| Organisation signing key | Ability to forge an evidence seal |
| Recipient PII | Names, emails, IP addresses, user agents |

## 2. Adversaries

| # | Adversary | Capability | Goal |
| --- | --- | --- | --- |
| A1 | Anonymous internet user | Can reach any public endpoint | Read or sign documents they were not sent |
| A2 | Legitimate recipient | Holds one valid signing link | Sign as another party, alter the document, or repudiate their own signature |
| A3 | Rival tenant | Holds a valid account in another organisation | Read or modify another tenant's envelopes |
| A4 | Malicious insider (operator) | Holds an account in the tenant | Backdate, alter or fabricate a signed record |
| A5 | Database-level attacker | Read/write access to the datastore | Rewrite history to change what a document says was agreed |
| A6 | Network observer | Sees traffic | Capture credentials or signing links |
| A7 | Malicious uploader | Can upload files | Achieve code execution or exfiltration via a crafted PDF |

## 3. Threats and controls

### T1 — Guessing or enumerating a signing link (A1)

Tokens are 256 bits from `crypto.randomBytes`, base64url-encoded, and stored only as
SHA-256 digests, so a database leak does not yield usable links. Lookup is by digest, so
there is no prefix scan to enumerate. Identifiers throughout are random and opaque, so
neither envelopes nor recipients can be walked. *Residual:* a link forwarded by its
recipient works for whoever receives it — mitigated by per-recipient access codes, and
the audit trail records the IP and user agent that actually signed.

### T2 — Replaying an old link (A1, A2)

A token is destroyed the moment its recipient completes (`token_hash` set to `NULL`).
Sending a reminder mints a fresh token and invalidates the previous one. Voiding an
envelope clears every outstanding token. Expiry is enforced on resolution, not only in
the UI. Each resolution re-checks envelope status and whose turn it is.

### T3 — Signing out of turn or as another party (A2)

`resolveSigningToken()` re-evaluates `activeRecipients()` on every request; a token
outside its turn resolves to `not_your_turn`. Field writes are filtered by
`recipient_id` in SQL, so a signer's session can only write fields bound to them —
requests to write another party's fields are silently ignored rather than partially
applied. A later signer's token does not exist until their turn begins.

### T4 — Tampering with the executed document (A4, A5)

Every stored file is content-addressed and its digest recorded. `verifyBlob()` re-hashes
the bytes on demand, so any modification is detected. The executed PDF's digest is also
part of the signed evidence payload, so replacing the file also invalidates the seal.

### T5 — Rewriting the audit trail (A4, A5)

Audit events form a SHA-256 chain in which each entry commits to its predecessor.
Editing, deleting, reordering or inserting an event invalidates every hash after it, and
`verifyChain()` reports the exact position and reason. An attacker with database write
access can recompute the chain — which is why the head hash is additionally signed with
the organisation's ECDSA P-256 private key. Forging a coherent record therefore requires
the key, not merely the database. *Residual:* an attacker who obtains the signing key can
forge a seal; in production that key belongs in a KMS or HSM (see §5).

### T6 — Cross-tenant access (A3)

Every principal carries an `orgId`, applied as a filter in every query; helper functions
such as `getEnvelope(orgId, id)` take it as a required argument rather than deriving it
from the record. Blobs live under a per-organisation prefix, and storage keys are
validated against `^[A-Za-z0-9_-]+/[0-9a-f]{64}$` — traversal sequences are rejected
outright rather than sanitised. API keys are bound to the organisation that issued them.
Covered by automated tests in `tests/tenancy.test.mjs`.

### T7 — Credential compromise (A1, A6)

Passwords use scrypt with per-user salts, so a database leak yields no plaintext.
Login equalises timing between "no such user" and "wrong password". Session and API-key
values are stored only as digests. Cookies are `httpOnly`, `SameSite=Lax` and `Secure`
in production. API keys are displayed exactly once and can be revoked without rotating
anything else. *Residual:* no rate limiting on password login and no MFA — both are
listed in §5.

### T8 — Brute-forcing an access code (A1)

Access codes are compared in constant time against a SHA-256 digest and throttled to
five attempts per recipient per ten minutes. Both successful and failed attempts are
written to the audit trail, so an attack is visible in the evidence record.

### T9 — Repudiation ("I never signed that") (A2)

Before completion the signer must explicitly consent to the Electronic Record and
Signature Disclosure; the consent is a distinct audit event. Signing records the IP
address, user agent and timestamp, and the digest of every mark applied. All of it is
reproduced on the certificate of completion, and the whole record is sealed.

### T10 — Malicious upload (A7)

Uploads are capped at 25 MB and must begin with `%PDF-`. Files are parsed server-side
with `pdf-lib`, a pure-JavaScript library with no native decoders and no shell-outs; a
parse failure is a rejected upload, not a crash. Rendering happens in the browser via
`pdf.js`, sandboxed by the browser and with scripting disabled by default. Files are
served with `Content-Type: application/pdf`, `X-Content-Type-Options: nosniff` and
`Content-Disposition` set explicitly, so a PDF cannot be coerced into rendering as HTML
on the application origin. Blobs are stored under digest filenames, never user-supplied
names.

### T11 — Injection (A1–A4)

Every SQL statement is a prepared statement with bound parameters; no query is built by
string concatenation. Request bodies are validated with Zod schemas that constrain
types, lengths, enumerations and numeric ranges (field coordinates must lie in 0–1).
React escapes all interpolated output. The one place raw HTML is rendered — the email
preview in the Outbox — uses a fully sandboxed `<iframe srcDoc>` with no allowances.

### T12 — Signature image abuse (A2)

Signature values must match `^data:image/(png|jpeg);base64,` and are size-capped at
roughly 650 KB decoded; anything else is discarded before it reaches the database.
Embedding is wrapped in a try/catch so a malformed image degrades to a text mark rather
than failing the whole finalisation.

### T13 — Webhook forgery or SSRF (A1, A3)

Outgoing payloads are signed with HMAC-SHA256 over `<timestamp>.<body>`, so a receiver
can authenticate them and reject replays by checking the timestamp. Requests carry an
8-second timeout and every attempt is logged with its response code. *Residual:*
endpoint URLs are not restricted to public IP ranges, so an operator can point a webhook
at an internal address; see §5.

### T14 — Passwordless demo sign-in reaching production (A1)

The **Test sign in** button authenticates as the seeded demo owner without a password.
It is therefore disabled by default in production: `demoLogin()` refuses unless
`DEMO_LOGIN=on` is set explicitly, refuses outright when `DEMO_LOGIN=off`, and refuses on
any instance where the seeded account does not exist — so a deployment that never ran
`npm run seed` can never expose it. The endpoint accepts no request body and resolves a
fixed email, so it cannot be steered at another account. Both the button and the endpoint
disappear together, because the page resolves availability from the same function on the
server. *Residual:* an operator who deliberately sets `DEMO_LOGIN=on` in production grants
anonymous owner access to that workspace; the deployment checklist calls this out.

### T15 — Demo mode weakens session and token handling (A1)

A demo instance has no shared storage, so sessions move into a signed cookie and signing
tokens are derived from the recipient id rather than random. Both are verified by HMAC,
so they cannot be forged without `DEMO_SECRET`, but they lose two properties the real
build has: a session cannot be revoked server-side, and a signing token is predictable to
anyone holding the secret. `DEMO_SECRET` also has a published default.

This is confined to demo mode: with `DEMO_MODE` unset, sessions are database-backed and
signing tokens are 256 bits of randomness, exactly as before. Demo mode exists so a
reviewer can click through a hosted URL, and every page states that the data is sample
data. It must never carry real documents — which is also why demo instances discard
everything on restart.

## 4. Trust boundaries

```
        ┌──────────────── untrusted ────────────────┐
        │ recipient browser · integrator · internet │
        └────────────────────┬──────────────────────┘
                             │  token / API key / session cookie
        ┌────────────────────▼──────────────────────┐
        │ route handlers — authN, authZ, validation │   ← all input is hostile here
        ├───────────────────────────────────────────┤
        │ domain layer — org-scoped, parameterised  │
        ├───────────────────────────────────────────┤
        │ datastore + blob store · signing key      │   ← integrity anchored by the seal
        └───────────────────────────────────────────┘
```

## 5. Known gaps

Deliberately out of scope for this build, and the recommended treatment:

| Gap | Recommendation |
| --- | --- |
| No MFA for operator accounts | TOTP enrolment, or SSO via the client's IdP |
| No rate limiting on password login | Per-IP and per-account throttling with lockout |
| Signing key stored in the database | Move to a KMS/HSM; the code touches it only via `sealEvidence()` |
| No PAdES/PKCS#7 signature inside the PDF | Requires a TSP certificate; hook is `sealEvidence()` |
| No qualified timestamp authority | RFC 3161 TSA over the head hash for long-term validity |
| Webhook URLs unrestricted | Block private/link-local ranges and require HTTPS |
| No automated malware scanning of uploads | Scan on upload before the file becomes retrievable |
| Audit retention and legal hold not implemented | Retention policy plus write-once export |
