'use client';
import { AlertTriangle } from 'lucide-react';

export default function ErrorScreen({ error, reset }) {
  const storage = /Storage is not writable/i.test(error?.message || '');
  return (
    <main className="min-h-screen bg-ink-50 flex items-center justify-center px-5 py-16">
      <div className="w-full max-w-lg">
        <span className="text-[16px] font-semibold tracking-[-.02em] text-ink-900">
          Inkwell<span className="text-brand-600">eSign</span>
        </span>
        <div className="mt-6 bg-white border border-ink-200/80 rounded-2xl shadow-card p-8">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle size={22} />
          </div>
          <h1 className="mt-4 text-[17px] font-semibold text-ink-950">
            {storage ? 'This deployment has no persistent storage' : 'Something went wrong'}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">
            {storage
              ? 'Inkwell keeps its database and signed documents on disk. The host running this build does not provide a writable, persistent volume, so nothing can be read or saved.'
              : 'The page could not be rendered. The error has been logged.'}
          </p>
          {storage && (
            <div className="mt-5 rounded-lg bg-ink-50 border border-ink-200 px-4 py-3 text-[12.5px] text-ink-600 leading-relaxed">
              <p className="font-medium text-ink-800">How to fix it</p>
              <ul className="mt-1.5 space-y-1 list-disc pl-4">
                <li>Deploy to a host with a persistent disk and point <code className="font-mono">INKWELL_DATA_DIR</code> at the mounted volume, or</li>
                <li>Move storage to a managed database so the app no longer needs local disk.</li>
              </ul>
            </div>
          )}
          <button
            onClick={reset}
            className="mt-6 inline-flex items-center h-9.5 px-4 rounded-lg bg-ink-900 text-white text-sm font-medium hover:bg-ink-800 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
