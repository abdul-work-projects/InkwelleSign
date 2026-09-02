import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth.js';
import Shell from '@/components/Shell.jsx';

export default async function AppLayout({ children }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <Shell user={user}>{children}</Shell>;
}
