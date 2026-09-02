'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client.js';
import PrepareEditor from '@/components/PrepareEditor.jsx';
import { Button, Card, EmptyState, Spinner } from '@/components/ui.jsx';
import { FileWarning } from 'lucide-react';

/**
 * Loads the envelope over the API rather than reading the database during server
 * render. Every other screen already works this way; this one did not, which broke it on
 * hosts that run pages and API routes as separate functions with separate storage — an
 * envelope created through the API was invisible to the page rendering it.
 */
export default function PrepareLoader({ id }) {
  const router = useRouter();
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api(`/envelopes/${id}`)
      .then((data) => {
        if (cancelled) return;
        if (data.envelope.status !== 'draft') {
          router.replace(`/envelopes/${id}`);
          return;
        }
        setBundle({
          envelope: data.envelope,
          recipients: data.recipients,
          fields: data.fields,
          source: data.source,
        });
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [id, router]);

  if (error) {
    return (
      <div className="p-8 max-w-xl">
        <Card>
          <EmptyState
            icon={FileWarning}
            title="This envelope could not be opened"
            description={error}
            action={<Button as={Link} href="/envelopes">Back to envelopes</Button>}
          />
        </Card>
      </div>
    );
  }

  if (!bundle) {
    return <div className="p-16 flex justify-center text-ink-400"><Spinner size={22} /></div>;
  }

  return <PrepareEditor bundle={bundle} />;
}
