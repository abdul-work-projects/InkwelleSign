'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatBytes, relativeTime } from '@/lib/client.js';
import { PageHeader } from '@/components/Shell.jsx';
import { Card, Button, EmptyState, Spinner, Modal, Mono, Toast } from '@/components/ui.jsx';
import { FileText, Upload, Send, Trash2, Layers, ShieldCheck } from 'lucide-react';

export default function DocumentsView() {
  const router = useRouter();
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const inputRef = useRef(null);

  const load = useCallback(() => {
    api('/documents').then((d) => setDocs(d.documents)).catch((e) => setToast({ type: 'error', message: e.message }));
  }, []);
  useEffect(load, [load]);

  const upload = useCallback(async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('name', file.name.replace(/\.pdf$/i, ''));
      const { document } = await api('/documents', { method: 'POST', body: form });
      setToast({ message: `Uploaded “${document.name}”` });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [load]);

  async function remove(id) {
    try {
      await api(`/documents/${id}`, { method: 'DELETE' });
      setToast({ message: 'Document deleted' });
      load();
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    } finally { setConfirmDelete(null); }
  }

  return (
    <>
      <PageHeader
        title="Documents"
        description="Your uploaded PDFs and every version of them. Each file is checked for tampering every time it is opened."
        actions={
          <Button onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Spinner /> : <Upload size={15} />} Upload PDF
          </Button>
        }
      />
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden"
        onChange={(e) => upload(e.target.files?.[0])} />

      <div className="p-5 sm:p-8 max-w-[1400px] space-y-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files?.[0]); }}
          className={`rounded-xl border-2 border-dashed transition-colors px-6 py-9 text-center ${
            dragging ? 'border-brand-400 bg-brand-50/50' : 'border-ink-200 bg-white'
          }`}
        >
          <div className="w-10 h-10 mx-auto rounded-xl bg-ink-100 text-ink-400 flex items-center justify-center">
            <Upload size={18} />
          </div>
          <p className="mt-3 text-[14px] font-medium text-ink-800">Drop a PDF here, or click upload</p>
          <p className="mt-1 text-[12.5px] text-ink-500">PDF only · up to 25 MB</p>
        </div>

        {docs === null ? (
          <div className="py-16 flex justify-center text-ink-400"><Spinner size={22} /></div>
        ) : docs.length === 0 ? (
          <Card><EmptyState icon={FileText} title="No documents yet"
            description="Upload a PDF to start preparing an envelope for signature." /></Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-ink-200/70 bg-ink-50/60 text-[11.5px] uppercase tracking-wide text-ink-500">
                    <th className="font-medium px-5 py-2.5">Document</th>
                    <th className="font-medium px-3 py-2.5">Pages</th>
                    <th className="font-medium px-3 py-2.5">Size</th>
                    <th className="font-medium px-3 py-2.5">Fingerprint</th>
                    <th className="font-medium px-3 py-2.5">Versions</th>
                    <th className="font-medium px-3 py-2.5">Uploaded</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-200/60">
                  {docs.map((d) => (
                    <tr key={d.id} className="hover:bg-ink-50/60 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-8 h-9 rounded bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                            <FileText size={15} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-medium text-ink-900 truncate max-w-[280px]">{d.name}</p>
                            <p className="text-[11.5px] text-ink-500">{d.envelope_count} envelope{d.envelope_count === 1 ? '' : 's'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-ink-600 tabular-nums">{d.page_count}</td>
                      <td className="px-3 py-3 text-[13px] text-ink-600 tabular-nums">{formatBytes(d.byte_size)}</td>
                      <td className="px-3 py-3"><Mono>{(d.sha256 || '').slice(0, 12)}…</Mono></td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-600">
                          <Layers size={13} className="text-ink-400" /> v{d.version_count}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[12.5px] text-ink-500">{relativeTime(d.created_at)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="secondary" as={Link}
                            href={`/api/v1/versions/${d.latest_version_id}/file`} target="_blank">Preview</Button>
                          <Button size="sm" onClick={() => router.push(`/envelopes/new?versionId=${d.latest_version_id}`)}>
                            <Send size={13} /> Send
                          </Button>
                          <button onClick={() => setConfirmDelete(d)}
                            className="p-1.5 rounded-md text-ink-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <div className="flex items-start gap-2 text-[12.5px] text-ink-500">
          <ShieldCheck size={14} className="text-emerald-600 mt-0.5 shrink-0" />
          <span>
            Every upload is checked to confirm it is a genuine PDF, then stored separately for your
            organisation and fingerprinted so any later change would be obvious. Your documents are
            never visible to another company.
          </span>
        </div>
      </div>

      <Modal
        open={!!confirmDelete} onClose={() => setConfirmDelete(null)}
        title="Delete document" description="This removes the file and all of its versions."
        footer={<>
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => remove(confirmDelete.id)}>Delete</Button>
        </>}
      >
        <p className="text-[13.5px] text-ink-600">
          “{confirmDelete?.name}” will be permanently deleted. Documents referenced by sent envelopes
          cannot be deleted.
        </p>
      </Modal>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
