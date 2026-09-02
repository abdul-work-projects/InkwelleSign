import SigningExperience from './SigningExperience.jsx';

export const metadata = { title: 'Review & sign', robots: { index: false, follow: false } };

export default async function Page({ params }) {
  const { token } = await params;
  return <SigningExperience token={token} />;
}
