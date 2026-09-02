# Inkwell eSign

An electronic signature platform: upload a PDF, place fields, route it to recipients,
collect legally-meaningful signatures, and produce an executed document plus a
tamper-evident certificate of completion.

Built from scratch for this engagement. No code is copied, forked, translated or
adapted from DocuSeal, Documenso, OpenSign, DocuSign or any other e-signature product.
Every third-party package is catalogued in [`docs/SBOM.md`](docs/SBOM.md).

---

## Quick start

```bash
npm install          # also prunes optional LGPL packages (see scripts/prune-optional.mjs)
npm run seed         # creates a demo workspace with sample envelopes
npm run dev          # http://localhost:4000
```

Then open http://localhost:4000/login and press **Test sign in** — it opens the sample
workspace with no credentials to type. Or sign in manually:

| | |
| --- | --- |
| Email | `owner@northwind.test` |
| Password | `inkwell-demo-2026` |

The Test sign in button is passwordless, so it is guarded: it is hidden outside
development unless `DEMO_LOGIN=on`, hidden entirely when `DEMO_LOGIN=off`, and hidden on
any instance where `npm run seed` has never been run. It signs in only as the fixed demo
account and accepts no input, so it cannot be used to assume another user.

No SMTP server is required. Every message the platform sends is captured in the
in-app **Outbox**, where you can read it and open the recipient's signing link — that
is how you walk through a signing session locally.

```bash
npm test             # 34 tests: crypto, audit chain, PDF engine, workflow, tenancy
npm run sbom         # regenerate the SBOM and re-run the licence policy check
npm run build        # production build
npm run db:reset     # wipe the database and blob store
```

## What it does

**Documents and templates** — PDF upload with server-side validation and page-geometry
parsing, content-addressed storage, and full version history. Any field layout can be
saved as a reusable template with named roles.

**Field placement** — drag or click to place signature, initials, date, text, checkbox,
dropdown, full-name and email fields anywhere on any page. Fields are stored as
normalised coordinates, so a layout is independent of zoom, screen size and page size.
Each field is bound to a specific recipient.

**Routing** — sequential or parallel signing order, signers / approvers / CC recipients,
optional per-recipient access codes, expiry dates, invitations, reminders and
recipient-level status tracking.

**Signing** — a mobile-first signing session with typed, drawn or uploaded signatures,
progressive save, required-field validation, an electronic-record disclosure with
explicit consent capture, and the option to decline with a reason.

**Getting the document** — the sender downloads the executed PDF and certificate from
the envelope record; each signer can download their own copy from their signing link once
every party has finished.

**Evidence** — every action is appended to a per-envelope SHA-256 hash chain. On
completion the platform flattens all values into the PDF, generates a certificate of
completion, and signs `{envelope id, audit head hash, executed document digest}` with
the workspace's ECDSA P-256 key.

**Platform** — organisations with role-based access, a REST API with scoped bearer
keys, HMAC-signed webhooks with a delivery log, and an email outbox.

## Where things live

```
app/
  (app)/            dashboard, envelopes, documents, templates, outbox, activity, settings
  sign/[token]/     the recipient-facing signing session
  api/v1/           REST API (cookie session or bearer API key)
  api/sign/[token]/ token-authenticated signing endpoints
  api/cron/         scheduled reminder sweep
components/         UI kit, PDF renderer, field editor, signature pad
lib/
  db.js schema.js   SQLite connection and schema
  crypto.js         scrypt, SHA-256, ECDSA, HMAC, canonical JSON
  audit.js          hash-chained audit log + evidence seal
  pdf.js            PDF inspection, field flattening, certificate generation
  envelopes.js      envelope lifecycle and routing
  storage.js        content-addressed, per-tenant blob store
  mailer.js         templated email + outbox
  webhooks.js       signed webhook dispatch
docs/               architecture, threat model, API reference, SBOM
tests/              automated tests
```

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Data model, PDF pipeline, evidence architecture, deployment |
| [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) | Assets, adversaries, threats and controls |
| [`docs/API.md`](docs/API.md) | REST endpoints, authentication, webhook verification |
| [`docs/SBOM.md`](docs/SBOM.md) | Full dependency manifest with licences and sources |
| [`docs/OPERATIONS.md`](docs/OPERATIONS.md) | Configuration, deployment, backup, scaling |

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:4000` | Base URL used in signing links and emails |
| `SMTP_URL` | *(unset)* | SMTP transport; when unset, mail is captured in the Outbox |
| `MAIL_FROM` | `Inkwell eSign <no-reply@inkwell.example>` | Envelope sender address |
| `INKWELL_DATA_DIR` | `./storage` | Database and blob store location |
| `CRON_SECRET` | *(unset)* | Shared secret for `POST /api/cron/reminders` |
| `DEMO_MODE` | auto on Vercel | Runs from a temporary directory, seeded on each cold start, for hosts with no persistent disk. Data does not survive. See `docs/OPERATIONS.md`. |
| `DEMO_LOGIN` | *(unset)* | `on` / `off`. Controls the passwordless **Test sign in** button; unset means development only |
| `REMINDER_AFTER_HOURS` | `48` | Idle time before an automatic reminder |
| `REMINDER_MAX` | `3` | Automatic reminders per recipient |

## Scope of this build

This is a complete, working implementation of the signature workflow end to end. Two
deliberate simplifications are documented rather than hidden:

- **Storage engine.** SQLite with a filesystem blob store, behind a thin data layer.
  `docs/ARCHITECTURE.md` describes the PostgreSQL + object-storage migration; the schema
  is written in portable SQL and the queries are parameterised throughout.
- **Signature cryptography.** Completed envelopes are sealed with an ECDSA P-256
  signature over the evidence record. Embedding a PAdES/PKCS#7 signature *inside* the PDF
  requires a certificate from a trust-service provider; the hook for it is
  `sealEvidence()` in `lib/audit.js`.
