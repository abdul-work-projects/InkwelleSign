import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { sha256 } from './crypto.js';

const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.42, 0.47, 0.55);
const RULE = rgb(0.85, 0.87, 0.9);
const ACCENT = rgb(0.31, 0.275, 0.898);
const OK = rgb(0.02, 0.47, 0.34);

/** Reads structural metadata without trusting client-supplied values. */
export async function inspectPdf(buffer) {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  return {
    pageCount: pages.length,
    pageSizes: pages.map((p) => {
      const { width, height } = p.getSize();
      return { w: Math.round(width * 100) / 100, h: Math.round(height * 100) / 100 };
    }),
  };
}

function wrapText(font, text, size, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      // Break a single over-long token character by character.
      let chunk = '';
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function dataUrlToBytes(dataUrl) {
  const m = /^data:(image\/(png|jpeg|jpg));base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[3], 'base64') };
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * Flattens collected field values onto the source PDF and stamps a tamper-evident
 * footer on every page. Field geometry is stored normalised (0..1, top-left origin)
 * so it is independent of the zoom level used in the editor.
 */
export async function renderExecutedPdf({ sourceBytes, fields, recipients, envelope }) {
  const doc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true, updateMetadata: false });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  const byId = new Map(recipients.map((r) => [r.id, r]));

  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const x = field.x * pw;
    const w = field.w * pw;
    const h = field.h * ph;
    const yTop = field.y * ph;
    const y = ph - yTop - h; // pdf-lib origin is bottom-left

    const value = field.value;
    if (value === null || value === undefined || value === '') continue;

    if (field.type === 'signature' || field.type === 'initials') {
      const img = dataUrlToBytes(value);
      let embedded = null;
      if (img) {
        try {
          embedded = img.mime === 'image/png'
            ? await doc.embedPng(img.bytes)
            : await doc.embedJpg(img.bytes);
        } catch {
          embedded = null; // fall back to a text mark rather than failing the whole render
        }
      }
      if (embedded) {
        const scale = Math.min(w / embedded.width, h / embedded.height);
        const dw = embedded.width * scale;
        const dh = embedded.height * scale;
        page.drawImage(embedded, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh });
      } else {
        const recipient = byId.get(field.recipient_id);
        const fallback = /^data:image/.test(String(value)) ? (recipient?.name || 'Signed') : String(value);
        const size = Math.min(h * 0.62, 22);
        page.drawText(fallback, { x: x + 2, y: y + (h - size) / 2 + size * 0.12, size, font: helvBold, color: INK });
      }
      const signer = byId.get(field.recipient_id);
      // Attribution sits above the mark so it never collides with printed form labels.
      const meta = `${signer?.name || ''} · ${fmt(field.filled_at)}`;
      page.drawText(meta, { x, y: y + h + 1.5, size: 5.5, font: helv, color: MUTED });
    } else if (field.type === 'checkbox') {
      const checked = value === 'true' || value === true || value === '1';
      const box = Math.min(w, h, 14);
      page.drawRectangle({
        x, y: y + (h - box) / 2, width: box, height: box,
        borderColor: INK, borderWidth: 0.9, color: rgb(1, 1, 1), opacity: 1,
      });
      if (checked) {
        page.drawText('X', {
          x: x + box * 0.22, y: y + (h - box) / 2 + box * 0.2,
          size: box * 0.72, font: helvBold, color: INK,
        });
      }
    } else {
      const size = Math.max(6, Math.min(field.font_size || 11, h * 0.78));
      const lines = wrapText(helv, value, size, Math.max(w - 2, 8));
      let ty = y + h - size;
      for (const line of lines) {
        if (ty < y - 1) break;
        page.drawText(line, { x: x + 1.5, y: ty, size, font: helv, color: INK });
        ty -= size * 1.18;
      }
    }
  }

  // Tamper-evident page footer.
  const head = (envelope.audit_head_hash || '').slice(0, 16);
  pages.forEach((page, i) => {
    const { width } = page.getSize();
    const stamp = `Executed via Inkwell eSign  ·  Envelope ${envelope.id}  ·  Evidence ${head}  ·  Page ${i + 1} of ${pages.length}`;
    page.drawText(stamp, { x: 22, y: 12, size: 5.6, font: helv, color: MUTED });
    page.drawLine({ start: { x: 22, y: 22 }, end: { x: width - 22, y: 22 }, thickness: 0.4, color: RULE });
  });

  doc.setTitle(envelope.title);
  doc.setProducer('Inkwell eSign');
  doc.setCreator('Inkwell eSign');
  doc.setSubject(`Executed envelope ${envelope.id}`);
  doc.setKeywords([`envelope:${envelope.id}`, `evidence:${envelope.audit_head_hash || ''}`]);

  // updateMetadata:false keeps pdf-lib from overwriting the Producer we just set,
  // and keeps output byte-identical for identical input.
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false, updateMetadata: false }));
  return { bytes, sha256: sha256(bytes), pageCount: pages.length };
}

/**
 * Certificate of completion: a standalone PDF evidence summary containing the
 * signer roster, integrity digests and the full hash-chained audit trail.
 */
export async function buildCertificate({ envelope, recipients, events, org, sourceVersion, executedVersion, evidenceSignature }) {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 612, H = 792, M = 46;
  let page, y;

  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const need = (space) => { if (y - space < M + 26) { footer(); newPage(); heading('Certificate of Completion (continued)'); } };
  const footer = () => {
    const idx = doc.getPageCount();
    page.drawLine({ start: { x: M, y: M - 12 }, end: { x: W - M, y: M - 12 }, thickness: 0.5, color: RULE });
    page.drawText(`Inkwell eSign · Envelope ${envelope.id}`, { x: M, y: M - 24, size: 6.5, font: helv, color: MUTED });
    const label = `Page ${idx}`;
    page.drawText(label, { x: W - M - helv.widthOfTextAtSize(label, 6.5), y: M - 24, size: 6.5, font: helv, color: MUTED });
  };

  const heading = (text) => {
    page.drawText(text, { x: M, y: y - 14, size: 15, font: bold, color: INK });
    y -= 26;
  };
  const section = (text) => {
    need(34);
    y -= 8;
    page.drawText(text.toUpperCase(), { x: M, y, size: 7.5, font: bold, color: ACCENT });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: RULE });
    y -= 14;
  };
  const kv = (key, value, opts = {}) => {
    need(16);
    const size = opts.size || 8.5;
    page.drawText(key, { x: M, y, size, font: bold, color: MUTED });
    const lines = wrapText(opts.mono ? helv : helv, String(value ?? '—'), size, W - M - (M + 138));
    lines.forEach((line, i) => {
      if (i > 0) { y -= size * 1.35; need(14); }
      page.drawText(line, { x: M + 138, y, size, font: helv, color: opts.color || INK });
    });
    y -= 15;
  };
  const para = (text, size = 8.2, color = MUTED) => {
    const lines = wrapText(helv, text, size, W - M * 2);
    for (const line of lines) {
      need(14);
      page.drawText(line, { x: M, y, size, font: helv, color });
      y -= size * 1.5;
    }
    y -= 4;
  };

  newPage();

  // Masthead
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: rgb(0.055, 0.075, 0.13) });
  page.drawText('Inkwell', { x: M, y: H - 44, size: 17, font: bold, color: rgb(1, 1, 1) });
  page.drawText('eSign', { x: M + bold.widthOfTextAtSize('Inkwell', 17), y: H - 44, size: 17, font: bold, color: rgb(0.58, 0.55, 0.98) });
  page.drawText('CERTIFICATE OF COMPLETION', { x: M, y: H - 66, size: 8.5, font: bold, color: rgb(0.68, 0.72, 0.8) });
  const issued = `Issued ${fmt(new Date().toISOString())}`;
  page.drawText(issued, { x: W - M - helv.widthOfTextAtSize(issued, 7.5), y: H - 66, size: 7.5, font: helv, color: rgb(0.6, 0.64, 0.72) });
  y = H - 96 - 26;

  heading(envelope.title);
  para(`This certificate records the electronic execution of the document identified below, together with the tamper-evident audit trail captured by Inkwell eSign during the signing process.`);

  section('Envelope');
  kv('Envelope ID', envelope.id);
  kv('Status', String(envelope.status).replace('_', ' ').toUpperCase(), { color: envelope.status === 'completed' ? OK : INK });
  kv('Organisation', org?.name || '—');
  kv('Signing order', envelope.ordered ? 'Sequential' : 'Parallel');
  kv('Created', fmt(envelope.created_at));
  kv('Sent', fmt(envelope.sent_at));
  kv('Completed', fmt(envelope.completed_at));

  section('Document integrity');
  kv('Original file', sourceVersion?.filename || '—');
  kv('Original SHA-256', sourceVersion?.sha256 || '—', { size: 7.2 });
  kv('Executed SHA-256', executedVersion?.sha256 || '—', { size: 7.2 });
  kv('Audit head hash', envelope.audit_head_hash || '—', { size: 7.2 });
  kv('Evidence signature', evidenceSignature ? `${evidenceSignature.slice(0, 64)}…  (ECDSA P-256 / SHA-256)` : '—', { size: 7.2 });
  para('Any modification to the executed document or to the audit trail will change these digests and invalidate the evidence signature, which is produced with a private key held by the issuing organisation.');

  section('Signers');
  for (const r of recipients) {
    need(76);
    page.drawRectangle({ x: M, y: y - 62, width: W - M * 2, height: 68, color: rgb(0.975, 0.98, 0.99), borderColor: RULE, borderWidth: 0.5 });
    const top = y - 2;
    page.drawText(`${r.name}`, { x: M + 10, y: top - 8, size: 9.5, font: bold, color: INK });
    page.drawText(`${r.email}`, { x: M + 10, y: top - 20, size: 7.8, font: helv, color: MUTED });
    const statusLabel = String(r.status).toUpperCase();
    page.drawText(statusLabel, {
      x: W - M - 10 - bold.widthOfTextAtSize(statusLabel, 7.5), y: top - 8,
      size: 7.5, font: bold, color: r.status === 'completed' ? OK : MUTED,
    });
    const row = (label, value, col) => {
      page.drawText(label, { x: col, y: top - 34, size: 6.4, font: bold, color: MUTED });
      page.drawText(String(value ?? '—'), { x: col, y: top - 44, size: 7.2, font: helv, color: INK });
    };
    row('ROLE / ORDER', `${r.role_name || r.kind} · #${r.order_index}`, M + 10);
    row('AUTHENTICATION', r.auth_method === 'access_code' ? 'Email link + access code' : 'Unique email link', M + 130);
    row('IP ADDRESS', r.signed_ip || '—', M + 265);
    row('SIGNED AT', r.completed_at ? fmt(r.completed_at) : '—', M + 350);
    const ua = (r.signed_user_agent || '—').slice(0, 118);
    page.drawText('CLIENT', { x: M + 10, y: top - 54, size: 6.4, font: bold, color: MUTED });
    page.drawText(ua, { x: M + 56, y: top - 54, size: 6.2, font: helv, color: MUTED });
    y -= 74;
  }

  section('Audit trail');
  para('Each entry is chained to its predecessor with SHA-256. The hash column shows the first 12 characters of the entry digest.', 7.4);
  need(20);
  const cols = [M, M + 104, M + 232, M + 350, M + 452];
  ['TIMESTAMP (UTC)', 'EVENT', 'ACTOR', 'IP', 'HASH'].forEach((h, i) => {
    page.drawText(h, { x: cols[i], y, size: 6.4, font: bold, color: MUTED });
  });
  y -= 5;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: RULE });
  y -= 11;

  for (const e of events) {
    need(16);
    const cells = [
      fmt(e.created_at).replace(' UTC', ''),
      e.event_type,
      (e.actor_label || e.actor_type || '').slice(0, 26),
      e.ip || '—',
      e.hash.slice(0, 12),
    ];
    cells.forEach((c, i) => {
      page.drawText(String(c), { x: cols[i], y, size: 6.6, font: helv, color: i === 1 ? INK : MUTED });
    });
    y -= 11.5;
  }

  y -= 10;
  need(40);
  para('Verification: recompute the SHA-256 chain over the audit entries above and compare the final value against the audit head hash; then verify the evidence signature against the organisation public key published at /api/v1/organization/public-key.', 7.2);

  footer();

  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return { bytes, sha256: sha256(bytes), pageCount: doc.getPageCount() };
}

/** Merges the executed document and certificate into a single downloadable file. */
export async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

/**
 * A simple, dependency-free sample agreement used to seed demo data. Returns the
 * PDF bytes plus normalised anchor rectangles for the signature block, so seeded
 * fields land exactly on the printed lines.
 */
export async function buildSamplePdf(title = 'Mutual Non-Disclosure Agreement') {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 64;

  const body = [
    ['1. Purpose', 'The parties wish to explore a potential business relationship. In connection with this opportunity, each party may disclose to the other certain confidential technical and business information which the receiving party will protect on the terms set out in this agreement.'],
    ['2. Confidential Information', '"Confidential Information" means any information disclosed by one party to the other, either directly or indirectly, in writing, orally or by inspection of tangible objects, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information.'],
    ['3. Obligations', 'The receiving party shall not use the disclosing party\'s Confidential Information for any purpose except to evaluate and engage in discussions concerning the potential business relationship, and shall not disclose it to third parties without prior written consent.'],
    ['4. Term', 'The obligations of each receiving party under this agreement shall survive for three (3) years from the date of disclosure of the relevant Confidential Information.'],
    ['5. Governing Law', 'This agreement shall be governed by and construed in accordance with the laws of the jurisdiction in which the disclosing party maintains its principal place of business.'],
  ];

  let pageIndex = 1;
  let page = doc.addPage([W, H]);
  const nextPage = () => { page = doc.addPage([W, H]); pageIndex += 1; return H - M; };

  let y = H - M;
  page.drawText(title, { x: M, y, size: 17, font: bold, color: INK });
  y -= 12;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: ACCENT });
  y -= 28;
  page.drawText('This agreement is entered into as of the date of the last signature below.', { x: M, y, size: 9.5, font: helv, color: MUTED });
  y -= 26;

  for (const [h, text] of body) {
    if (y < 190) y = nextPage();
    page.drawText(h, { x: M, y, size: 10.5, font: bold, color: INK });
    y -= 15;
    for (const line of wrapText(helv, text, 9.5, W - M * 2)) {
      if (y < 140) y = nextPage();
      page.drawText(line, { x: M, y, size: 9.5, font: helv, color: rgb(0.2, 0.24, 0.3) });
      y -= 14;
    }
    y -= 12;
  }

  if (y < 250) y = nextPage();
  y -= 10;
  page.drawText('SIGNATURES', { x: M, y, size: 8, font: bold, color: ACCENT });
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: RULE });
  y -= 26;

  // Normalised rect helper: PDF coordinates (bottom-left) -> field coordinates (top-left).
  const rect = (x, baseline, w, h) => ({
    page: pageIndex, x: x / W, y: (H - baseline - h) / H, w: w / W, h: h / H,
  });

  const anchors = { parties: [] };
  for (const party of ['Disclosing Party', 'Receiving Party']) {
    page.drawText(party, { x: M, y, size: 9, font: bold, color: INK });
    y -= 44;
    page.drawLine({ start: { x: M, y }, end: { x: M + 210, y }, thickness: 0.7, color: rgb(0.6, 0.64, 0.7) });
    page.drawLine({ start: { x: M + 250, y }, end: { x: M + 380, y }, thickness: 0.7, color: rgb(0.6, 0.64, 0.7) });
    page.drawText('Signature', { x: M, y: y - 11, size: 7.5, font: helv, color: MUTED });
    page.drawText('Date', { x: M + 250, y: y - 11, size: 7.5, font: helv, color: MUTED });
    anchors.parties.push({
      signature: rect(M + 4, y + 3, 202, 32),
      date: rect(M + 252, y + 3, 128, 14),
    });
    y -= 42;
  }

  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 0.5, color: RULE });
  page.drawText('Acknowledgement', { x: M + 20, y, size: 8.5, font: bold, color: INK });
  page.drawText('The Receiving Party confirms it has read and accepts the terms above.',
    { x: M + 20, y: y - 12, size: 8, font: helv, color: MUTED });
  anchors.checkbox = rect(M, y - 3, 13, 13);
  anchors.initials = rect(W - M - 74, 44, 70, 24);
  page.drawText('Initials', { x: W - M - 74, y: 34, size: 6.5, font: helv, color: MUTED });

  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return { bytes, anchors, pageCount: doc.getPageCount() };
}
