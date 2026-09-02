import LoginForm from './LoginForm.jsx';
import { demoLogin } from '@/lib/demo.js';

export const metadata = { title: 'Sign in' };

// Demo availability depends on runtime configuration and on whether the database has
// been seeded. Prerendering this page would bake the answer in at build time, so the
// button could never appear on a deployed instance no matter how it was configured.
export const dynamic = 'force-dynamic';

export default function Page() {
  const demo = demoLogin();
  return (
    <LoginForm
      demo={demo ? { name: demo.name, email: demo.email, orgName: demo.orgName } : null}
    />
  );
}
