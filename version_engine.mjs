import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve('data');
export const HISTORY_DIR = path.join(DATA_DIR, 'history');
if (!fs.existsSync(HISTORY_DIR)) {
  try { fs.mkdirSync(HISTORY_DIR, { recursive: true }); } catch (e) {}
}

export const MAX_DOCUMENT_VERSIONS = 10;

// Ścisła weryfikacja granic katalogu (ochrona przed Path Traversal)
export function isPathInside(targetPath, baseDir) {
  if (!targetPath || !baseDir) return false;
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

// Atomowy zapis pliku (ochrona przed uszkodzeniem przy restarcie)
export function atomicWriteFile(filePath, data, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  fs.writeFileSync(tmpPath, data, encoding);
  fs.renameSync(tmpPath, filePath);
}

export function sanitizeHistoryRelPath(relPath) {
  let decodedPath = decodeURIComponent(relPath || '');
  let sanitized = decodedPath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
  sanitized = sanitized.replace(/[<>:"|?*\x00]/g, '_');
  sanitized = sanitized.split('/').map(part => part === '..' ? '__' : part).join('/');
  if (!sanitized.endsWith('.md')) sanitized += '.md';
  return sanitized;
}

export function getDocumentHistoryDir(relPath) {
  const raw = String(relPath || '');
  if (raw.includes('..') || path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new Error('Nieprawidłowa ścieżka dokumentu w historii (Path Traversal)');
  }
  const sanitized = sanitizeHistoryRelPath(raw);
  const dir = path.resolve(HISTORY_DIR, sanitized);
  if (!isPathInside(dir, HISTORY_DIR)) {
    throw new Error('Nieprawidłowa ścieżka dokumentu w historii (Path Traversal)');
  }
  return dir;
}

export function archiveDocumentVersion(relPath, oldContent) {
  if (!relPath || typeof oldContent !== 'string') return null;
  const docHistoryDir = getDocumentHistoryDir(relPath);

  if (!fs.existsSync(docHistoryDir)) {
    fs.mkdirSync(docHistoryDir, { recursive: true });
  }

  const timestamp = Date.now();
  const versionFilename = `version_${timestamp}.md`;
  const versionPath = path.join(docHistoryDir, versionFilename);
  atomicWriteFile(versionPath, oldContent, 'utf8');

  // Rotacja FIFO: utrzymywanie maksymalnie MAX_DOCUMENT_VERSIONS
  const files = fs.readdirSync(docHistoryDir)
    .filter(f => /^version_\d+\.md$/.test(f))
    .sort((a, b) => {
      const tsA = parseInt(a.replace(/^version_|\.md$/g, ''), 10) || 0;
      const tsB = parseInt(b.replace(/^version_|\.md$/g, ''), 10) || 0;
      return tsA - tsB;
    });

  if (files.length > MAX_DOCUMENT_VERSIONS) {
    const toRemove = files.slice(0, files.length - MAX_DOCUMENT_VERSIONS);
    for (const f of toRemove) {
      try {
        fs.unlinkSync(path.join(docHistoryDir, f));
      } catch (err) {
        console.warn('[Wiki History] Błąd usuwania starej wersji:', err.message);
      }
    }
  }

  return {
    versionFilename,
    timestamp,
    remainingVersionsCount: Math.min(files.length, MAX_DOCUMENT_VERSIONS)
  };
}

export function listDocumentVersions(relPath) {
  const docHistoryDir = getDocumentHistoryDir(relPath);
  if (!fs.existsSync(docHistoryDir)) {
    return [];
  }

  const files = fs.readdirSync(docHistoryDir).filter(f => /^version_\d+\.md$/.test(f));
  const versions = [];

  for (const f of files) {
    const filePath = path.join(docHistoryDir, f);
    const stat = fs.statSync(filePath);
    const tsMatch = f.match(/^version_(\d+)\.md$/);
    const timestamp = tsMatch ? parseInt(tsMatch[1], 10) : stat.mtimeMs;
    const dateObj = new Date(timestamp);
    versions.push({
      id: f,
      timestamp,
      date: dateObj.toISOString(),
      formattedDate: dateObj.toLocaleString('pl-PL'),
      size: stat.size
    });
  }

  versions.sort((a, b) => b.timestamp - a.timestamp);
  return versions;
}

export function getDocumentVersionContent(relPath, versionId) {
  if (!/^version_\d+\.md$/.test(versionId)) {
    throw new Error('Nieprawidłowy identyfikator wersji');
  }
  const docHistoryDir = getDocumentHistoryDir(relPath);
  const versionFilePath = path.resolve(docHistoryDir, versionId);

  if (!isPathInside(versionFilePath, docHistoryDir) || !fs.existsSync(versionFilePath)) {
    return null;
  }

  const content = fs.readFileSync(versionFilePath, 'utf8');
  const stat = fs.statSync(versionFilePath);
  const tsMatch = versionId.match(/^version_(\d+)\.md$/);
  const timestamp = tsMatch ? parseInt(tsMatch[1], 10) : stat.mtimeMs;

  return {
    versionId,
    timestamp,
    formattedDate: new Date(timestamp).toLocaleString('pl-PL'),
    size: stat.size,
    content
  };
}
