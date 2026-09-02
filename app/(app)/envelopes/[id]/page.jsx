import EnvelopeDetail from './EnvelopeDetail.jsx';
export const metadata = { title: 'Envelope' };
export default async function Page({ params }) {
  const { id } = await params;
  return <EnvelopeDetail id={id} />;
}
