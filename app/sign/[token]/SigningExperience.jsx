'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import PdfDocument from '@/components/PdfDocument.jsx';
import SignaturePad from '@/components/SignaturePad.jsx';
import { Button, Input, Modal, Spinner, Textarea, Toast } from '@/components/ui.jsx';
import { FIELD_META } from '@/components/FieldChip.jsx';
import {
  CheckCircle2, ChevronDown, ChevronRight, Lock, PenLine, ShieldCheck,
  XCircle, AlertTriangle, ArrowDown, FileText,
} from 'lucide-react';

const todayLabel = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Terminal state screen shown when there is nothing left for the recipient to do. */
function Outcome({ tone = 'neutral', icon, title, body, children }) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-500',
    success: 'bg-emerald-50 text-emerald-600',
    danger: 'bg-red-50 text-red-600',
  };
  return (
    <main className="min-h-screen bg-ink-50 flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-md text-center">
        <span className="text-[16px] font-semibold tracking-[-.02em] text-ink-900">
          Inkwell<span className="text-brand-600">eSign</span>
        </span>
        <div className="mt-6 bg-white border border-ink-200/80 rounded-2xl shadow-card p-8">
          <div className={clsx('w-12 h-12 mx-auto rounded-xl flex items-center justify-center', tones[tone])}>
            {icon}
          </div>
          <h1 className="mt-4 text-[17px] font-semibold text-ink-950">{title}</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">{body}</p>
          {children}
        </div>
      </div>
    </main>
  );
}

export default function SigningExperience({ token }) {
  const [state, setState] = useState({ status: 'loading' });
  const [values, setValues] = useState({});
  const [meta, setMeta] = useState({});
  const [activeField, setActiveField] = useState(null);
  const [padFor, setPadFor] = useState(null);
  const [consent, setConsent] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [accessError, setAccessError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const saveTimer = useRef(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sign/${token}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setState({ status: 'ready', data });
      const initial = {};
      for (const f of data.fields) {
        if (!f.mine) continue;
        if (f.value) initial[f.id] = f.value;
        else if (f.type === 'date') initial[f.id] = todayLabel();
        else if (f.type === 'fullname') initial[f.id] = data.recipient.name;
        else if (f.type === 'email') initial[f.id] = data.recipient.email;
        else if (f.type === 'checkbox') initial[f.id] = 'false';
      }
      setValues(initial);
      return;
    }
    if (data.requiresAccessCode) { setState({ status: 'locked', data }); return; }
    setState({ status: 'blocked', data });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const myFields = useMemo(
    () => (data?.fields || []).filter((f) => f.mine).sort((a, b) => a.page - b.page || a.y - b.y),
    [data],
  );

  const isFilled = useCallback((f) => {
    const v = values[f.id];
    if (f.type === 'checkbox') return !f.required || v === 'true';
    return v !== undefined && v !== null && v !== '';
  }, [values]);

  const remaining = myFields.filter((f) => f.required && !isFilled(f));
  const completedCount = myFields.filter(isFilled).length;

  const persist = useCallback((next, nextMeta) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/sign/${token}/fields`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          values: Object.entries(next).map(([fieldId, value]) => ({
            fieldId, value: value === '' ? null : value, method: nextMeta[fieldId] || 'input',
          })),
        }),
      }).catch(() => {});
    }, 700);
  }, [token]);

  const setValue = useCallback((fieldId, value, method) => {
    setValues((prev) => {
      const next = { ...prev, [fieldId]: value };
      setMeta((m) => {
        const nm = { ...m, [fieldId]: method || m[fieldId] || 'input' };
        persist(next, nm);
        return nm;
      });
      return next;
    });
  }, [persist]);

  function scrollToField(field) {
    setActiveField(field.id);
    // Scroll the field's own element into view; this stays correct regardless of
    // zoom level, page size or how much chrome is stacked above the document.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-field-id="${field.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function nextIncomplete() {
    const target = remaining[0] || myFields.find((f) => !isFilled(f));
    if (target) scrollToField(target);
  }

  async function submitAccessCode(e) {
    e.preventDefault();
    setBusy(true); setAccessError(null);
    const res = await fetch(`/api/sign/${token}/access`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessCode }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setAccessError(body.error || 'Incorrect code'); return; }
    setState({ status: 'loading' });
    load();
  }

  async function finish() {
    setBusy(true);
    try {
      clearTimeout(saveTimer.current);
      await fetch(`/api/sign/${token}/fields`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          values: Object.entries(values).map(([fieldId, value]) => ({
            fieldId, value: value === '' ? null : value, method: meta[fieldId] || 'input',
          })),
        }),
      });
      const res = await fetch(`/api/sign/${token}/complete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setToast({ type: 'error', message: body.error || 'Could not complete signing' }); setBusy(false); return; }
      setState({ status: 'done', data, completedAll: body.completed });
    } catch {
      setToast({ type: 'error', message: 'Network error — please try again' });
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    await fetch(`/api/sign/${token}/decline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: declineReason }),
    });
    setBusy(false);
    setDeclineOpen(false);
    setState({ status: 'declined', data });
  }

  // ---- non-signing states --------------------------------------------------
  if (state.status === 'loading') {
    return <div className="min-h-screen flex items-center justify-center text-ink-400"><Spinner size={24} /></div>;
  }

  if (state.status === 'locked') {
    return (
      <main className="min-h-screen bg-ink-50 flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-sm">
          <span className="text-[16px] font-semibold tracking-[-.02em] text-ink-900">
            Inkwell<span className="text-brand-600">eSign</span>
          </span>
          <div className="mt-6 bg-white border border-ink-200/80 rounded-2xl shadow-card p-7">
            <div className="w-11 h-11 rounded-xl bg-ink-100 text-ink-500 flex items-center justify-center"><Lock size={18} /></div>
            <h1 className="mt-4 text-[17px] font-semibold text-ink-950">Enter your access code</h1>
            <p className="mt-1.5 text-[13.5px] text-ink-600 leading-relaxed">
              Hello {state.data.recipientName} — “{state.data.envelopeTitle}” is protected. Enter the code the
              sender shared with you.
            </p>
            <form onSubmit={submitAccessCode} className="mt-5 space-y-3">
              <Input label="Access code" value={accessCode} onChange={(e) => setAccessCode(e.target.value)}
                autoFocus autoComplete="one-time-code" error={accessError} />
              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? <Spinner /> : null} Continue
              </Button>
            </form>
          </div>
        </div>
      </main>
    );
  }

  if (state.status === 'blocked') {
    const alreadySigned = state.data?.error === 'completed';
    return (
      <Outcome
        tone={alreadySigned ? 'success' : 'neutral'}
        icon={alreadySigned ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
        title={alreadySigned ? 'Already signed' : 'This link is not available'}
        body={state.data?.message || 'The signing link could not be opened.'}
      />
    );
  }

  if (state.status === 'declined') {
    return (
      <Outcome
        tone="danger"
        icon={<XCircle size={22} />}
        title="You declined to sign"
        body="The sender has been notified. You can close this window."
      />
    );
  }

  if (state.status === 'done') {
    return (
      <Outcome
        tone="success"
        icon={<CheckCircle2 size={22} />}
        title="Signing complete"
        body={state.completedAll
          ? 'All parties have now signed. A copy of the executed document and certificate of completion is on its way to your inbox.'
          : 'Thank you. The next recipient has been notified, and you will receive the completed document by email.'}
      >
        <div className="mt-5 flex items-start gap-2 text-left rounded-lg bg-ink-50 border border-ink-200 px-3 py-2.5 text-[12px] text-ink-600">
          <ShieldCheck size={14} className="text-emerald-600 mt-0.5 shrink-0" />
          Your signature and the time you signed have been recorded, and cannot be changed afterwards.
        </div>
      </Outcome>
    );
  }

  // ---- signing surface -----------------------------------------------------
  const renderOverlay = (pageNumber) => (
    <div className="absolute inset-0">
      {data.fields.filter((f) => f.page === pageNumber).map((f) => {
        const style = {
          left: `${f.x * 100}%`, top: `${f.y * 100}%`,
          width: `${f.w * 100}%`, height: `${f.h * 100}%`,
        };
        if (!f.mine) {
          return (
            <div key={f.id} className="absolute rounded-[3px] border border-dashed flex items-center px-1 overflow-hidden"
              style={{ ...style, borderColor: `${f.recipientColor}66`, backgroundColor: `${f.recipientColor}12` }}>
              {f.value && /^data:image/.test(f.value)
                ? <img alt="" src={f.value} className="max-h-full max-w-full object-contain mx-auto" />
                : <span className="text-[9.5px] truncate" style={{ color: f.recipientColor }}>
                    {f.value || `${f.recipientName}`}
                  </span>}
            </div>
          );
        }
        const filled = isFilled(f);
        const isActive = activeField === f.id;
        return (
          <button
            key={f.id}
            data-field-id={f.id}
            onClick={() => {
              setActiveField(f.id);
              if (f.type === 'signature' || f.type === 'initials') setPadFor(f);
              else if (f.type === 'checkbox') setValue(f.id, values[f.id] === 'true' ? 'false' : 'true', 'input');
            }}
            className={clsx(
              'absolute rounded-[3px] border-2 flex items-center gap-1 px-1 overflow-hidden transition-all text-left',
              filled ? 'border-emerald-500/70 bg-emerald-50/50' : 'border-brand-500 bg-brand-100/70 hover:bg-brand-200/70',
              isActive && !filled && 'ring-4 ring-brand-500/25',
            )}
            style={style}
          >
            {f.type === 'signature' || f.type === 'initials' ? (
              values[f.id] ? (
                <img alt={f.type} src={values[f.id]} className="max-h-full max-w-full object-contain mx-auto" />
              ) : (
                <span className="flex items-center gap-1 text-[10.5px] font-semibold text-brand-700 mx-auto">
                  <PenLine size={11} /> {f.type === 'initials' ? 'Initials' : 'Sign'}
                </span>
              )
            ) : f.type === 'checkbox' ? (
              <span className="mx-auto text-[12px] font-bold leading-none text-emerald-700">
                {values[f.id] === 'true' ? '✕' : ''}
              </span>
            ) : f.type === 'dropdown' ? (
              <span className="flex items-center w-full gap-1 text-[10.5px] text-ink-800">
                <span className="truncate">{values[f.id] || f.label || 'Select'}</span>
                <ChevronDown size={10} className="ml-auto shrink-0 opacity-60" />
              </span>
            ) : (
              <span className="w-full truncate text-[10.5px] text-ink-900">
                {values[f.id] || <span className="text-brand-700 font-medium">{f.label || FIELD_META[f.type]?.label}</span>}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const editableField = myFields.find((f) => f.id === activeField
    && ['text', 'date', 'fullname', 'email', 'dropdown'].includes(f.type));

  return (
    <div className="min-h-screen bg-ink-100 flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-ink-200/80">
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <span className="text-[15px] font-semibold tracking-[-.02em] text-ink-900 shrink-0">
            Inkwell<span className="text-brand-600">eSign</span>
          </span>
          <div className="hidden sm:block min-w-0 border-l border-ink-200 pl-3">
            <p className="text-[13px] font-medium text-ink-900 truncate">{data.envelope.title}</p>
            <p className="text-[11.5px] text-ink-500 truncate">from {data.sender?.name} · {data.organization}</p>
          </div>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <div className="w-28 h-1.5 rounded-full bg-ink-200 overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full transition-all"
                  style={{ width: `${myFields.length ? (completedCount / myFields.length) * 100 : 0}%` }} />
              </div>
              <span className="text-[12px] text-ink-500 tabular-nums">{completedCount}/{myFields.length}</span>
            </div>
            {remaining.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={nextIncomplete}>
                <ArrowDown size={14} /> Next field
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setFinishOpen(true)} disabled={remaining.length > 0}>
              Finish
            </Button>
          </div>
        </div>
      </header>

      {data.envelope.message && (
        <div className="bg-brand-50 border-b border-brand-100 px-4 sm:px-6 py-2.5">
          <p className="text-[13px] text-brand-900 max-w-3xl mx-auto">
            <span className="font-medium">{data.sender?.name}:</span> {data.envelope.message}
          </p>
        </div>
      )}

      <div className="flex-1 px-3 sm:px-6 py-5 sm:py-7">
        <PdfDocument
          url={`/api/sign/${token}/document`}
          maxWidth={880}
          renderOverlay={renderOverlay}
          className="pb-28"
        />
      </div>

      {/* Inline editor for text-ish fields */}
      {editableField && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-white border-t border-ink-200 shadow-pop px-4 py-3 sm:px-6">
          <div className="max-w-3xl mx-auto flex items-end gap-3">
            <div className="flex-1">
              {editableField.type === 'dropdown' ? (
                <label className="block">
                  <span className="block text-[12.5px] font-medium text-ink-700 mb-1.5">
                    {editableField.label || 'Select an option'}
                  </span>
                  <select
                    autoFocus
                    value={values[editableField.id] || ''}
                    onChange={(e) => setValue(editableField.id, e.target.value, 'input')}
                    className="w-full h-10 px-3 rounded-lg border border-ink-200 text-sm focus:ring-2 focus:ring-brand-500/70 focus:border-brand-500 outline-none"
                  >
                    <option value="">Choose…</option>
                    {(editableField.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>
              ) : (
                <Input
                  autoFocus
                  label={editableField.label || FIELD_META[editableField.type]?.label}
                  value={values[editableField.id] || ''}
                  onChange={(e) => setValue(editableField.id, e.target.value, 'input')}
                  placeholder={editableField.type === 'date' ? todayLabel() : ''}
                />
              )}
            </div>
            <Button variant="secondary" onClick={() => setActiveField(null)}>Done</Button>
            {remaining.length > 0 && <Button onClick={nextIncomplete}>Next <ChevronRight size={14} /></Button>}
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      {!editableField && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-white/95 backdrop-blur border-t border-ink-200 px-4 sm:px-6 py-3">
          <div className="max-w-3xl mx-auto flex items-center gap-3">
            <div className="sm:hidden flex-1">
              <div className="h-1.5 rounded-full bg-ink-200 overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full transition-all"
                  style={{ width: `${myFields.length ? (completedCount / myFields.length) * 100 : 0}%` }} />
              </div>
              <p className="mt-1 text-[11.5px] text-ink-500">{completedCount} of {myFields.length} fields</p>
            </div>
            <p className="hidden sm:block text-[12.5px] text-ink-500">
              {remaining.length === 0
                ? 'All required fields are complete.'
                : `${remaining.length} required field${remaining.length === 1 ? '' : 's'} remaining.`}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeclineOpen(true)}>Decline</Button>
              {remaining.length > 0
                ? <Button onClick={nextIncomplete}>Start signing <ChevronRight size={15} /></Button>
                : <Button onClick={() => setFinishOpen(true)}>Finish signing</Button>}
            </div>
          </div>
        </div>
      )}

      <SignaturePad
        open={!!padFor} onClose={() => setPadFor(null)}
        kind={padFor?.type === 'initials' ? 'initials' : 'signature'}
        defaultName={data.recipient.name}
        onApply={({ dataUrl, method }) => {
          setValue(padFor.id, dataUrl, method);
          // Apply the same mark to every other empty field of the same type.
          for (const f of myFields) {
            if (f.id !== padFor.id && f.type === padFor.type && !values[f.id]) setValue(f.id, dataUrl, method);
          }
        }}
      />

      <Modal
        open={finishOpen} onClose={() => setFinishOpen(false)}
        title="Complete signing"
        description="Confirm your intent to sign this document electronically."
        footer={<>
          <Button variant="secondary" onClick={() => setFinishOpen(false)}>Back</Button>
          <Button onClick={finish} disabled={!consent || busy}>
            {busy ? <Spinner /> : null} Sign & complete
          </Button>
        </>}
      >
        <div className="space-y-3.5">
          <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3.5 py-3 text-[13px] text-ink-700 space-y-1">
            <p><span className="text-ink-500">Document:</span> {data.envelope.title}</p>
            <p><span className="text-ink-500">Signing as:</span> {data.recipient.name} ({data.recipient.email})</p>
            <p><span className="text-ink-500">Fields completed:</span> {completedCount} of {myFields.length}</p>
          </div>
          <label className="flex items-start gap-2.5 text-[13px] text-ink-700 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 rounded border-ink-300 text-brand-600 focus:ring-brand-500" />
            <span>
              I agree to use electronic records and signatures, and I intend my mark above to be my
              legally binding signature on this document.{' '}
              <button type="button" onClick={(e) => { e.preventDefault(); setDisclosureOpen(true); }}
                className="text-brand-600 underline">Read the disclosure</button>
            </span>
          </label>
          <div className="flex items-start gap-2 text-[12px] text-ink-500">
            <ShieldCheck size={13} className="text-emerald-600 mt-0.5 shrink-0" />
            The time you sign, the device you used and your agreement above are recorded on the
            certificate of completion for this document.
          </div>
        </div>
      </Modal>

      <Modal open={disclosureOpen} onClose={() => setDisclosureOpen(false)}
        title="Electronic Record and Signature Disclosure" width="max-w-2xl"
        footer={<Button onClick={() => setDisclosureOpen(false)}>Close</Button>}>
        <div className="space-y-3 text-[13px] leading-relaxed text-ink-700 max-h-[55vh] overflow-y-auto pr-1">
          <p>By selecting “I agree”, you consent to receive and sign this document electronically rather than on paper.</p>
          <p><strong>Scope.</strong> Your consent applies to this document and to any related notices delivered through this signing session.</p>
          <p><strong>Paper copies.</strong> You may request a paper copy of the executed document from the sender at no charge.</p>
          <p><strong>Withdrawing consent.</strong> You may decline to sign at any time before completing, using the “Decline” action. Declining notifies the sender and ends the signing session.</p>
          <p><strong>System requirements.</strong> A current web browser with JavaScript enabled and an internet connection. A PDF reader is required to view downloaded copies.</p>
          <p><strong>Record retention.</strong> The executed document, the certificate of completion and the audit trail are retained by the sending organisation and can be provided on request.</p>
          <p><strong>What we record.</strong> The time of each action, your IP address, your browser user agent, the authentication method used to open this link, and the digest of every mark you apply.</p>
        </div>
      </Modal>

      <Modal open={declineOpen} onClose={() => setDeclineOpen(false)}
        title="Decline to sign"
        description="The sender is notified immediately and the envelope is closed."
        footer={<>
          <Button variant="secondary" onClick={() => setDeclineOpen(false)}>Back</Button>
          <Button variant="danger" onClick={decline} disabled={busy}>Decline to sign</Button>
        </>}>
        <Textarea label="Reason (optional)" rows={3} value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
          placeholder="Let the sender know why you are declining." />
      </Modal>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
