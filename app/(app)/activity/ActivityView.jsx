'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, formatDate, EVENT_LABELS } from '@/lib/client.js';
import { PageHeader } from '@/components/Shell.jsx';
import { Card, CardHeader, EmptyState, Spinner, Mono } from '@/components/ui.jsx';
import { ScrollText, ShieldCheck } from 'lucide-react';

export default function ActivityView() {
  const [envelopes, setEnvelopes] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    api('/envelopes?limit=25').then(async (d) => {
      setEnvelopes(d.envelopes);
      const batches = await Promise.all(
        d.envelopes.slice(0, 12).map((e) =>
          api(`/envelopes/${e.id}/audit`).then((a) => a.events.map((ev) => ({ ...ev, title: e.title }))).catch(() => []))
      );
      setEvents(batches.flat().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 120));
    }).catch(() => setEnvelopes([]));
  }, []);

  return (
    <>
      <PageHeader title="Activity"
        description="Everything that has happened across your documents recently." />
      <div className="p-5 sm:p-8 max-w-4xl">
        <Card>
          <CardHeader title="Audit events" description="Newest first. Each entry is locked to the one before it, so the history cannot be rewritten."
            action={<span className="inline-flex items-center gap-1.5 text-[12px] text-emerald-700">
              <ShieldCheck size={13} /> tamper-evident
            </span>} />
          {envelopes === null ? (
            <div className="py-16 flex justify-center text-ink-400"><Spinner size={22} /></div>
          ) : events.length === 0 ? (
            <EmptyState icon={ScrollText} title="No activity yet"
              description="Activity appears here as soon as you send your first document." />
          ) : (
            <ol className="divide-y divide-ink-200/60">
              {events.map((e) => (
                <li key={e.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] text-ink-900">
                      {EVENT_LABELS[e.event_type] || e.event_type}
                      <span className="text-ink-500"> · {e.actor_label || e.actor_type}</span>
                    </p>
                    <Link href={`/envelopes/${e.envelope_id}`} className="text-[12px] text-ink-500 hover:text-brand-600">
                      {e.title}
                    </Link>
                  </div>
                  <span className="text-[12px] text-ink-500 shrink-0">{formatDate(e.created_at)}</span>
                  <Mono className="shrink-0">{e.hash.slice(0, 10)}…</Mono>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}
