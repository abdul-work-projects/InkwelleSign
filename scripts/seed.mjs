/**
 * Populates the demo workspace.  npm run seed
 */
import { seedDemoWorkspace } from '../lib/seed.js';

seedDemoWorkspace()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
