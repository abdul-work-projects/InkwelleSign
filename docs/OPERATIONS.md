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

## Pre-production checklist

- [ ] `APP_URL` set to the public HTTPS origin
- [ ] TLS terminated in front of the app; HSTS enabled at the edge
- [ ] `SMTP_URL` configured, with SPF/DKIM/DMARC aligned for `MAIL_FROM`
- [ ] `CRON_SECRET` set and the reminder job scheduled
- [ ] `INKWELL_DATA_DIR` on persistent, backed-up storage with restrictive permissions
- [ ] Organisation signing keys migrated to a KMS/HSM (see the threat model, §5)
- [ ] Rate limiting in front of `/api/auth/login` and `/api/sign/*`
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
