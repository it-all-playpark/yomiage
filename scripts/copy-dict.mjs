// kuromoji の辞書（*.dat.gz）を public/dict に置く。dev / build / test の前に走る
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve('kuromoji/package.json')), 'dict');
const dest = join(root, 'public', 'dict');

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`kuromoji の辞書を ${dest} にコピーしました`);
