'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { api, formatBytes } from '@/lib/client.js';
import { PageHeader } from '@/components/Shell.jsx';
import { Card, CardHeader, Button, Input, Select, Textarea, Spinner, Toast, EmptyState } from '@/components/ui.jsx';
import { RECIPIENT_COLORS } from '@/lib/colors.js';
import { Plus, Trash2, Upload, FileText, GripVertical, ArrowRight, LayoutTemplate, KeyRound } from 'lucide-react';

const blankRecipient = (i) => ({
  name: '', email: '', role: '', kind: 'signer', order: i + 1, accessCode: '',
});

export default function NewEnvelopeView() {
  const router = useRouter();
  // Read the deep-link parameters once on mount; this keeps the whole page a plain
  // client component with no Suspense boundary to coordinate.
  const initial = typeof window === 'undefined'
    ? new URLSearchParams()
    : new URLSearchParams(window.location.search);
  const [documents, setDocuments] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [versionId, setVersionId] = useState(initial.get('versionId') || '');
  const [templateId, setTemplateId] = useState(initial.get('templateId') || '');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [ordered, setOrdered] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [recipients, setRecipients] = useState([blankRecipient(0)]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api('/documents').then((d) => {
      setDocuments(d.documents);
      if (!versionId && !templateId && d.documents[0]) setVersionId(d.documents[0].latest_version_id);
    }).catch(() => setDocuments([]));
    api('/templates').then((d) => setTemplates(d.templates)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (title) return;
    if (templateId) {
      const t = templates.find((x) => x.id === templateId);
      if (t) setTitle(t.name);
      return;
    }
    const doc = (documents || []).find((d) => d.latest_version_id === versionId);
    if (doc) setTitle(doc.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId, templateId, documents, templates]);

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;

  useEffect(() => {
    if (!selectedTemplate) return;
    setRecipients(selectedTemplate.roles.map((r, i) => ({
      ...blankRecipient(i), role: r.name, roleKey: r.key, order: r.order || i + 1,
    })));
  }, [selectedTemplate]);

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', file.name.replace(/\.pdf$/i, ''));
      const res = await api('/documents', { method: 'POST', body: form });
      const list = await api('/documents');
      setDocuments(list.documents);
      setVersionId(res.version.id);
      setTemplateId('');
      if (!title) setTitle(res.document.name);
      setToast({ message: 'Document uploaded' });
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally { setUploading(false); }
  }

  function updateRecipient(i, patch) {
    setRecipients((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function create() {
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        message: message.trim() || null,
        ordered,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        recipients: recipients.map((r, i) => ({
          name: r.name.trim(), email: r.email.trim(), role: r.role.trim() || null,
          kind: r.kind, order: ordered ? (r.order || i + 1) : 1,
          accessCode: r.accessCode.trim() || null,
          roleKey: r.roleKey || null,
        })),
        ...(templateId ? { templateId } : { documentVersionId: versionId }),
      };
      const res = await api('/envelopes', { method: 'POST', body: payload });
      router.push(`/envelopes/${res.id}/prepare`);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
      setBusy(false);
    }
  }

  const valid = title.trim() && (versionId || templateId)
    && recipients.every((r) => r.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email.trim()));

  return (
    <>
      <PageHeader
        title="New envelope"
        description="Choose a document, add recipients, then place fields."
        actions={
          <Button onClick={create} disabled={!valid || busy}>
            {busy ? <Spinner /> : null} Continue to fields <ArrowRight size={15} />
          </Button>
        }
      />

      <div className="p-5 sm:p-8 max-w-5xl space-y-6">
        <Card>
          <CardHeader title="Document" description="Start from an uploaded PDF or a saved template."
            action={
              <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Spinner /> : <Upload size={14} />} Upload
              </Button>
            } />
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => upload(e.target.files?.[0])} />
          <div className="p-5 space-y-4">
            {templates.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <button key={t.id}
                    onClick={() => { setTemplateId(templateId === t.id ? '' : t.id); setVersionId(''); }}
                    className={clsx(
                      'flex items-center gap-2 px-3 h-9 rounded-lg border text-[13px] font-medium transition-colors',
                      templateId === t.id ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-700 hover:bg-ink-50',
                    )}>
                    <LayoutTemplate size={14} /> {t.name}
                    <span className="text-[11.5px] text-ink-500">{t.fields.length} fields</span>
                  </button>
                ))}
              </div>
            )}

            {!templateId && (documents === null ? (
              <div className="py-8 flex justify-center text-ink-400"><Spinner /></div>
            ) : documents.length === 0 ? (
              <EmptyState icon={FileText} title="No documents yet"
                description="Upload a PDF to prepare it for signature."
                action={<Button onClick={() => fileRef.current?.click()}><Upload size={15} /> Upload PDF</Button>} />
            ) : (
              <div className="grid sm:grid-cols-2 gap-2.5">
                {documents.map((d) => (
                  <button key={d.id} onClick={() => { setVersionId(d.latest_version_id); setTemplateId(''); }}
                    className={clsx(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors',
                      versionId === d.latest_version_id ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500/30' : 'border-ink-200 hover:bg-ink-50',
                    )}>
                    <span className="w-8 h-9 rounded bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                      <FileText size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium text-ink-900 truncate">{d.name}</span>
                      <span className="block text-[11.5px] text-ink-500">{d.page_count} pages · {formatBytes(d.byte_size)}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Details" />
          <div className="p-5 grid sm:grid-cols-2 gap-4">
            <Input label="Envelope title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Mutual NDA — Northwind & Acme" />
            <Input label="Expires (optional)" type="datetime-local" value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)} hint="Links stop working after this time." />
            <div className="sm:col-span-2">
              <Textarea label="Message to recipients" rows={3} value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Please review and sign at your earliest convenience." />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recipients"
            description={ordered ? 'Signed one after another, in the order below.' : 'Everyone is invited at the same time.'}
            action={
              <div className="flex gap-1 p-1 bg-ink-100 rounded-lg">
                <button onClick={() => setOrdered(true)}
                  className={clsx('px-2.5 h-7 rounded-md text-[12.5px] font-medium', ordered ? 'bg-white shadow-card text-ink-900' : 'text-ink-500')}>
                  Sequential
                </button>
                <button onClick={() => setOrdered(false)}
                  className={clsx('px-2.5 h-7 rounded-md text-[12.5px] font-medium', !ordered ? 'bg-white shadow-card text-ink-900' : 'text-ink-500')}>
                  Parallel
                </button>
              </div>
            }
          />
          <div className="p-5 space-y-3">
            {recipients.map((r, i) => (
              <div key={i} className="rounded-xl border border-ink-200 p-3.5 bg-ink-50/40">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RECIPIENT_COLORS[i % RECIPIENT_COLORS.length] }} />
                  {ordered && (
                    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-ink-600">
                      <GripVertical size={13} className="text-ink-400" /> Step {r.order}
                    </span>
                  )}
                  <span className="text-[12.5px] text-ink-500">{r.roleKey ? `Role: ${r.role}` : `Recipient ${i + 1}`}</span>
                  {recipients.length > 1 && (
                    <button onClick={() => setRecipients((p) => p.filter((_, idx) => idx !== i))}
                      className="ml-auto text-ink-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <Input label="Full name" value={r.name} onChange={(e) => updateRecipient(i, { name: e.target.value })} placeholder="Jordan Reyes" />
                  <Input label="Email" type="email" value={r.email} onChange={(e) => updateRecipient(i, { email: e.target.value })} placeholder="jordan@acme.com" />
                  {!r.roleKey && (
                    <Input label="Role (optional)" value={r.role} onChange={(e) => updateRecipient(i, { role: e.target.value })} placeholder="Counterparty" />
                  )}
                  <Select label="Type" value={r.kind} onChange={(e) => updateRecipient(i, { kind: e.target.value })}>
                    <option value="signer">Needs to sign</option>
                    <option value="approver">Needs to approve</option>
                    <option value="cc">Receives a copy</option>
                  </Select>
                  {ordered && (
                    <Input label="Order" type="number" min={1} max={50} value={r.order}
                      onChange={(e) => updateRecipient(i, { order: Number(e.target.value) || 1 })} />
                  )}
                  <div className="sm:col-span-2">
                    <Input label="Access code (optional)" value={r.accessCode}
                      onChange={(e) => updateRecipient(i, { accessCode: e.target.value })}
                      placeholder="Shared out of band"
                      hint="Requires the recipient to enter this code before the document opens." />
                  </div>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm"
              onClick={() => setRecipients((p) => [...p, blankRecipient(p.length)])}>
              <Plus size={14} /> Add recipient
            </Button>
            <p className="flex items-start gap-2 text-[12.5px] text-ink-500 pt-1">
              <KeyRound size={13} className="mt-0.5 shrink-0 text-ink-400" />
              Each recipient gets their own private signing link that works only for them, and stops
              working as soon as they have signed.
            </p>
          </div>
        </Card>
      </div>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
