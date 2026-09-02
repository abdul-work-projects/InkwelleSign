'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Spinner } from '@/components/ui.jsx';

export default function RegisterForm() {
  const [state, setState] = useState({ orgName: '', name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Could not create workspace'); setBusy(false); return; }
    // A full navigation rather than router.push: signing in changes what the server
    // renders for every route, and calling router.refresh() alongside a push races the
    // pending navigation and can leave the user on this page.
    window.location.assign('/dashboard');
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-14 bg-ink-50">
      <div className="w-full max-w-md">
        <Link href="/" className="text-[17px] font-semibold tracking-[-.02em] text-ink-900">
          Inkwell<span className="text-brand-600">eSign</span>
        </Link>
        <div className="mt-6 bg-white border border-ink-200/80 rounded-2xl shadow-card p-7">
          <h1 className="text-xl font-semibold tracking-[-.02em] text-ink-950">Create your workspace</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-500">
            You will be the owner of this workspace. Everything needed to seal and verify your
            completed documents is set up automatically.
          </p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Input label="Organisation name" name="orgName" required value={state.orgName}
              onChange={(e) => setState({ ...state, orgName: e.target.value })} placeholder="Northwind Legal" />
            <Input label="Your name" name="name" required value={state.name}
              onChange={(e) => setState({ ...state, name: e.target.value })} placeholder="Alex Moore" />
            <Input label="Work email" name="email" type="email" autoComplete="email" required value={state.email}
              onChange={(e) => setState({ ...state, email: e.target.value })} placeholder="alex@northwind.com" />
            <Input label="Password" name="password" type="password" autoComplete="new-password" required
              hint="At least 10 characters." value={state.password}
              onChange={(e) => setState({ ...state, password: e.target.value })} placeholder="••••••••••" />
            {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-[13px] text-red-700">{error}</div>}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? <Spinner /> : null} Create workspace
            </Button>
          </form>
        </div>
        <p className="mt-5 text-center text-[13px] text-ink-500">
          Already have an account? <Link href="/login" className="text-brand-600 font-medium hover:text-brand-700">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
