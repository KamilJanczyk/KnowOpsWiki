import fs from 'node:fs';
import path from 'node:path';

const docsDir = path.resolve('docs');

function cleanTitle(name) {
  let title = name.replace(/\.md$/i, '');
  title = title.replace(/_/g, ' ');
  title = title.replace(/^\d+[a-zA-Z]?[\s._-]+/, '');
  return title.trim();
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
          relPath: rel
        });
      }
    }
  }
  recurse(subPath, baseRel);
  return files;
}

function scanDirectoryRecursive(dirPath, baseRel) {
  if (!fs.existsSync(dirPath)) return [];
  const items = [];
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
      if (subItems.length > 0) {
        items.push({
          type: 'directory',
          title: cleanTitle(entry.name),
          relPath: rel,
          items: subItems
        });
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      items.push({
        type: 'file',
        title: cleanTitle(entry.name),
        relPath: rel
      });
    }
  }
  return items;
}

const availableCategories = [
  { id: 'kanban_board', title: 'Pulpit', subcategories: [] }
];

if (fs.existsSync(docsDir)) {
  const dirEntries = fs.readdirSync(docsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !['media', 'public', 'images'].includes(e.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

  for (const catDir of dirEntries) {
    const catPath = path.join(docsDir, catDir.name);
    const subDirs = fs.readdirSync(catPath, { withFileTypes: true })
      .filter(s => s.isDirectory() && !s.name.startsWith('.') && !['media', 'public', 'images'].includes(s.name.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

    const subcategories = [];
    for (const subDir of subDirs) {
      const subPath = path.join(catPath, subDir.name);
      const subRel = path.posix.join(catDir.name, subDir.name);
      const files = scanSubcategoryFiles(subPath, subRel);
      const items = scanDirectoryRecursive(subPath, subRel);
      if (files.length > 0) {
        subcategories.push({
          id: subDir.name,
          title: cleanTitle(subDir.name),
          relPath: subRel,
          files,
          items
        });
      }
    }

    if (subcategories.length > 0) {
      availableCategories.push({
        id: catDir.name,
        title: cleanTitle(catDir.name),
        subcategories
      });
    }
  }
}

const navigationData = { categories: availableCategories };
const navJsonPath = path.join(docsDir, 'navigation.json');
fs.writeFileSync(navJsonPath, JSON.stringify(navigationData, null, 2), 'utf-8');

console.log(`DETERMINISTIC NAVIGATION JSON GENERATED! (Categories: ${availableCategories.length})`);
