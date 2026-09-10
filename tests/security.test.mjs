import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { extractMarkdownTags } from '../build_navigation.mjs';
import { exportWikiZip } from '../backup_wiki.mjs';

// 1. Walidacja Sygnatur Binarnych Obrazów (Magic Bytes)
function isValidImageMagicBytes(buf, ext) {
  if (!buf || buf.length < 12) return false;
  const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpg = buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isGif = buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
  const isWebp = buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;

  return (ext === '.png' && isPng) || ((ext === '.jpg' || ext === '.jpeg') && isJpg) || (ext === '.gif' && isGif) || (ext === '.webp' && isWebp);
}

// 2. Ochrona SSRF - Walidacja Hostów
function isBlockedSsrfHost(hostname) {
  const h = (hostname || '').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('169.254.')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;

  const match172 = h.match(/^172\.(\d+)\./);
  if (match172) {
    const secondOctet = parseInt(match172[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  return false;
}

// 3. Sanityzacja Sciezek (Path Traversal Protection)
function sanitizeRelativePath(categoryRel, filename, baseDocsDir) {
  let sanitizedCatRel = categoryRel.replace(/\\/g, '/').replace(/[<>:"|?*\x00]/g, '_');
  sanitizedCatRel = sanitizedCatRel.split('/').map(p => p === '..' ? '__' : p).filter(Boolean).join('/');

  let decodedFilename = decodeURIComponent(filename);
  let normalizedPath = decodedFilename.trim().replace(/\\/g, '/');
  normalizedPath = normalizedPath.replace(/[<>:"|?*\x00]/g, '_');
  let parts = normalizedPath.split('/').map(p => p === '..' ? '__' : p).filter(Boolean);
  let relativeFilePath = parts.join('/');
  if (!relativeFilePath.endsWith('.md')) relativeFilePath += '.md';

  const fullFilePath = path.resolve(baseDocsDir, sanitizedCatRel, relativeFilePath);
  const isSafe = isPathInsideDocs(fullFilePath, baseDocsDir);
  return { fullFilePath, isSafe };
}

// 3b. Ścisła weryfikacja granic katalogu (ochrona przed Path Traversal i katalogami siostrzanymi)
function isPathInsideDocs(targetPath, baseDir = path.resolve('docs')) {
  if (!targetPath) return false;
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

// 4. Centralna Funkcja Kodowania Encji HTML
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ================= TESTY JEDNOSTKOWE ================= //

test('Magic Bytes: Poprawne rozpoznawanie plików PNG, JPEG, GIF i WebP', () => {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  assert.equal(isValidImageMagicBytes(pngHeader, '.png'), true);
  assert.equal(isValidImageMagicBytes(pngHeader, '.jpg'), false);

  const jpgHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(isValidImageMagicBytes(jpgHeader, '.jpg'), true);
  assert.equal(isValidImageMagicBytes(jpgHeader, '.jpeg'), true);

  const gifHeader = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
  assert.equal(isValidImageMagicBytes(gifHeader, '.gif'), true);

  const webpHeader = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(isValidImageMagicBytes(webpHeader, '.webp'), true);
});

test('Magic Bytes: Blokowanie fałszywych plików z rozszerzeniem graficznym', () => {
  const fakePng = Buffer.from('<?php echo "exploit"; ?>\n\n\n\n');
  assert.equal(isValidImageMagicBytes(fakePng, '.png'), false);

  const bashScript = Buffer.from('#!/bin/bash\nrm -rf /\n\n\n');
  assert.equal(isValidImageMagicBytes(bashScript, '.jpg'), false);
});

test('SSRF: Blokowanie adresów pętli zwrotnej, sieci prywatnych i instancji chmurowych', () => {
  assert.equal(isBlockedSsrfHost('localhost'), true);
  assert.equal(isBlockedSsrfHost('127.0.0.1'), true);
  assert.equal(isBlockedSsrfHost('192.168.1.100'), true);
  assert.equal(isBlockedSsrfHost('10.200.0.1'), true);
  assert.equal(isBlockedSsrfHost('172.20.0.5'), true);
  assert.equal(isBlockedSsrfHost('169.254.169.254'), true);
  assert.equal(isBlockedSsrfHost('server.internal'), true);

  // Adresy publiczne dozwolone
  assert.equal(isBlockedSsrfHost('niebezpiecznik.pl'), false);
  assert.equal(isBlockedSsrfHost('github.com'), false);
  assert.equal(isBlockedSsrfHost('1.1.1.1'), false);
});

test('Path Traversal: Uniemożliwienie wyjścia poza katalog bazowy docs/', () => {
  const baseDir = path.resolve('docs');

  // Próba ataku przez categoryRel
  const test1 = sanitizeRelativePath('../../../etc', 'passwd.md', baseDir);
  assert.equal(test1.isSafe, true);
  assert.equal(test1.fullFilePath.startsWith(baseDir), true);
  assert.match(test1.fullFilePath, /[\\\/]__[\\\/]__[\\\/]__[\\\/]etc/);

  // Próba ataku przez filename
  const test2 = sanitizeRelativePath('01_Sec', '../../root/.bashrc', baseDir);
  assert.equal(test2.isSafe, true);
  assert.equal(test2.fullFilePath.startsWith(baseDir), true);
  assert.equal(test2.fullFilePath.includes('..'), false);
});

test('Path Traversal: Ścisła weryfikacja granic katalogu docs/ oraz blokowanie katalogów siostrzanych', () => {
  const baseDir = path.resolve('docs');

  // Bezpieczne ścieżki wewnątrz docs
  assert.equal(isPathInsideDocs(path.join(baseDir, 'test.md'), baseDir), true);
  assert.equal(isPathInsideDocs(path.join(baseDir, 'sub', 'doc.md'), baseDir), true);
  assert.equal(isPathInsideDocs(baseDir, baseDir), true);

  // Próby wyjścia w górę (traversal)
  assert.equal(isPathInsideDocs(path.resolve(baseDir, '../server.mjs'), baseDir), false);
  assert.equal(isPathInsideDocs(path.resolve(baseDir, '../../etc/passwd'), baseDir), false);

  // Próba ataku przez katalog siostrzany o wspólnej nazwie początkowej (np. docs_secret, docs-private)
  const siblingDir = baseDir + '_secret';
  const siblingFile = path.join(siblingDir, 'passwords.txt');
  assert.equal(siblingFile.startsWith(baseDir), true); // Podatny check startsWith zwróciłby true
  assert.equal(isPathInsideDocs(siblingFile, baseDir), false); // Utwardzona weryfikacja isPathInsideDocs bezpiecznie blokuje dostęp
});

test('XSS Sanitization: Poprawne kodowanie encji HTML', () => {
  const malicious = '<script>alert("XSS")</script>&<img src=x onerror=\'alert(1)\'>';
  const clean = escapeHtml(malicious);

  assert.equal(clean.includes('<script>'), false);
  assert.equal(clean.includes('onerror='), true); // Tekst zachowany, ale tagi unieszkodliwione
  assert.equal(clean.includes('&lt;script&gt;'), true);
  assert.equal(clean.includes('&quot;XSS&quot;'), true);
  assert.equal(clean.includes('&#039;alert(1)&#039;'), true);
});

test('ReDoS Mitygacja: Bezpieczne eskapowanie znaków specjalnych RegExp', () => {
  const problematicQuery = 'test(regex)[*+?\\';
  const escaped = problematicQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Tworzenie RegExp nie powinno rzucić wyjątku SyntaxError
  assert.doesNotThrow(() => {
    new RegExp(escaped, 'gi');
  });
});

test('Playbooks: Poprawność struktury i sanityzacja danych procedur wieloetapowych', () => {
  const mockPlaybook = {
    id: 'pb_test',
    title: '<script>alert(1)</script>Procedura',
    category: 'Cyberbezpieczeństwo',
    stages: [
      {
        id: 'st_1',
        title: 'Etap 1: Rekonesans',
        tasks: [
          { id: 'tsk_1', title: 'Zadanie <b>pogrubione</b>', done: false }
        ]
      }
    ]
  };

  const safeTitle = escapeHtml(mockPlaybook.title);
  assert.equal(safeTitle.includes('<script>'), false);
  assert.equal(safeTitle.includes('&lt;script&gt;'), true);

  const safeTaskTitle = escapeHtml(mockPlaybook.stages[0].tasks[0].title);
  assert.equal(safeTaskTitle.includes('<b>'), false);
  assert.equal(safeTaskTitle.includes('&lt;b&gt;'), true);
});

test('Nawigacja: Sortowanie dwuetapowe (pliki .md zawsze przed podfolderami, numery 01, 02, 03 zachowane)', () => {
  const mockItems = [
    { type: 'directory', title: 'Konfiguracja Klastra', relPath: '04_Proxmox/02_Konfiguracja_Klastra' },
    { type: 'file', title: 'Podsumowanie', relPath: '04_Proxmox/05_Podsumowanie.md' },
    { type: 'directory', title: 'Instalacja Wezlow', relPath: '04_Proxmox/01_Instalacja_Wezlow' },
    { type: 'file', title: 'Wstep Teoretyczny', relPath: '04_Proxmox/01_Wstep_Teoretyczny.md' },
    { type: 'file', title: 'Wymagania Sprzetowe', relPath: '04_Proxmox/03_Wymagania_Sprzetowe.md' }
  ];

  function sortItemsFilesFirst(list) {
    return [...list].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'file' ? -1 : 1;
      }
      const nameA = a.relPath ? a.relPath.split('/').pop() : (a.title || '');
      const nameB = b.relPath ? b.relPath.split('/').pop() : (b.title || '');
      return nameA.localeCompare(nameB, 'pl', { numeric: true });
    });
  }

  const sorted = sortItemsFilesFirst(mockItems);

  // Pliki Markdown na początku, ściśle według numeracji fizycznej 01, 03, 05
  assert.equal(sorted[0].type, 'file');
  assert.equal(sorted[0].relPath, '04_Proxmox/01_Wstep_Teoretyczny.md');
  assert.equal(sorted[1].type, 'file');
  assert.equal(sorted[1].relPath, '04_Proxmox/03_Wymagania_Sprzetowe.md');
  assert.equal(sorted[2].type, 'file');
  assert.equal(sorted[2].relPath, '04_Proxmox/05_Podsumowanie.md');

  // Podfoldery na końcu, również ściśle według numeracji 01, 02
  assert.equal(sorted[3].type, 'directory');
  assert.equal(sorted[3].relPath, '04_Proxmox/01_Instalacja_Wezlow');
  assert.equal(sorted[4].type, 'directory');
  assert.equal(sorted[4].relPath, '04_Proxmox/02_Konfiguracja_Klastra');
});

test('Folder Deletion Security: Ochrona przed usunięciem docs/, .trash i Path Traversal', () => {
  const docsBase = path.resolve('docs');
  const trashBase = path.join(docsBase, '.trash');

  function validateFolderDeletionPath(relPath) {
    if (!relPath || typeof relPath !== 'string') return { valid: false, error: 'Brak parametru' };
    const decodedRel = decodeURIComponent(relPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const parts = decodedRel.split('/').map(p => p.trim()).filter(Boolean);

    if (parts.length === 0 || parts.some(p => p === '..' || p === '.' || p.includes('\0'))) {
      return { valid: false, error: 'Nieprawidłowa ścieżka' };
    }

    const targetPath = path.resolve(docsBase, ...parts);
    if (!isPathInsideDocs(targetPath, docsBase)) {
      return { valid: false, error: 'Ścieżka poza docs' };
    }
    if (targetPath === docsBase) {
      return { valid: false, error: 'Nie można usunąć katalogu głównego' };
    }
    if (targetPath === trashBase || targetPath.startsWith(trashBase + path.sep)) {
      return { valid: false, error: 'Nie można usunąć kosza systemowego' };
    }

    return { valid: true, targetPath };
  }

  // Próby zniszczenia korzenia bazy wiedzy
  assert.equal(validateFolderDeletionPath('').valid, false);
  assert.equal(validateFolderDeletionPath('.').valid, false);
  assert.equal(validateFolderDeletionPath('/').valid, false);
  assert.equal(validateFolderDeletionPath('..').valid, false);

  // Próby wyjścia Path Traversal
  assert.equal(validateFolderDeletionPath('../../etc').valid, false);
  assert.equal(validateFolderDeletionPath('01_Sec/../../../var').valid, false);

  // Próba usunięcia kosza
  assert.equal(validateFolderDeletionPath('.trash').valid, false);
  assert.equal(validateFolderDeletionPath('.trash/subdir').valid, false);

  // Prawidłowy folder do usunięcia
  const validRes = validateFolderDeletionPath('04_Proxmox/01_Proxmox_VE/99_Studium_przypadku');
  assert.equal(validRes.valid, true);
  assert.equal(validRes.targetPath.startsWith(docsBase), true);
});

test('Folder Moving Security: Ochrona przed cyklami (folder do podfolderu), Path Traversal i ucieczką z docs/', () => {
  const docsBase = path.resolve('docs');
  const trashBase = path.join(docsBase, '.trash');

  function validateFolderMove(sourceRel, targetParentRel, newFolderName) {
    if (!sourceRel || typeof sourceRel !== 'string') return { valid: false, error: 'Brak sourceRel' };
    const decodedSource = decodeURIComponent(sourceRel).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const sourceParts = decodedSource.split('/').map(p => p.trim()).filter(Boolean);

    if (sourceParts.length === 0 || sourceParts.some(p => p === '..' || p === '.' || p.includes('\0') || /[<>:"|?*]/.test(p))) {
      return { valid: false, error: 'Nieprawidłowa ścieżka źródłowa' };
    }

    const sourcePath = path.resolve(docsBase, ...sourceParts);
    if (!isPathInsideDocs(sourcePath, docsBase)) return { valid: false, error: 'Źródło poza docs' };
    if (sourcePath === docsBase) return { valid: false, error: 'Nie można przenieść głównego katalogu' };
    if (sourcePath === trashBase || sourcePath.startsWith(trashBase + path.sep)) {
      return { valid: false, error: 'Nie można manipulować koszem' };
    }

    const decodedTargetParent = (targetParentRel ? decodeURIComponent(targetParentRel) : '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    let targetParentParts = [];
    if (decodedTargetParent.length > 0) {
      targetParentParts = decodedTargetParent.split('/').map(p => p.trim()).filter(Boolean);
      if (targetParentParts.some(p => p === '..' || p === '.' || p.includes('\0') || /[<>:"|?*]/.test(p))) {
        return { valid: false, error: 'Nieprawidłowy cel nadrzędny' };
      }
    }

    const targetParentPath = path.resolve(docsBase, ...targetParentParts);
    if (!isPathInsideDocs(targetParentPath, docsBase)) return { valid: false, error: 'Cel poza docs' };
    if (targetParentPath === trashBase || targetParentPath.startsWith(trashBase + path.sep)) {
      return { valid: false, error: 'Cel w koszu' };
    }

    let finalFolderName = (newFolderName && typeof newFolderName === 'string' ? decodeURIComponent(newFolderName) : '').trim();
    finalFolderName = finalFolderName.replace(/[<>:"|?*\x00/\\]/g, '_').trim();
    if (!finalFolderName || finalFolderName === '.' || finalFolderName === '..') {
      finalFolderName = path.basename(sourcePath);
    }

    const targetPath = path.resolve(targetParentPath, finalFolderName);
    if (!isPathInsideDocs(targetPath, docsBase)) return { valid: false, error: 'Ścieżka końcowa poza docs' };

    // Anti-cycle
    if (targetPath === sourcePath || targetPath.startsWith(sourcePath + path.sep) || targetParentPath === sourcePath || targetParentPath.startsWith(sourcePath + path.sep)) {
      return { valid: false, error: 'Próba przeniesienia do samego siebie lub podkatalogu' };
    }

    // Brak zmiany
    if (sourcePath === targetPath) return { valid: false, error: 'Brak zmiany lokalizacji' };

    return { valid: true, sourcePath, targetPath };
  }

  // Próby cykli / samozagnieżdżenia
  assert.equal(validateFolderMove('01_Sec/01_SOC', '01_Sec/01_SOC').valid, false);
  assert.equal(validateFolderMove('01_Sec/01_SOC', '01_Sec/01_SOC/subfolder').valid, false);
  assert.equal(validateFolderMove('01_Sec/01_SOC', '01_Sec/01_SOC/sub1/sub2').valid, false);

  // Próby wyjścia Path Traversal
  assert.equal(validateFolderMove('../../etc', '01_Sec').valid, false);
  assert.equal(validateFolderMove('01_Sec', '../../etc').valid, false);
  assert.equal(validateFolderMove('01_Sec/../../../var', '01_Sec').valid, false);

  // Próby manipulacji korzeniem i koszem
  assert.equal(validateFolderMove('', '01_Sec').valid, false);
  assert.equal(validateFolderMove('.', '01_Sec').valid, false);
  assert.equal(validateFolderMove('.trash', '01_Sec').valid, false);
  assert.equal(validateFolderMove('01_Sec/01_SOC', '.trash').valid, false);

  // Prawidłowe przeniesienie
  const validMove = validateFolderMove('04_Procedury/01_Katalog', '01_Sec', '01_Katalog');
  assert.equal(validMove.valid, true);
  assert.equal(validMove.targetPath, path.join(docsBase, '01_Sec', '01_Katalog'));
});

test('Tagi Frontmatter: Ekstrakcja i normalizacja tagów YAML z plików Markdown', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowops-tags-test-'));

  try {
    const file1 = path.join(tmpDir, 'file1.md');
    fs.writeFileSync(file1, `---
title: SOC Alerting
tags: [CyberSec, "incident-response", SIEM]
---
# Treść artykułu
`);

    const file2 = path.join(tmpDir, 'file2.md');
    fs.writeFileSync(file2, `---
title: Linux Hardening
tags:
  - Linux
  - CIS-Benchmark
  - DevSecOps
---
# Hardening
`);

    const file3 = path.join(tmpDir, 'file3.md');
    fs.writeFileSync(file3, `---
title: Proxmox Setup
tags: proxmox, virtualisation, homelab
---
# Proxmox VE
`);

    const file4 = path.join(tmpDir, 'file4.md');
    fs.writeFileSync(file4, `# Zwykły dokument bez frontmattera`);

    const tags1 = extractMarkdownTags(file1);
    assert.deepEqual(tags1.sort(), ['cybersec', 'incident-response', 'siem']);

    const tags2 = extractMarkdownTags(file2);
    assert.deepEqual(tags2.sort(), ['cis-benchmark', 'devsecops', 'linux']);

    const tags3 = extractMarkdownTags(file3);
    assert.deepEqual(tags3.sort(), ['homelab', 'proxmox', 'virtualisation']);

    const tags4 = extractMarkdownTags(file4);
    assert.deepEqual(tags4, []);

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Orphaned Images Security: Wykrywanie osieroconych grafik i mitygacja Path Traversal przy usuwaniu', () => {
  const imagesBase = path.resolve('public', 'images');

  // 1. Ekstrakcja referencji do obrazów z Markdown
  const sampleMd = `
  # Testowy dokument
  Oto diagram architektury: ![Architektura](/public/images/arch_v1.png)
  Oto zrzut ekranu: ![Screen](screen_shot.jpg)
  Oraz znacznik HTML: <img src="icons/badge.svg" alt="badge">
  Plik niebędący grafiką: [Dokument](manual.pdf)
  `;

  const matches = sampleMd.match(/[\w\-./\\]+\.(?:png|jpe?g|gif|webp|svg)/gi) || [];
  const referenced = new Set(matches.map(m => path.basename(m.replace(/\\/g, '/'))));

  assert.equal(referenced.has('arch_v1.png'), true);
  assert.equal(referenced.has('screen_shot.jpg'), true);
  assert.equal(referenced.has('badge.svg'), true);
  assert.equal(referenced.has('manual.pdf'), false);

  // 2. Walidator bezpieczeństwa usuwania osieroconych plików
  function validateOrphanedImageDeletion(rawName, baseDir) {
    if (typeof rawName !== 'string') return { valid: false, error: 'Błędny typ danych' };
    const sanitized = path.basename(rawName).trim();
    if (!sanitized || sanitized === '.' || sanitized === '..' || sanitized.includes('\0')) {
      return { valid: false, error: 'Niebezpieczna nazwa' };
    }
    const resolvedPath = path.resolve(baseDir, sanitized);
    if (!isPathInsideDocs(resolvedPath, baseDir)) {
      return { valid: false, error: 'Próba wyjścia poza katalog' };
    }
    return { valid: true, sanitized, resolvedPath };
  }

  // Próby ataku Path Traversal
  assert.equal(validateOrphanedImageDeletion('../../../etc/shadow', imagesBase).valid, true);
  assert.equal(validateOrphanedImageDeletion('../../../etc/shadow', imagesBase).sanitized, 'shadow');
  assert.equal(validateOrphanedImageDeletion('..', imagesBase).valid, false);
  assert.equal(validateOrphanedImageDeletion('.', imagesBase).valid, false);
  assert.equal(validateOrphanedImageDeletion('img\0.png', imagesBase).valid, false);

  // Prawidłowa grafika
  const validCheck = validateOrphanedImageDeletion('orphaned_diagram.png', imagesBase);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.resolvedPath, path.join(imagesBase, 'orphaned_diagram.png'));
});

test('Backup ZIP Engine: Weryfikacja integralności archiwizacji bazy wiedzy', () => {
  const result = exportWikiZip();
  assert.equal(result.success, true);
  assert.equal(typeof result.filename, 'string');
  assert.equal(result.filename.startsWith('knowops_wiki_backup_'), true);
  assert.equal(result.filename.endsWith('.zip'), true);
  assert.equal(fs.existsSync(result.path), true);

  const stat = fs.statSync(result.path);
  assert.equal(stat.size > 0, true);

  // Sprzątanie po teście jednostkowym
  try {
    fs.unlinkSync(result.path);
  } catch (e) {}
});
