'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Spinner } from '@/components/ui.jsx';
import { Play } from 'lucide-react';

export default function LoginForm({ demo = null }) {
  const [state, setState] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  async function testSignIn() {
    setDemoBusy(true); setError(null);
    const res = await fetch('/api/auth/demo', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || 'Demo sign-in is unavailable');
      setDemoBusy(false);
      return;
    }
    // A full navigation rather than router.push: signing in changes what the server
    // renders for every route, and calling router.refresh() alongside a push races the
    // pending navigation and can leave the user on this page.
    window.location.assign('/dashboard');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Sign in failed'); setBusy(false); return; }
    // A full navigation rather than router.push: signing in changes what the server
    // renders for every route, and calling router.refresh() alongside a push races the
    // pending navigation and can leave the user on this page.
    window.location.assign('/dashboard');
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

          {demo && (
            <>
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-ink-200" /></div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-[12px] text-ink-400">or take a look around</span>
                </div>
              </div>

              <Button variant="secondary" size="lg" className="w-full" onClick={testSignIn} disabled={demoBusy}>
                {demoBusy ? <Spinner /> : <Play size={15} />} Test sign in
              </Button>
              <p className="mt-2 text-[12px] text-ink-500 text-center">
                Opens {demo.orgName} as {demo.name} — a sample workspace with documents already signed.
              </p>
            </>
          )}

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
