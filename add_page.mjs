import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const docsDir = path.resolve('docs');

const categories = [
  '01_Cyberbezpieczenstwo_i_SOC',
  '02_Infrastruktura_Systemowa',
  '03_Wirtualizacja_Kontenery_i_Sieci',
  '04_DevOps_Automatyzacja_i_AI',
  '05_Monitoring_i_Observability',
  '06_Sciagi_i_Szybkie_Polecenia',
  '07_Aplikacje_i_Skrypty'
];

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`
📄 Szybkie dodawanie nowej strony z poziomu SSH / Konsoli
-------------------------------------------------------
Użycie:
  node add_page.mjs "<Nazwa_Strony>"
  node add_page.mjs "<Kategoria>" "<Temat>" "<Nazwa_Strony>"

Przykłady:
  node add_page.mjs "Nowa Ściąga Linux"
  node add_page.mjs "Infrastruktura Systemowa" "Linux" "Zaawansowane Uprawnienia ACL"

Dostępne kategorie:
${categories.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}
`);
  process.exit(0);
}

let categoryDir = categories[0];
let topicDir = 'Ogólne';
let pageTitle = '';

if (args.length === 1) {
  pageTitle = args[0];
} else if (args.length === 2) {
  topicDir = args[0];
  pageTitle = args[1];
} else {
  const matchCat = categories.find(c => c.toLowerCase().includes(args[0].toLowerCase()));
  if (matchCat) categoryDir = matchCat;
  topicDir = args[1];
  pageTitle = args[2];
}

const cleanTopic = topicDir.trim().replace(/[<>:"|?*\x00\/\\]/g, '_').replace(/\s+/g, '_').replace(/\.\./g, '__');
const cleanFileName = pageTitle.trim().replace(/[<>:"|?*\x00\/\\]/g, '').replace(/\s+/g, '_') + '.md';
const targetDir = path.join(docsDir, categoryDir, cleanTopic);
if (!path.resolve(targetDir).startsWith(docsDir)) {
  console.error('❌ Nieprawidłowa ścieżka docelowa katalogu!');
  process.exit(1);
}

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const targetPath = path.join(targetDir, cleanFileName);

const defaultTemplate = `# ${pageTitle.trim()}

> [!NOTE]
> Strona utworzona z poziomu konsoli SSH / CLI.

## 1. Wprowadzenie

Wpisz tutaj treść dokumentacji...

---

## 2. Instrukcja krok po kroku

\`\`\`bash
# Przykładowe polecenie
echo "Hello World"
\`\`\`
`;

fs.writeFileSync(targetPath, defaultTemplate, 'utf8');
console.log(`✅ Pomyślnie utworzono plik Markdown: ${targetPath}`);
console.log(`⏳ Uruchamianie kompilatora bazy wiedzy...`);

try {
  const out = execSync('node build_knowops.mjs', { cwd: process.cwd(), encoding: 'utf8' });
  console.log(out.trim());
  console.log(`🎉 Strona gotowa i opublikowana!`);
} catch (e) {
  console.error(`❌ Błąd kompilacji:`, e.message);
}
