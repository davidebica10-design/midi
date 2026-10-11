// Copia l'app web (../tempo) in www/ per Capacitor, senza test, documenti e file di sviluppo.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../tempo');
const out = join(here, '../www');
const SKIP = new Set(['tests', 'package.json', 'README.md', 'DESIGN-API.md', 'NOTIFICHE.md', 'APP-STORE.md', 'node_modules']);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true, filter: (p) => !SKIP.has(basename(p)) });
console.log('App web copiata in', out);
