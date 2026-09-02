import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { useTempStore } from './helpers.mjs';
useTempStore('pdf');

const { buildSamplePdf, inspectPdf, renderExecutedPdf, buildCertificate, mergePdfs } = await import('../lib/pdf.js');
const { drawSignaturePng, encodePng } = await import('../lib/png.js');

const { bytes: source, anchors } = await buildSamplePdf('Test Agreement');
const signature = `data:image/png;base64,${drawSignaturePng({ seed: 3 }).toString('base64')}`;

const recipients = [
  { id: 'r1', name: 'Alpha Signer', email: 'alpha@test.local', status: 'completed', order_index: 1, kind: 'signer', role_name: 'Party A', auth_method: 'link', signed_ip: '203.0.113.9', signed_user_agent: 'node-test', completed_at: new Date().toISOString() },
  { id: 'r2', name: 'Beta Signer', email: 'beta@test.local', status: 'completed', order_index: 2, kind: 'signer', role_name: 'Party B', auth_method: 'access_code', signed_ip: '203.0.113.10', signed_user_agent: 'node-test', completed_at: new Date().toISOString() },
];

const envelope = {
  id: 'env_test', title: 'Test Agreement', status: 'completed', ordered: 1,
  created_at: new Date().toISOString(), sent_at: new Date().toISOString(),
  completed_at: new Date().toISOString(), audit_head_hash: 'f'.repeat(64),
};

test('the sample document reports geometry that matches its anchors', async () => {
  const meta = await inspectPdf(source);
  assert.ok(meta.pageCount >= 1);
  assert.equal(meta.pageSizes[0].w, 612);
  assert.equal(meta.pageSizes[0].h, 792);
  for (const party of anchors.parties) {
    for (const rect of [party.signature, party.date]) {
      assert.ok(rect.x >= 0 && rect.x + rect.w <= 1, 'anchor must sit inside the page');
      assert.ok(rect.y >= 0 && rect.y + rect.h <= 1);
      assert.ok(rect.page >= 1 && rect.page <= meta.pageCount);
    }
  }
});

test('field values are flattened into the executed PDF', async () => {
  const fields = [
    { recipient_id: 'r1', type: 'signature', value: signature, filled_at: envelope.completed_at, font_size: 11, ...anchors.parties[0].signature },
    { recipient_id: 'r1', type: 'date', value: 'Sep 2, 2026', filled_at: envelope.completed_at, font_size: 10, ...anchors.parties[0].date },
    { recipient_id: 'r2', type: 'signature', value: signature, filled_at: envelope.completed_at, font_size: 11, ...anchors.parties[1].signature },
    { recipient_id: 'r2', type: 'checkbox', value: 'true', filled_at: envelope.completed_at, font_size: 11, ...anchors.checkbox },
  ];
  const result = await renderExecutedPdf({ sourceBytes: source, fields, recipients, envelope });

  assert.equal(result.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.ok(result.bytes.length > source.length, 'stamping should add content');

  // updateMetadata:false so simply reading the file does not rewrite its Producer.
  const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
  assert.equal(doc.getPageCount(), result.pageCount);
  assert.equal(doc.getTitle(), envelope.title);
  assert.equal(doc.getProducer(), 'Inkwell eSign');
  assert.ok(doc.getKeywords().includes(`envelope:${envelope.id}`));
});

test('a corrupt signature image degrades to a text mark instead of failing', async () => {
  const fields = [{
    recipient_id: 'r1', type: 'signature', value: 'data:image/png;base64,bm90LWEtcG5n',
    filled_at: envelope.completed_at, font_size: 11, ...anchors.parties[0].signature,
  }];
  const result = await renderExecutedPdf({ sourceBytes: source, fields, recipients, envelope });
  assert.equal(result.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('rendering is deterministic for identical input', async () => {
  const fields = [{
    recipient_id: 'r1', type: 'text', value: 'Hello world', filled_at: envelope.completed_at,
    font_size: 11, ...anchors.parties[0].signature,
  }];
  const a = await renderExecutedPdf({ sourceBytes: source, fields, recipients, envelope });
  const b = await renderExecutedPdf({ sourceBytes: source, fields, recipients, envelope });
  assert.equal(a.sha256, b.sha256);
});

test('the certificate of completion carries the evidence summary', async () => {
  const events = Array.from({ length: 40 }, (_, i) => ({
    seq: i + 1, event_type: 'recipient.viewed', actor_label: 'Alpha Signer <alpha@test.local>',
    actor_type: 'recipient', ip: '203.0.113.9', created_at: new Date().toISOString(),
    hash: `${i}`.padStart(64, '0'), prev_hash: '0'.repeat(64), payload: '{}',
  }));
  const cert = await buildCertificate({
    envelope, recipients, events, org: { name: 'Test Org' },
    sourceVersion: { filename: 'test.pdf', sha256: 'a'.repeat(64) },
    executedVersion: { sha256: 'b'.repeat(64) },
    evidenceSignature: 'MEUCIQ' + 'x'.repeat(80),
  });
  assert.equal(cert.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(cert.pageCount >= 2, 'forty audit rows should paginate');
});

test('merging produces a single packet with all pages', async () => {
  const cert = await buildCertificate({
    envelope, recipients, events: [], org: { name: 'Test Org' },
    sourceVersion: { filename: 'test.pdf', sha256: 'a'.repeat(64) },
    executedVersion: { sha256: 'b'.repeat(64) }, evidenceSignature: null,
  });
  const sourceDoc = await PDFDocument.load(source);
  const merged = await mergePdfs([source, cert.bytes]);
  const mergedDoc = await PDFDocument.load(merged);
  assert.equal(mergedDoc.getPageCount(), sourceDoc.getPageCount() + cert.pageCount);
});

test('the PNG encoder emits a valid, embeddable image', async () => {
  const png = drawSignaturePng({ width: 120, height: 60, seed: 9 });
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(png);
  assert.equal(img.width, 120);
  assert.equal(img.height, 60);

  const solid = encodePng(2, 2, new Uint8Array([255,0,0,255, 0,255,0,255, 0,0,255,255, 0,0,0,255]));
  const img2 = await doc.embedPng(solid);
  assert.equal(img2.width, 2);
});
