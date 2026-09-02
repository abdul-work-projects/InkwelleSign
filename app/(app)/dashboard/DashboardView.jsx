'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, relativeTime, EVENT_LABELS } from '@/lib/client.js';
import { PageHeader } from '@/components/Shell.jsx';
import { Card, CardHeader, Button, EmptyState, Spinner, StatusBadge } from '@/components/ui.jsx';
import { Send, Clock, CheckCircle2, FileText, Plus, Inbox, ArrowUpRight } from 'lucide-react';

function Stat({ label, value, sub, icon: Icon, tone = 'default' }) {
  const tones = {
    default: 'text-ink-400 bg-ink-100',
    amber: 'text-amber-600 bg-amber-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    brand: 'text-brand-600 bg-brand-50',
  };
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <p className="text-[12.5px] font-medium text-ink-500">{label}</p>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon size={14} /></span>
      </div>
      <p className="mt-2.5 text-[27px] leading-none font-semibold tracking-[-.03em] text-ink-950 tabular-nums">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-ink-500">{sub}</p>}
    </Card>
  );
}

export default function DashboardView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/stats').then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="p-8 text-sm text-red-600">{error}</div>;
  if (!data) return <div className="p-16 flex justify-center text-ink-400"><Spinner size={22} /></div>;

  const { counts, awaiting, recent, documents, templates, avgCompletionHours } = data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Signing activity across your workspace."
        actions={<>
          <Button as={Link} href="/documents" variant="secondary"><FileText size={15} /> Documents</Button>
          <Button as={Link} href="/envelopes/new"><Plus size={15} /> New envelope</Button>
        </>}
      />

      <div className="p-5 sm:p-8 space-y-6 max-w-[1400px]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <Stat label="Out for signature" value={counts.pending} icon={Clock} tone="amber"
            sub={counts.pending ? 'Awaiting recipient action' : 'Nothing pending'} />
          <Stat label="Completed" value={counts.completed} icon={CheckCircle2} tone="emerald"
            sub={avgCompletionHours !== null ? `Avg ${avgCompletionHours}h to complete` : 'No completions yet'} />
          <Stat label="Drafts" value={counts.draft} icon={Send} sub="Not yet sent" />
          <Stat label="Library" value={documents} icon={FileText} tone="brand"
            sub={`${templates} template${templates === 1 ? '' : 's'}`} />
        </div>

        <div className="grid lg:grid-cols-5 gap-6">
          <Card className="lg:col-span-3">
            <CardHeader
              title="Waiting on others"
              description="Recipients whose turn it is right now."
              action={<Button as={Link} href="/envelopes" size="sm" variant="ghost">View all <ArrowUpRight size={14} /></Button>}
            />
            {awaiting.length === 0 ? (
              <EmptyState icon={Inbox} title="Nothing is waiting" description="Every sent envelope has been actioned." />
            ) : (
              <ul className="divide-y divide-ink-200/70">
                {awaiting.map((a, i) => (
                  <li key={i}>
                    <Link href={`/envelopes/${a.envelope_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50/70 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-ink-100 text-ink-600 text-[11px] font-semibold flex items-center justify-center shrink-0">
                        {a.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-ink-900 truncate">{a.title}</p>
                        <p className="text-[12px] text-ink-500 truncate">{a.name} · {a.email}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <StatusBadge status={a.status} />
                        <p className="mt-1 text-[11.5px] text-ink-400">sent {relativeTime(a.sent_at)}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Recent activity" description="Latest audit events." />
            {recent.length === 0 ? (
              <EmptyState title="No activity yet" description="Events appear here as envelopes move through signing." />
            ) : (
              <ul className="px-5 py-4 space-y-3.5">
                {recent.map((e, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[13px] text-ink-800 leading-snug">
                        {EVENT_LABELS[e.event_type] || e.event_type}
                        {e.actor_label ? <span className="text-ink-500"> · {e.actor_label}</span> : null}
                      </p>
                      <Link href={`/envelopes/${e.envelope_id}`} className="text-[12px] text-ink-500 hover:text-brand-600 truncate block">
                        {e.title} · {relativeTime(e.created_at)}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
