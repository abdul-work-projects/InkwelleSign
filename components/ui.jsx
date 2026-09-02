'use client';
import clsx from 'clsx';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export function Button({ variant = 'primary', size = 'md', className, as: As = 'button', ...props }) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus-ring disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap';
  const sizes = {
    sm: 'text-[13px] h-8 px-3',
    md: 'text-sm h-9.5 px-4 py-2',
    lg: 'text-[15px] h-11 px-5',
  };
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 shadow-sm',
    ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    subtle: 'bg-ink-100 text-ink-700 hover:bg-ink-200',
    dark: 'bg-ink-900 text-white hover:bg-ink-800 shadow-sm',
  };
  return <As className={clsx(base, sizes[size], variants[variant], className)} {...props} />;
}

export function Card({ className, children, ...props }) {
  return (
    <div className={clsx('bg-white border border-ink-200/80 rounded-xl shadow-card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }) {
  return (
    <div className={clsx('flex items-start justify-between gap-4 px-5 py-4 border-b border-ink-200/70', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink-900 tracking-[-.01em]">{title}</h2>
        {description && <p className="text-[13px] text-ink-500 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const STATUS_STYLES = {
  draft: 'bg-ink-100 text-ink-600 ring-ink-200',
  sent: 'bg-blue-50 text-blue-700 ring-blue-200',
  created: 'bg-ink-100 text-ink-600 ring-ink-200',
  viewed: 'bg-amber-50 text-amber-700 ring-amber-200',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  declined: 'bg-red-50 text-red-700 ring-red-200',
  voided: 'bg-ink-200 text-ink-600 ring-ink-300',
  expired: 'bg-orange-50 text-orange-700 ring-orange-200',
};

export function StatusBadge({ status, className }) {
  const label = String(status || '').replace(/_/g, ' ');
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset',
      STATUS_STYLES[status] || STATUS_STYLES.draft, className,
    )}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function Input({ label, hint, error, className, id, ...props }) {
  const generated = useId();
  const inputId = id || props.name || generated;
  return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-[13px] font-medium text-ink-700 mb-1.5">{label}</label>}
      <input
        id={inputId}
        className={clsx(
          'w-full h-9.5 px-3 rounded-lg border bg-white text-sm text-ink-900 placeholder:text-ink-400',
          'focus:outline-none focus:ring-2 focus:ring-brand-500/70 focus:border-brand-500 transition',
          error ? 'border-red-400' : 'border-ink-200', className,
        )}
        {...props}
      />
      {error ? <p className="mt-1.5 text-xs text-red-600">{error}</p>
        : hint ? <p className="mt-1.5 text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}

export function Textarea({ label, hint, className, id, ...props }) {
  const generated = useId();
  const inputId = id || props.name || generated;
  return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-[13px] font-medium text-ink-700 mb-1.5">{label}</label>}
      <textarea
        id={inputId}
        className={clsx(
          'w-full px-3 py-2 rounded-lg border border-ink-200 bg-white text-sm text-ink-900 placeholder:text-ink-400',
          'focus:outline-none focus:ring-2 focus:ring-brand-500/70 focus:border-brand-500 transition resize-y',
          className,
        )}
        {...props}
      />
      {hint && <p className="mt-1.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function Select({ label, className, children, id, ...props }) {
  const generated = useId();
  const inputId = id || props.name || generated;
  return (
    <div className="w-full">
      {label && <label htmlFor={inputId} className="block text-[13px] font-medium text-ink-700 mb-1.5">{label}</label>}
      <select
        id={inputId}
        className={clsx(
          'w-full h-9.5 px-2.5 rounded-lg border border-ink-200 bg-white text-sm text-ink-900',
          'focus:outline-none focus:ring-2 focus:ring-brand-500/70 focus:border-brand-500 transition',
          className,
        )}
        {...props}
      >{children}</select>
    </div>
  );
}

export function Modal({ open, onClose, title, description, children, footer, width = 'max-w-lg' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-ink-950/45 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={ref} className={clsx('relative w-full bg-white rounded-2xl shadow-pop border border-ink-200 animate-fade-up my-8', width)}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-ink-200/70">
          <div>
            <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
            {description && <p className="text-[13px] text-ink-500 mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 rounded-md p-1 -m-1 focus-ring" aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t border-ink-200/70 bg-ink-50/60 rounded-b-2xl flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-14 px-6">
      {Icon && (
        <div className="w-11 h-11 mx-auto rounded-xl bg-ink-100 flex items-center justify-center text-ink-400 mb-3.5">
          <Icon size={20} />
        </div>
      )}
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {description && <p className="text-[13px] text-ink-500 mt-1 max-w-sm mx-auto leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Spinner({ size = 16, className }) {
  return (
    <svg className={clsx('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity=".2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Mono({ children, className }) {
  return <span className={clsx('font-mono text-[11px] tracking-tight text-ink-600', className)}>{children}</span>;
}

export function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => onDismiss(), 4200);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] animate-fade-up">
      <div className={clsx(
        'flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm shadow-pop border',
        toast.type === 'error' ? 'bg-red-600 text-white border-red-700' : 'bg-ink-900 text-white border-ink-800',
      )}>
        {toast.message}
      </div>
    </div>
  );
}
