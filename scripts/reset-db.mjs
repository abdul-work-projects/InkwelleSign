import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.INKWELL_DATA_DIR || path.join(process.cwd(), 'storage');
for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (name.startsWith('inkwell.db')) fs.rmSync(path.join(dir, name), { force: true });
}
fs.rmSync(path.join(dir, 'blobs'), { recursive: true, force: true });
console.log('Database and blob store cleared.');
