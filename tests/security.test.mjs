import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

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

