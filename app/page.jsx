import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth.js';
import { ShieldCheck, PenLine, FileStack, Workflow, Webhook, FileCheck2 } from 'lucide-react';

const FEATURES = [
  { icon: FileStack, title: 'Prepare in the browser', body: 'Upload a PDF and drop signature, initials, date, text, checkbox and dropdown fields anywhere on the page.' },
  { icon: Workflow, title: 'Routing that matches reality', body: 'Send to one person at a time or to everyone at once, add a private access code, and let reminders chase whoever is holding things up.' },
  { icon: PenLine, title: 'Sign three ways', body: 'Type, draw or upload a signature. The signing experience is built for phones first.' },
  { icon: ShieldCheck, title: 'Proof that holds up', body: 'Every open, signature and completion is recorded and time-stamped, then locked so it cannot be quietly changed later.' },
  { icon: FileCheck2, title: 'A signed copy, ready to file', body: 'Signatures are written into the PDF itself and paired with a certificate listing every party and every action.' },
  { icon: Webhook, title: 'Connects to your systems', body: 'A full API and instant notifications, so your CRM or contract system knows the moment a document is signed.' },
];

export default async function Landing() {
  const user = await currentUser();
  if (user) redirect('/dashboard');

  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-ink-200/70">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="text-[17px] font-semibold tracking-[-.02em] text-ink-900">
            Inkwell<span className="text-brand-600">eSign</span>
          </span>
          <nav className="flex items-center gap-2">
            <Link href="/login" className="text-sm font-medium text-ink-600 hover:text-ink-900 px-3 py-2">Sign in</Link>
            <Link href="/register" className="text-sm font-medium bg-ink-900 text-white rounded-lg px-4 py-2 hover:bg-ink-800 transition-colors">
              Create workspace
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 grid-paper opacity-[.55] [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" />
        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-16 sm:pt-28 sm:pb-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1 text-[12px] text-ink-600 shadow-card">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            A complete, tamper-evident record on every document
          </div>
          <h1 className="mt-6 text-4xl sm:text-[54px] leading-[1.05] font-semibold tracking-[-.035em] text-ink-950 max-w-3xl">
            Electronic signatures with evidence you can actually defend.
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-ink-600 max-w-2xl">
            Send a document, choose who signs it and in what order, and let Inkwell handle the rest —
            private signing links, reminders, the signed copy, and a certificate that proves exactly
            what happened.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="inline-flex items-center h-11 px-6 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 transition-colors shadow-sm">
              Create a workspace
            </Link>
            <Link href="/login" className="inline-flex items-center h-11 px-6 rounded-lg bg-white border border-ink-200 text-ink-800 font-medium hover:bg-ink-50 transition-colors shadow-sm">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="border-t border-ink-200/70 bg-ink-50/50">
        <div className="max-w-6xl mx-auto px-6 py-16 grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-ink-200/70 rounded-2xl overflow-hidden border border-ink-200/70">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-white p-6">
              <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                <Icon size={17} />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold text-ink-900">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-ink-200/70">
        <div className="max-w-6xl mx-auto px-6 py-8 text-[13px] text-ink-500 flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>Inkwell eSign — independently developed e-signature platform.</span>
          <span>Every document is checked for tampering each time it is opened.</span>
        </div>
      </footer>
    </main>
  );
}
