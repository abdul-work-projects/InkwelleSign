'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import {
  LayoutDashboard, FileText, Send, LayoutTemplate, ScrollText,
  Settings, Mail, LogOut, Menu, X, ShieldCheck,
} from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/envelopes', label: 'Envelopes', icon: Send },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate },
  { href: '/outbox', label: 'Outbox', icon: Mail },
  { href: '/activity', label: 'Activity', icon: ScrollText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Shell({ user, children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const initials = user.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  const nav = (
    <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={clsx(
              'flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13.5px] font-medium transition-colors',
              active ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-900 hover:bg-white/70',
            )}>
            <Icon size={16} className={active ? 'text-brand-600' : 'text-ink-400'} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-ink-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-[232px] shrink-0 flex-col border-r border-ink-200/80 bg-ink-100/60">
        <div className="h-16 flex items-center px-5 border-b border-ink-200/70">
          <Link href="/dashboard" className="text-[15.5px] font-semibold tracking-[-.02em] text-ink-900">
            Inkwell<span className="text-brand-600">eSign</span>
          </Link>
        </div>
        {nav}
        <div className="p-3 border-t border-ink-200/70">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-8 h-8 rounded-lg bg-ink-900 text-white text-[11.5px] font-semibold flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink-900 truncate">{user.name}</p>
              <p className="text-[11.5px] text-ink-500 truncate capitalize">{user.role} · {user.orgName}</p>
            </div>
            <button onClick={logout} title="Sign out"
              className="text-ink-400 hover:text-ink-800 p-1.5 rounded-md hover:bg-ink-200/70 transition-colors">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-ink-950/45" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[256px] bg-ink-100 flex flex-col shadow-pop">
            <div className="h-14 flex items-center justify-between px-5 border-b border-ink-200/70">
              <span className="text-[15px] font-semibold text-ink-900">Inkwell<span className="text-brand-600">eSign</span></span>
              <button onClick={() => setOpen(false)} className="text-ink-500 p-1"><X size={18} /></button>
            </div>
            {nav}
            <button onClick={logout} className="m-3 flex items-center gap-2 px-3 h-9 rounded-lg text-[13.5px] text-ink-600 hover:bg-white">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden h-14 bg-white border-b border-ink-200/80 flex items-center justify-between px-4">
          <button onClick={() => setOpen(true)} className="text-ink-600 p-1.5 -ml-1.5"><Menu size={19} /></button>
          <span className="text-[15px] font-semibold text-ink-900">Inkwell<span className="text-brand-600">eSign</span></span>
          <div className="w-7 h-7 rounded-lg bg-ink-900 text-white text-[10.5px] font-semibold flex items-center justify-center">{initials}</div>
        </header>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, badge }) {
  return (
    <div className="border-b border-ink-200/80 bg-white">
      <div className="px-5 sm:px-8 py-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[19px] sm:text-[21px] font-semibold tracking-[-.02em] text-ink-950 truncate">{title}</h1>
            {badge}
          </div>
          {description && <p className="mt-1 text-[13.5px] text-ink-500 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

export function TrustNote({ children }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px] text-ink-500">
      <ShieldCheck size={14} className="text-emerald-600 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
