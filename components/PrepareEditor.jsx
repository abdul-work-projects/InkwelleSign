'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { api } from '@/lib/client.js';
import PdfDocument from './PdfDocument.jsx';
import FieldChip, { FIELD_TYPES, FIELD_META } from './FieldChip.jsx';
import { Button, Card, Input, Select, Modal, Toast, Spinner, StatusBadge, Textarea } from './ui.jsx';
import { Trash2, Send, Save, LayoutTemplate, MousePointerClick, Users, Info, ArrowLeft } from 'lucide-react';

const uid = () => `tmp_${Math.random().toString(36).slice(2, 11)}`;

export default function PrepareEditor({ bundle }) {
  const router = useRouter();
  const { envelope, source } = bundle;

  const [recipients] = useState(bundle.recipients);
  const [fields, setFields] = useState(() => bundle.fields.map((f) => ({
    id: f.id, recipientId: f.recipient_id, type: f.type, page: f.page,
    x: f.x, y: f.y, w: f.w, h: f.h, required: !!f.required, label: f.label,
    options: f.options ? JSON.parse(f.options) : null, fontSize: f.font_size,
  })));
  const [activeRecipient, setActiveRecipient] = useState(recipients[0]?.id || null);
  const [selected, setSelected] = useState(null);
  const [armedType, setArmedType] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState(envelope.title);
  const dragState = useRef(null);

  const recipientById = useMemo(
    () => Object.fromEntries(recipients.map((r) => [r.id, r])), [recipients]
  );
  const colorFor = (recipientId) => recipientById[recipientId]?.color || '#64748b';
  const selectedField = fields.find((f) => f.id === selected) || null;

  const mutate = useCallback((updater) => {
    setFields((prev) => (typeof updater === 'function' ? updater(prev) : updater));
    setDirty(true);
  }, []);

  const addField = useCallback((type, page, nx, ny) => {
    if (!activeRecipient) return;
    const meta = FIELD_META[type];
    const field = {
      id: uid(), recipientId: activeRecipient, type, page,
      x: Math.min(Math.max(nx - meta.w / 2, 0), 1 - meta.w),
      y: Math.min(Math.max(ny - meta.h / 2, 0), 1 - meta.h),
      w: meta.w, h: meta.h, required: true, label: null,
      options: type === 'dropdown' ? ['Option A', 'Option B'] : null,
      fontSize: 11,
    };
    mutate((prev) => [...prev, field]);
    setSelected(field.id);
    setArmedType(null);
  }, [activeRecipient, mutate]);

  // ---- drag / resize -------------------------------------------------------
  const beginDrag = (e, field, mode) => {
    e.preventDefault();
    e.stopPropagation();
    const pageEl = e.currentTarget.closest('[data-page]');
    if (!pageEl) return;
    const rect = pageEl.getBoundingClientRect();
    dragState.current = {
      mode, id: field.id, rect,
      startX: e.clientX, startY: e.clientY,
      origin: { x: field.x, y: field.y, w: field.w, h: field.h },
    };
    setSelected(field.id);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  useEffect(() => {
    const onMove = (e) => {
      const st = dragState.current;
      if (!st) return;
      const dx = (e.clientX - st.startX) / st.rect.width;
      const dy = (e.clientY - st.startY) / st.rect.height;
      mutate((prev) => prev.map((f) => {
        if (f.id !== st.id) return f;
        if (st.mode === 'move') {
          return {
            ...f,
            x: Math.min(Math.max(st.origin.x + dx, 0), 1 - f.w),
            y: Math.min(Math.max(st.origin.y + dy, 0), 1 - f.h),
          };
        }
        return {
          ...f,
          w: Math.min(Math.max(st.origin.w + dx, 0.02), 1 - f.x),
          h: Math.min(Math.max(st.origin.h + dy, 0.012), 1 - f.y),
        };
      }));
    };
    const onUp = () => { dragState.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [mutate]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && document.activeElement?.tagName !== 'INPUT'
        && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'SELECT') {
        e.preventDefault();
        mutate((prev) => prev.filter((f) => f.id !== selected));
        setSelected(null);
      }
      if (e.key === 'Escape') { setArmedType(null); setSelected(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, mutate]);

  // ---- persistence ---------------------------------------------------------
  const save = useCallback(async ({ quiet = false } = {}) => {
    setSaving(true);
    try {
      const payload = fields.map((f) => ({
        id: f.id.startsWith('tmp_') ? null : f.id,
        recipientId: f.recipientId, type: f.type, page: f.page,
        x: +f.x.toFixed(5), y: +f.y.toFixed(5), w: +f.w.toFixed(5), h: +f.h.toFixed(5),
        required: f.required, label: f.label || null,
        options: f.options || null, fontSize: f.fontSize || 11,
      }));
      const res = await api(`/envelopes/${envelope.id}/fields`, { method: 'PUT', body: { fields: payload } });
      setFields(res.fields.map((f) => ({
        id: f.id, recipientId: f.recipient_id, type: f.type, page: f.page,
        x: f.x, y: f.y, w: f.w, h: f.h, required: !!f.required, label: f.label,
        options: f.options ? JSON.parse(f.options) : null, fontSize: f.font_size,
      })));
      setDirty(false);
      if (!quiet) setToast({ message: 'Layout saved' });
      return true;
    } catch (e) {
      setToast({ type: 'error', message: e.message });
      return false;
    } finally { setSaving(false); }
  }, [fields, envelope.id]);

  async function sendEnvelope() {
    if (!(await save({ quiet: true }))) return;
    try {
      const res = await api(`/envelopes/${envelope.id}/send`, { method: 'POST' });
      setSendOpen(false);
      setToast({ message: `Invitation sent to ${res.sent} recipient${res.sent === 1 ? '' : 's'}` });
      setTimeout(() => router.push(`/envelopes/${envelope.id}`), 600);
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  }

  async function saveTemplate() {
    try {
      const roles = recipients.map((r, i) => ({
        key: `role${i + 1}`, name: r.role_name || r.name, order: r.order_index, color: r.color,
      }));
      const index = Object.fromEntries(recipients.map((r, i) => [r.id, `role${i + 1}`]));
      await api('/templates', {
        method: 'POST',
        body: {
          name: templateName,
          description: `Created from envelope “${envelope.title}”`,
          documentVersionId: source.id,
          roles,
          fields: fields.map((f) => ({
            roleKey: index[f.recipientId], type: f.type, page: f.page,
            x: f.x, y: f.y, w: f.w, h: f.h, required: f.required,
            label: f.label || null, options: f.options || null, fontSize: f.fontSize || 11,
          })),
        },
      });
      setTemplateOpen(false);
      setToast({ message: 'Saved as template' });
    } catch (e) {
      setToast({ type: 'error', message: e.message });
    }
  }

  const perRecipientCount = (id) => fields.filter((f) => f.recipientId === id).length;
  const unassigned = recipients.filter((r) => r.kind !== 'cc' && perRecipientCount(r.id) === 0);

  const overlay = (pageNumber) => (
    <div
      className={clsx('absolute inset-0', armedType ? 'cursor-crosshair' : 'cursor-default')}
      onClick={(e) => {
        if (!armedType) { if (e.target === e.currentTarget) setSelected(null); return; }
        const rect = e.currentTarget.getBoundingClientRect();
        addField(armedType, pageNumber, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/inkwell-field');
        if (!type) return;
        const rect = e.currentTarget.getBoundingClientRect();
        addField(type, pageNumber, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }}
    >
      {fields.filter((f) => f.page === pageNumber).map((f) => (
        <FieldChip
          key={f.id} field={f} color={colorFor(f.recipientId)} selected={selected === f.id}
          onPointerDown={(e) => beginDrag(e, f, 'move')}
          onResizePointerDown={(e) => beginDrag(e, f, 'resize')}
        />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row min-h-screen lg:h-[calc(100vh-1px)]">
      {/* Left rail */}
      <aside className="lg:w-[280px] shrink-0 border-b lg:border-b-0 lg:border-r border-ink-200/80 bg-white flex flex-col lg:h-full lg:overflow-y-auto">
        <div className="px-4 py-3.5 border-b border-ink-200/70">
          <button onClick={() => router.push('/envelopes')} className="text-[12.5px] text-ink-500 hover:text-ink-900 flex items-center gap-1.5">
            <ArrowLeft size={14} /> Envelopes
          </button>
          <h1 className="mt-2 text-[15px] font-semibold text-ink-950 leading-snug">{envelope.title}</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusBadge status={envelope.status} />
            <span className="text-[11.5px] text-ink-500">{envelope.ordered ? 'Sequential' : 'Parallel'}</span>
          </div>
        </div>

        <div className="px-4 py-3.5 border-b border-ink-200/70">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">
            <Users size={12} /> Assign fields to
          </p>
          <div className="mt-2.5 space-y-1.5">
            {recipients.map((r) => (
              <button key={r.id} onClick={() => setActiveRecipient(r.id)}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border text-left transition-colors',
                  activeRecipient === r.id ? 'border-ink-300 bg-ink-50' : 'border-transparent hover:bg-ink-50',
                )}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink-900 truncate">{r.name}</span>
                  <span className="block text-[11.5px] text-ink-500 truncate">
                    {envelope.ordered ? `#${r.order_index} · ` : ''}{r.kind === 'cc' ? 'Copy only' : r.role_name || 'Signer'}
                  </span>
                </span>
                <span className="text-[11.5px] tabular-nums text-ink-500">{perRecipientCount(r.id)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-3.5 border-b border-ink-200/70">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">
            <MousePointerClick size={12} /> Fields
          </p>
          <p className="mt-1.5 text-[11.5px] text-ink-500 leading-relaxed">
            Drag onto the page, or click a field then click where it should go.
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            {FIELD_TYPES.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/inkwell-field', type); setArmedType(null); }}
                onClick={() => setArmedType(armedType === type ? null : type)}
                className={clsx(
                  'flex items-center gap-1.5 px-2 h-8 rounded-lg border text-[12px] font-medium transition-colors',
                  armedType === type
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-ink-200 text-ink-700 hover:border-ink-300 hover:bg-ink-50',
                )}>
                <Icon size={13} className="shrink-0 opacity-70" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {selectedField ? (
          <div className="px-4 py-3.5 border-b border-ink-200/70 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">Field properties</p>
              <button
                onClick={() => { mutate((prev) => prev.filter((f) => f.id !== selectedField.id)); setSelected(null); }}
                className="text-ink-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            </div>
            <Input label="Label" value={selectedField.label || ''} placeholder={FIELD_META[selectedField.type].label}
              onChange={(e) => mutate((prev) => prev.map((f) => f.id === selectedField.id ? { ...f, label: e.target.value } : f))} />
            <Select label="Assigned to" value={selectedField.recipientId}
              onChange={(e) => mutate((prev) => prev.map((f) => f.id === selectedField.id ? { ...f, recipientId: e.target.value } : f))}>
              {recipients.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            {['text', 'date', 'fullname', 'email', 'dropdown'].includes(selectedField.type) && (
              <Input label="Font size" type="number" min={6} max={48} value={selectedField.fontSize}
                onChange={(e) => mutate((prev) => prev.map((f) => f.id === selectedField.id ? { ...f, fontSize: Number(e.target.value) || 11 } : f))} />
            )}
            {selectedField.type === 'dropdown' && (
              <Textarea label="Options" rows={3} value={(selectedField.options || []).join('\n')}
                hint="One option per line."
                onChange={(e) => mutate((prev) => prev.map((f) => f.id === selectedField.id
                  ? { ...f, options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) } : f))} />
            )}
            <label className="flex items-center gap-2 text-[13px] text-ink-700">
              <input type="checkbox" checked={selectedField.required}
                onChange={(e) => mutate((prev) => prev.map((f) => f.id === selectedField.id ? { ...f, required: e.target.checked } : f))}
                className="rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
              Required
            </label>
          </div>
        ) : (
          <div className="px-4 py-3.5 border-b border-ink-200/70">
            <div className="flex items-start gap-2 text-[12px] text-ink-500 leading-relaxed">
              <Info size={13} className="mt-0.5 shrink-0 text-ink-400" />
              Select a field on the page to edit its label, assignment and validation.
            </div>
          </div>
        )}

        <div className="mt-auto p-4 space-y-2 sticky bottom-0 bg-white border-t border-ink-200/70">
          {unassigned.length > 0 && (
            <p className="text-[11.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 leading-relaxed">
              No fields yet for {unassigned.map((r) => r.name).join(', ')}.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => save()} disabled={saving}>
              {saving ? <Spinner /> : <Save size={14} />} Save
            </Button>
            <Button className="flex-1" onClick={() => setSendOpen(true)} disabled={fields.length === 0}>
              <Send size={14} /> Send
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setTemplateOpen(true)}>
            <LayoutTemplate size={14} /> Save as template
          </Button>
          <p className="text-[11px] text-center text-ink-400">
            {dirty ? 'Unsaved changes' : 'All changes saved'} · {fields.length} field{fields.length === 1 ? '' : 's'}
          </p>
        </div>
      </aside>

      {/* Canvas */}
      <div className="flex-1 min-w-0 lg:overflow-y-auto bg-ink-100/70">
        <div className="px-4 sm:px-8 py-6">
          {armedType && (
            <div className="mb-4 mx-auto max-w-[900px] rounded-lg bg-brand-600 text-white text-[13px] px-3.5 py-2 flex items-center justify-between">
              <span>Click on the page to place a {FIELD_META[armedType].label.toLowerCase()} for {recipientById[activeRecipient]?.name}.</span>
              <button onClick={() => setArmedType(null)} className="text-white/80 hover:text-white text-[12px] underline">Cancel</button>
            </div>
          )}
          <PdfDocument
            url={`/api/v1/versions/${source.id}/file`}
            renderOverlay={overlay}
            maxWidth={900}
            className="pb-16"
          />
        </div>
      </div>

      <Modal
        open={sendOpen} onClose={() => setSendOpen(false)}
        title="Send for signature"
        description="Each recipient gets their own private signing link, which stops working once they have signed."
        footer={<>
          <Button variant="secondary" onClick={() => setSendOpen(false)}>Cancel</Button>
          <Button onClick={sendEnvelope}><Send size={14} /> Send now</Button>
        </>}
      >
        <ul className="space-y-2">
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-2.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink-900 truncate">{r.name}</p>
                <p className="text-[12px] text-ink-500 truncate">{r.email}</p>
              </div>
              <span className="text-[12px] text-ink-500">
                {envelope.ordered ? `Step ${r.order_index}` : 'Parallel'} · {perRecipientCount(r.id)} field{perRecipientCount(r.id) === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
        {envelope.ordered && (
          <p className="mt-3 text-[12.5px] text-ink-500">
            Only step 1 is invited now. Each following recipient is invited automatically when the step before them completes.
          </p>
        )}
      </Modal>

      <Modal
        open={templateOpen} onClose={() => setTemplateOpen(false)}
        title="Save as template"
        description="Reuse this document and field layout with new recipients."
        footer={<>
          <Button variant="secondary" onClick={() => setTemplateOpen(false)}>Cancel</Button>
          <Button onClick={saveTemplate}>Save template</Button>
        </>}
      >
        <Input label="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
        <p className="mt-3 text-[12.5px] text-ink-500">
          Recipients are stored as roles ({recipients.map((r) => r.role_name || r.name).join(', ')}) and mapped to
          real people when the template is used.
        </p>
      </Modal>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
