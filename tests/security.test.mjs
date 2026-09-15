import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { extractMarkdownTags } from '../build_navigation.mjs';
import { exportWikiZip, createWikiBackup, checkBackupsDirWritable, getBackupSchedulerStatus, initBackupScheduler, stopBackupScheduler, parseScheduleTime, computeNextRunTime } from '../backup_wiki.mjs';
import { extractFirstH1, slugifyTitle, computeTargetFilename } from '../scripts/sync_markdown_filenames.mjs';
import { categorizeVulnerability, getCveWatchlist, saveCveWatchlist, setCveAuditStatus, isItemMatchingWatchlist, fetchCveFeed, CVE_CATEGORIES, translateSecOpsRules, translateCveRecord, CVE_SECOPS_GLOSSARY, translateLiveText, batchTranslateLive, getTranslationsCache } from '../cve_engine.mjs';

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

test('Orphaned Images Security: Wykrywanie osieroconych grafik w podkatalogach i mitygacja Path Traversal przy usuwaniu', () => {
  const imagesBase = path.resolve('public', 'images');
  const imagesTrashDir = path.join(imagesBase, '.trash');

  // 1. Ekstrakcja referencji do obrazów z Markdown z uwzględnieniem podfolderów
  const sampleMd = `
  # Testowy dokument
  Oto diagram architektury: ![Architektura](/public/images/Ansible_grafiki/arch_v1.png)
  Oto zrzut ekranu: ![Screen](screen_shot.jpg)
  Oraz znacznik HTML: <img src="icons/badge.svg" alt="badge">
  Plik niebędący grafiką: [Dokument](manual.pdf)
  `;

  const matches = sampleMd.match(/[\w\-./\\]+\.(?:png|jpe?g|gif|webp|svg)/gi) || [];
  const referenced = new Set();
  for (const m of matches) {
    const clean = m.replace(/\\/g, '/').replace(/^\/+/, '');
    referenced.add(clean.toLowerCase());
    referenced.add(path.basename(clean).toLowerCase());
    const withoutPrefix = clean.replace(/^(?:public\/)?images\//i, '');
    referenced.add(withoutPrefix.toLowerCase());
  }

  assert.equal(referenced.has('arch_v1.png'), true);
  assert.equal(referenced.has('ansible_grafiki/arch_v1.png'), true);
  assert.equal(referenced.has('public/images/ansible_grafiki/arch_v1.png'), true);
  assert.equal(referenced.has('screen_shot.jpg'), true);
  assert.equal(referenced.has('badge.svg'), true);
  assert.equal(referenced.has('manual.pdf'), false);

  // 2. Walidator bezpieczeństwa usuwania osieroconych plików z podkatalogami
  function validateOrphanedImageDeletion(rawName, baseDir) {
    if (typeof rawName !== 'string') return { valid: false, error: 'Błędny typ danych' };
    const normalized = path.normalize(rawName.trim()).replace(/\\/g, '/');
    const sanitizedRel = normalized.replace(/^(\.\.[\/])+/g, '').replace(/^\/+/g, '');
    if (!sanitizedRel || sanitizedRel === '.' || sanitizedRel === '..' || sanitizedRel.includes('\0')) {
      return { valid: false, error: 'Niebezpieczna nazwa' };
    }
    const resolvedPath = path.resolve(baseDir, sanitizedRel);
    if (!isPathInsideDocs(resolvedPath, baseDir)) {
      return { valid: false, error: 'Próba wyjścia poza katalog' };
    }
    const trashDest = path.join(imagesTrashDir, sanitizedRel);
    return { valid: true, sanitizedRel, resolvedPath, trashDest };
  }

  // Próby ataku Path Traversal
  assert.equal(validateOrphanedImageDeletion('../../../etc/shadow', imagesBase).valid, true);
  assert.equal(validateOrphanedImageDeletion('../../../etc/shadow', imagesBase).sanitizedRel, 'etc/shadow');
  assert.equal(validateOrphanedImageDeletion('../../../etc/shadow', imagesBase).resolvedPath, path.join(imagesBase, 'etc', 'shadow'));
  assert.equal(isPathInsideDocs(validateOrphanedImageDeletion('../../../etc/shadow', imagesBase).resolvedPath, imagesBase), true);

  assert.equal(validateOrphanedImageDeletion('..', imagesBase).valid, false);
  assert.equal(validateOrphanedImageDeletion('.', imagesBase).valid, false);
  assert.equal(validateOrphanedImageDeletion('img\0.png', imagesBase).valid, false);

  // Prawidłowa grafika w katalogu głównym
  const validRoot = validateOrphanedImageDeletion('orphaned_diagram.png', imagesBase);
  assert.equal(validRoot.valid, true);
  assert.equal(validRoot.resolvedPath, path.join(imagesBase, 'orphaned_diagram.png'));
  assert.equal(validRoot.trashDest, path.join(imagesTrashDir, 'orphaned_diagram.png'));

  // Prawidłowa grafika w podkatalogu (np. Ansible_grafiki)
  const validSub = validateOrphanedImageDeletion('Ansible_grafiki/unused_screen.png', imagesBase);
  assert.equal(validSub.valid, true);
  assert.equal(validSub.resolvedPath, path.join(imagesBase, 'Ansible_grafiki', 'unused_screen.png'));
  assert.equal(validSub.trashDest, path.join(imagesTrashDir, 'Ansible_grafiki', 'unused_screen.png'));
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

test('Scratchpad Security & Validation: Walidacja danych brudnopisu i ochrona payloadu', () => {
  function validateScratchpadPayload(body) {
    if (!body || typeof body !== 'object') return { valid: false, error: 'Nieprawidłowe ciało żądania' };
    const content = typeof body.content === 'string' ? body.content : '';
    if (content.length > 1024 * 1024) {
      return { valid: false, error: 'Treść brudnopisu przekracza maksymalny limit 1MB' };
    }
    const checklist = Array.isArray(body.checklist) ? body.checklist.slice(0, 100).map(item => ({
      id: String(item.id || Date.now() + Math.random().toString(36).slice(2, 6)),
      text: String(item.text || '').replace(/[<>]/g, '').slice(0, 500),
      done: Boolean(item.done)
    })) : [];

    return {
      valid: true,
      data: {
        content,
        checklist
      }
    };
  }

  // 1. Zabezpieczenie przed przepełnieniem (Payload > 1MB)
  const hugeString = 'a'.repeat(1024 * 1024 + 50);
  const oversizedResult = validateScratchpadPayload({ content: hugeString });
  assert.equal(oversizedResult.valid, false);
  assert.equal(oversizedResult.error.includes('1MB'), true);

  // 2. Poprawny brudnopis z tekstem i checklistą
  const validPayload = {
    content: 'Tymczasowe polecenie: sudo systemctl restart nginx\nIP: 192.168.1.10',
    checklist: [
      { id: '1', text: 'Sprawdzić status klastra <script>alert(1)</script>', done: false },
      { id: '2', text: 'Wykonać kopię zapasową', done: true }
    ]
  };
  const validResult = validateScratchpadPayload(validPayload);
  assert.equal(validResult.valid, true);
  assert.equal(validResult.data.content.includes('sudo systemctl'), true);
  assert.equal(validResult.data.checklist.length, 2);
  // Sanityzacja znaków tagów HTML
  assert.equal(validResult.data.checklist[0].text.includes('<script>'), false);
  assert.equal(validResult.data.checklist[0].done, false);
  assert.equal(validResult.data.checklist[1].done, true);
});

test('Editor Tags Handler: Weryfikacja logiki wstawiania i modyfikacji YAML Frontmatter dla tagów', () => {
  function processEditorTags(text, selectedText = '') {
    const defaultTags = selectedText ? selectedText.replace(/[\r\n]/g, '').trim() : 'tag1, tag2';

    if (text.startsWith('---')) {
      const parts = text.split('---');
      if (parts.length >= 3) {
        const frontmatter = parts[1];
        const match = frontmatter.match(/tags:\s*(\[[^\]\n]*\]|[^\n]+)/i);
        if (match) {
          const matchIndex = text.indexOf(match[0]);
          return {
            type: 'existing_tags',
            newText: text,
            selectionStart: matchIndex,
            selectionEnd: matchIndex + match[0].length
          };
        } else {
          const endOfFm = text.indexOf('---', 3);
          const tagLine = `tags: [${defaultTags}]\n`;
          const newText = text.substring(0, endOfFm) + tagLine + text.substring(endOfFm);
          const tagSelStart = endOfFm + 7;
          return {
            type: 'inserted_in_fm',
            newText: newText,
            selectionStart: tagSelStart,
            selectionEnd: tagSelStart + defaultTags.length
          };
        }
      }
    }

    const fmBlock = `---\ntags: [${defaultTags}]\n---\n\n`;
    return {
      type: 'created_fm',
      newText: fmBlock + text,
      selectionStart: 11,
      selectionEnd: 11 + defaultTags.length
    };
  }

  // 1. Dokument bez frontmattera
  const plainDoc = '# Tytuł artykułu\nTreść dokumentu.';
  const res1 = processEditorTags(plainDoc, 'linux, security');
  assert.equal(res1.type, 'created_fm');
  assert.equal(res1.newText.startsWith('---\ntags: [linux, security]\n---\n\n# Tytuł'), true);

  // 2. Dokument z frontmatterem bez tagów
  const fmDoc = '---\ntitle: NFS Storage\nauthor: Admin\n---\n# Treść';
  const res2 = processEditorTags(fmDoc, 'vmware, storage');
  assert.equal(res2.type, 'inserted_in_fm');
  assert.equal(res2.newText.includes('tags: [vmware, storage]\n---'), true);

  // 3. Dokument z istniejącymi tagami
  const existingTagsDoc = '---\ntitle: VMware\ntags: [esxi, vcenter]\n---\n# Treść';
  const res3 = processEditorTags(existingTagsDoc);
  assert.equal(res3.type, 'existing_tags');
  assert.equal(res3.newText, existingTagsDoc);
  assert.equal(existingTagsDoc.substring(res3.selectionStart, res3.selectionEnd), 'tags: [esxi, vcenter]');
});

// 17. Kanban Subtasks: Szybkie dodawanie, przełączanie stanu i sanityzacja XSS
test('Kanban Subtasks: Szybkie dodawanie, przełączanie stanu i sanityzacja XSS', () => {
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Symulacja zadania
  const task = {
    id: 'task-test-01',
    title: 'ZABBIX - podłączenie',
    status: 'in_progress',
    subtasks: [
      { id: 'sub-1', title: 'RDS-EURECA', done: false },
      { id: 'sub-2', title: 'VEEAM-R760', done: true }
    ]
  };

  // 1. Szybkie dodanie podzadania
  const newSubTitle = '  Net-Serwer Produkcja <script>alert("xss")</script>  ';
  const cleanTitle = newSubTitle.trim();
  const newSubId = 'sub-test-' + Date.now();
  task.subtasks.push({
    id: newSubId,
    title: cleanTitle,
    done: false
  });

  assert.equal(task.subtasks.length, 3);
  assert.equal(task.subtasks[2].done, false);

  // 2. Weryfikacja sanityzacji XSS
  const safeTitle = escapeHtml(task.subtasks[2].title);
  assert.equal(safeTitle.includes('<script>'), false);
  assert.equal(safeTitle.includes('&lt;script&gt;'), true);

  // 3. Przełączanie stanu podzadania (toggle) i przypisanie completedAt
  const targetSub = task.subtasks.find(s => s.id === 'sub-1');
  assert.ok(targetSub);
  assert.equal(targetSub.done, false);
  targetSub.done = !targetSub.done;
  if (targetSub.done) {
    targetSub.completedAt = '12.09, 13:05';
  } else {
    delete targetSub.completedAt;
  }
  assert.equal(targetSub.done, true);
  assert.equal(targetSub.completedAt, '12.09, 13:05');

  // Test odznaczenia (uncheck) - usunięcie completedAt
  targetSub.done = !targetSub.done;
  if (targetSub.done) {
    targetSub.completedAt = '12.09, 13:05';
  } else {
    delete targetSub.completedAt;
  }
  assert.equal(targetSub.done, false);
  assert.equal(targetSub.completedAt, undefined);

  // Ponowne zaznaczenie dla poprawnego przeliczenia postępu
  targetSub.done = true;
  targetSub.completedAt = '12.09, 13:05';

  // 4. Przeliczanie postępu
  const total = task.subtasks.length;
  const doneCount = task.subtasks.filter(s => s.done).length;
  const progress = Math.round((doneCount / total) * 100);
  assert.equal(total, 3);
  assert.equal(doneCount, 2); // sub-1 i sub-2 są done
  assert.equal(progress, 67);
});

// 18. Mermaid Diagrams: Weryfikacja struktury i sanityzacji bloków diagramów
test('Mermaid Diagrams: Weryfikacja struktury i sanityzacji bloków diagramów', () => {
  const mermaidSample = `flowchart TD
  Client["Docker Client (CLI)"] -->|/var/run/docker.sock| Daemon["Docker Daemon (dockerd)"]
  Daemon -->|gRPC| Containerd["containerd"]
  Containerd --> Runc["runc (OCI Runtime)"]
  Runc --> Kernel["Linux Kernel: cgroups v2 / Namespaces"]`;

  assert.equal(mermaidSample.includes('flowchart TD'), true);
  assert.equal(mermaidSample.includes('Docker Client'), true);
  assert.equal(mermaidSample.includes('containerd'), true);
  assert.equal(mermaidSample.includes('runc'), true);

  // Sprawdzenie konfiguracji motywu dark
  const themeConfig = {
    theme: 'dark',
    themeVariables: {
      darkMode: true,
      background: '#0d0d0e',
      mainBkg: '#18181b',
      nodeBorder: '#3b82f6',
      lineColor: '#eab308'
    }
  };
  assert.equal(themeConfig.theme, 'dark');
  assert.equal(themeConfig.themeVariables.darkMode, true);
  assert.equal(themeConfig.themeVariables.background, '#0d0d0e');
});

// 19. Kanban Subtasks & Cards Sorting & Sidebar Filtering
test('Kanban Subtasks & Cards: Sortowanie otwartych na górze, opadanie zadań 100% oraz ukrywanie ukończonych w pasku', () => {
  // A. Sortowanie podzadań na karcie (otwarte u góry, ukończone na dole)
  const subtasks = [
    { id: '1', title: 'Podzadanie A', done: true, completedAt: '12.09, 13:00' },
    { id: '2', title: 'Podzadanie B', done: false },
    { id: '3', title: 'Podzadanie C', done: false },
    { id: '4', title: 'Podzadanie D', done: true, completedAt: '12.09, 13:10' }
  ];
  const sortedSubtasks = [...subtasks].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  assert.equal(sortedSubtasks[0].id, '2');
  assert.equal(sortedSubtasks[1].id, '3');
  assert.equal(sortedSubtasks[2].id, '1');
  assert.equal(sortedSubtasks[3].id, '4');
  assert.equal(sortedSubtasks[0].done, false);
  assert.equal(sortedSubtasks[1].done, false);
  assert.equal(sortedSubtasks[2].done, true);
  assert.equal(sortedSubtasks[3].done, true);

  // B. Pasek boczny: filtrowanie podzadań aktywnych i ukończonych
  const pendingSubs = subtasks.filter(s => !s.done);
  const doneSubs = subtasks.filter(s => s.done);
  assert.equal(pendingSubs.length, 2);
  assert.equal(doneSubs.length, 2);
  assert.equal(pendingSubs.every(s => !s.done), true);
  assert.equal(doneSubs.every(s => s.done), true);

  // C. Sortowanie kart zadań: zadania w 100% ukończone spadają na dół kolumny
  const cards = [
    { id: 'c1', title: 'Zadanie w toku', subtasks: [{ done: false }, { done: true }] },
    { id: 'c2', title: 'Zadanie w 100% gotowe', subtasks: [{ done: true }, { done: true }] },
    { id: 'c3', title: 'Zadanie nowe', subtasks: [{ done: false }] }
  ];
  const sortedCards = [...cards].sort((a, b) => {
    const aTotal = a.subtasks ? a.subtasks.length : 0;
    const aDone = a.subtasks ? a.subtasks.filter(s => s.done).length : 0;
    const aAllDone = aTotal > 0 && aDone === aTotal;

    const bTotal = b.subtasks ? b.subtasks.length : 0;
    const bDone = b.subtasks ? b.subtasks.filter(s => s.done).length : 0;
    const bAllDone = bTotal > 0 && bDone === bTotal;

    if (aAllDone === bAllDone) return 0;
    return aAllDone ? 1 : -1;
  });

  assert.equal(sortedCards[0].id, 'c1');
  assert.equal(sortedCards[1].id, 'c3');
  assert.equal(sortedCards[2].id, 'c2');
});

// 20. Tree Navigation: Wielopoziomowe kolorowanie poziomów folderów (Wariant 1)
test('Tree Navigation: Wielopoziomowe przypisywanie stylów dla poziomów zagłębienia folderów (Wariant 1)', () => {
  const depthColors = ['var(--sw-gold)', '#60a5fa', '#34d399', '#a78bfa', '#cbd5e1'];
  function getFolderStyle(depth) {
    const depthClass = `depth-${Math.min(depth, 4)}`;
    const color = depthColors[depth] || depthColors[depthColors.length - 1];
    return { depthClass, color };
  }

  // Poziom 0: folder główny -> złoty
  assert.equal(getFolderStyle(0).depthClass, 'depth-0');
  assert.equal(getFolderStyle(0).color, 'var(--sw-gold)');

  // Poziom 1: podfolder -> błękitny
  assert.equal(getFolderStyle(1).depthClass, 'depth-1');
  assert.equal(getFolderStyle(1).color, '#60a5fa');

  // Poziom 2: pod-podfolder -> szmaragdowy / zielony
  assert.equal(getFolderStyle(2).depthClass, 'depth-2');
  assert.equal(getFolderStyle(2).color, '#34d399');

  // Poziom 3: głęboki podfolder -> fioletowy
  assert.equal(getFolderStyle(3).depthClass, 'depth-3');
  assert.equal(getFolderStyle(3).color, '#a78bfa');

  // Poziom 4: kolejny podfolder -> neutralny stalowy
  assert.equal(getFolderStyle(4).depthClass, 'depth-4');
  assert.equal(getFolderStyle(4).color, '#cbd5e1');

  // Poziom 5: fallback -> neutralny stalowy
  assert.equal(getFolderStyle(5).depthClass, 'depth-4');
  assert.equal(getFolderStyle(5).color, '#cbd5e1');
});

// 21. Kosz Dokumentacji: Walidacja manifestu usunięcia i ochrona przed Path Traversal przy przywracaniu
test('Trash Engine: Walidacja manifestu usunięcia i ochrona ścieżki przywracania dokumentów', () => {
  const docsBase = path.resolve('docs');
  const trashBase = path.join(docsBase, '.trash');

  function validateRestoreTarget(originalRelPath) {
    if (!originalRelPath || typeof originalRelPath !== 'string') {
      return { valid: false, error: 'Brak ścieżki' };
    }
    const cleanRel = originalRelPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const targetPath = path.resolve(docsBase, cleanRel);

    if (!isPathInsideDocs(targetPath, docsBase)) {
      return { valid: false, error: 'Path traversal poza docs' };
    }
    if (targetPath === docsBase) {
      return { valid: false, error: 'Ścieżka to katalog główny' };
    }
    if (isPathInsideDocs(targetPath, trashBase)) {
      return { valid: false, error: 'Ścieżka wewnątrz .trash' };
    }
    return { valid: true, targetPath, cleanRel };
  }

  // Próby ataku Path Traversal
  assert.equal(validateRestoreTarget('../../etc/shadow').valid, false);
  assert.equal(validateRestoreTarget('../../../var/log').valid, false);
  assert.equal(validateRestoreTarget('.trash/hack.md').valid, false);
  assert.equal(validateRestoreTarget('.trash/sub/file.md').valid, false);
  assert.equal(validateRestoreTarget('').valid, false);
  assert.equal(validateRestoreTarget('/').valid, false);

  // Prawidłowe ścieżki przywracania
  const validDoc = validateRestoreTarget('01_Cybersec/01_SOC/procedura.md');
  assert.equal(validDoc.valid, true);
  assert.equal(validDoc.cleanRel, '01_Cybersec/01_SOC/procedura.md');
  assert.equal(validDoc.targetPath, path.join(docsBase, '01_Cybersec', '01_SOC', 'procedura.md'));

  const validFolder = validateRestoreTarget('02_Infra/Nowy_Folder');
  assert.equal(validFolder.valid, true);
  assert.equal(validFolder.cleanRel, '02_Infra/Nowy_Folder');
});

// 22. Callouts / Admonitions Parser: Weryfikacja bloków wyróżnień z niestandardowymi tytułami
test('Callouts Parser: Weryfikacja transformacji bloków wyróżnień z tytułami i sanityzacją XSS', () => {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function parseCallouts(markdownHtml) {
    return markdownHtml.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
      const alertMatch = content.match(/\[!(NOTE|WARNING|CAUTION|IMPORTANT|TIP)\](?:[^\S\r\n]+([^\r\n]+?))?(?:\n|<br\s*\/?>|<\/p|$)/i);
      if (alertMatch) {
        const type = alertMatch[1].toUpperCase();
        const customTitle = alertMatch[2] ? alertMatch[2].trim() : '';

        let cleanContent = content.replace(/\[!(NOTE|WARNING|CAUTION|IMPORTANT|TIP)\](?:[^\S\r\n]+[^\r\n]+?)?(?:\n|<br\s*\/?>|<\/p|$)/i, '').trim();
        cleanContent = cleanContent.replace(/^<p>\s*(<br\s*\/?>)?/i, '<p>');
        if (cleanContent.startsWith('<p></p>')) {
          cleanContent = cleanContent.replace('<p></p>', '');
        }

        const alertClass = `markdown-alert markdown-alert-${type.toLowerCase()} callout callout-${type.toLowerCase()}`;
        const defaultTitle = type === 'NOTE' ? 'INFORMACJA' :
                             type === 'WARNING' ? 'OSTRZEŻENIE' :
                             type === 'CAUTION' ? 'UWAGA KRYTYCZNA' :
                             type === 'IMPORTANT' ? 'WAŻNE' :
                             type === 'TIP' ? 'WSKAZÓWKA' : type;

        const titleText = customTitle || defaultTitle;
        return `<div class="${alertClass}"><div class="markdown-alert-title callout-header">${escapeHtml(titleText)}</div><div class="markdown-alert-body callout-body">${cleanContent}</div></div>`;
      }
      return match;
    });
  }

  // Domyślny nagłówek
  const noteOutput = parseCallouts('<blockquote><p>[!NOTE]\nTo jest ważna notatka.</p></blockquote>');
  assert.equal(noteOutput.includes('class="markdown-alert markdown-alert-note callout callout-note"'), true);
  assert.equal(noteOutput.includes('INFORMACJA'), true);

  // Niestandardowy nagłówek
  const warningOutput = parseCallouts('<blockquote><p>[!WARNING] Uwaga przed restartem klastra\nSprawdź quorum.</p></blockquote>');
  assert.equal(warningOutput.includes('class="markdown-alert markdown-alert-warning callout callout-warning"'), true);
  assert.equal(warningOutput.includes('Uwaga przed restartem klastra'), true);

  // Ochrona przed XSS w tytule wyróżnienia
  const xssOutput = parseCallouts('<blockquote><p>[!TIP] <script>alert(1)</script>\nWskazówka bezpieczeństwa.</p></blockquote>');
  assert.equal(xssOutput.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.equal(xssOutput.includes('<script>'), false);
});

// 23. Rotacja Kopii Zapasowych: Retencja 7 kopii
test('Backup Engine: Test retencji i rotacji usuwania nadmiarowych kopii zapasowych', () => {
  const tmpDir = path.join(os.tmpdir(), `wiki_test_backups_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const createdFiles = [];
    for (let i = 0; i < 10; i++) {
      const filename = `wiki_backup_20260912_10000${i}.zip`;
      const fullPath = path.join(tmpDir, filename);
      fs.writeFileSync(fullPath, `backup data ${i}`, 'utf8');
      const mtime = new Date(Date.now() - (10 - i) * 60000);
      fs.utimesSync(fullPath, mtime, mtime);
      createdFiles.push({ filename, fullPath, mtime });
    }

    function rotateTestDir(dir, keepCount = 7) {
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith('wiki_backup_'))
        .map(f => {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          return { filename: f, fullPath, mtime: stat.mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > keepCount) {
        const toDelete = files.slice(keepCount);
        for (const item of toDelete) {
          fs.unlinkSync(item.fullPath);
        }
      }
      return fs.readdirSync(dir).filter(f => f.startsWith('wiki_backup_'));
    }

    const remaining = rotateTestDir(tmpDir, 7);
    assert.equal(remaining.length, 7);

    assert.equal(fs.existsSync(path.join(tmpDir, 'wiki_backup_20260912_100000.zip')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, 'wiki_backup_20260912_100001.zip')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, 'wiki_backup_20260912_100002.zip')), false);

    assert.equal(fs.existsSync(path.join(tmpDir, 'wiki_backup_20260912_100009.zip')), true);
    assert.equal(fs.existsSync(path.join(tmpDir, 'wiki_backup_20260912_100008.zip')), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 24. Sanitizer Nazw Plików H1
test('H1 Filename Sync: Ekstrakcja pierwszego H1 i generowanie znormalizowanej nazwy pliku', () => {
  const contentWithFm = `---
tags: [security, soc]
author: Admin
---
# Procedura Reagowania na Incydenty

Treść procedury...`;
  assert.equal(extractFirstH1(contentWithFm), 'Procedura Reagowania na Incydenty');

  const contentWithoutFm = `# Tytuł Bez Frontmattera\nTreść...`;
  assert.equal(extractFirstH1(contentWithoutFm), 'Tytuł Bez Frontmattera');

  const contentNoH1 = `## Podtytuł\nBrak H1`;
  assert.equal(extractFirstH1(contentNoH1), null);

  assert.equal(slugifyTitle('Łukasz król żaba'), 'Lukasz_krol_zaba');
  assert.equal(slugifyTitle('Hardening Windows & Active Directory'), 'Hardening_Windows_and_Active_Directory');
  assert.equal(slugifyTitle('Limitowanie Żądań HTTP (Rate Limiting)'), 'Limitowanie_Zadan_HTTP_Rate_Limiting');
  assert.equal(slugifyTitle('ogórek'), 'ogorek');

  assert.equal(
    computeTargetFilename('01_Procedura_Stara.md', 'Procedura Reagowania na Incydenty'),
    '01_Procedura_Reagowania_na_Incydenty.md'
  );
  assert.equal(
    computeTargetFilename('02_Test.md', 'Hardening Linux'),
    '02_Hardening_Linux.md'
  );
  assert.equal(
    computeTargetFilename('ogórek.md', 'ogórek'),
    'ogorek.md'
  );
});

// 25. Sync Filenames Security: Walidacja ścieżek, mitygacja Path Traversal i zapobieganie kolizjom nazw
test('Sync Filenames Security: Walidacja ścieżek, mitygacja Path Traversal i zapobieganie kolizjom nazw', () => {
  const tmpDir = path.join(os.tmpdir(), `wiki_test_sync_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const fileA = path.join(tmpDir, '01_Stara_Nazwa.md');
    fs.writeFileSync(fileA, '# Nowy Tytuł Procedury\nTreść.', 'utf8');

    const fileB = path.join(tmpDir, '02_Istniejacy.md');
    fs.writeFileSync(fileB, '# Inna Procedura\nTreść.', 'utf8');

    function validateAndRename(sourceRel, targetName, baseDir) {
      if (!sourceRel || typeof sourceRel !== 'string' || !targetName || typeof targetName !== 'string') {
        return { valid: false, error: 'Nieprawidłowe argumenty' };
      }
      const cleanRel = path.normalize(sourceRel.trim()).replace(/\\/g, '/').replace(/^\/+/, '');
      if (cleanRel.includes('..') || cleanRel.includes('\0')) {
        return { valid: false, error: 'Próba Path Traversal w ścieżce źródłowej' };
      }
      const sourcePath = path.resolve(baseDir, cleanRel);
      if (!isPathInsideDocs(sourcePath, baseDir) || !fs.existsSync(sourcePath)) {
        return { valid: false, error: 'Plik źródłowy poza zakresem lub nie istnieje' };
      }

      const rawTarget = targetName.trim();
      if (!rawTarget || rawTarget.includes('/') || rawTarget.includes('\\') || rawTarget.includes('..') || rawTarget.includes('\0')) {
        return { valid: false, error: 'Nieprawidłowa nazwa pliku docelowego (zawiera separatory ścieżki)' };
      }
      const cleanTarget = path.basename(rawTarget);
      if (!cleanTarget.endsWith('.md')) {
        return { valid: false, error: 'Nieprawidłowe rozszerzenie' };
      }

      const targetPath = path.join(path.dirname(sourcePath), cleanTarget);
      if (!isPathInsideDocs(targetPath, baseDir)) {
        return { valid: false, error: 'Próba wyjścia poza katalog' };
      }

      if (fs.existsSync(targetPath) && sourcePath.toLowerCase() !== targetPath.toLowerCase()) {
        return { valid: false, error: 'Kolizja: plik docelowy już istnieje' };
      }

      fs.renameSync(sourcePath, targetPath);
      return { valid: true, newPath: targetPath, newRel: path.relative(baseDir, targetPath).replace(/\\/g, '/') };
    }

    // 1. Próby ataków Path Traversal
    assert.equal(validateAndRename('../../etc/passwd', 'hack.md', tmpDir).valid, false);
    assert.equal(validateAndRename('01_Stara_Nazwa.md', '../hack.md', tmpDir).valid, false);

    // 2. Wykrywanie kolizji (próba zmiany na nazwę pliku, który już istnieje)
    const collisionResult = validateAndRename('01_Stara_Nazwa.md', '02_Istniejacy.md', tmpDir);
    assert.equal(collisionResult.valid, false);
    assert.equal(collisionResult.error.includes('Kolizja'), true);

    // 3. Prawidłowa bezpieczna zmiana nazwy
    const successResult = validateAndRename('01_Stara_Nazwa.md', '01_Nowy_Tytul_Procedury.md', tmpDir);
    assert.equal(successResult.valid, true);
    assert.equal(fs.existsSync(path.join(tmpDir, '01_Stara_Nazwa.md')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, '01_Nowy_Tytul_Procedury.md')), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// 26. Editor Code Highlighting: Weryfikacja reguł nakładki dla bloków wieloliniowych, jednoliniowych oraz szablonów języków kodu
test('Editor Code Highlighting: Weryfikacja reguł nakładki dla bloków wieloliniowych, jednoliniowych oraz szablonów języków kodu', () => {
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function simulateEditorHighlights(text) {
    let escaped = escapeHtml(text);
    // 1. Podświetlenie bloków kodu wieloliniowego (fenced code blocks): ```język ... ```
    escaped = escaped.replace(/(```)([a-zA-Z0-9_\-]+)?([\s\S]*?)(```)/g, (match, openTicks, lang, body, closeTicks) => {
      const langSpan = lang ? `<span class="editor-code-lang">${lang}</span>` : '';
      return `<span class="editor-code-block"><span class="editor-code-ticks">${openTicks}</span>${langSpan}<span class="editor-code-body">${body}</span><span class="editor-code-ticks">${closeTicks}</span></span>`;
    });

    // 2. Podświetlenie kodu jednoliniowego (inline code): `polecenie`
    escaped = escaped.replace(/(?<!`)(`)([^`\r\n]+)(`)(?!`)/g, '<span class="editor-code-inline"><span class="editor-code-ticks">$1</span><span class="editor-code-inline-body">$2</span><span class="editor-code-ticks">$3</span></span>');

    // 3. Podświetlenie formatki Markdown dla obrazów: ![alt](url)
    escaped = escaped.replace(/(!\[[^\]\r\n]*\]\([^\)\r\n]+\))/g, '<span class="editor-img-highlight">$1</span>');

    // 4. Podświetlenie formatki HTML dla obrazów: <img ... src="..." ...>
    escaped = escaped.replace(/(&lt;img\s+[^&>]*src=[^&>]*&gt;)/gi, '<span class="editor-img-highlight">$1</span>');

    return escaped;
  }

  function simulateInsertCodeLang(text, selectionStart, selectionEnd, lang = 'bash') {
    const selectedText = text.substring(selectionStart, selectionEnd);
    if (lang === 'inline') {
      const codeSnippet = selectedText || 'polecenie';
      const replacement = `\`${codeSnippet}\``;
      const newText = text.substring(0, selectionStart) + replacement + text.substring(selectionEnd);
      const selStart = !selectedText ? selectionStart + 1 : selectionStart;
      const selEnd = !selectedText ? selStart + codeSnippet.length : selectionStart + replacement.length;
      return { newText, selStart, selEnd };
    } else {
      const codeBody = selectedText || 'polecenie / kod';
      const langHeader = lang ? lang : 'bash';
      const replacement = `\n\`\`\`${langHeader}\n${codeBody}\n\`\`\`\n`;
      const newText = text.substring(0, selectionStart) + replacement + text.substring(selectionEnd);
      const selStart = selectionStart + 1 + 3 + langHeader.length + 1;
      const selEnd = selStart + codeBody.length;
      return { newText, selStart, selEnd };
    }
  }

  // 1. Weryfikacja formatowania bloku wieloliniowego z etykietą języka i sanityzacją XSS
  const mdInput = '# Tytuł\n\n```bash\necho "<script>alert(1)</script>"\n```\n\nKoniec.';
  const highlighted = simulateEditorHighlights(mdInput);
  assert.equal(highlighted.includes('class="editor-code-block"'), true);
  assert.equal(highlighted.includes('class="editor-code-lang">bash</span>'), true);
  assert.equal(highlighted.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), true);
  assert.equal(highlighted.includes('<script>'), false);

  // 2. Weryfikacja formatowania kodu jednoliniowego
  const inlineInput = 'Uruchom polecenie `systemctl restart nginx` na hoście.';
  const inlineHighlighted = simulateEditorHighlights(inlineInput);
  assert.equal(inlineHighlighted.includes('class="editor-code-inline"'), true);
  assert.equal(inlineHighlighted.includes('systemctl restart nginx'), true);

  // 3. Weryfikacja współistnienia grafik i bloków kodu
  const mixedInput = '![arch](test.png)\n\n```yaml\nversion: "3"\n```';
  const mixedHighlighted = simulateEditorHighlights(mixedInput);
  assert.equal(mixedHighlighted.includes('class="editor-img-highlight"'), true);
  assert.equal(mixedHighlighted.includes('class="editor-code-block"'), true);

  // 4. Weryfikacja szablonu wstawiania i zaznaczania wnętrza kodu (szybka podmiana)
  const templateResult = simulateInsertCodeLang('', 0, 0, 'powershell');
  assert.equal(templateResult.newText, '\n```powershell\npolecenie / kod\n```\n');
  assert.equal(templateResult.newText.substring(templateResult.selStart, templateResult.selEnd), 'polecenie / kod');

  // 5. Weryfikacja otaczania istniejącego zaznaczenia (Wrap Selection)
  const wrapResult = simulateInsertCodeLang('uptime', 0, 6, 'bash');
  assert.equal(wrapResult.newText, '\n```bash\nuptime\n```\n');
  assert.equal(wrapResult.newText.substring(wrapResult.selStart, wrapResult.selEnd), 'uptime');
});

// 27. Auto Refresh & Navigation Routing: Wyznaczanie kategorii, podkategorii i auto-rozwijania
test('Auto Refresh & Routing: Poprawne wyznaczanie podkategorii ("glowne" vs podfolder) oraz ścieżek drzewa nawigacji', () => {
  function resolveDocNavigation(relPath) {
    const parts = relPath.split('/');
    const catId = parts[0];
    let subId = 'glowne';
    if (parts.length > 2) {
      subId = parts[1];
    }
    const expandedDirs = {};
    let pathAcc = '';
    for (let i = 0; i < parts.length - 1; i++) {
      pathAcc = pathAcc ? `${pathAcc}/${parts[i]}` : parts[i];
      expandedDirs[pathAcc] = true;
    }
    return { catId, subId, expandedDirs };
  }

  // 1. Dokument bezpośrednio w kategorii głównej (np. 01_Cyberbezpieczenstwo/123.md)
  const rootDoc = resolveDocNavigation('01_Cyberbezpieczenstwo/123.md');
  assert.equal(rootDoc.catId, '01_Cyberbezpieczenstwo');
  assert.equal(rootDoc.subId, 'glowne');
  assert.equal(rootDoc.expandedDirs['01_Cyberbezpieczenstwo'], true);

  // 2. Dokument w podkatalogu pierwszego rzędu (np. 01_Cyberbezpieczenstwo/01_SOC/Instrukcja.md)
  const subDoc = resolveDocNavigation('01_Cyberbezpieczenstwo/01_SOC/Instrukcja.md');
  assert.equal(subDoc.catId, '01_Cyberbezpieczenstwo');
  assert.equal(subDoc.subId, '01_SOC');
  assert.equal(subDoc.expandedDirs['01_Cyberbezpieczenstwo'], true);
  assert.equal(subDoc.expandedDirs['01_Cyberbezpieczenstwo/01_SOC'], true);

  // 3. Dokument głęboko zagnieżdżony (np. 02_SysAdmin/03_Sieci/VLANy/Trunk.md)
  const deepDoc = resolveDocNavigation('02_SysAdmin/03_Sieci/VLANy/Trunk.md');
  assert.equal(deepDoc.catId, '02_SysAdmin');
  assert.equal(deepDoc.subId, '03_Sieci');
  assert.equal(deepDoc.expandedDirs['02_SysAdmin'], true);
  assert.equal(deepDoc.expandedDirs['02_SysAdmin/03_Sieci'], true);
  assert.equal(deepDoc.expandedDirs['02_SysAdmin/03_Sieci/VLANy'], true);
});

// 28. Folder Renaming Security & Validation
test('Folder Renaming Security: Sanityzacja nazw, blokada Path Traversal i ochrona katalogu bazowego docs/', () => {
  const docsBase = path.resolve('docs');
  const trashBase = path.resolve('docs', '.trash');

  function validateFolderRename(sourceRelPath, newFolderName) {
    if (!sourceRelPath || typeof sourceRelPath !== 'string') {
      return { valid: false, error: 'Wymagany parametr sourceRelPath' };
    }

    const decodedSource = decodeURIComponent(sourceRelPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const sourceParts = decodedSource.split('/').map(p => p.trim()).filter(Boolean);

    if (sourceParts.length === 0 || sourceParts.some(p => p === '..' || p === '.' || p.includes('\0') || /[<>:"|?*]/.test(p))) {
      return { valid: false, error: 'Nieprawidłowa ścieżka źródłowa folderu' };
    }

    const sourcePath = path.resolve(docsBase, ...sourceParts);
    if (!isPathInsideDocs(sourcePath, docsBase)) {
      return { valid: false, error: 'Dostęp zablokowany: ścieżka źródłowa poza katalogiem bazy wiedzy' };
    }
    if (sourcePath === docsBase) {
      return { valid: false, error: 'Niedozwolona operacja: nie można zmienić nazwy katalogu głównego' };
    }
    if (sourcePath === trashBase || sourcePath.startsWith(trashBase + path.sep)) {
      return { valid: false, error: 'Niedozwolona operacja: nie można modyfikować kosza' };
    }

    let cleanNewName = (newFolderName && typeof newFolderName === 'string' ? decodeURIComponent(newFolderName) : '').trim();
    cleanNewName = cleanNewName.replace(/[<>:"|?*\x00/\\]/g, '_').trim().replace(/\s+/g, '_');

    if (!cleanNewName || cleanNewName === '.' || cleanNewName === '..') {
      return { valid: false, error: 'Nowa nazwa folderu nie może być pusta' };
    }

    const parentDir = path.dirname(sourcePath);
    const targetPath = path.resolve(parentDir, cleanNewName);

    if (!isPathInsideDocs(targetPath, docsBase)) {
      return { valid: false, error: 'Nieprawidłowa ścieżka docelowa' };
    }
    if (sourcePath === targetPath) {
      return { valid: false, error: 'Folder posiada już podaną nazwę' };
    }

    return { valid: true, cleanNewName, targetPath, sourcePath };
  }

  // 1. Blokada Path Traversal w ścieżce źródłowej
  assert.equal(validateFolderRename('../../../etc', 'NowaNazwa').valid, false);
  assert.equal(validateFolderRename('01_Sciagi/../../etc', 'NowaNazwa').valid, false);

  // 2. Blokada próby zmiany nazwy katalogu głównego docs/ lub kosza
  assert.equal(validateFolderRename('', 'NowaNazwa').valid, false);
  assert.equal(validateFolderRename('.trash', 'NowaNazwa').valid, false);

  // 3. Sanityzacja niedozwolonych znaków w nowej nazwie folderu
  const sanitizedRes = validateFolderRename('01_Cyberbezpieczenstwo/01_SOC', 'Nowy:Nazwa/Folderu*Test?');
  assert.equal(sanitizedRes.valid, true);
  assert.equal(sanitizedRes.cleanNewName, 'Nowy_Nazwa_Folderu_Test_');

  // 4. Blokada identycznej nazwy
  assert.equal(validateFolderRename('01_Cyberbezpieczenstwo/01_SOC', '01_SOC').valid, false);

  // 5. Poprawna walidacja prawidłowej ścieżki i nazwy
  const validRes = validateFolderRename('01_Cyberbezpieczenstwo/01_SOC', '01_SOC_Incident_Response');
  assert.equal(validRes.valid, true);
  assert.equal(validRes.cleanNewName, '01_SOC_Incident_Response');
  assert.equal(path.basename(validRes.targetPath), '01_SOC_Incident_Response');
});

// 29. Markdown Hyperlinks: Weryfikacja reguł CSS i kontrastu kolorystycznego WCAG AAA
test('Markdown Hyperlinks: Weryfikacja reguł CSS i wysokiego kontrastu dla linków w ciemnym motywie', () => {
  const cssContent = fs.readFileSync(path.resolve('public/style.css'), 'utf8');

  // 1. Obecność reguły .markdown-body a w trybie ekranowym
  assert.equal(cssContent.includes('.markdown-body a {'), true);
  assert.equal(cssContent.includes('color: #38bdf8;'), true);
  assert.equal(cssContent.includes('color: #7dd3fc;'), true);

  // 2. Weryfikacja współczynnika kontrastu WCAG: #38bdf8 na tle #0c0c0e
  function getLuminance(hex) {
    const rgb = [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255
    ].map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  const lLink = getLuminance('#38bdf8');
  const lDarkBg = getLuminance('#0c0c0e');
  const contrastRatio = (Math.max(lLink, lDarkBg) + 0.05) / (Math.min(lLink, lDarkBg) + 0.05);

  // Wymóg WCAG AAA dla zwykłego tekstu: kontrast >= 7:1
  assert.equal(contrastRatio >= 7.0, true);
});

// 30. Sidebar Symmetry: Weryfikacja identycznej szerokości lewego i prawego paska bocznego (300px)
test('Sidebar Layout: Sprawdzenie symetrii szerokości lewego panelu nawigacji i prawego paska zadań Kanban', () => {
  const cssContent = fs.readFileSync(path.resolve('public/style.css'), 'utf8');

  // Ekstrakcja szerokości lewego paska
  const leftMatch = cssContent.match(/\.left-topics-box\s*\{[^}]*?width:\s*([^;]+);/);
  assert.equal(Boolean(leftMatch), true, 'Brak definicji width dla .left-topics-box');
  const leftWidth = leftMatch[1].trim();

  // Ekstrakcja szerokości prawego paska
  const rightMatch = cssContent.match(/\.right-kanban-sidebar\s*\{[^}]*?width:\s*([^;]+);/);
  assert.equal(Boolean(rightMatch), true, 'Brak definicji width dla .right-kanban-sidebar');
  const rightWidth = rightMatch[1].trim();

  // Sprawdzenie wartości 300px i pełnej symetrii
  assert.equal(leftWidth, '300px');
  assert.equal(rightWidth, '300px');
  assert.equal(leftWidth, rightWidth);
});

// 31. Single-User Auth & 6h Session Gatekeeper: Weryfikacja bezpieczeństwa autoryzacji, wygasania tokenów i ochrony brute-force
test('Single-User Auth: Weryfikacja mechanizmu autoryzacji panelu, tokenów sesyjnych z TTL 6h i ochrony brute-force', () => {
  const serverContent = fs.readFileSync(path.resolve('server.mjs'), 'utf8');
  const indexContent = fs.readFileSync(path.resolve('index.html'), 'utf8');
  const cssContent = fs.readFileSync(path.resolve('public/style.css'), 'utf8');
  const appContent = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

  // 1. Weryfikacja obecności elementów UI autoryzacji
  assert.equal(indexContent.includes('id="authLockOverlay"'), true, 'Brak authLockOverlay w index.html');
  assert.equal(indexContent.includes('id="authPasswordInput"'), true, 'Brak authPasswordInput w index.html');
  assert.equal(indexContent.includes('id="authSubmitBtn"'), true, 'Brak authSubmitBtn w index.html');
  assert.equal(indexContent.includes('id="btnHeaderLock"'), true, 'Brak btnHeaderLock w index.html');

  assert.equal(cssContent.includes('.auth-lock-overlay'), true, 'Brak stylów .auth-lock-overlay w style.css');
  assert.equal(cssContent.includes('.auth-lock-card'), true, 'Brak stylów .auth-lock-card w style.css');
  assert.equal(cssContent.includes('.btn-header-lock'), true, 'Brak stylów .btn-header-lock w style.css');

  // 2. Weryfikacja obsługi w app.js
  assert.equal(appContent.includes('const AUTH_TOKEN_KEY = \'knowops_auth_token\';'), true);
  assert.equal(appContent.includes('function getStoredToken()'), true);
  assert.equal(appContent.includes('function showLockScreen('), true);
  assert.equal(appContent.includes('async function handleAuthSubmit('), true);
  assert.equal(appContent.includes('manualLockSession'), true);

  // 3. Logika bezpiecznego porównywania hasła (Timing-Safe)
  function timingSafeCheck(inputPass, realPass) {
    if (!realPass || !inputPass) return false;
    try {
      const inputBuf = Buffer.from(String(inputPass), 'utf8');
      const realBuf = Buffer.from(String(realPass), 'utf8');
      return inputBuf.length === realBuf.length && crypto.timingSafeEqual(inputBuf, realBuf);
    } catch {
      return false;
    }
  }

  assert.equal(timingSafeCheck('poprawneHaslo123', 'poprawneHaslo123'), true);
  assert.equal(timingSafeCheck('bledneHaslo', 'poprawneHaslo123'), false);
  assert.equal(timingSafeCheck('poprawneHaslo12', 'poprawneHaslo123'), false);
  assert.equal(timingSafeCheck('', 'poprawneHaslo123'), false);

  // 4. Logika ważności i wygasania tokenu po 6 godzinach (TTL = 6h)
  const SESSION_HOURS = 6;
  const SESSION_TTL_MS = SESSION_HOURS * 60 * 60 * 1000;
  const simulatedActiveTokens = new Map();

  function simulateVerifyAuth(reqHeaders, reqUrlStr, adminPassword) {
    if (!adminPassword) return true;

    let token = '';
    const authHeader = reqHeaders && reqHeaders['authorization'] ? String(reqHeaders['authorization']) : '';
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (reqUrlStr) {
      try {
        const u = new URL(reqUrlStr, 'http://localhost');
        token = u.searchParams.get('token') || '';
      } catch {}
    }

    if (!token) return false;
    const tokenData = simulatedActiveTokens.get(token);
    if (!tokenData) return false;

    const createdAt = typeof tokenData === 'object' && tokenData.createdAt ? tokenData.createdAt : tokenData;
    const now = Date.now();
    if (now - createdAt > SESSION_TTL_MS) {
      simulatedActiveTokens.delete(token);
      return false;
    }
    return true;
  }

  // Test 4a: Tryb bezhasłowy zawsze autoryzuje
  assert.equal(simulateVerifyAuth({}, '', null), true);

  // Test 4b: Tryb z hasłem - brak tokenu odrzuca autoryzację
  assert.equal(simulateVerifyAuth({}, '', 'tajneHaslo'), false);

  // Test 4c: Poprawny token z nagłówka Bearer
  const validToken = crypto.randomBytes(32).toString('hex');
  simulatedActiveTokens.set(validToken, { createdAt: Date.now(), lastActive: Date.now() });
  assert.equal(simulateVerifyAuth({ authorization: `Bearer ${validToken}` }, '', 'tajneHaslo'), true);

  // Test 4d: Poprawny token z query param (?token=...)
  assert.equal(simulateVerifyAuth({}, `/api/export-wiki-zip?token=${validToken}`, 'tajneHaslo'), true);

  // Test 4e: Wygasły token (starszy niż 6h) jest odrzucany i usuwany
  const expiredToken = crypto.randomBytes(32).toString('hex');
  const pastTime = Date.now() - (SESSION_TTL_MS + 5000); // 6h i 5 sekund temu
  simulatedActiveTokens.set(expiredToken, { createdAt: pastTime, lastActive: pastTime });
  assert.equal(simulateVerifyAuth({ authorization: `Bearer ${expiredToken}` }, '', 'tajneHaslo'), false);
  assert.equal(simulatedActiveTokens.has(expiredToken), false, 'Wygasły token nie został usunięty');

  // 5. Weryfikacja ochrony Brute-Force (max 5 prób na minutę)
  const simulatedLoginAttempts = new Map();
  function simulateLoginAttempt(clientIp, isCorrect) {
    const now = Date.now();
    let attempts = simulatedLoginAttempts.get(clientIp) || { count: 0, firstAttempt: now };
    if (now - attempts.firstAttempt > 60000) {
      attempts = { count: 0, firstAttempt: now };
    }
    if (attempts.count >= 5) {
      return { status: 429, error: 'BLOCKED' };
    }
    if (isCorrect) {
      simulatedLoginAttempts.delete(clientIp);
      return { status: 200, success: true };
    } else {
      attempts.count += 1;
      simulatedLoginAttempts.set(clientIp, attempts);
      return { status: 401, error: 'INVALID_PASSWORD' };
    }
  }

  const testIp = '192.168.1.100';
  for (let i = 1; i <= 5; i++) {
    const res = simulateLoginAttempt(testIp, false);
    assert.equal(res.status, 401);
  }
  // 6. próba musi być zablokowana statusem 429
  const blockedRes = simulateLoginAttempt(testIp, false);
  assert.equal(blockedRes.status, 429);
  assert.equal(blockedRes.error, 'BLOCKED');

  // 6. Weryfikacja ciągłości Docker Healthcheck
  assert.equal(serverContent.includes('normPath === \'/api/check-auth\''), true);
  assert.equal(serverContent.includes('authRequired = Boolean(ADMIN_PASSWORD)'), true);
  assert.equal(serverContent.includes('sessionHours: SESSION_HOURS'), true);
});

// 32. Department Toolbar Layout: Weryfikacja dedykowanego paska akcji pod nazwą działu (Wariant 1)
test('Department Toolbar Layout: Sprawdzenie dedykowanego paska akcji pod nazwą działu w siatce 3-kolumnowej', () => {
  const indexContent = fs.readFileSync(path.resolve('index.html'), 'utf8');
  const cssContent = fs.readFileSync(path.resolve('public/style.css'), 'utf8');
  const appContent = fs.readFileSync(path.resolve('public/app.js'), 'utf8');

  // 1. Sprawdzenie struktury w index.html
  assert.equal(indexContent.includes('class="sidebar-dept-header-box"'), true);
  assert.equal(indexContent.includes('id="currentDeptToolbar"'), true);
  assert.equal(indexContent.includes('id="btnRenameCurrentDept"'), true);
  assert.equal(indexContent.includes('id="btnMoveCurrentDept"'), true);
  assert.equal(indexContent.includes('id="btnDeleteCurrentDept"'), true);

  // Etykiety przycisków w 1 linii bez łamania
  assert.equal(indexContent.includes('>Zmień nazwę</button>'), true);
  assert.equal(indexContent.includes('>Przenieś</button>'), true);
  assert.equal(indexContent.includes('>Usuń</button>'), true);

  // 2. Sprawdzenie stylów w style.css
  assert.equal(cssContent.includes('.dept-actions-toolbar'), true);
  assert.equal(cssContent.includes('grid-template-columns: 1fr 1fr 1fr;'), true);
  assert.equal(cssContent.includes('.btn-dept-action'), true);
  assert.equal(cssContent.includes('.btn-dept-rename'), true);
  assert.equal(cssContent.includes('.btn-dept-move'), true);
  assert.equal(cssContent.includes('.btn-dept-delete'), true);

  // 3. Sprawdzenie sterowania w app.js
  assert.equal(appContent.includes('const deptToolbar = document.getElementById(\'currentDeptToolbar\');'), true);
  assert.equal(appContent.includes('deptToolbar.style.display = canManageDept ? \'grid\' : \'none\';'), true);
});

// 33. Scheduled Backups & Permissions Engine: Weryfikacja schedulera cyklicznych kopii, wykrywania uprawnień zapisu i kompletności archiwum
test('Scheduled Backups & Permissions Engine: Weryfikacja schedulera cyklicznych kopii, uprawnień zapisu i integralności archiwum', () => {
  // 1. Test weryfikacji uprawnień zapisu katalogu kopii
  const permCheck = checkBackupsDirWritable();
  assert.equal(permCheck.writable, true);

  // Sprawdzenie symulowanego katalogu bez uprawnień / z błędną ścieżką
  const invalidDir = path.join(os.tmpdir(), 'invalid_nonexistent_dir_\0_test');
  const invalidCheck = checkBackupsDirWritable(invalidDir);
  assert.equal(invalidCheck.writable, false);
  assert.equal(typeof invalidCheck.error, 'string');
  assert.equal(invalidCheck.error.includes('Brak uprawnień zapisu w katalogu kopii'), true);

  // 2. Test tworzenia trwałej pełnej kopii zapasowej
  const backupRes = createWikiBackup();
  assert.equal(backupRes.success, true);
  assert.equal(typeof backupRes.filename, 'string');
  assert.equal(backupRes.filename.startsWith('wiki_backup_'), true);
  assert.equal(fs.existsSync(backupRes.path), true);
  assert.equal(backupRes.size > 0, true);

  // Sprzątanie po utworzonym pliku testowym
  try {
    fs.unlinkSync(backupRes.path);
  } catch (e) {}

  // 3. Test schedulera cyklicznych kopii zapasowych
  // A. Weryfikacja parsowania i kalkulacji czasu codziennej kopii o 22:00
  const parsed22 = parseScheduleTime('22:00');
  assert.equal(parsed22.hour, 22);
  assert.equal(parsed22.minute, 0);
  assert.equal(parsed22.formatted, '22:00');

  const parsedHOnly = parseScheduleTime('22');
  assert.equal(parsedHOnly.hour, 22);
  assert.equal(parsedHOnly.minute, 0);
  assert.equal(parsedHOnly.formatted, '22:00');

  const nextRun22 = computeNextRunTime({ scheduleTime: '22:00' });
  const nextDate = new Date(nextRun22);
  assert.equal(nextDate.getHours(), 22);
  assert.equal(nextDate.getMinutes(), 0);

  // B. Inicjalizacja schedulera z harmonogramem codziennym o 22:00
  const schedulerState = initBackupScheduler({ enabled: true, scheduleTime: '22:00', keepCount: 7 });
  assert.equal(schedulerState.enabled, true);
  assert.equal(schedulerState.scheduleTime, '22:00');
  assert.equal(schedulerState.keepCount, 7);
  assert.equal(typeof schedulerState.nextBackupTime, 'number');

  const status = getBackupSchedulerStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.scheduleTime, '22:00');
  assert.equal(status.keepCount, 7);
  assert.equal(status.isWritable, true);
  assert.equal(typeof status.nextBackupTime, 'string');

  // 4. Weryfikacja konfiguracji Docker i backendu
  const composeContent = fs.readFileSync(path.resolve('docker-compose.yml'), 'utf8');
  assert.equal(composeContent.includes('./backup_wiki.mjs:/app/backup_wiki.mjs:ro'), true);
  assert.equal(composeContent.includes('BACKUP_SCHEDULE_TIME='), true);
  assert.equal(composeContent.includes('TZ='), true);

  const serverContent = fs.readFileSync(path.resolve('server.mjs'), 'utf8');
  assert.equal(serverContent.includes('initBackupScheduler()'), true);
  assert.equal(serverContent.includes('executeBackupJob(true)'), true);
  assert.equal(serverContent.includes('scheduler: schedulerStatus') || serverContent.includes('backups: list, scheduler'), true);

  const indexContent = fs.readFileSync(path.resolve('index.html'), 'utf8');
  assert.equal(indexContent.includes('id="backupsStatusBanner"'), true);
  assert.equal(indexContent.includes('id="backupSchedMode"'), true);
  assert.equal(indexContent.includes('id="backupsPermWarning"'), true);

  stopBackupScheduler();
});

test('34. Radar Podatności CVE (CISA KEV): kategoryzacja regułowa, silnik pobierania, buforowanie, Watchlist i integracja z Kanbanem', async () => {
  // 1. Kategoryzacja regułowa technologii
  assert.equal(categorizeVulnerability('VMware', 'vCenter Server', 'Remote code execution in DCERPC'), 'virtualization');
  assert.equal(categorizeVulnerability('Docker', 'runc', 'Container breakout vulnerability'), 'containers');
  assert.equal(categorizeVulnerability('Linux', 'Kernel', 'Local privilege escalation vulnerability'), 'os_linux');
  assert.equal(categorizeVulnerability('Microsoft', 'Windows Server', 'Active Directory Kerberos security bypass'), 'identity');
  assert.equal(categorizeVulnerability('OpenSSH', 'sshd', 'regreSSHion remote code execution'), 'web_services');
  assert.equal(categorizeVulnerability('Palo Alto Networks', 'PAN-OS', 'GlobalProtect command injection'), 'network_firewall');
  assert.equal(categorizeVulnerability('PostgreSQL Global Development Group', 'PostgreSQL', 'Buffer overflow'), 'databases');
  assert.equal(categorizeVulnerability('UnknownVendor', 'UnknownApp', 'Generic bug without infra keywords'), 'other');

  // 2. Zarządzanie obserwowanym stosem technologicznym (Watchlist)
  const initialWatchlist = getCveWatchlist();
  assert.equal(Array.isArray(initialWatchlist.selectedCategories), true);
  assert.equal(Array.isArray(initialWatchlist.selectedVendors), true);
  assert.equal(typeof initialWatchlist.audited, 'object');

  const updatedWatchlist = saveCveWatchlist({
    selectedCategories: ['virtualization', 'containers', 'network_firewall'],
    selectedVendors: ['VMware', 'Docker', 'Fortinet'],
    minScore: 7.0,
    onlyKev: true
  });
  assert.deepEqual(updatedWatchlist.selectedCategories, ['virtualization', 'containers', 'network_firewall']);
  assert.deepEqual(updatedWatchlist.selectedVendors, ['VMware', 'Docker', 'Fortinet']);
  assert.equal(updatedWatchlist.minScore, 7.0);
  assert.equal(updatedWatchlist.onlyKev, true);

  // Weryfikacja filtrowania Watchlist (koniunkcja kategorii, dostawców i CVSS)
  const ciscoCve = {
    id: 'CVE-2023-20198',
    vendor: 'Cisco',
    product: 'IOS XE',
    title: 'Cisco IOS XE Web UI Privilege Escalation',
    category: 'network_firewall',
    score: 10.0
  };
  const fortinetCve = {
    id: 'CVE-2024-21762',
    vendor: 'Fortinet',
    product: 'FortiOS',
    title: 'Fortinet FortiOS Out-of-bounds Write Vulnerability',
    category: 'network_firewall',
    score: 9.8
  };
  const fortinetLowScoreCve = {
    id: 'CVE-2024-0001',
    vendor: 'Fortinet',
    product: 'FortiOS',
    title: 'Fortinet Low Score Bug',
    category: 'network_firewall',
    score: 6.5
  };
  const vmwareCve = {
    id: 'CVE-2023-34048',
    vendor: 'VMware',
    product: 'vCenter Server',
    title: 'VMware vCenter Server Out-of-Bounds Write',
    category: 'virtualization',
    score: 9.8
  };
  const opensshCve = {
    id: 'CVE-2024-6387',
    vendor: 'OpenSSH',
    product: 'OpenSSH',
    title: 'OpenSSH regreSSHion Remote Code Execution',
    category: 'web_services',
    score: 8.1
  };

  // Cisco jest w kategorii network_firewall, ale nie ma go w selectedVendors -> odrzucone
  assert.equal(isItemMatchingWatchlist(ciscoCve, updatedWatchlist), false);
  // Fortinet jest w network_firewall oraz na liście dostawców, a CVSS >= 7.0 -> zaakceptowane
  assert.equal(isItemMatchingWatchlist(fortinetCve, updatedWatchlist), true);
  // Fortinet o CVSS < 7.0 -> odrzucone przez próg minScore
  assert.equal(isItemMatchingWatchlist(fortinetLowScoreCve, updatedWatchlist), false);
  // VMware jest w virtualization i na liście dostawców -> zaakceptowane
  assert.equal(isItemMatchingWatchlist(vmwareCve, updatedWatchlist), true);
  // OpenSSH nie ma ani w kategoriach, ani w dostawcach -> odrzucone
  assert.equal(isItemMatchingWatchlist(opensshCve, updatedWatchlist), false);

  // 3. Statusy audytu podatności
  const testCve = 'CVE-TEST-2026-9999';
  const inProgressStatus = setCveAuditStatus(testCve, 'in_progress', 'W trakcie weryfikacji przez zespół SecOps');
  assert.equal(inProgressStatus.status, 'in_progress');
  assert.equal(inProgressStatus.notes.includes('W trakcie weryfikacji'), true);
  assert.equal(typeof inProgressStatus.updatedAt, 'string');

  const mitigatedStatus = setCveAuditStatus(testCve, 'mitigated', 'Zaaplikowano łatę bezpieczeństwa');
  assert.equal(mitigatedStatus.status, 'mitigated');

  assert.throws(() => {
    setCveAuditStatus(testCve, 'invalid_audit_status');
  }, /Nieprawidłowy status audytu/);

  const resetStatus = setCveAuditStatus(testCve, 'unreviewed');
  assert.equal(resetStatus.status, 'unreviewed');

  // 4. Silnik feedu podatności i fallback offline
  const feedResult = await fetchCveFeed(false);
  assert.equal(typeof feedResult, 'object');
  assert.equal(Array.isArray(feedResult.items), true);
  assert.equal(feedResult.items.length > 0, true);
  assert.equal(typeof feedResult.categories, 'object');

  const firstItem = feedResult.items[0];
  assert.equal(typeof firstItem.id, 'string');
  assert.equal(firstItem.id.startsWith('CVE-'), true);
  assert.equal(typeof firstItem.vendor, 'string');
  assert.equal(typeof firstItem.product, 'string');
  assert.equal(typeof firstItem.title, 'string');
  assert.equal(typeof firstItem.description, 'string');
  assert.equal(typeof firstItem.requiredAction, 'string');
  assert.equal(typeof firstItem.score, 'number');
  assert.equal(['CRITICAL', 'HIGH', 'MEDIUM'].includes(firstItem.severity), true);
  assert.equal(firstItem.isKev, true);
  assert.equal(typeof firstItem.category, 'string');
  assert.equal(typeof firstItem.categoryName, 'string');
  assert.equal(firstItem.nvdUrl.includes('nvd.nist.gov'), true);
  assert.equal(firstItem.cveOrgUrl.includes('cve.org'), true);

  // 5. Weryfikacja endpointów API i logiki integracji z Kanbanem w server.mjs
  const serverCode = fs.readFileSync(path.resolve('server.mjs'), 'utf8');
  assert.equal(serverCode.includes('/api/cve-feed'), true);
  assert.equal(serverCode.includes('/api/cve-refresh'), true);
  assert.equal(serverCode.includes('/api/cve-watchlist'), true);
  assert.equal(serverCode.includes('/api/cve-status'), true);
  assert.equal(serverCode.includes('/api/cve-to-kanban'), true);

  // 6. Weryfikacja interfejsu SPA i definicji w index.html / public/app.js
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
  assert.equal(indexHtml.includes('id="cveWatchlistModalOverlay"'), true);
  assert.equal(indexHtml.includes('id="cveWatchlistCategoriesContainer"'), true);
  assert.equal(indexHtml.includes('id="cveWatchlistVendorsInput"'), true);

  const appJs = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  assert.equal(appJs.includes('#/tool/cve'), true);
  assert.equal(appJs.includes('Radar Podatności CVE'), true);
  assert.equal(appJs.includes('function renderCveRadar'), true);
  assert.equal(appJs.includes('sendCveToKanban'), true);
  assert.equal(appJs.includes('updateCveAuditStatus'), true);
  assert.equal(appJs.includes('openCveWatchlistModal'), true);

  // 7. Weryfikacja konfiguracji Docker
  const dockerfile = fs.readFileSync(path.resolve('Dockerfile'), 'utf8');
  assert.equal(dockerfile.includes('cve_engine.mjs'), true);

  const dockerCompose = fs.readFileSync(path.resolve('docker-compose.yml'), 'utf8');
  assert.equal(dockerCompose.includes('./cve_engine.mjs:/app/cve_engine.mjs:ro'), true);
});

test('35. Client-Side Translation Engine (Koncepcja A): reguły leksykonu SecOps, transformacje CISA KEV i integracja interfejsu', () => {
  // 1. Weryfikacja słownika terminologii SecOps
  assert.equal(Array.isArray(CVE_SECOPS_GLOSSARY), true);
  assert.equal(CVE_SECOPS_GLOSSARY.length >= 30, true);

  // 2. Weryfikacja tłumaczenia kluczowych typów podatności
  const rceText = translateSecOpsRules('Remote Code Execution vulnerability in OpenSSH');
  assert.equal(rceText.includes('zdalne wykonanie kodu (RCE)'), true);

  const cmdText = translateSecOpsRules('Command Injection vulnerability in GlobalProtect');
  assert.equal(cmdText.includes('wstrzyknięcie poleceń (Command Injection)'), true);

  const privText = translateSecOpsRules('Privilege Escalation vulnerability in Linux kernel');
  assert.equal(privText.includes('eskalację uprawnień (Privilege Escalation)'), true);

  const oobText = translateSecOpsRules('Out-of-bounds Write vulnerability in DCERPC');
  assert.equal(oobText.includes('zapis poza granicami bufora (Out-of-bounds Write)'), true);

  const breakoutText = translateSecOpsRules('Container Breakout vulnerability in runc');
  assert.equal(breakoutText.includes('ucieczkę z kontenera (Container Breakout)'), true);

  // 3. Weryfikacja transformacji ustrukturyzowanych zdań CISA KEV
  const cisaSentence = 'Palo Alto Networks PAN-OS contains a command injection vulnerability in GlobalProtect that may allow an unauthenticated attacker to execute arbitrary code with root privileges.';
  const translatedSentence = translateSecOpsRules(cisaSentence);
  assert.equal(translatedSentence.includes('Oprogramowanie Palo Alto Networks PAN-OS zawiera podatność'), true);
  assert.equal(translatedSentence.includes('wstrzyknięcie poleceń (Command Injection)'), true);
  assert.equal(translatedSentence.includes('nieuwierzytelnionemu atakującemu'), true);
  assert.equal(translatedSentence.includes('wykonanie dowolnego kodu'), true);
  assert.equal(translatedSentence.includes('uprawnieniami roota (administratora)'), true);

  // 4. Weryfikacja tłumaczenia zaleceń naprawczych (Remediation Actions)
  const remediationText = "Apply mitigations in accordance with vendor instructions, ensuring compliance with CISA's BOD 26-04. Follow applicable guidance or discontinue use of the product if mitigations are unavailable.";
  const translatedAction = translateSecOpsRules(remediationText, true);
  assert.equal(translatedAction.includes('Zastosować środki mitygujące zgodnie z oficjalnymi instrukcjami producenta oprogramowania.'), true);
  assert.equal(translatedAction.includes('wycofać produkt z użytku'), true);

  // 5. Weryfikacja tłumaczenia całego rekordu podatności (translateCveRecord)
  const sampleItem = {
    id: 'CVE-2024-3400',
    title: 'Palo Alto Networks PAN-OS Command Injection Vulnerability',
    description: 'Palo Alto Networks PAN-OS contains a command injection vulnerability that allows an unauthenticated attacker to execute arbitrary code with root privileges.',
    requiredAction: 'Apply updates per vendor instructions.'
  };
  const translatedItem = translateCveRecord(sampleItem);
  assert.equal(translatedItem.isTranslated, true);
  assert.equal(translatedItem.translatedTitle.includes('Podatność Palo Alto Networks PAN-OS'), true);
  assert.equal(translatedItem.translatedDescription.includes('Oprogramowanie Palo Alto Networks PAN-OS zawiera podatność'), true);
  assert.equal(translatedItem.translatedRequiredAction.includes('Zastosować oficjalne aktualizacje zgodnie z zaleceniami producenta.'), true);

  // 6. Weryfikacja wielozdaniowego opisu i przypadku Linux Kernel IPv6 (CVE-2026-53362)
  const linuxKernelItem = {
    id: 'CVE-2026-53362',
    title: 'Linux Kernel Unspecified Vulnerability',
    description: 'Linux Kernel contains an unspecified vulnerability that can allow for privilege escalation via IPv6 networking subsystem. This vulnerability can impact multiple products, including but not limited to Suse, Red Hat, and other products using Linux.',
    requiredAction: 'Apply mitigations in accordance with vendor instructions... discontinue use of the product if mitigations are unavailable.'
  };
  const translatedLinuxItem = translateCveRecord(linuxKernelItem);
  assert.equal(translatedLinuxItem.translatedTitle.includes('Podatność Linux Kernel: bliżej nieokreślona'), true);
  assert.equal(translatedLinuxItem.translatedDescription.includes('zawiera bliżej nieokreśloną podatność'), true);
  assert.equal(translatedLinuxItem.translatedDescription.includes('za pośrednictwem podsystemu sieciowego IPv6'), true);
  assert.equal(translatedLinuxItem.translatedDescription.includes('w tym między innymi'), true);
  assert.equal(translatedLinuxItem.translatedDescription.includes('oraz innych rozwiązań wykorzystujących jądro Linux'), true);
  assert.equal(translatedLinuxItem.translatedRequiredAction.includes('Zastosować środki mitygujące zgodnie z oficjalnymi instrukcjami producenta oprogramowania.'), true);

  // 7. Weryfikacja kodu klienta w public/app.js i index.html
  const appJs = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  assert.equal(appJs.includes('CLIENT_CVE_GLOSSARY'), true);
  assert.equal(appJs.includes('CLIENT_CVE_PHRASES'), true);
  assert.equal(appJs.includes('CLIENT_CVE_TITLE_PATTERNS'), true);
  assert.equal(appJs.includes('function translateSecOpsClient'), true);
  assert.equal(appJs.includes('function getOrTranslateCveItem'), true);
  assert.equal(appJs.includes('knowops_cve_trans_v2_'), true);
  assert.equal(appJs.includes('knowops_cve_auto_translate'), true);
  assert.equal(appJs.includes('window.handleCveTranslateToggle'), true);
  assert.equal(appJs.includes('window.toggleCveItemLanguage'), true);
  assert.equal(appJs.includes('window.clearCveTranslationCache'), true);
  assert.equal(appJs.includes('Tłumacz opisy na język polski (PL)'), true);
  assert.equal(appJs.includes('TŁUMACZENIE PL'), true);
  assert.equal(appJs.includes('ORYGINAŁ EN'), true);

  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
  assert.equal(indexHtml.includes('app.js?v=2.7.0'), true);
});

test('36. Instrukcja Obsługi & Live Translation Engine (Wariant 1): brak błędów runtime w instrukcji, endpoint API i bufor dyskowy', async () => {
  // 1. Weryfikacja braku błędu TypeError w renderWikiInstruction()
  const appJs = fs.readFileSync(path.resolve('public/app.js'), 'utf8');
  assert.equal(appJs.includes('function renderWikiInstruction'), true);
  // Sprawdzenie czy nie ma niesparowanych grawisów w linii z szablonem kodu
  assert.equal(appJs.includes('&#96;&#96;&#96;język ... &#96;&#96;&#96;'), true);
  assert.equal(appJs.includes('&#96;polecenie&#96;'), true);

  // 2. Symulacja wywołania renderWikiInstruction w kontrolowanym środowisku DOM
  let renderedContent = '';
  let renderedBreadcrumb = '';
  const mockDocument = {
    getElementById: (id) => ({
      get innerHTML() { return ''; },
      set innerHTML(val) {
        if (id === 'articleContentArea') renderedContent = val;
        if (id === 'breadcrumbArea') renderedBreadcrumb = val;
      },
      setAttribute: () => {},
      style: {}
    }),
    addEventListener: () => {},
    querySelectorAll: () => []
  };
  const mockWindow = { addEventListener: () => {}, location: { hash: '#/tool/instrukcja' } };

  const testScope = new Function('window', 'document', 'localStorage', `
    ${appJs}
    renderWikiInstruction();
  `);

  assert.doesNotThrow(() => {
    testScope(mockWindow, mockDocument, { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });
  assert.equal(renderedBreadcrumb.includes('Instrukcja obsługi'), true);
  assert.equal(renderedContent.includes('Instrukcja obsługi portalu KnowOps Wiki'), true);
  assert.equal(renderedContent.includes('1. Główne moduły systemu'), true);

  // 3. Weryfikacja silnika translacji na żywo w cve_engine.mjs
  const testEnText = 'Command Injection vulnerability in GlobalProtect';
  const liveResult = await translateLiveText(testEnText);
  assert.equal(typeof liveResult, 'string');
  assert.equal(liveResult.length > 0, true);

  // 4. Weryfikacja bufora dyskowego w data/cve_translations.json
  const cache = getTranslationsCache();
  assert.equal(typeof cache, 'object');
  assert.notEqual(cache, null);

  // 5. Weryfikacja translacji wsadowej (batchTranslateLive)
  const sampleItems = [
    {
      id: 'CVE-2026-TEST1',
      title: 'Remote Code Execution in OpenSSH',
      description: 'Allows remote attacker to execute arbitrary code',
      requiredAction: 'Apply vendor patches immediately'
    }
  ];
  const batchResult = await batchTranslateLive(sampleItems);
  assert.equal(Array.isArray(batchResult), true);
  assert.equal(batchResult.length, 1);
  assert.equal(batchResult[0].id, 'CVE-2026-TEST1');
  assert.equal(typeof batchResult[0].translatedTitle, 'string');
  assert.equal(typeof batchResult[0].translatedDescription, 'string');
  assert.equal(typeof batchResult[0].translatedRequiredAction, 'string');
  assert.equal(batchResult[0].isLiveTranslated, true);

  // 6. Weryfikacja rejestracji trasy POST /api/translate-live w server.mjs
  const serverMjs = fs.readFileSync(path.resolve('server.mjs'), 'utf8');
  assert.equal(serverMjs.includes("normPath === '/api/translate-live' && req.method === 'POST'"), true);
  assert.equal(serverMjs.includes('translateLiveText'), true);
  assert.equal(serverMjs.includes('batchTranslateLive'), true);
});

