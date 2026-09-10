import fs from 'node:fs';
import path from 'node:path';

const docsDir = path.resolve('docs');
const docsExampleDir = path.resolve('docs.example');

// Jeśli katalog docs/ nie istnieje lub jest pusty, automatycznie skopiuj docs.example/ -> docs/
if (!fs.existsSync(docsDir) || fs.readdirSync(docsDir).length === 0) {
  if (fs.existsSync(docsExampleDir)) {
    console.log('[Wiki Build] Inicjalizacja katalogu docs/ na podstawie docs.example/...');
    fs.cpSync(docsExampleDir, docsDir, { recursive: true });
  }
}

function cleanTitle(name) {
  let title = name.replace(/\.md$/i, '');
  title = title.replace(/_/g, ' ');
  title = title.replace(/^\d+[a-zA-Z]?[\s._-]+/, '');
  return title.trim();
}

export function extractMarkdownTags(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const tags = new Set();

    if (content.startsWith('---')) {
      const parts = content.split('---');
      if (parts.length >= 3) {
        const frontmatter = parts[1];
        // Format tablicowy inline: tags: [cybersec, linux, nginx]
        const inlineMatch = frontmatter.match(/tags:\s*\[(.*?)\]/i);
        if (inlineMatch && inlineMatch[1]) {
          inlineMatch[1].split(',')
            .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
            .forEach(t => tags.add(t.toLowerCase()));
        }
        // Format listy pionowej:
        // tags:
        //   - cybersec
        //   - linux
        const listMatch = frontmatter.match(/tags:\s*\n((?:\s*-\s*.+\n?)+)/i);
        if (listMatch && listMatch[1]) {
          const lines = listMatch[1].split('\n');
          for (const l of lines) {
            const m = l.match(/^\s*-\s*['"]?([^'"#\n]+)['"]?/);
            if (m && m[1]) tags.add(m[1].trim().toLowerCase());
          }
        }
        // Format po przecinku: tags: cybersec, linux
        const commaMatch = frontmatter.match(/tags:\s*([^\n\[]+)/i);
        if (commaMatch && commaMatch[1] && !commaMatch[1].trim().startsWith('-')) {
          commaMatch[1].split(',')
            .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
            .forEach(t => tags.add(t.toLowerCase()));
        }
      }
    }
    return Array.from(tags).sort();
  } catch (e) {
    return [];
  }
}

function scanSubcategoryFiles(subPath, baseRel) {
  const files = [];
  function recurse(currentPath, currentRel) {
    if (!fs.existsSync(currentPath)) return;
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(currentPath, entry.name);
      const rel = path.posix.join(currentRel, entry.name);

      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase();
        if (!['media', 'public', 'images', 'img'].includes(lower)) {
          recurse(full, rel);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push({
          title: cleanTitle(entry.name),
          relPath: rel,
          tags: extractMarkdownTags(full)
        });
      }
    }
  }
  recurse(subPath, baseRel);
  return files;
}

function scanDirectoryRecursive(dirPath, baseRel) {
  if (!fs.existsSync(dirPath)) return [];
  const fileItems = [];
  const dirItems = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const lower = entry.name.toLowerCase();
    if (['media', 'public', 'images', 'img'].includes(lower)) continue;

    const full = path.join(dirPath, entry.name);
    const rel = path.posix.join(baseRel, entry.name);

    if (entry.isDirectory()) {
      const subItems = scanDirectoryRecursive(full, rel);
      dirItems.push({
        type: 'directory',
        title: cleanTitle(entry.name),
        relPath: rel,
        items: subItems
      });
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fileItems.push({
        type: 'file',
        title: cleanTitle(entry.name),
        relPath: rel,
        tags: extractMarkdownTags(full)
      });
    }
  }
  // Pliki Markdown (.md) zawsze na początku, a podkatalogi na końcu
  return [...fileItems, ...dirItems];
}

export function generateNavigation() {
  const availableCategories = [
    { id: 'kanban_board', title: 'Pulpit', subcategories: [] }
  ];

  if (fs.existsSync(docsDir)) {
    const dirEntries = fs.readdirSync(docsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !['media', 'public', 'images', '.trash'].includes(e.name.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

    for (const catDir of dirEntries) {
      const catPath = path.join(docsDir, catDir.name);
      const subDirs = fs.readdirSync(catPath, { withFileTypes: true })
        .filter(s => s.isDirectory() && !s.name.startsWith('.') && !['media', 'public', 'images', '.trash'].includes(s.name.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

      const subcategories = [];
      for (const subDir of subDirs) {
        const subPath = path.join(catPath, subDir.name);
        const subRel = path.posix.join(catDir.name, subDir.name);
        const files = scanSubcategoryFiles(subPath, subRel);
        const items = scanDirectoryRecursive(subPath, subRel);
        subcategories.push({
          id: subDir.name,
          title: cleanTitle(subDir.name),
          relPath: subRel,
          files,
          items
        });
      }

      // Dodanie również pojedynczych plików Markdown znajdujących się bezpośrednio w kategorii głównej
      const directFiles = fs.readdirSync(catPath, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.endsWith('.md') && !f.name.startsWith('.'))
        .map(f => {
          const fullPath = path.join(catPath, f.name);
          return {
            title: cleanTitle(f.name),
            relPath: path.posix.join(catDir.name, f.name),
            tags: extractMarkdownTags(fullPath)
          };
        });

      if (directFiles.length > 0) {
        subcategories.unshift({
          id: 'glowne',
          title: 'Ogólne',
          relPath: catDir.name,
          files: directFiles,
          items: directFiles.map(f => ({ type: 'file', title: f.title, relPath: f.relPath, tags: f.tags }))
        });
      }

      availableCategories.push({
        id: catDir.name,
        title: cleanTitle(catDir.name),
        subcategories
      });
    }
  }

  // Agregacja globalnej listy tagów z liczbą wystąpień
  const tagCountMap = {};
  function collectItemTags(items) {
    if (!items || !Array.isArray(items)) return;
    for (const it of items) {
      if (it.type === 'file' && Array.isArray(it.tags)) {
        for (const t of it.tags) {
          tagCountMap[t] = (tagCountMap[t] || 0) + 1;
        }
      } else if (it.type === 'directory' && it.items) {
        collectItemTags(it.items);
      }
    }
  }

  for (const cat of availableCategories) {
    for (const sub of (cat.subcategories || [])) {
      if (sub.items) collectItemTags(sub.items);
      else if (sub.files) {
        for (const f of sub.files) {
          if (Array.isArray(f.tags)) {
            for (const t of f.tags) {
              tagCountMap[t] = (tagCountMap[t] || 0) + 1;
            }
          }
        }
      }
    }
  }

  const allTags = Object.keys(tagCountMap).sort().map(t => ({
    tag: t,
    count: tagCountMap[t]
  }));

  const navigationData = { categories: availableCategories, allTags };
  const navJsonPath = path.join(docsDir, 'navigation.json');
  const tmpPath = `${navJsonPath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(navigationData, null, 2), 'utf-8');
  fs.renameSync(tmpPath, navJsonPath);

  return navigationData;
}

// Jeśli plik jest uruchamiany bezpośrednio z terminala (CLI)
if (process.argv[1] && process.argv[1].endsWith('build_navigation.mjs')) {
  const result = generateNavigation();
  console.log(`DETERMINISTIC NAVIGATION JSON GENERATED! (Categories: ${result.categories.length})`);
}
