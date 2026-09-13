import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, execFileSync } from 'node:child_process';

const DOCS_DIR = path.resolve('docs');
const DATA_DIR = path.resolve('data');
const IMAGES_DIR = path.resolve('public', 'images');
export const BACKUPS_DIR = path.resolve('backups');

if (!fs.existsSync(BACKUPS_DIR)) {
  try {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  } catch (e) {
    // Katalog zostanie zweryfikowany w checkBackupsDirWritable
  }
}

/**
 * Sprawdza czy katalog kopii zapasowych jest fizycznie zapisywalny dla procesu Node.js.
 * W środowiskach Docker/Linux chroni przed błędem uprawnień hosta (root vs node UID 1000).
 */
export function checkBackupsDirWritable(targetDir = BACKUPS_DIR) {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const testFile = path.join(targetDir, `.perm_check_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.writeFileSync(testFile, 'test', 'utf8');
    fs.unlinkSync(testFile);
    return { writable: true };
  } catch (err) {
    const code = err.code || 'EACCES';
    const msg = `Brak uprawnień zapisu w katalogu kopii (${targetDir}) [${code}]. Wykonaj na hoście Linux: chmod -R 777 ./backups lub chown -R 1000:1000 ./backups`;
    return {
      writable: false,
      code,
      error: msg
    };
  }
}

/**
 * Pomocnicze sprawdzanie dostępności narzędzia w PATH (Linux / Unix)
 */
function isToolAvailable(toolName) {
  try {
    execFileSync('which', [toolName], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pakuje kompletne dane bazy wiedzy (docs/, data/, public/images/) do archiwum ZIP.
 * Pomija pliki w katalogach .trash.
 */
function packageArchive(targetFilePath, isZipFormat = true) {
  const isWin = process.platform === 'win32';
  const rootDir = path.resolve('.');

  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

  if (isWin) {
    // Na Windows kompresujemy do ZIP przez PowerShell
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${DOCS_DIR}', '${DATA_DIR}', '${IMAGES_DIR}' -DestinationPath '${targetFilePath}' -Force`
    ], { stdio: 'pipe' });
    return;
  }

  // Środowisko Linux / Unix
  if (isZipFormat && isToolAvailable('zip')) {
    try {
      execFileSync('zip', [
        '-r',
        '-q',
        targetFilePath,
        'docs',
        'data',
        'public/images',
        '-x',
        '*/.trash/*',
        '*/.trash'
      ], {
        cwd: rootDir,
        stdio: 'pipe'
      });
      return;
    } catch (err) {
      const stderr = err.stderr ? err.stderr.toString('utf8').trim() : '';
      const stdout = err.stdout ? err.stdout.toString('utf8').trim() : '';
      const details = stderr || stdout || err.message;
      throw new Error(`Narzędzie zip zwróciło błąd: ${details}`);
    }
  }

  // Fallback do narzędzia tar, jeśli zip nie jest dostępny lub nie był żądany
  try {
    execFileSync('tar', [
      '-czf',
      targetFilePath,
      '--exclude=*/.trash/*',
      '--exclude=*/.trash',
      'docs',
      'data',
      'public/images'
    ], {
      cwd: rootDir,
      stdio: 'pipe'
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString('utf8').trim() : '';
    const stdout = err.stdout ? err.stdout.toString('utf8').trim() : '';
    const details = stderr || stdout || err.message;
    throw new Error(`Narzędzie tar zwróciło błąd: ${details}`);
  }
}

/**
 * Tworzy trwałą kopię zapasową w katalogu backups/ (dla schedulera i przycisku w modalu).
 */
export function createWikiBackup() {
  const permCheck = checkBackupsDirWritable(BACKUPS_DIR);
  if (!permCheck.writable) {
    console.error(`[Backup Engine Error] ${permCheck.error}`);
    return {
      success: false,
      error: permCheck.error
    };
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
  const isWin = process.platform === 'win32';
  const hasZip = isWin || isToolAvailable('zip');
  const ext = hasZip ? '.zip' : '.tar.gz';
  const backupFileName = `wiki_backup_${timestamp}${ext}`;
  const backupFilePath = path.join(BACKUPS_DIR, backupFileName);

  console.log(`[Backup Engine] Tworzenie pełnej kopii zapasowej bazy wiedzy: ${backupFileName}...`);

  try {
    packageArchive(backupFilePath, hasZip);

    if (!fs.existsSync(backupFilePath)) {
      throw new Error('Plik kopii zapasowej nie został poprawnie zapisany na dysku.');
    }

    const stat = fs.statSync(backupFilePath);
    console.log(`[Backup Engine] Kopia utworzona pomyślnie w: ${backupFilePath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

    // Opcjonalna synchronizacja z Dyskiem Google przez rclone
    const gdriveRemote = process.env.GOOGLE_DRIVE_REMOTE || '';
    if (gdriveRemote) {
      if (!/^[a-zA-Z0-9_\-\:\/]+$/.test(gdriveRemote)) {
        console.error('[Backup Engine Security] Niedozwolona nazwa zadanego parametru GOOGLE_DRIVE_REMOTE');
      } else {
        try {
          console.log(`[Backup Engine] Przesyłanie kopii zapasowej do Dysku Google (${gdriveRemote})...`);
          execSync(`rclone copy "${backupFilePath}" "${gdriveRemote}"`, { stdio: 'pipe' });
          console.log('[Backup Engine] Kopia pomyślnie wysłana na Dysk Google.');
        } catch (err) {
          console.warn('[Backup Engine] Wskazówka: Aby automatycznie wysyłać pliki na Dysk Google, zainstaluj narzędzie rclone i skonfiguruj remote.');
        }
      }
    }

    return {
      success: true,
      filename: backupFileName,
      path: backupFilePath,
      size: stat.size,
      timestamp
    };
  } catch (err) {
    console.error('[Backup Engine Error] Nie można utworzyć kopii zapasowej:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Eksportuje bazę wiedzy jako archiwum ZIP do natychmiastowego pobrania w przeglądarce.
 * W przypadku braku uprawnień zapisu w backups/, bezpiecznie wykonuje fallback do katalogu /tmp.
 */
export function exportWikiZip() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
  const zipFileName = `knowops_wiki_backup_${timestamp}.zip`;

  let targetDir = BACKUPS_DIR;
  const permCheck = checkBackupsDirWritable(BACKUPS_DIR);
  if (!permCheck.writable) {
    targetDir = os.tmpdir();
    console.warn(`[Backup Engine] Katalog backups/ nie jest zapisywalny (${permCheck.error}). Eksport pobierany zostanie wygenerowany w katalogu tymczasowym: ${targetDir}`);
  }

  const zipFilePath = path.join(targetDir, zipFileName);

  try {
    packageArchive(zipFilePath, true);

    if (!fs.existsSync(zipFilePath)) {
      throw new Error('Nie udało się utworzyć pliku archiwum ZIP.');
    }

    const stat = fs.statSync(zipFilePath);
    return {
      success: true,
      filename: zipFileName,
      path: zipFilePath,
      size: stat.size,
      timestamp
    };
  } catch (err) {
    const stderrMsg = err.stderr ? err.stderr.toString('utf8').trim() : '';
    const details = stderrMsg || err.message;
    console.error('[Backup Engine Error] Błąd podczas eksportu archiwum ZIP:', details);
    throw new Error(details);
  }
}

/**
 * Retencja kopii zapasowych: zachowuje keepCount najnowszych kopii, usuwając starsze.
 */
export function rotateBackups(keepCount = 7) {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith('wiki_backup_') || f.startsWith('knowops_wiki_backup_'))
    .map(f => {
      const fullPath = path.join(BACKUPS_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        return { filename: f, fullPath, size: stat.size, mtime: stat.mtime };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length > keepCount) {
    const toDelete = files.slice(keepCount);
    for (const item of toDelete) {
      try {
        fs.unlinkSync(item.fullPath);
        console.log(`[Backup Engine] Usunięto starą kopię w ramach retencji (${keepCount}): ${item.filename}`);
      } catch (e) {
        console.error(`[Backup Engine] Błąd usuwania kopii ${item.filename}:`, e.message);
      }
    }
  }
  return files.slice(0, keepCount);
}

// ================= HARMONOGRAM CYKLICZNYCH KOPII (SCHEDULER) ================= //

/**
 * Parsowanie zadanego czasu wykonania kopii w formacie HH:MM lub HH (np. '22:00', '22')
 */
export function parseScheduleTime(timeStr) {
  if (!timeStr) return null;
  const str = String(timeStr).trim();
  const match = str.match(/^([01]?[0-9]|2[0-3])(?::([0-5][0-9]))?$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  return {
    hour: h,
    minute: m,
    formatted: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  };
}

/**
 * Oblicza czas następnego uruchomienia kopii zapasowej
 */
export function computeNextRunTime({ scheduleTime, intervalHours = 24, lastBackupTime = null }) {
  const parsed = parseScheduleTime(scheduleTime);
  const now = new Date();

  if (parsed) {
    const target = new Date(now.getTime());
    target.setHours(parsed.hour, parsed.minute, 0, 0);

    // Jeśli zaplanowana godzina dzisiaj już minęła, ustaw na jutro o tej samej porze
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  const intervalMs = Math.max(1, intervalHours) * 3600 * 1000;
  if (!lastBackupTime) {
    return now.getTime() + 30000;
  }
  const elapsed = now.getTime() - lastBackupTime;
  if (elapsed >= intervalMs) {
    return now.getTime() + 30000;
  }
  return lastBackupTime + intervalMs;
}

let schedulerState = {
  enabled: true,
  scheduleTime: '22:00',
  intervalHours: 24,
  keepCount: 7,
  lastBackupTime: null,
  lastBackupFilename: null,
  lastBackupStatus: 'idle',
  lastBackupError: null,
  nextBackupTime: null,
  isRunning: false,
  ticker: null
};

export function getBackupSchedulerStatus() {
  const perm = checkBackupsDirWritable(BACKUPS_DIR);
  return {
    enabled: schedulerState.enabled,
    scheduleTime: schedulerState.scheduleTime,
    intervalHours: schedulerState.intervalHours,
    keepCount: schedulerState.keepCount,
    lastBackupTime: schedulerState.lastBackupTime ? new Date(schedulerState.lastBackupTime).toISOString() : null,
    lastBackupFilename: schedulerState.lastBackupFilename,
    lastBackupStatus: schedulerState.lastBackupStatus,
    lastBackupError: schedulerState.lastBackupError,
    nextBackupTime: schedulerState.nextBackupTime ? new Date(schedulerState.nextBackupTime).toISOString() : null,
    isRunning: schedulerState.isRunning,
    isWritable: perm.writable,
    writableError: perm.error || null
  };
}

export function executeBackupJob(isManual = false) {
  if (schedulerState.isRunning) {
    return { success: false, error: 'Proces tworzenia kopii zapasowej jest już w toku.' };
  }

  schedulerState.isRunning = true;
  try {
    console.log(`[Backup Scheduler] Rozpoczynanie ${isManual ? 'ręcznej' : 'automatycznej cyklicznej'} kopii zapasowej...`);
    const res = createWikiBackup();
    if (res && res.success) {
      schedulerState.lastBackupTime = Date.now();
      schedulerState.lastBackupFilename = res.filename;
      schedulerState.lastBackupStatus = 'success';
      schedulerState.lastBackupError = null;
      schedulerState.nextBackupTime = computeNextRunTime({
        scheduleTime: schedulerState.scheduleTime,
        intervalHours: schedulerState.intervalHours,
        lastBackupTime: schedulerState.lastBackupTime
      });
      rotateBackups(schedulerState.keepCount);
      console.log(`[Backup Scheduler] Kopia pomyślnie zrealizowana: ${res.filename}`);
      return res;
    } else {
      schedulerState.lastBackupStatus = 'error';
      schedulerState.lastBackupError = res?.error || 'Nieznany błąd';
      console.error(`[Backup Scheduler] Błąd podczas tworzenia kopii: ${schedulerState.lastBackupError}`);
      return res;
    }
  } catch (err) {
    schedulerState.lastBackupStatus = 'error';
    schedulerState.lastBackupError = err.message;
    console.error('[Backup Scheduler Exception]', err);
    return { success: false, error: err.message };
  } finally {
    schedulerState.isRunning = false;
  }
}

export function initBackupScheduler(customConfig = {}) {
  const envEnabled = process.env.BACKUP_AUTO_ENABLED !== 'false';
  const rawScheduleTime = customConfig.scheduleTime !== undefined ? customConfig.scheduleTime : (process.env.BACKUP_SCHEDULE_TIME || '22:00');
  const parsedTime = parseScheduleTime(rawScheduleTime);
  const envInterval = parseInt(process.env.BACKUP_INTERVAL_HOURS || '24', 10) || 24;
  const envKeep = parseInt(process.env.BACKUP_KEEP_COUNT || '7', 10) || 7;

  schedulerState.enabled = customConfig.enabled !== undefined ? Boolean(customConfig.enabled) : envEnabled;
  schedulerState.scheduleTime = parsedTime ? parsedTime.formatted : null;
  schedulerState.intervalHours = Math.max(1, customConfig.intervalHours || envInterval);
  schedulerState.keepCount = Math.max(1, customConfig.keepCount || envKeep);

  const existingBackups = rotateBackups(schedulerState.keepCount);
  if (existingBackups.length > 0 && existingBackups[0].mtime) {
    schedulerState.lastBackupTime = new Date(existingBackups[0].mtime).getTime();
    schedulerState.lastBackupFilename = existingBackups[0].filename;
    schedulerState.lastBackupStatus = 'success';
  }

  const now = Date.now();

  // Weryfikacja potrzeby natychmiastowego nadrobienia kopii po starcie (np. brak jakiejkolwiek kopii)
  if (!schedulerState.lastBackupTime) {
    schedulerState.nextBackupTime = now + 30000;
  } else {
    const elapsed = now - schedulerState.lastBackupTime;
    const maxAgeMs = (schedulerState.intervalHours || 24) * 3600 * 1000;
    if (elapsed >= maxAgeMs) {
      schedulerState.nextBackupTime = now + 30000;
    } else {
      schedulerState.nextBackupTime = computeNextRunTime({
        scheduleTime: schedulerState.scheduleTime,
        intervalHours: schedulerState.intervalHours,
        lastBackupTime: schedulerState.lastBackupTime
      });
    }
  }

  const scheduleDesc = schedulerState.scheduleTime
    ? `codziennie o ${schedulerState.scheduleTime}`
    : `co ${schedulerState.intervalHours}h`;

  console.log(`[Backup Scheduler] Zainicjalizowano: ${scheduleDesc}, retencja ${schedulerState.keepCount} kopii. Następna kopia: ${new Date(schedulerState.nextBackupTime).toLocaleString('pl-PL')}`);

  if (schedulerState.ticker) {
    clearInterval(schedulerState.ticker);
  }

  schedulerState.ticker = setInterval(() => {
    if (!schedulerState.enabled || schedulerState.isRunning) return;
    if (schedulerState.nextBackupTime && Date.now() >= schedulerState.nextBackupTime) {
      executeBackupJob(false);
    }
  }, 60000);

  if (typeof schedulerState.ticker.unref === 'function') {
    schedulerState.ticker.unref();
  }

  return schedulerState;
}

export function stopBackupScheduler() {
  if (schedulerState.ticker) {
    clearInterval(schedulerState.ticker);
    schedulerState.ticker = null;
  }
}

// Bezpośrednie wywołanie ze skryptu: node backup_wiki.mjs
if (process.argv[1] && process.argv[1].endsWith('backup_wiki.mjs')) {
  createWikiBackup();
  rotateBackups(7);
}
