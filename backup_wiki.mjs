import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DOCS_DIR = path.resolve('docs');
const BACKUPS_DIR = path.resolve('backups');

if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

export function createWikiBackup() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
  const backupFileName = `wiki_backup_${timestamp}.zip`;
  const backupFilePath = path.join(BACKUPS_DIR, backupFileName);

  console.log(`[Backup Engine] Tworzenie kopii zapasowej bazy wiedzy: ${backupFileName}...`);

  try {
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Compress-Archive -Path '${DOCS_DIR}' -DestinationPath '${backupFilePath}' -Force"`, { stdio: 'pipe' });
    } else {
      execSync(`tar -czf "${backupFilePath.replace(/\.zip$/, '.tar.gz')}" -C "${DOCS_DIR}" .`, { stdio: 'pipe' });
    }

    console.log(`[Backup Engine] Kopia zapasowa utworzona pomyślnie w: ${backupFilePath}`);

    // Optional Google Drive Sync via rclone if configured
    const gdriveRemote = process.env.GOOGLE_DRIVE_REMOTE || '';
    if (gdriveRemote) {
      if (!/^[a-zA-Z0-9_\-\:\/]+$/.test(gdriveRemote)) {
        console.error('[Backup Engine Security] Niedozwolona nazwa zadanego parametru GOOGLE_DRIVE_REMOTE');
      } else {
        try {
          console.log(`[Backup Engine] Przesyłanie kopii zapasowej do Dysku Google (${gdriveRemote})...`);
          execSync(`rclone copy "${backupFilePath}" "${gdriveRemote}"`, { stdio: 'pipe' });
          console.log('[Backup Engine] Kopia pomyślnie wysłana na Dysk Google!');
        } catch (err) {
          console.warn('[Backup Engine] Wskazówka: Aby automatycznie wysyłać pliki na Dysk Google, zainstaluj narzędzie rclone i skonfiguruj remote (rclone config).');
        }
      }
    }

    return {
      success: true,
      filename: backupFileName,
      path: backupFilePath,
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

// Allow direct script execution: node backup_wiki.mjs
if (process.argv[1] && process.argv[1].endsWith('backup_wiki.mjs')) {
  createWikiBackup();
}
