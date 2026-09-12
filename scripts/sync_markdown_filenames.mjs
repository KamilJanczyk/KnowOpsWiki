import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNavigation } from '../build_navigation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCS_DIR = path.resolve(__dirname, '../docs');

export function extractFirstH1(content) {
  if (!content || typeof content !== 'string') return null;
  const stripped = content.replace(/^---[\s\S]*?---\s*/, '');
  const match = stripped.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

export function slugifyTitle(title) {
  if (!title || typeof title !== 'string') return '';
  const polishMap = {
    'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
    'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ł': 'L', 'Ń': 'N', 'Ó': 'O', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z'
  };
  let str = title.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, char => polishMap[char] || char);
  str = str.replace(/[&]/g, '_and_');
  str = str.replace(/[()[\]{}]/g, '');
  str = str.replace(/[<>:"/\\|?*#`]/g, '');
  str = str.replace(/[\s\-]+/g, '_');
  str = str.replace(/_+/g, '_');
  return str.replace(/^_+|_+$/g, '');
}

export function computeTargetFilename(currentFilename, h1Title) {
  if (!h1Title) return currentFilename;
  const prefixMatch = currentFilename.match(/^(\d+[\.\-_])(.*)\.md$/i);
  const cleanSlug = slugifyTitle(h1Title);
  if (!cleanSlug) return currentFilename;

  if (prefixMatch && prefixMatch[1]) {
    return `${prefixMatch[1]}${cleanSlug}.md`;
  }
  return `${cleanSlug}.md`;
}

export function analyzeDocsFilenames(docsDir = DOCS_DIR) {
  const results = [];
  if (!fs.existsSync(docsDir)) return results;

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.toLowerCase() === '.trash') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const h1 = extractFirstH1(content);
          const targetName = computeTargetFilename(entry.name, h1);
          const relPath = path.relative(docsDir, fullPath).replace(/\\/g, '/');
          const isMatch = entry.name.toLowerCase() === targetName.toLowerCase();
          const targetFullPath = path.join(dir, targetName);
          const targetExists = !isMatch && fs.existsSync(targetFullPath);

          results.push({
            fullPath,
            relPath,
            currentName: entry.name,
            h1Title: h1 || '[Brak nagłówka H1]',
            targetName,
            targetExists,
            status: !h1 ? 'BRAK_H1' : (isMatch ? 'ZGODNA' : (targetExists ? 'KOLIZJA' : 'DO_ZMIANY'))
          });
        } catch (e) {
          console.error(`[Sync H1 Error] Blad odczytu ${fullPath}:`, e.message);
        }
      }
    }
  }

  scan(docsDir);
  return results;
}

if (process.argv[1] && process.argv[1].endsWith('sync_markdown_filenames.mjs')) {
  const isApply = process.argv.includes('--apply');
  console.log('================================================================');
  console.log('[KnowOps Wiki] Audyt zgodnosci nazw plikow Markdown z naglowkiem H1');
  console.log(`Tryb pracy: ${isApply ? 'APLIKACJA ZMIAN (--apply)' : 'AUDYT (Dry-run, bezpieczny podglad)'}`);
  console.log('================================================================\n');

  const items = analyzeDocsFilenames(DOCS_DIR);
  let mismatches = 0;
  let renamed = 0;

  for (const item of items) {
    if (item.status === 'DO_ZMIANY') {
      mismatches++;
      console.log('[WYKRYTO ROZBIEZNOSC]');
      console.log(`  Sciezka:    ${item.relPath}`);
      console.log(`  Naglowek:   # ${item.h1Title}`);
      console.log(`  Aktualna:   ${item.currentName}`);
      console.log(`  Sugerowana: ${item.targetName}\n`);

      if (isApply) {
        const targetPath = path.join(path.dirname(item.fullPath), item.targetName);
        if (fs.existsSync(targetPath)) {
          console.warn(`  [POMINIETO] Plik docelowy ${item.targetName} juz istnieje. Brak nadpisywania.`);
        } else {
          try {
            fs.renameSync(item.fullPath, targetPath);
            renamed++;
            console.log(`  [ZASTOSOWANO] Zmieniono nazwe na: ${item.targetName}`);
          } catch (err) {
            console.error(`  [BLAD] Nie udalo sie zmienic nazwy: ${err.message}`);
          }
        }
      }
    } else if (item.status === 'BRAK_H1') {
      console.log(`[UWAGA - BRAK H1] ${item.relPath} (Plik nie posiada naglowka pierwszego stopnia)`);
    }
  }

  console.log('\n----------------------------------------------------------------');
  console.log('Podsumowanie:');
  console.log(`Lacznie przeanalizowanych plikow Markdown: ${items.length}`);
  console.log(`Wykrytych rozbieznosci wymagajacych zmiany: ${mismatches}`);
  if (isApply) {
    console.log(`Pomyslnie zmieniono nazwy plikow:          ${renamed}`);
    if (renamed > 0) {
      console.log('Generowanie nowej struktury nawigacji navigation.json...');
      try {
        generateNavigation();
        console.log('Struktura nawigacji zaktualizowana pomyslnie.');
      } catch (e) {
        console.error('Blad aktualizacji navigation.json:', e.message);
      }
    }
  } else {
    if (mismatches > 0) {
      console.log(`Wskazowka: Uruchom z flaga '--apply', aby automatycznie zastosowac sugerowane nazwy.`);
    } else {
      console.log('Wszystkie nazwy plikow sa w 100% zgodne z naglowkami H1.');
    }
  }
  console.log('----------------------------------------------------------------');
}
