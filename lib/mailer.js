import { db, newId, nowIso } from './db.js';

const SMTP_URL = process.env.SMTP_URL || '';
const FROM = process.env.MAIL_FROM || 'Inkwell eSign <no-reply@inkwell.example>';

export function appUrl() {
  return (process.env.APP_URL || 'http://localhost:4000').replace(/\/$/, '');
}

function shell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e3e6ea;overflow:hidden">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #eef0f3">
          <span style="font-size:17px;font-weight:700;letter-spacing:-.2px;color:#0f172a">Inkwell<span style="color:#4f46e5">eSign</span></span>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;color:#0f172a">${title}</h1>
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#fafbfc;border-top:1px solid #eef0f3;color:#64748b;font-size:12px;line-height:1.6">
          This message was sent by Inkwell eSign. If you were not expecting it, you can ignore this email.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0"><tr>
    <td style="background:#4f46e5;border-radius:9px">
      <a href="${href}" style="display:inline-block;padding:12px 24px;color:#fff;text-decoration:none;font-weight:600;font-size:14px">${label}</a>
    </td></tr></table>`;
}

const P = (t) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#334155">${t}</p>`;
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

export const templates = {
  invitation({ recipient, envelope, sender, url }) {
    const title = `${esc(sender)} requested your signature`;
    const body =
      P(`Hello ${esc(recipient.name)},`) +
      P(`<strong>${esc(sender)}</strong> has sent you <strong>${esc(envelope.title)}</strong> to review and sign.`) +
      (envelope.message ? `<div style="margin:0 0 12px;padding:12px 14px;background:#f8fafc;border-left:3px solid #4f46e5;border-radius:6px;font-size:14px;color:#334155;line-height:1.6">${esc(envelope.message)}</div>` : '') +
      button(url, 'Review & sign document') +
      P(`<span style="color:#64748b;font-size:12px">This link is unique to you — please do not forward it.</span>`);
    return {
      subject: `Signature requested: ${envelope.title}`,
      html: shell(title, body),
      text: `${sender} sent you "${envelope.title}" to sign.\n\nOpen: ${url}\n\nThis link is unique to you; do not forward it.`,
    };
  },
  reminder({ recipient, envelope, sender, url }) {
    const title = `Reminder: ${esc(envelope.title)} awaits your signature`;
    const body =
      P(`Hello ${esc(recipient.name)},`) +
      P(`This is a reminder that <strong>${esc(envelope.title)}</strong> from ${esc(sender)} is still waiting for your signature.`) +
      button(url, 'Complete signing');
    return {
      subject: `Reminder: please sign "${envelope.title}"`,
      html: shell(title, body),
      text: `Reminder: "${envelope.title}" is waiting for your signature.\n\nOpen: ${url}`,
    };
  },
  completed({ recipient, envelope, url }) {
    const title = `${esc(envelope.title)} is complete`;
    const body =
      P(`Hello ${esc(recipient.name)},`) +
      P(`All parties have signed <strong>${esc(envelope.title)}</strong>. The executed copy and certificate of completion are attached to the record below.`) +
      button(url, 'Download signed document');
    return {
      subject: `Completed: ${envelope.title}`,
      html: shell(title, body),
      text: `"${envelope.title}" has been completed by all parties.\n\nDownload: ${url}`,
    };
  },
  declined({ recipient, envelope, decliner, reason }) {
    const title = `${esc(envelope.title)} was declined`;
    const body =
      P(`Hello ${esc(recipient.name)},`) +
      P(`<strong>${esc(decliner)}</strong> declined to sign <strong>${esc(envelope.title)}</strong>.`) +
      (reason ? P(`Reason given: <em>${esc(reason)}</em>`) : '');
    return {
      subject: `Declined: ${envelope.title}`,
      html: shell(title, body),
      text: `${decliner} declined to sign "${envelope.title}".${reason ? `\nReason: ${reason}` : ''}`,
    };
  },
};

let transporterPromise = null;
async function getTransporter() {
  if (!SMTP_URL) return null;
  if (!transporterPromise) {
    transporterPromise = import('nodemailer').then((m) => m.default.createTransport(SMTP_URL));
  }
  return transporterPromise;
}

/**
 * Every message is persisted to `email_outbox` before delivery is attempted, so the
 * outbox doubles as a delivery log and — when no SMTP server is configured — as a
 * fully browsable inbox for local evaluation.
 */
export async function sendMail({ orgId, envelopeId = null, recipientId = null, to, toName = null, kind = 'invitation', subject, html, text }) {
  const id = newId('eml');
  db.prepare(`INSERT INTO email_outbox
    (id, org_id, envelope_id, recipient_id, to_email, to_name, subject, html, text, kind, status, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, orgId, envelopeId, recipientId, to, toName, subject, html, text, kind, 'queued', nowIso());

  try {
    const transporter = await getTransporter();
    if (transporter) {
      await transporter.sendMail({ from: FROM, to, subject, html, text });
    }
    db.prepare('UPDATE email_outbox SET status = ?, sent_at = ? WHERE id = ?')
      .run('sent', nowIso(), id);
    return { id, delivered: true, captured: !SMTP_URL };
  } catch (err) {
    db.prepare('UPDATE email_outbox SET status = ?, error = ? WHERE id = ?')
      .run('failed', String(err?.message || err), id);
    return { id, delivered: false, error: String(err?.message || err) };
  }
}
