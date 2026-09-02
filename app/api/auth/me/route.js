import { currentUser } from '@/lib/auth.js';
import { json } from '@/lib/api.js';

export async function GET() {
  const user = await currentUser();
  return json({ user: user || null });
}
