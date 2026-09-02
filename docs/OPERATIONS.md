# Operations

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:4000` | Base URL embedded in signing links and emails. **Must** be the public URL in production. |
| `SMTP_URL` | *(unset)* | e.g. `smtps://user:pass@smtp.example.com:465`. When unset, mail is captured in the Outbox instead of being delivered. |
| `MAIL_FROM` | `Inkwell eSign <no-reply@inkwell.example>` | Sender address |
| `INKWELL_DATA_DIR` | `./storage` | Database and blob store location |
| `INKWELL_DB_PATH` | `$INKWELL_DATA_DIR/inkwell.db` | Explicit database path |
| `CRON_SECRET` | *(unset)* | Required header value for `/api/cron/reminders`. Set it in production. |
| `REMINDER_AFTER_HOURS` | `48` | Idle time before an automatic reminder |
| `REMINDER_MAX` | `3` | Automatic reminders per recipient |
| `NODE_ENV` | — | `production` enables `Secure` cookies |
| `DEMO_LOGIN` | *(unset)* | `on` exposes the passwordless **Test sign in** button, `off` disables it. Unset means development only, or wherever `DEMO_MODE` is active. |
| `DEMO_MODE` | auto on Vercel | `1` runs the instance from a temporary directory, seeded on every cold start. `0` forces it off. See below. |
| `DEMO_SECRET` | `inkwell-demo-instance` | Signs demo session cookies and signing tokens. Every function must agree on it; not a security boundary, since demo mode has none. |

## Running

```bash
npm install        # postinstall prunes optional LGPL packages
npm run build
npm start          # serves on :4000
```

Behind a reverse proxy, forward `X-Forwarded-For` — it is what the audit trail records
as the signer's IP address.

Scheduled reminders, e.g. hourly:

```
0 * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" https://your-host/api/cron/reminders
```

## Deploying

The application keeps its database and every stored document on disk, so it needs a host
that provides a **persistent volume**. Serverless platforms (Vercel, Lambda, Cloudflare
Workers) do not, and the app will refuse to start on one with an explanatory error.

A `Dockerfile` is included. Mount a volume at `/data` and set `INKWELL_DATA_DIR=/data`.

```bash
# Fly.io — fly.toml declares the volume and the health check
fly launch --no-deploy
fly volumes create inkwell_data --size 1
fly secrets set APP_URL=https://<your-app>.fly.dev
fly deploy

# Render — render.yaml declares the disk
# (a persistent disk requires a paid instance type)
```

`SEED_ON_START=1` populates the demo workspace on first boot only — it checks for an
existing organisation and does nothing if one is present, so a redeploy never overwrites
real data. Pair it with `DEMO_LOGIN=on` to expose the passwordless **Test sign in**
button. Remove both for a real deployment.

Seed manually instead:

```bash
fly ssh console -C "node scripts/seed.mjs"
```

## Demo mode (no persistent storage)

Set `DEMO_MODE=1` — it is on automatically wherever `VERCEL` is set — to run on a host
that provides no writable disk. The database and documents go to the instance's temporary
directory, and `instrumentation.js` seeds the sample workspace on each cold start, so
every instance serves a populated app rather than an empty one.

On Vercel each route becomes its own function with its own temporary directory, so
"one instance" is not even one deployment — pages and API routes do not share storage.
Demo mode is built for that:

- Seeded ids come from a deterministic counter, so every function builds an identical
  workspace and a link produced by one resolves in another
- Signing tokens are derived from the recipient rather than random, for the same reason
- Sessions are carried in a signed cookie and verified without a database lookup, since
  a session row written by the API function is invisible to the page function

What this means in practice:

- The seeded workspace is reliable everywhere: sign in, browse envelopes, inspect the
  audit trail, open a signing link, download the executed PDF and certificate.
- Anything a visitor *creates* survives only while that function instance stays warm. A
  cold start, a redeploy, or a request served by another function returns the sample data.
- The passwordless **Test sign in** button is enabled, since an ephemeral instance has no
  lasting accounts.
- Nothing in the interface announces that the data is temporary, so whoever shares the
  link is responsible for saying so.
- Signing links use `VERCEL_PROJECT_PRODUCTION_URL` when `APP_URL` is unset, so they
  resolve to the deployment rather than to localhost.

It exists to let a reviewer click through a live URL. **It is not a deployment option for
real documents** — anything signed on it can vanish. For that, run on a host with a
persistent volume, or complete the managed-database migration in `ARCHITECTURE.md` §6.

## Pre-production checklist

- [ ] `APP_URL` set to the public HTTPS origin
- [ ] TLS terminated in front of the app; HSTS enabled at the edge
- [ ] `SMTP_URL` configured, with SPF/DKIM/DMARC aligned for `MAIL_FROM`
- [ ] `CRON_SECRET` set and the reminder job scheduled
- [ ] `INKWELL_DATA_DIR` on persistent, backed-up storage with restrictive permissions
- [ ] Organisation signing keys migrated to a KMS/HSM (see the threat model, §5)
- [ ] Rate limiting in front of `/api/auth/login` and `/api/sign/*`
- [ ] `DEMO_LOGIN` left unset or set to `off` — set `on` only on a throwaway evaluation instance
- [ ] `npm run sbom` clean, and the SBOM handed over with the build
- [ ] `npm test` green in CI

## Backup and recovery

Two things must be backed up together, and consistently:

1. `storage/inkwell.db` (plus `-wal` and `-shm`). Use `sqlite3 inkwell.db ".backup out.db"`
   for a consistent snapshot rather than copying the file while it is in use.
2. `storage/blobs/` — content-addressed, so it is append-only and safe to sync
   incrementally.

Restoring a database without the matching blobs will fail integrity verification
(`verdict: "tampered"`) rather than silently serving wrong documents. That is the
intended behaviour: verification detects a partial restore.

To confirm a restore, run `GET /api/v1/envelopes/:id/verify` on a sample of completed
envelopes and check for `"verdict": "intact"`.

## Monitoring

Signals worth alerting on:

| Signal | Source | Why |
| --- | --- | --- |
| `verdict != "intact"` | `/api/v1/envelopes/:id/verify` | Tampering or partial restore |
| `email_outbox.status = 'failed'` | Outbox | Undeliverable invitations stall signing |
| `webhook_deliveries.status_code >= 400` | Settings → Webhooks | Broken integration |
| `recipient.authentication_failed` bursts | Audit trail | Access-code brute force |
| Envelopes in `sent` beyond expected SLA | `/api/v1/stats` | Stalled workflows |

## Data retention

Completed envelopes retain: source, executed and certificate PDFs; the full audit chain;
and the evidence seal. Nothing in the finalisation path deletes anything — the executed
document is stored as a *new* version alongside the source, so the original is always
recoverable.

Signature images are stored inline on `fields.value` as data URLs. If a retention policy
requires purging biometric artefacts after a period, clear that column: the audit trail
records each mark by digest, so the record stays verifiable without the image itself.

## Scaling notes

See `ARCHITECTURE.md` §6 for the PostgreSQL and object-storage migration path. In
summary: the storage layer is isolated behind `lib/db.js` and `lib/storage.js`, the SQL
is portable and parameterised, and webhook and email dispatch are each a single function
call away from being queue-backed.
