'use client';

/**
 * Fetch helper. Paths are resolved against /api/v1 unless they already address the
 * API root — note the trailing slash, so a resource named `/api-keys` is not
 * mistaken for an absolute API path.
 */
export async function api(path, options = {}) {
  const res = await fetch(path.startsWith('/api/') ? path : `/api/v1${path}`, {
    headers: options.body && !(options.body instanceof FormData)
      ? { 'content-type': 'application/json', ...options.headers }
      : options.headers,
    ...options,
    body: options.body && !(options.body instanceof FormData) && typeof options.body !== 'string'
      ? JSON.stringify(options.body) : options.body,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function formatDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: opts.year === false ? undefined : 'numeric',
    hour: 'numeric', minute: '2-digit', ...opts,
  });
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export const EVENT_LABELS = {
  'envelope.created': 'Envelope created',
  'envelope.sent': 'Envelope sent',
  'envelope.completed': 'Envelope completed',
  'envelope.voided': 'Envelope voided',
  'recipient.invited': 'Invitation sent',
  'recipient.viewed': 'Document viewed',
  'recipient.authenticated': 'Access code accepted',
  'recipient.authentication_failed': 'Access code rejected',
  'recipient.authentication_throttled': 'Access attempts throttled',
  'recipient.consented': 'Consent to sign electronically',
  'recipient.signed': 'Recipient signed',
  'recipient.declined': 'Recipient declined',
  'recipient.reminded': 'Reminder sent',
  'document.executed': 'Executed PDF generated',
};
