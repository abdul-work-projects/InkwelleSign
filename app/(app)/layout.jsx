import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth.js';
import Shell from '@/components/Shell.jsx';
import { ensureDemoSeeded } from '@/lib/demo-seed.js';

export default async function AppLayout({ children }) {
  await ensureDemoSeeded();
  const user = await currentUser();
  if (!user) redirect('/login');
  return <Shell user={user}>{children}</Shell>;
}
