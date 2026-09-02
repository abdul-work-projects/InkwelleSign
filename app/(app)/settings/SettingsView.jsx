'use client';
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { api, formatDate, relativeTime } from '@/lib/client.js';
import { PageHeader } from '@/components/Shell.jsx';
import { Card, CardHeader, Button, Input, Select, Modal, Spinner, Toast, Mono, EmptyState, StatusBadge } from '@/components/ui.jsx';
import { KeyRound, Webhook, Users, Copy, Trash2, Plus, Fingerprint, Send } from 'lucide-react';

const TABS = [
  { key: 'team', label: 'Team', icon: Users },
  { key: 'api', label: 'API keys', icon: KeyRound },
  { key: 'webhooks', label: 'Webhooks', icon: Webhook },
  { key: 'security', label: 'Security', icon: Fingerprint },
];

export default function SettingsView() {
  const [tab, setTab] = useState('team');
  const [toast, setToast] = useState(null);

  return (
    <>
      <PageHeader title="Settings" description="Team access, integration credentials and workspace security." />
      <div className="px-5 sm:px-8 border-b border-ink-200/80 bg-white">
        <div className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={clsx('flex items-center gap-1.5 px-3.5 h-11 text-[13.5px] font-medium border-b-2 whitespace-nowrap transition-colors',
                tab === key ? 'border-brand-600 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800')}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5 sm:p-8 max-w-4xl space-y-6">
        {tab === 'team' && <TeamPanel setToast={setToast} />}
        {tab === 'api' && <ApiKeysPanel setToast={setToast} />}
        {tab === 'webhooks' && <WebhooksPanel setToast={setToast} />}
        {tab === 'security' && <SecurityPanel setToast={setToast} />}
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

function TeamPanel({ setToast }) {
  const [members, setMembers] = useState(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'member' });

  const load = useCallback(() => api('/team').then((d) => setMembers(d.members)).catch(() => setMembers([])), []);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    try {
      await api('/team', { method: 'POST', body: form });
      setOpen(false);
      setForm({ name: '', email: '', password: '', role: 'member' });
      setToast({ message: 'Team member added' });
      load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
  }

  async function changeRole(userId, role) {
    try {
      await api('/team', { method: 'PATCH', body: { userId, role } });
      load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
  }

  return (
    <Card>
      <CardHeader title="Team members"
        description="Roles gate what each person can do. Owners and admins manage credentials; viewers are read-only."
        action={<Button size="sm" onClick={() => setOpen(true)}><Plus size={14} /> Add member</Button>} />
      {members === null ? <div className="p-10 flex justify-center"><Spinner /></div> : (
        <ul className="divide-y divide-ink-200/60">
          {members.map((m) => (
            <li key={m.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-ink-900 text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
                {m.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink-900">{m.name}</p>
                <p className="text-[12px] text-ink-500 truncate">{m.email} · joined {relativeTime(m.created_at)}</p>
              </div>
              <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value)}
                className="h-8 px-2 rounded-lg border border-ink-200 text-[12.5px] bg-white capitalize">
                {['owner', 'admin', 'member', 'viewer'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </li>
          ))}
        </ul>
      )}
      <div className="px-5 py-3 border-t border-ink-200/70 bg-ink-50/50 text-[12px] text-ink-500 leading-relaxed">
        <strong className="text-ink-700">owner</strong> full control ·
        <strong className="text-ink-700"> admin</strong> manages keys, webhooks and team ·
        <strong className="text-ink-700"> member</strong> creates and sends envelopes ·
        <strong className="text-ink-700"> viewer</strong> read-only
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add team member"
        description="The member signs in with the credentials you set here."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={invite}>Add member</Button></>}>
        <div className="space-y-3.5">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Temporary password" type="text" value={form.password} hint="At least 10 characters."
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {['admin', 'member', 'viewer'].map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
          </Select>
        </div>
      </Modal>
    </Card>
  );
}

function ApiKeysPanel({ setToast }) {
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState(null);

  const load = useCallback(() => api('/api-keys').then((d) => setKeys(d.keys)).catch(() => setKeys([])), []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim()) return;
    try {
      const res = await api('/api-keys', { method: 'POST', body: { name } });
      setIssued(res.key);
      setName('');
      load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
  }

  async function revoke(id) {
    await api(`/api-keys/${id}`, { method: 'DELETE' });
    setToast({ message: 'Key revoked' });
    load();
  }

  return (
    <>
      <Card>
        <CardHeader title="API keys"
          description="Bearer credentials for the REST API. Only the SHA-256 digest is stored, so a key is shown once." />
        <div className="p-5 flex gap-2">
          <Input placeholder="Key name, e.g. Production integration" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={create} className="shrink-0"><Plus size={14} /> Create key</Button>
        </div>
        {keys === null ? <div className="p-10 flex justify-center"><Spinner /></div>
          : keys.length === 0 ? <EmptyState icon={KeyRound} title="No API keys" description="Create a key to call the REST API." />
            : (
              <ul className="divide-y divide-ink-200/60 border-t border-ink-200/70">
                {keys.map((k) => (
                  <li key={k.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[13.5px] font-medium text-ink-900">{k.name}</p>
                        {k.revoked_at && <StatusBadge status="voided" />}
                      </div>
                      <p className="text-[12px] text-ink-500">
                        <Mono>{k.prefix}…</Mono> · created {formatDate(k.created_at)}
                        {k.last_used_at ? ` · last used ${relativeTime(k.last_used_at)}` : ' · never used'}
                      </p>
                    </div>
                    {!k.revoked_at && (
                      <button onClick={() => revoke(k.id)}
                        className="text-ink-400 hover:text-red-600 p-1.5 rounded-md hover:bg-red-50"><Trash2 size={15} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
      </Card>

      <Card>
        <CardHeader title="Using the API" description="All endpoints are scoped to the key's organisation." />
        <pre className="p-5 text-[11.5px] leading-relaxed overflow-x-auto text-ink-700">
{`curl https://your-host/api/v1/envelopes \\
  -H "Authorization: Bearer ink_live_..."

curl -X POST https://your-host/api/v1/envelopes \\
  -H "Authorization: Bearer ink_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Mutual NDA",
    "documentVersionId": "dv_...",
    "ordered": true,
    "recipients": [{ "name": "Jordan Reyes", "email": "jordan@acme.com", "order": 1 }],
    "fields": [{ "type": "signature", "page": 1, "x": 0.12, "y": 0.78, "w": 0.26, "h": 0.055, "recipientIndex": 0 }]
  }'

curl -X POST https://your-host/api/v1/envelopes/env_.../send \\
  -H "Authorization: Bearer ink_live_..."`}
        </pre>
      </Card>

      <Modal open={!!issued} onClose={() => setIssued(null)} title="Copy your API key"
        description="This is the only time the key is shown."
        footer={<Button onClick={() => setIssued(null)}>Done</Button>}>
        <div className="flex items-center gap-2 rounded-lg bg-ink-900 px-3 py-2.5">
          <code className="text-[12px] font-mono text-white break-all flex-1">{issued}</code>
          <button onClick={() => { navigator.clipboard.writeText(issued); setToast({ message: 'Key copied' }); }}
            className="text-white/70 hover:text-white p-1 shrink-0"><Copy size={15} /></button>
        </div>
      </Modal>
    </>
  );
}

function WebhooksPanel({ setToast }) {
  const [hooks, setHooks] = useState(null);
  const [events, setEvents] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [url, setUrl] = useState('');
  const [created, setCreated] = useState(null);

  const load = useCallback(() => {
    api('/webhooks').then((d) => { setHooks(d.webhooks); setEvents(d.availableEvents); }).catch(() => setHooks([]));
    api('/webhook-deliveries').then((d) => setDeliveries(d.deliveries)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      const res = await api('/webhooks', { method: 'POST', body: { url, events: ['*'] } });
      setCreated(res.webhook);
      setUrl('');
      load();
    } catch (e) { setToast({ type: 'error', message: e.message }); }
  }

  return (
    <>
      <Card>
        <CardHeader title="Webhook endpoints"
          description="Payloads are signed with HMAC-SHA256 over `<timestamp>.<body>` in the X-Inkwell-Signature header." />
        <div className="p-5 flex gap-2">
          <Input placeholder="https://example.com/hooks/inkwell" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button onClick={create} className="shrink-0"><Plus size={14} /> Add endpoint</Button>
        </div>
        {hooks === null ? <div className="p-10 flex justify-center"><Spinner /></div>
          : hooks.length === 0 ? <EmptyState icon={Webhook} title="No endpoints" description="Add an endpoint to receive envelope lifecycle events." />
            : (
              <ul className="divide-y divide-ink-200/60 border-t border-ink-200/70">
                {hooks.map((h) => (
                  <li key={h.id} className="px-5 py-3.5 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-mono text-ink-900 truncate">{h.url}</p>
                      <p className="text-[12px] text-ink-500">{h.events.join(', ')} · added {relativeTime(h.created_at)}</p>
                    </div>
                    <StatusBadge status={h.active ? 'completed' : 'voided'} />
                    <button onClick={async () => { await api(`/webhooks/${h.id}`, { method: 'DELETE' }); load(); }}
                      className="text-ink-400 hover:text-red-600 p-1.5 rounded-md hover:bg-red-50"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
        <div className="px-5 py-3 border-t border-ink-200/70 bg-ink-50/50 text-[12px] text-ink-500">
          Events: {events.join(' · ')}
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent deliveries" description="The last 100 attempts, with response codes." />
        {deliveries.length === 0 ? (
          <EmptyState icon={Send} title="No deliveries yet" description="Send an envelope to trigger your first event." />
        ) : (
          <ul className="divide-y divide-ink-200/60">
            {deliveries.slice(0, 20).map((d) => (
              <li key={d.id} className="px-5 py-2.5 flex items-center gap-3 text-[12.5px]">
                <span className="font-medium text-ink-800 w-56 truncate">{d.event}</span>
                <span className="text-ink-500 flex-1 truncate font-mono text-[11.5px]">{d.url}</span>
                <span className={clsx('tabular-nums font-medium',
                  d.status_code >= 200 && d.status_code < 300 ? 'text-emerald-600' : 'text-red-600')}>
                  {d.status_code || d.error?.slice(0, 24) || 'pending'}
                </span>
                <span className="text-ink-400 shrink-0">{relativeTime(d.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Endpoint created"
        description="Store this signing secret — it is not shown again."
        footer={<Button onClick={() => setCreated(null)}>Done</Button>}>
        <div className="flex items-center gap-2 rounded-lg bg-ink-900 px-3 py-2.5">
          <code className="text-[12px] font-mono text-white break-all flex-1">{created?.secret}</code>
          <button onClick={() => navigator.clipboard.writeText(created.secret)}
            className="text-white/70 hover:text-white p-1 shrink-0"><Copy size={15} /></button>
        </div>
        <pre className="mt-3 text-[11.5px] bg-ink-50 border border-ink-200 rounded-lg p-3 overflow-x-auto text-ink-700">
{`// verify in Node
const [t, v1] = header.split(',').map(p => p.split('=')[1]);
const expected = crypto.createHmac('sha256', secret)
  .update(\`\${t}.\${rawBody}\`).digest('hex');
crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));`}
        </pre>
      </Modal>
    </>
  );
}

function SecurityPanel() {
  const [key, setKey] = useState(null);
  useEffect(() => { api('/organization/public-key').then(setKey).catch(() => {}); }, []);

  return (
    <>
      <Card>
        <CardHeader title="Evidence signing key"
          description="Completed envelopes are sealed with this workspace key pair. Share the public key with anyone who needs to verify a certificate independently." />
        <div className="p-5 space-y-3">
          <p className="text-[12.5px] text-ink-600">Algorithm: <span className="font-medium text-ink-900">{key?.algorithm || 'ECDSA P-256 / SHA-256'}</span></p>
          <pre className="text-[11px] bg-ink-50 border border-ink-200 rounded-lg p-3 overflow-x-auto text-ink-700 whitespace-pre-wrap break-all">
{key?.publicKey || 'Loading…'}
          </pre>
        </div>
      </Card>

      <Card>
        <CardHeader title="Security model" description="How the platform protects documents and evidence." />
        <ul className="p-5 space-y-3 text-[13px] text-ink-700 leading-relaxed">
          {[
            ['Tenant isolation', 'Every query is scoped by organisation id derived from the session or API key, and blobs are stored under a per-organisation prefix.'],
            ['Credential storage', 'Passwords use scrypt with per-user salts. Session tokens, signing tokens and API keys are stored only as SHA-256 digests.'],
            ['Signing links', '256-bit random tokens, single recipient, invalidated when a reminder re-issues them and destroyed on completion.'],
            ['Recipient authentication', 'Optional per-recipient access codes, throttled to five attempts per ten minutes, with successes and failures recorded in the audit trail.'],
            ['Evidence integrity', 'Audit events form a SHA-256 hash chain; documents are content-addressed and re-hashed on verification; the completed record is signed with the key above.'],
            ['Transport hardening', 'Strict security headers, httpOnly SameSite cookies and no-store responses for document streams.'],
          ].map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
              <span><strong className="text-ink-900 font-medium">{title}.</strong> {body}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
