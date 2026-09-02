'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, relativeTime } from '@/lib/client.js';
import { PageHeader } from '@/components/Shell.jsx';
import { Card, Button, EmptyState, Spinner, Modal, Toast } from '@/components/ui.jsx';
import { LayoutTemplate, Send, Trash2, Users, SquareStack } from 'lucide-react';

export default function TemplatesView() {
  const [templates, setTemplates] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    api('/templates').then((d) => setTemplates(d.templates)).catch((e) => setToast({ type: 'error', message: e.message }));
  }, []);
  useEffect(load, [load]);

  async function remove(id) {
    try {
      await api(`/templates/${id}`, { method: 'DELETE' });
      setToast({ message: 'Template deleted' });
      load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
    finally { setConfirm(null); }
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable document and field layouts. Roles are mapped to real recipients when you send."
      />
      <div className="p-5 sm:p-8 max-w-[1400px]">
        {templates === null ? (
          <div className="py-16 flex justify-center text-ink-400"><Spinner size={22} /></div>
        ) : templates.length === 0 ? (
          <Card>
            <EmptyState icon={LayoutTemplate} title="No templates yet"
              description="Prepare an envelope, then choose “Save as template” in the field editor to reuse that layout."
              action={<Button as={Link} href="/envelopes/new">Prepare an envelope</Button>} />
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <Card key={t.id} className="p-5 flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                    <LayoutTemplate size={17} />
                  </span>
                  <button onClick={() => setConfirm(t)}
                    className="text-ink-400 hover:text-red-600 p-1.5 rounded-md hover:bg-red-50 transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
                <h3 className="mt-3.5 text-[14.5px] font-semibold text-ink-900 leading-snug">{t.name}</h3>
                {t.description && <p className="mt-1 text-[12.5px] text-ink-500 line-clamp-2">{t.description}</p>}
                <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-ink-500">
                  <span className="inline-flex items-center gap-1.5"><Users size={12} /> {t.roles.length} role{t.roles.length === 1 ? '' : 's'}</span>
                  <span className="inline-flex items-center gap-1.5"><SquareStack size={12} /> {t.fields.length} fields</span>
                  <span>{t.page_count} pages</span>
                </div>
                <p className="mt-2 text-[11.5px] text-ink-400">
                  Used {t.usage_count} time{t.usage_count === 1 ? '' : 's'} · updated {relativeTime(t.updated_at)}
                </p>
                <Button as={Link} href={`/envelopes/new?templateId=${t.id}`} className="mt-4 w-full">
                  <Send size={14} /> Use template
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Delete template"
        footer={<>
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => remove(confirm.id)}>Delete</Button>
        </>}>
        <p className="text-[13.5px] text-ink-600">
          “{confirm?.name}” will be removed. Envelopes already created from it are unaffected.
        </p>
      </Modal>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
