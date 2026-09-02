import { z } from 'zod';
import { db, newId, nowIso } from '@/lib/db.js';
import { withAuth, json, fail, readJson } from '@/lib/api.js';
import { sha256 } from '@/lib/crypto.js';
import { recordEvent } from '@/lib/audit.js';
import { RECIPIENT_COLORS, publicEnvelope } from '@/lib/envelopes.js';

const RecipientIn = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(160),
  role: z.string().max(60).optional().nullable(),
  kind: z.enum(['signer', 'approver', 'cc']).default('signer'),
  order: z.number().int().min(1).max(50).default(1),
  accessCode: z.string().min(4).max(40).optional().nullable(),
  roleKey: z.string().optional().nullable(),
});

const FieldIn = z.object({
  type: z.enum(['signature', 'initials', 'date', 'text', 'checkbox', 'dropdown', 'email', 'fullname']),
  page: z.number().int().min(1),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  w: z.number().min(0.005).max(1), h: z.number().min(0.004).max(1),
  required: z.boolean().default(true),
  label: z.string().max(80).optional().nullable(),
  options: z.array(z.string().max(80)).optional().nullable(),
  fontSize: z.number().int().min(6).max(48).default(11),
  recipientIndex: z.number().int().min(0).optional(),
  roleKey: z.string().optional().nullable(),
});

const CreateBody = z.object({
  title: z.string().min(1).max(160),
  message: z.string().max(2000).optional().nullable(),
  documentVersionId: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
  ordered: z.boolean().default(true),
  expiresAt: z.string().datetime().optional().nullable(),
  recipients: z.array(RecipientIn).min(1).max(30),
  fields: z.array(FieldIn).optional().default([]),
});

export const GET = withAuth(async ({ orgId, request }) => {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 200);

  const where = ['e.org_id = ?'];
  const args = [orgId];
  if (status && status !== 'all') { where.push('e.status = ?'); args.push(status); }
  if (q) { where.push('LOWER(e.title) LIKE ?'); args.push(`%${q.toLowerCase()}%`); }

  const envelopes = db.prepare(`
    SELECT e.*, u.name AS created_by_name,
      (SELECT COUNT(*) FROM recipients r WHERE r.envelope_id = e.id AND r.kind != 'cc') AS signer_count,
      (SELECT COUNT(*) FROM recipients r WHERE r.envelope_id = e.id AND r.kind != 'cc' AND r.status = 'completed') AS signed_count
    FROM envelopes e LEFT JOIN users u ON u.id = e.created_by
    WHERE ${where.join(' AND ')}
    ORDER BY e.created_at DESC LIMIT ?`).all(...args, limit);
  return json({ envelopes });
});

export const POST = withAuth(async ({ orgId, actor, meta, request }) => {
  const parsed = CreateBody.safeParse(await readJson(request));
  if (!parsed.success) return fail(parsed.error.issues[0].message, 422);
  const body = parsed.data;

  let versionId = body.documentVersionId;
  let templateFields = null;
  let templateRoles = null;

  if (body.templateId) {
    const template = db.prepare('SELECT * FROM templates WHERE id = ? AND org_id = ?').get(body.templateId, orgId);
    if (!template) return fail('Template not found', 404);
    versionId = template.document_version_id;
    templateFields = JSON.parse(template.fields || '[]');
    templateRoles = JSON.parse(template.roles || '[]');
  }

  const version = db.prepare('SELECT * FROM document_versions WHERE id = ? AND org_id = ?').get(versionId, orgId);
  if (!version) return fail('Document version not found', 404);

  const envelopeId = newId('env');
  const createdAt = nowIso();

  db.transaction(() => {
    db.prepare(`INSERT INTO envelopes
      (id, org_id, document_id, source_version_id, template_id, title, message, status, ordered, expires_at, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,'draft',?,?,?,?)`)
      .run(envelopeId, orgId, version.document_id, version.id, body.templateId || null,
        body.title, body.message || null, body.ordered ? 1 : 0, body.expiresAt || null,
        actor.user?.id || null, createdAt);

    const recipientIds = [];
    body.recipients.forEach((r, i) => {
      const id = newId('rcp');
      recipientIds.push(id);
      db.prepare(`INSERT INTO recipients
        (id, envelope_id, org_id, order_index, name, email, role_name, kind, color, access_code_hash, auth_method)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, envelopeId, orgId, body.ordered ? (r.order || i + 1) : 1, r.name, r.email.toLowerCase(),
          r.role || r.roleKey || null, r.kind, RECIPIENT_COLORS[i % RECIPIENT_COLORS.length],
          r.accessCode ? sha256(r.accessCode) : null, r.accessCode ? 'access_code' : 'link');
    });

    const insertField = db.prepare(`INSERT INTO fields
      (id, envelope_id, recipient_id, type, page, x, y, w, h, required, label, options, font_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

    const source = templateFields?.length ? templateFields : body.fields;
    for (const f of source) {
      let recipientId = null;
      if (typeof f.recipientIndex === 'number' && recipientIds[f.recipientIndex]) {
        recipientId = recipientIds[f.recipientIndex];
      } else if (f.roleKey) {
        const idx = body.recipients.findIndex((r) => r.roleKey === f.roleKey);
        if (idx >= 0) recipientId = recipientIds[idx];
        else {
          const roleIdx = (templateRoles || []).findIndex((r) => r.key === f.roleKey);
          if (roleIdx >= 0 && recipientIds[roleIdx]) recipientId = recipientIds[roleIdx];
        }
      }
      if (!recipientId) recipientId = recipientIds[0];
      insertField.run(newId('fld'), envelopeId, recipientId, f.type, f.page, f.x, f.y, f.w, f.h,
        f.required === false ? 0 : 1, f.label || null,
        f.options ? JSON.stringify(f.options) : null, f.fontSize || 11);
    }
  })();

  recordEvent({
    orgId, envelopeId, eventType: 'envelope.created',
    actorType: actor.kind === 'api' ? 'api' : 'user', actorId: actor.user?.id || actor.apiKey?.id,
    actorLabel: actor.label, ip: meta.ip, userAgent: meta.userAgent,
    payload: {
      title: body.title, documentVersionId: version.id, documentSha256: version.sha256,
      ordered: body.ordered, recipients: body.recipients.length, templateId: body.templateId || null,
    },
  });

  return json({ envelope: publicEnvelope(orgId, envelopeId), id: envelopeId }, { status: 201 });
}, { minRole: 'member' });
