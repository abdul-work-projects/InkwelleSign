import LoginForm from './LoginForm.jsx';
import { demoLogin } from '@/lib/demo.js';

export const metadata = { title: 'Sign in' };

export default function Page() {
  // Resolved on the server so the button never flashes in and out on instances
  // where demo sign-in is unavailable.
  const demo = demoLogin();
  return (
    <LoginForm
      demo={demo ? { name: demo.name, email: demo.email, orgName: demo.orgName } : null}
    />
  );
}
