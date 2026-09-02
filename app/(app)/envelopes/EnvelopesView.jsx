'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { api, relativeTime } from '@/lib/client.js';
import { PageHeader } from '@/components/Shell.jsx';
import { Card, Button, EmptyState, Spinner, StatusBadge, Input } from '@/components/ui.jsx';
import { Plus, Send, Search } from 'lucide-react';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'sent', label: 'Sent' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'declined', label: 'Declined' },
  { key: 'voided', label: 'Voided' },
];

export default function EnvelopesView() {
  const [envelopes, setEnvelopes] = useState(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    setEnvelopes(null);
    api(`/envelopes?status=${filter}`).then((d) => setEnvelopes(d.envelopes)).catch(() => setEnvelopes([]));
  }, [filter]);

  const shown = useMemo(
    () => (envelopes || []).filter((e) => !q || e.title.toLowerCase().includes(q.toLowerCase())),
    [envelopes, q],
  );

  return (
    <>
      <PageHeader
        title="Envelopes"
        description="Every signing request, its recipients and current state."
        actions={<Button as={Link} href="/envelopes/new"><Plus size={15} /> New envelope</Button>}
      />

      <div className="p-5 sm:p-8 max-w-[1400px] space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex flex-wrap gap-1 p-1 bg-ink-100 rounded-lg">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={clsx(
                  'px-3 h-8 rounded-md text-[13px] font-medium transition-colors',
                  filter === f.key ? 'bg-white text-ink-900 shadow-card' : 'text-ink-500 hover:text-ink-800',
                )}>{f.label}</button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles" className="pl-9" />
          </div>
        </div>

        {envelopes === null ? (
          <div className="py-16 flex justify-center text-ink-400"><Spinner size={22} /></div>
        ) : shown.length === 0 ? (
          <Card>
            <EmptyState icon={Send} title="No envelopes here"
              description="Upload a document and prepare it for signature to get started."
              action={<Button as={Link} href="/envelopes/new"><Plus size={15} /> New envelope</Button>} />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-ink-200/60">
              {shown.map((e) => {
                const href = e.status === 'draft' ? `/envelopes/${e.id}/prepare` : `/envelopes/${e.id}`;
                const pct = e.signer_count ? Math.round((e.signed_count / e.signer_count) * 100) : 0;
                return (
                  <li key={e.id}>
                    <Link href={href} className="flex flex-wrap items-center gap-4 px-5 py-3.5 hover:bg-ink-50/70 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <p className="text-[14px] font-medium text-ink-900 truncate">{e.title}</p>
                          <StatusBadge status={e.status} />
                        </div>
                        <p className="mt-1 text-[12.5px] text-ink-500">
                          {e.created_by_name ? `${e.created_by_name} · ` : ''}
                          {e.sent_at ? `sent ${relativeTime(e.sent_at)}` : `created ${relativeTime(e.created_at)}`}
                          {e.ordered ? ' · sequential' : ' · parallel'}
                        </p>
                      </div>
                      <div className="w-40 shrink-0">
                        <div className="flex items-center justify-between text-[11.5px] text-ink-500 mb-1">
                          <span>{e.signed_count}/{e.signer_count} signed</span>
                          <span className="tabular-nums">{pct}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-ink-200 overflow-hidden">
                          <div className={clsx('h-full rounded-full transition-all',
                            e.status === 'completed' ? 'bg-emerald-500' : e.status === 'declined' ? 'bg-red-500' : 'bg-brand-500')}
                            style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
