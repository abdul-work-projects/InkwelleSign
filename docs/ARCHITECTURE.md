# Architecture

## 1. System shape

A single Next.js 15 application serves both the operator interface and the API. There is
no separate backend service: route handlers under `app/api/**` are the server, and the
domain logic they call lives in `lib/**` so it is reusable from scripts, tests and a
future queue worker.

```
Browser (operator)          Browser (recipient)          Integrator
   │  session cookie            │  signing token            │  bearer API key
   ▼                            ▼                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Next.js route handlers                                              │
│    app/api/v1/**      session OR API key, always org-scoped          │
│    app/api/sign/**    token-authenticated, single recipient          │
│    app/api/cron/**    shared-secret scheduled jobs                   │
├──────────────────────────────────────────────────────────────────────┤
│  Domain layer (lib/)                                                 │
│    envelopes · audit · pdf · storage · mailer · webhooks · crypto     │
├──────────────────────────────────────────────────────────────────────┤
│  SQLite (WAL)                    Blob store (content-addressed)      │
└──────────────────────────────────────────────────────────────────────┘
```

Every request resolves to a **principal** carrying an `orgId` (`lib/auth.js`
`authenticate()`). `withAuth()` in `lib/api.js` wraps handlers so the org id is applied
before any query runs, and enforces a minimum role. There is no code path that reads
tenant data without an org filter.

## 2. Data model

All identifiers are prefixed, opaque, random strings (`env_`, `rcp_`, `fld_`…) — never
sequential integers, so nothing is enumerable from the outside.

| Table | Purpose | Key relationships |
| --- | --- | --- |
| `organizations` | Tenant boundary; holds the ECDSA key pair used to seal evidence | — |
| `users` | Operators, with `role` ∈ owner/admin/member/viewer | → organization |
| `sessions` | Browser sessions, stored as SHA-256 of the cookie value | → user |
| `api_keys` | Bearer credentials, stored as SHA-256 of the key | → organization |
| `documents` | A logical document | → organization |
| `document_versions` | Immutable file versions (`source`, `executed`, `certificate`) with digest, size, page count and page geometry | → document |
| `templates` | Reusable role + field layout over a document version | → document_version |
| `envelopes` | One signing transaction, its status and evidence head | → document_version (source, executed, certificate) |
| `recipients` | Parties, order, status, hashed signing token, hashed access code, signing forensics | → envelope |
| `fields` | Field definition **and** its collected value | → envelope, recipient |
| `audit_events` | Append-only hash chain, one chain per envelope | → envelope |
| `webhooks`, `webhook_deliveries` | Endpoints, secrets, and per-attempt delivery log | → organization |
| `email_outbox` | Every message generated, with delivery state | → organization |

Full DDL: [`lib/schema.sql`](../lib/schema.sql) (shipped to the runtime as
`lib/schema.js` so no filesystem access is needed at boot).

### Field geometry

Fields store `x`, `y`, `w`, `h` as fractions of the page (0–1), with the origin at the
**top-left** — the same convention the DOM uses, so the editor writes what it renders.
The PDF engine converts to PDF user space (bottom-left origin) at stamping time:

```
pdfX = x · pageWidth
pdfY = pageHeight − (y · pageHeight) − (h · pageHeight)
```

Because coordinates are relative, a layout survives zoom changes, device pixel ratios,
different page sizes and re-rendering at any scale.

### Envelope state machine

```
draft ──send──▶ sent ──first signature──▶ in_progress ──last signature──▶ completed
  │               │                            │
  │               └──────────┬─────────────────┘
  │                          ▼
  └──delete            declined / voided / expired
```

`draft` is the only editable state: recipients and fields can be replaced wholesale.
Once sent, the layout is frozen and only values change.

Routing is decided by `activeRecipients()`: in sequential mode only the lowest
outstanding `order_index` is active; in parallel mode everyone is. A recipient's link is
minted at the moment they become active — a later signer's token does not exist while it
is not their turn, so it cannot be leaked or replayed early.

## 3. PDF architecture

Two independent engines, chosen deliberately:

| Concern | Library | Where |
| --- | --- | --- |
| **Rendering** for on-screen placement and signing | `pdfjs-dist` (Apache-2.0) | Browser only, `components/PdfDocument.jsx` |
| **Writing** the executed document and certificate | `pdf-lib` (MIT) | Server only, `lib/pdf.js` |

The browser never produces the final artefact — it only renders pages to a canvas and
overlays absolutely-positioned field chips. All flattening happens server-side from the
stored source bytes, so a malicious client cannot influence the executed PDF beyond the
field values it is authorised to set.

### Upload path

1. Reject anything whose first five bytes are not `%PDF-`, or larger than 25 MB.
2. Parse with `pdf-lib` to obtain page count and per-page dimensions — client-supplied
   geometry is never trusted.
3. Hash the bytes (SHA-256) and write them to `storage/blobs/<orgId>/<digest>`.
4. Record a `document_versions` row. Re-uploading identical bytes is a new version row
   pointing at the same blob.

### Finalisation path (`finalizeEnvelope`)

1. Mark the envelope `completed` and append the `envelope.completed` audit event, so
   the head hash covers the completion itself.
2. Load the **source** bytes and stamp every field:
   signature/initials → embedded PNG/JPEG scaled to fit, with a small attribution
   caption above it; text/date/name/email → wrapped text clipped to the box;
   checkbox → drawn box with a cross.
3. Stamp a footer on every page: envelope id, evidence hash prefix, page number.
4. Set PDF metadata (`Title`, `Producer`, `Keywords: envelope:…, evidence:…`) and save
   with `updateMetadata: false` so output is byte-stable for identical input.
5. Store as an `executed` version; append `document.executed` with the new digest.
6. Seal the evidence record (§4) and build the certificate of completion.
7. Store the certificate as a `certificate` version and notify every party.

Rendering is deterministic: the same inputs produce the same bytes and therefore the
same digest, which is what makes the recorded hash reproducible by a third party.

### Certificate of completion

Generated with `pdf-lib` from primitives — no HTML-to-PDF step, no headless browser.
It contains the envelope summary, the document integrity block (original digest,
executed digest, audit head hash, evidence signature), a per-signer card (role,
authentication method, IP, user agent, timestamps) and the complete audit trail with
per-event hash prefixes. Layout paginates automatically; the audit table can run to as
many pages as needed.

## 4. Evidence architecture

### Hash chain

Each envelope owns an append-only chain in `audit_events`. Every entry stores the hash
of its predecessor, and its own hash covers that link plus the entry's full content:

```
hash = SHA-256( prevHash ⧺ seq ⧺ envelopeId ⧺ eventType ⧺ actorType ⧺ actorId
                ⧺ actorLabel ⧺ ip ⧺ userAgent ⧺ canonicalJson(payload) ⧺ createdAt )
```

The first entry links to a genesis value of 64 zeros. `canonicalJson` sorts object keys
so serialisation is stable and the hash is reproducible in any language.

`verifyChain()` walks the chain and reports the first position that fails, and why:
a sequence gap, a broken back-link, or a content hash that no longer matches. Editing,
deleting or reordering any historical event invalidates every hash after it — there is
no way to rewrite one entry in isolation.

Recorded events: `envelope.created`, `envelope.sent`, `recipient.invited`,
`recipient.viewed`, `recipient.authenticated`, `recipient.authentication_failed`,
`recipient.consented`, `recipient.signed`, `recipient.declined`, `recipient.reminded`,
`envelope.completed`, `document.executed`, `envelope.voided`.

Signature images are recorded **by digest** (`sha256:…`), never inline: the log stays
compact, and the biometric artefact is not duplicated across systems while remaining
verifiable against the stored value.

### Evidence seal

The chain proves internal consistency but, on its own, a party with write access to the
database could rebuild it. So at completion the platform signs

```
canonicalJson({ envelopeId, headHash, documentSha256 })
```

with the organisation's ECDSA P-256 private key. Reproducing that signature requires the
key, not just database access. The public half is published at
`GET /api/v1/organization/public-key` so a third party can verify a certificate
independently.

### Three-layer verification

`GET /api/v1/envelopes/:id/verify` runs all three and returns a single verdict:

| Layer | Detects |
| --- | --- |
| Audit chain recomputation | Edited, deleted, inserted or reordered history |
| Blob re-hash | Any byte changed in the source, executed or certificate PDF |
| Evidence signature | A wholesale rebuild of the record by anyone without the key |

## 5. Security architecture

| Control | Implementation |
| --- | --- |
| Password storage | scrypt (N=16384, r=8, p=1), 16-byte random salt, 64-byte key |
| Session tokens | 256-bit random; only SHA-256 stored; httpOnly + SameSite=Lax cookie |
| API keys | 192-bit random, `ink_live_` prefix; only SHA-256 stored; shown once |
| Signing tokens | 256-bit random; only SHA-256 stored; rotated on reminder; destroyed on completion |
| Access codes | SHA-256 with constant-time comparison; five attempts per ten minutes; successes and failures audited |
| Tenant isolation | Org id from the principal applied to every query; blobs namespaced per org; storage keys validated against a strict pattern |
| Authorisation | Role ranking (`lib/permissions.js`) enforced by `withAuth({ minRole })` |
| Input validation | Zod schemas at every mutating endpoint; field coordinates range-checked; signature payloads restricted to PNG/JPEG data URLs under a size cap |
| Transport | Security headers set in `next.config.mjs`; document responses are `no-store` |
| Least privilege in signing | A signing token authorises exactly one recipient's fields; writes to any other field are silently ignored |

Details and the adversary analysis: [`THREAT-MODEL.md`](./THREAT-MODEL.md).

## 6. Deployment and scaling

The current build targets a single node: SQLite in WAL mode plus a local blob directory.
That is a deliberate, contained choice — every access goes through `lib/db.js` and
`lib/storage.js`, and the SQL is portable and parameterised.

**To PostgreSQL:** the DDL in `lib/schema.sql` maps directly (`TEXT` → `text`,
`INTEGER` boolean flags → `boolean`, ISO-8601 `TEXT` timestamps → `timestamptz`). Swap
the `db` export for a `pg` pool and convert `?` placeholders to `$n`. The audit chain,
PDF pipeline and routing logic are storage-agnostic.

**To object storage:** `lib/storage.js` exposes `putBlob` / `getBlob` / `verifyBlob`
over content-addressed keys, which map one-to-one onto S3 keys.

**Background work:** webhook dispatch is currently fire-and-forget with a delivery log.
For production, move `dispatchWebhooks` and `sendMail` onto a queue with exponential
backoff; both are already isolated behind a single function call.

**Scheduled jobs:** `POST /api/cron/reminders` sweeps for idle recipients and expired
envelopes. Protect it with `CRON_SECRET` and drive it from any scheduler.
