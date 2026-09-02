# REST API

Base path `/api/v1`. All responses are JSON unless the endpoint returns a PDF.

## Authentication

Two principals are accepted, and both resolve to a single organisation:

```http
Authorization: Bearer ink_live_...        # integration key (Settings → API keys)
Cookie: inkwell_session=...               # browser session, used by the dashboard
```

Keys are shown once at creation and stored only as a SHA-256 digest. An API key acts
with `admin` privileges **inside its own organisation only**. Every query is filtered by
that organisation, so no request can reach another tenant's data.

Errors use conventional status codes with `{ "error": "message" }`:
`401` unauthenticated · `403` insufficient role · `404` not found or not yours ·
`409` state conflict · `413` payload too large · `415` unsupported media type ·
`422` validation failure · `429` throttled.

## Documents

### `GET /documents`
Lists documents with page count, size, latest version id and source digest.

### `POST /documents`
`multipart/form-data` with `file` (PDF, ≤ 25 MB), optional `name`, and optional
`documentId` to add a version to an existing document. Returns `201` with the document
and the new version.

### `GET /documents/:id` · `DELETE /documents/:id`
Detail with all versions and referencing envelopes. Deletion is refused (`409`) while a
non-draft envelope references the document.

### `GET /versions/:id/file[?download=1]`
Streams the PDF bytes. `no-store`, `nosniff`.

## Envelopes

### `GET /envelopes?status=&q=&limit=`
`status` ∈ `all|draft|sent|in_progress|completed|declined|voided|expired`.

### `POST /envelopes`

```json
{
  "title": "Mutual NDA",
  "message": "Please review and sign.",
  "documentVersionId": "dv_...",
  "templateId": null,
  "ordered": true,
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "recipients": [
    { "name": "Jordan Reyes", "email": "jordan@acme.com", "role": "Counterparty",
      "kind": "signer", "order": 1, "accessCode": "4821" }
  ],
  "fields": [
    { "type": "signature", "page": 1, "x": 0.12, "y": 0.78, "w": 0.26, "h": 0.055,
      "required": true, "label": null, "fontSize": 11, "recipientIndex": 0 }
  ]
}
```

Supply **either** `documentVersionId` **or** `templateId`; with a template the field
layout comes from the template and recipients map to its roles by position (or by
`roleKey`). `kind` ∈ `signer|approver|cc`. Coordinates are fractions of the page with a
top-left origin. Creates the envelope in `draft`. Returns `201`.

### `GET /envelopes/:id`
Envelope, recipients, fields, source and output versions, the ids whose turn it is, and
a live audit-chain integrity check.

### `PATCH /envelopes/:id` · `DELETE /envelopes/:id`
Draft only (`409` otherwise). Void a sent envelope instead of deleting it.

### `PUT /envelopes/:id/recipients` · `PUT /envelopes/:id/fields`
Full replacement of the recipient list or field layout. Draft only. Fields referencing an
unknown recipient are rejected with `422`.

### `POST /envelopes/:id/send`
Validates that every signer has at least one field, mints signing tokens for the first
turn, sends invitations, records `envelope.sent` and fires the `envelope.sent` webhook.

### `POST /envelopes/:id/remind`
Body `{ "recipientId": "rcp_..." }`, or omit it to remind everyone whose turn it is.
Re-issues the signing token, invalidating the previous link.

### `POST /envelopes/:id/void`
Body `{ "reason": "..." }`. Invalidates all outstanding links. Completed envelopes
cannot be voided.

### `GET /envelopes/:id/audit`
Full hash chain, the chain verification result, and the evidence seal status.

### `GET /envelopes/:id/verify`

```json
{
  "envelopeId": "env_...",
  "verifiedAt": "2026-09-02T10:12:04.000Z",
  "auditChain": { "valid": true, "head": "e6afc4...", "events": 12 },
  "evidenceSeal": { "sealed": true, "valid": true },
  "documents": [ { "kind": "executed", "sha256": "...", "intact": true } ],
  "verdict": "intact"
}
```

Recomputes the chain, re-hashes every stored file and verifies the ECDSA seal.
`verdict` is `intact` or `tampered`.

### `GET /envelopes/:id/download?doc=`
`combined` (default: executed + certificate), `executed`, `certificate` or `source`.
`409` before completion.

## Templates

`GET /templates` · `POST /templates` · `GET|PATCH|DELETE /templates/:id`

```json
{
  "name": "Mutual NDA (standard)",
  "documentVersionId": "dv_...",
  "roles":  [ { "key": "role1", "name": "Disclosing Party", "order": 1 } ],
  "fields": [ { "roleKey": "role1", "type": "signature", "page": 1,
                "x": 0.1, "y": 0.7, "w": 0.28, "h": 0.05 } ]
}
```

## Organisation, team and credentials

| Endpoint | Notes |
| --- | --- |
| `GET /organization/public-key` | PEM public key used to verify evidence seals |
| `GET /team` · `POST /team` · `PATCH /team` | Members and roles; admin+ to modify |
| `GET /api-keys` · `POST /api-keys` · `DELETE /api-keys/:id` | Admin+; the key is returned once |
| `GET /webhooks` · `POST /webhooks` · `PATCH|DELETE /webhooks/:id` | Admin+ |
| `GET /webhook-deliveries` | Last 100 attempts with status codes |
| `GET /outbox[?envelopeId=]` | Every message generated, with delivery state |
| `GET /stats` | Dashboard counters and recent activity |

## Webhooks

Events: `envelope.sent`, `envelope.viewed`, `envelope.recipient_completed`,
`envelope.completed`, `envelope.declined`, `envelope.voided`. Subscribe to `*` for all.

```http
POST /your-endpoint
Content-Type: application/json
X-Inkwell-Event: envelope.completed
X-Inkwell-Signature: t=1767225600,v1=9f2c...
```

The signature is `HMAC-SHA256(secret, "<t>.<raw body>")`. Verify against the **raw**
body before parsing, and reject timestamps outside your tolerance window:

```js
const [t, v1] = header.split(',').map((p) => p.split('=')[1]);
if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error('stale');
const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) throw new Error('bad signature');
```

## Signing endpoints

Token-authenticated and public by design; the token *is* the credential. Not part of the
integration API, documented for completeness.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/sign/:token` | Session payload; records `recipient.viewed` on first open |
| `POST /api/sign/:token/access` | Submit an access code (throttled, audited) |
| `GET /api/sign/:token/document` | Streams the source PDF |
| `PUT /api/sign/:token/fields` | Incremental save; writes outside this signer's fields are ignored |
| `POST /api/sign/:token/complete` | Requires `{ "consent": true }`; validates required fields |
| `POST /api/sign/:token/decline` | Body `{ "reason": "..." }` |

## Scheduled jobs

`POST /api/cron/reminders` with header `x-cron-secret: $CRON_SECRET`. Sends reminders
for recipients idle beyond `REMINDER_AFTER_HOURS` (up to `REMINDER_MAX` times) and marks
past-expiry envelopes `expired`.

## Worked example

```bash
KEY=ink_live_...
HOST=https://your-host

VER=$(curl -s -H "Authorization: Bearer $KEY" $HOST/api/v1/documents | jq -r '.documents[0].latest_version_id')

ENV=$(curl -s -X POST $HOST/api/v1/envelopes \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d "{\"title\":\"Mutual NDA\",\"documentVersionId\":\"$VER\",\"ordered\":true,
       \"recipients\":[{\"name\":\"Rae Lin\",\"email\":\"rae@partner.test\",\"order\":1}],
       \"fields\":[{\"type\":\"signature\",\"page\":1,\"x\":0.12,\"y\":0.75,\"w\":0.26,\"h\":0.05,\"recipientIndex\":0}]}" \
  | jq -r .id)

curl -s -X POST $HOST/api/v1/envelopes/$ENV/send -H "Authorization: Bearer $KEY"
curl -s $HOST/api/v1/envelopes/$ENV/verify -H "Authorization: Bearer $KEY" | jq .verdict
curl -s -o packet.pdf "$HOST/api/v1/envelopes/$ENV/download?doc=combined" -H "Authorization: Bearer $KEY"
```
