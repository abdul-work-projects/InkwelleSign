import PrepareLoader from './PrepareLoader.jsx';

export const metadata = { title: 'Prepare document' };

export default async function Page({ params }) {
  const { id } = await params;
  return <PrepareLoader id={id} />;
}
