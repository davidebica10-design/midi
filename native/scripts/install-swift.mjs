// Copia i sorgenti Swift di ios-src/ nel progetto creato da «npx cap add ios».
// I target «TempoWidgets» (Widget Extension) e le capacità vanno aggiunti in Xcode: vedi README.md.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '../ios/App/App');
if (!existsSync(app)) { console.error('Prima esegui «npx cap add ios».'); process.exit(1); }
for (const d of ['App', 'Shared', 'CarPlay']) cpSync(join(here, '../ios-src', d), join(app, 'Tempo', d), { recursive: true });
cpSync(join(here, '../ios-src/Widgets'), join(here, '../ios/App/TempoWidgets'), { recursive: true });
cpSync(join(here, '../ios-src/Shared'), join(here, '../ios/App/TempoWidgets/Shared'), { recursive: true });
console.log('Sorgenti Swift copiati. Ora apri Xcode (npm run ios:open) e segui README.md, passo 4.');
