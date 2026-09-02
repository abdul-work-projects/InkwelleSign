import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth.js';
import Shell from '@/components/Shell.jsx';
import { DEMO_MODE } from '@/lib/db.js';

export default async function AppLayout({ children }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <Shell user={user} demoMode={DEMO_MODE}>{children}</Shell>;
}
