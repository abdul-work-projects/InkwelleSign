import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth.js';
import { getEnvelopeBundle } from '@/lib/envelopes.js';
import PrepareEditor from '@/components/PrepareEditor.jsx';

export const metadata = { title: 'Prepare document' };

export default async function Page({ params }) {
  const { id } = await params;
  const user = await currentUser();
  const bundle = getEnvelopeBundle(user.orgId, id);
  if (!bundle) notFound();
  if (bundle.envelope.status !== 'draft') redirect(`/envelopes/${id}`);
  return (
    <PrepareEditor
      bundle={{
        envelope: bundle.envelope,
        recipients: bundle.recipients,
        fields: bundle.fields,
        source: bundle.source,
      }}
    />
  );
}
