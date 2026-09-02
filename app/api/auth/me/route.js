import { currentUser } from '@/lib/auth.js';
import { json, withRoute } from '@/lib/api.js';

export const GET = withRoute(async () => {
  const user = await currentUser();
  return json({ user: user || null });
});
