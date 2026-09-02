'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input, Spinner } from '@/components/ui.jsx';

export default function LoginForm() {
  const router = useRouter();
  const [state, setState] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Sign in failed'); setBusy(false); return; }
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-14">
        <div className="w-full max-w-sm">
          <Link href="/" className="text-[17px] font-semibold tracking-[-.02em] text-ink-900">
            Inkwell<span className="text-brand-600">eSign</span>
          </Link>
          <h1 className="mt-8 text-2xl font-semibold tracking-[-.02em] text-ink-950">Sign in</h1>
          <p className="mt-1.5 text-sm text-ink-500">Access your workspace and signing activity.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            <Input label="Work email" name="email" type="email" autoComplete="email" required
              value={state.email} onChange={(e) => setState({ ...state, email: e.target.value })} placeholder="you@company.com" />
            <Input label="Password" name="password" type="password" autoComplete="current-password" required
              value={state.password} onChange={(e) => setState({ ...state, password: e.target.value })} placeholder="••••••••••" />
            {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[13px] text-red-700">{error}</div>}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? <Spinner /> : null} Sign in
            </Button>
          </form>

          <p className="mt-6 text-[13px] text-ink-500">
            No workspace yet? <Link href="/register" className="text-brand-600 font-medium hover:text-brand-700">Create one</Link>
          </p>
        </div>
      </div>
      <aside className="hidden lg:flex flex-col justify-between bg-ink-950 text-white p-12 relative overflow-hidden">
        <div className="absolute inset-0 grid-paper opacity-[.12]" />
        <div className="relative">
          <p className="text-[13px] uppercase tracking-[.14em] text-brand-300 font-medium">Proof included</p>
        </div>
        <div className="relative max-w-md">
          <blockquote className="text-[22px] leading-[1.45] font-medium tracking-[-.015em]">
            Every document you send comes with a complete record of who opened it, who signed it,
            and exactly when.
          </blockquote>
          <p className="mt-5 text-[13px] text-ink-400 leading-relaxed">
            That record is locked the moment signing finishes. If the document or its history is
            altered afterwards, it stops matching — and you will see it straight away.
          </p>
        </div>
        <div className="relative text-[12px] text-ink-500">Tamper-evident record · Certificate of completion with every document</div>
      </aside>
    </main>
  );
}
