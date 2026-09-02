# Deliverables against the milestone plan

What exists in this build, mapped to the six milestones in the brief. This is a working
minimal-but-complete implementation: every milestone has functioning code, and the gaps
that remain are named rather than glossed over.

## M1 — Architecture + specification

| Required | Where |
| --- | --- |
| Data model | [`ARCHITECTURE.md` §2](./ARCHITECTURE.md), DDL in [`lib/schema.sql`](../lib/schema.sql) |
| Threat model | [`THREAT-MODEL.md`](./THREAT-MODEL.md) — 7 adversaries, 13 threats, controls, known gaps |
| Licensing / dependency plan | [`SBOM.md`](./SBOM.md) + `npm run sbom` policy gate; `scripts/prune-optional.mjs` |
| PDF architecture | [`ARCHITECTURE.md` §3](./ARCHITECTURE.md) — render/write split, coordinate system, finalisation pipeline |
| Audit / evidence architecture | [`ARCHITECTURE.md` §4](./ARCHITECTURE.md) — hash chain, evidence seal, three-layer verification |

## M2 — Document / template editor

| Required | Status |
| --- | --- |
| PDF rendering | `components/PdfDocument.jsx` — pdf.js, fits to container, re-renders on resize |
| Field placement | `components/PrepareEditor.jsx` — drag-and-drop or click-to-place, move, resize, delete, keyboard delete |
| Signature, initials, text, date, checkbox | All present, plus dropdown, full name and email |
| Per-field configuration | Label, assignee, required flag, font size, dropdown options |
| Reusable templates | Save any layout as a template with named roles; roles map to real recipients at send time |

## M3 — Signing workflow

| Required | Status |
| --- | --- |
| Recipients | Signer / approver / CC, with roles and colour coding |
| Signing order | Sequential or parallel; later signers' tokens are not minted until their turn |
| Secure signing links | 256-bit tokens, stored hashed, rotated on reminder, destroyed on completion |
| Authentication | Unique link, optionally plus a per-recipient access code (throttled, audited) |
| Invitations and reminders | Templated HTML email; manual reminders and a scheduled sweep at `/api/cron/reminders` |
| Completion workflow | Consent capture, required-field validation, decline with reason, automatic advance, completion notices |
| Mobile signing | Mobile-first layout, touch drawing, sticky progress and action bar |

## M4 — Evidence / finalisation engine

| Required | Status |
| --- | --- |
| Immutable audit events | Append-only SHA-256 chain per envelope, 14 event types |
| Document hashes | Content-addressed storage; every version carries its digest and is re-hashed on verification |
| Timestamps | ISO-8601 UTC on every event, recipient action and version |
| Final executed PDF | Server-side flattening of all field values plus a per-page tamper-evident footer |
| Certificate of completion | Generated PDF with envelope summary, integrity digests, signer forensics and the full audit trail |
| Tamper evidence | `GET /api/v1/envelopes/:id/verify` — chain recomputation + blob re-hash + ECDSA seal verification |

## M5 — Backend / admin / security

| Required | Status |
| --- | --- |
| Organisations | Tenant boundary with its own signing key pair |
| Users and permissions | owner / admin / member / viewer, enforced per route via `withAuth({ minRole })` |
| Secure document storage | Content-addressed, per-organisation prefix, strict key validation, self-verifying |
| APIs | Full REST surface under `/api/v1` with scoped bearer keys — [`API.md`](./API.md) |
| Webhooks | Six lifecycle events, HMAC-SHA256 signed, with a per-attempt delivery log |
| Tenant isolation | Org id applied to every query; covered by `tests/tenancy.test.mjs` |

## M6 — Testing and production hardening

| Required | Status |
| --- | --- |
| Automated testing | 34 tests across crypto, audit chain and tamper detection, PDF engine, workflow routing, tenant isolation — `npm test` |
| Browser / mobile testing | Full signing session exercised in Chrome (typed and drawn signatures, sequential advance, completion); layouts checked at mobile width |
| Security review | Threat model with controls and named residual risks; storage-key hardening, path-traversal rejection and login timing equalisation came out of it |
| Deployment | [`OPERATIONS.md`](./OPERATIONS.md) — configuration, checklist, backup/restore, monitoring signals |
| Documentation | README, architecture, threat model, API reference, operations, SBOM, this mapping |
| Source-code handoff | The whole repository, with no external build service or proprietary component |

## Deliberate limitations

Named here so they are not mistaken for oversights:

1. **SQLite, not PostgreSQL.** Chosen so the build runs anywhere with no infrastructure.
   The schema is portable SQL, all queries are parameterised, and access is isolated
   behind `lib/db.js`. Migration path: `ARCHITECTURE.md` §6.
2. **No PAdES/PKCS#7 signature embedded in the PDF.** That requires a certificate from a
   trust-service provider. The evidence record is instead sealed with an ECDSA P-256
   signature over `{envelope id, audit head hash, executed document digest}`; the
   integration point is `sealEvidence()` in `lib/audit.js`.
3. **No MFA and no login rate limiting.** Both are listed in the threat model with the
   recommended treatment.
4. **Webhook and email dispatch are in-process.** Each is a single function call away
   from a queue with retry and backoff.
5. **Signing keys live in the database.** Production should hold them in a KMS or HSM;
   the code touches the private key in exactly one function.
