'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { api, formatDate, relativeTime, EVENT_LABELS, formatBytes } from '@/lib/client.js';
import { PageHeader } from '@/components/Shell.jsx';
import { Card, CardHeader, Button, StatusBadge, Spinner, Modal, Mono, Toast, Textarea, EmptyState } from '@/components/ui.jsx';
import PdfDocument from '@/components/PdfDocument.jsx';
import {
  Download, Bell, Ban, ShieldCheck, ShieldAlert, FileCheck2, Mail,
  Link2, Copy, Fingerprint, RefreshCw, ChevronRight,
} from 'lucide-react';

function Row({ label, children, mono }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-ink-200/50 last:border-0">
      <span className="text-[12.5px] text-ink-500 shrink-0">{label}</span>
      <span className={clsx('text-[12.5px] text-ink-800 text-right break-all', mono && 'font-mono text-[11px]')}>{children}</span>
    </div>
  );
}

export default function EnvelopeDetail({ id }) {
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState(null);
  const [emails, setEmails] = useState([]);
  const [verification, setVerification] = useState(null);
  const [toast, setToast] = useState(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');

  const load = useCallback(async () => {
    try {
      const bundle = await api(`/envelopes/${id}`);
      setData(bundle);
      const [a, o] = await Promise.all([
        api(`/envelopes/${id}/audit`),
        api(`/outbox?envelopeId=${id}`),
      ]);
      setAudit(a);
      setEmails(o.messages);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function remind(recipientId) {
    setBusy(true);
    try {
      const res = await api(`/envelopes/${id}/remind`, { method: 'POST', body: { recipientId } });
      setToast({ message: `Reminder sent to ${res.reminded} recipient${res.reminded === 1 ? '' : 's'}` });
      load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    finally { setBusy(false); }
  }

  async function voidEnvelope() {
    setBusy(true);
    try {
      await api(`/envelopes/${id}/void`, { method: 'POST', body: { reason: voidReason } });
      setVoidOpen(false);
      setToast({ message: 'Envelope voided' });
      load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true);
    try {
      setVerification(await api(`/envelopes/${id}/verify`));
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="p-16 flex justify-center text-ink-400"><Spinner size={22} /></div>;

  const { envelope, recipients, fields, source, finalVersion, certificateVersion, activeRecipientIds, integrity } = data;
  const completed = envelope.status === 'completed';
  const live = ['sent', 'in_progress'].includes(envelope.status);
  const previewVersionId = finalVersion?.id || source.id;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'document', label: 'Document' },
    { key: 'audit', label: `Audit trail${audit ? ` (${audit.events.length})` : ''}` },
    { key: 'emails', label: `Emails (${emails.length})` },
  ];

  return (
    <>
      <PageHeader
        title={envelope.title}
        badge={<StatusBadge status={envelope.status} />}
        description={
          <>Created {formatDate(envelope.created_at)}
            {envelope.sent_at ? ` · sent ${relativeTime(envelope.sent_at)}` : ''}
            {envelope.completed_at ? ` · completed ${relativeTime(envelope.completed_at)}` : ''}
          </>
        }
        actions={<>
          {live && <Button variant="secondary" onClick={() => remind(null)} disabled={busy}><Bell size={15} /> Remind</Button>}
          {envelope.status !== 'completed' && envelope.status !== 'voided' && (
            <Button variant="secondary" onClick={() => setVoidOpen(true)}><Ban size={15} /> Void</Button>
          )}
          {completed && (
            <Button as="a" href={`/api/v1/envelopes/${id}/download?doc=combined`}>
              <Download size={15} /> Signed packet
            </Button>
          )}
        </>}
      />

      <div className="px-5 sm:px-8 border-b border-ink-200/80 bg-white">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={clsx(
                'px-3.5 h-11 text-[13.5px] font-medium border-b-2 whitespace-nowrap transition-colors',
                tab === t.key ? 'border-brand-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800',
              )}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="p-5 sm:p-8 max-w-[1400px]">
        {tab === 'overview' && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader title="Recipients"
                  description={envelope.ordered ? 'Sequential routing — each step is invited when the previous completes.' : 'Parallel routing — everyone was invited at once.'} />
                <ul className="divide-y divide-ink-200/60">
                  {recipients.map((r) => {
                    const isActive = activeRecipientIds.includes(r.id);
                    const count = fields.filter((f) => f.recipient_id === r.id).length;
                    return (
                      <li key={r.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3">
                        <span className="w-8 h-8 rounded-lg text-white text-[11px] font-semibold flex items-center justify-center shrink-0"
                          style={{ backgroundColor: r.color }}>
                          {r.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[13.5px] font-medium text-ink-900">{r.name}</p>
                            <StatusBadge status={r.status} />
                            {isActive && live && (
                              <span className="text-[11px] font-medium text-brand-700 bg-brand-50 ring-1 ring-inset ring-brand-200 rounded-full px-2 py-0.5">
                                their turn
                              </span>
                            )}
                          </div>
                          <p className="text-[12px] text-ink-500 truncate">
                            {r.email} · {envelope.ordered ? `step ${r.order_index}` : 'parallel'} · {count} field{count === 1 ? '' : 's'}
                            {r.auth_method === 'access_code' ? ' · access code' : ''}
                          </p>
                          {r.declined_at && r.decline_reason && (
                            <p className="mt-1 text-[12px] text-red-700 bg-red-50 rounded-md px-2 py-1">Declined: {r.decline_reason}</p>
                          )}
                        </div>
                        <div className="text-right text-[11.5px] text-ink-500 shrink-0">
                          {r.completed_at ? <>signed {relativeTime(r.completed_at)}</>
                            : r.viewed_at ? <>viewed {relativeTime(r.viewed_at)}</>
                              : r.sent_at ? <>invited {relativeTime(r.sent_at)}</> : 'not yet invited'}
                          {r.reminder_count > 0 && <div>{r.reminder_count} reminder{r.reminder_count === 1 ? '' : 's'}</div>}
                        </div>
                        {isActive && live && (
                          <Button size="sm" variant="secondary" onClick={() => remind(r.id)} disabled={busy}>
                            <Bell size={13} /> Remind
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>

              {completed && (
                <Card>
                  <CardHeader title="Executed documents" description="Flattened PDF plus the certificate of completion." />
                  <div className="p-5 grid sm:grid-cols-2 gap-3">
                    {[
                      { v: finalVersion, label: 'Executed document', doc: 'executed', icon: FileCheck2 },
                      { v: certificateVersion, label: 'Certificate of completion', doc: 'certificate', icon: ShieldCheck },
                    ].filter((x) => x.v).map(({ v, label, doc, icon: Icon }) => (
                      <a key={doc} href={`/api/v1/envelopes/${id}/download?doc=${doc}`}
                        className="flex items-center gap-3 rounded-xl border border-ink-200 px-3.5 py-3 hover:bg-ink-50 transition-colors">
                        <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium text-ink-900">{label}</span>
                          <span className="block text-[11.5px] text-ink-500">{v.page_count} pages · {formatBytes(v.byte_size)}</span>
                        </span>
                        <Download size={15} className="text-ink-400" />
                      </a>
                    ))}
                  </div>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Evidence" description="Proof this document has not changed."
                  action={<Button size="sm" variant="secondary" onClick={verify} disabled={busy}>
                    {busy ? <Spinner size={13} /> : <RefreshCw size={13} />} Verify
                  </Button>} />
                <div className="px-5 py-3">
                  <div className={clsx(
                    'flex items-start gap-2.5 rounded-lg px-3 py-2.5 mb-3',
                    integrity.valid ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
                  )}>
                    {integrity.valid ? <ShieldCheck size={16} className="mt-0.5 shrink-0" /> : <ShieldAlert size={16} className="mt-0.5 shrink-0" />}
                    <div className="text-[12.5px] leading-relaxed">
                      {integrity.valid
                        ? <>Record verified — all {integrity.events} event{integrity.events === 1 ? '' : 's'} intact.</>
                        : <>Record altered at event {integrity.brokenAt} ({integrity.reason}).</>}
                    </div>
                  </div>
                  <Row label="Envelope ID" mono>{envelope.id}</Row>
                  <Row label="Original fingerprint" mono>{source.sha256.slice(0, 24)}…</Row>
                  {finalVersion && <Row label="Signed fingerprint" mono>{finalVersion.sha256.slice(0, 24)}…</Row>}
                  <Row label="History fingerprint" mono>{(envelope.audit_head_hash || '—').slice(0, 24)}…</Row>
                  <Row label="Tamper seal">
                    {envelope.evidence_signature
                      ? <span className="inline-flex items-center gap-1 text-emerald-700"><Fingerprint size={12} /> ECDSA P-256</span>
                      : <span className="text-ink-400">applied at completion</span>}
                  </Row>
                </div>
                {verification && (
                  <div className="px-5 pb-4">
                    <div className={clsx(
                      'rounded-lg px-3 py-2.5 text-[12.5px]',
                      verification.verdict === 'intact' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800',
                    )}>
                      <p className="font-medium">
                        {verification.verdict === 'intact' ? 'All checks passed' : 'Tampering detected'}
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        <li>Full history: {verification.auditChain.valid ? 'intact' : `altered at event ${verification.auditChain.brokenAt}`}</li>
                        <li>Tamper seal: {verification.evidenceSeal.sealed ? (verification.evidenceSeal.valid ? 'valid' : 'broken') : 'applied when signing completes'}</li>
                        {verification.documents.map((d) => (
                          <li key={d.id}>{d.kind === 'source' ? 'Original' : d.kind === 'executed' ? 'Signed document' : 'Certificate'}: {d.intact ? 'unchanged' : 'has been altered'}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader title="Details" />
                <div className="px-5 py-3">
                  <Row label="Document">
                    <Link href={`/api/v1/versions/${source.id}/file`} target="_blank" className="text-brand-600 hover:text-brand-700">
                      {source.filename}
                    </Link>
                  </Row>
                  <Row label="Pages">{source.page_count}</Row>
                  <Row label="Routing">{envelope.ordered ? 'Sequential' : 'Parallel'}</Row>
                  <Row label="Fields">{fields.length}</Row>
                  <Row label="Expires">{envelope.expires_at ? formatDate(envelope.expires_at) : 'No expiry'}</Row>
                  {envelope.void_reason && <Row label="Void reason">{envelope.void_reason}</Row>}
                </div>
              </Card>
            </div>
          </div>
        )}

        {tab === 'document' && (
          <div className="bg-ink-100/60 rounded-xl p-4 sm:p-6">
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <p className="text-[13px] text-ink-600">
                {finalVersion ? 'Executed document with all values flattened in.' : 'Source document with field placement.'}
              </p>
              <Button size="sm" variant="secondary" as="a" target="_blank"
                href={`/api/v1/versions/${previewVersionId}/file?download=1`}>
                <Download size={13} /> Download
              </Button>
            </div>
            <PdfDocument
              url={`/api/v1/versions/${previewVersionId}/file`}
              maxWidth={860}
              renderOverlay={finalVersion ? undefined : (pageNumber) => (
                <div className="absolute inset-0 pointer-events-none">
                  {fields.filter((f) => f.page === pageNumber).map((f) => {
                    const r = recipients.find((x) => x.id === f.recipient_id);
                    return (
                      <div key={f.id}
                        className="absolute rounded-[3px] border text-[10px] flex items-center px-1 truncate"
                        style={{
                          left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                          width: `${f.w * 100}%`, height: `${f.h * 100}%`,
                          backgroundColor: `${r?.color || '#64748b'}1f`,
                          borderColor: `${r?.color || '#64748b'}99`,
                          color: r?.color || '#64748b',
                        }}>
                        {f.label || f.type}
                      </div>
                    );
                  })}
                </div>
              )}
            />
          </div>
        )}

        {tab === 'audit' && (
          <Card>
            <CardHeader title="Audit trail"
              description="Everything that has happened to this document, in order. Each entry is locked to the one before it, so nothing can be changed or removed without it showing." />
            {!audit ? <div className="p-10 flex justify-center"><Spinner /></div> : (
              <ol className="divide-y divide-ink-200/60">
                {audit.events.map((e) => (
                  <li key={e.id} className="px-5 py-3.5 flex flex-wrap gap-3 items-start">
                    <span className="w-7 h-7 rounded-lg bg-ink-100 text-ink-500 text-[11px] font-semibold flex items-center justify-center shrink-0 tabular-nums">
                      {e.seq}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-ink-900">{EVENT_LABELS[e.event_type] || e.event_type}</p>
                      <p className="text-[12px] text-ink-500">
                        {e.actor_label || e.actor_type}
                        {e.ip ? ` · ${e.ip}` : ''}
                        {' · '}{formatDate(e.created_at)}
                      </p>
                      {e.user_agent && e.user_agent !== 'unknown' && (
                        <p className="text-[11px] text-ink-400 truncate max-w-xl">{e.user_agent}</p>
                      )}
                      {Object.keys(e.payload || {}).length > 0 && (
                        <details className="mt-1.5">
                          <summary className="text-[11.5px] text-ink-500 cursor-pointer hover:text-ink-800 inline-flex items-center gap-1">
                            <ChevronRight size={11} /> payload
                          </summary>
                          <pre className="mt-1.5 text-[11px] bg-ink-50 border border-ink-200 rounded-lg p-2.5 overflow-x-auto text-ink-700">
{JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <Mono className="block">{e.hash.slice(0, 16)}…</Mono>
                      <span className="text-[10.5px] text-ink-400">prev {e.prev_hash.slice(0, 8)}…</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        )}

        {tab === 'emails' && (
          <Card>
            <CardHeader title="Email log"
              description="Every message sent for this document, including the signing link each recipient received." />
            {emails.length === 0 ? (
              <EmptyState icon={Mail} title="No emails yet" description="Messages appear here once the envelope is sent." />
            ) : (
              <ul className="divide-y divide-ink-200/60">
                {emails.map((m) => {
                  const link = (m.text.match(/https?:\/\/\S+\/sign\/\S+/) || [])[0];
                  return (
                    <li key={m.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-[13.5px] font-medium text-ink-900">{m.subject}</span>
                        <StatusBadge status={m.status === 'sent' ? 'completed' : 'declined'} />
                        <span className="text-[12px] text-ink-500">to {m.to_email}</span>
                        <span className="ml-auto text-[11.5px] text-ink-400">{relativeTime(m.created_at)}</span>
                      </div>
                      {link && (
                        <div className="mt-2 flex items-center gap-2 rounded-lg bg-ink-50 border border-ink-200 px-2.5 py-1.5">
                          <Link2 size={13} className="text-ink-400 shrink-0" />
                          <a href={link} target="_blank" rel="noreferrer"
                            className="text-[11.5px] font-mono text-brand-700 hover:underline truncate">{link}</a>
                          <button onClick={() => { navigator.clipboard.writeText(link); setToast({ message: 'Signing link copied' }); }}
                            className="ml-auto text-ink-400 hover:text-ink-800 p-1 shrink-0"><Copy size={13} /></button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Modal open={voidOpen} onClose={() => setVoidOpen(false)}
        title="Void this envelope"
        description="All outstanding signing links stop working immediately."
        footer={<>
          <Button variant="secondary" onClick={() => setVoidOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={voidEnvelope} disabled={busy}>Void envelope</Button>
        </>}>
        <Textarea label="Reason (recorded in the audit trail)" rows={3} value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)} placeholder="Superseded by a revised agreement." />
      </Modal>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
