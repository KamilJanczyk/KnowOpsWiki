import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { createWikiBackup, exportWikiZip, rotateBackups, BACKUPS_DIR } from './backup_wiki.mjs';
import { generateNavigation, extractMarkdownTags } from './build_navigation.mjs';
import { analyzeDocsFilenames } from './scripts/sync_markdown_filenames.mjs';

// Global uncaught exception handlers to prevent container crashes
process.on('uncaughtException', (err) => {
  console.error('[Wiki API Exception Handler] Wykryto nieobsłużony błąd (zamykanie procesu):', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Wiki API Exception Handler] Wykryto nieobsłużoną obietnicę:', reason);
});

let searchCache = [];

const PORT = process.env.API_PORT || 9000;
const rawAdminPassword = (process.env.ADMIN_PASSWORD || '').trim();
const ADMIN_PASSWORD = rawAdminPassword.length > 0 ? rawAdminPassword : null;
if (!ADMIN_PASSWORD) {
  console.log('[Wiki API] Tryb Single-User aktywny (brak ADMIN_PASSWORD w środowisku - autoryzacja wyłączona)');
}
const DOCS_DIR = path.resolve('docs');
const DOCS_EXAMPLE_DIR = path.resolve('docs.example');
if (!fs.existsSync(DOCS_DIR) || fs.readdirSync(DOCS_DIR).length === 0) {
  if (fs.existsSync(DOCS_EXAMPLE_DIR)) {
    console.log('[Wiki API] Inicjalizacja katalogu docs/ z szablonu docs.example/...');
    fs.cpSync(DOCS_EXAMPLE_DIR, DOCS_DIR, { recursive: true });
  } else {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }
}
const TRASH_DIR = path.join(DOCS_DIR, '.trash');
if (!fs.existsSync(TRASH_DIR)) {
  try { fs.mkdirSync(TRASH_DIR, { recursive: true }); } catch (e) {}
}

// Ścisła weryfikacja granic katalogu docs (ochrona przed Path Traversal i katalogami siostrzanymi)
export function isPathInsideDocs(targetPath, baseDir = DOCS_DIR) {
  if (!targetPath) return false;
  const resolvedTarget = path.resolve(targetPath);
  const resolvedBase = path.resolve(baseDir);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

// Atomowy zapis pliku (ochrona przed uszkodzeniem przy nagłym restarcie hosta/kontenera)
function atomicWriteFile(filePath, data, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  fs.writeFileSync(tmpPath, data, encoding);
  fs.renameSync(tmpPath, filePath);
}
export const DOCS_TRASH_MANIFEST_FILE = path.join(TRASH_DIR, 'trash_manifest.json');

export function getTrashManifest() {
  let manifest = [];
  if (fs.existsSync(DOCS_TRASH_MANIFEST_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DOCS_TRASH_MANIFEST_FILE, 'utf8'));
      if (Array.isArray(parsed)) manifest = parsed;
    } catch (e) {
      console.error('[Trash Manifest] Błąd odczytu manifestu:', e);
      manifest = [];
    }
  }

  // Weryfikacja spójności fizycznej w katalogu .trash
  if (fs.existsSync(TRASH_DIR)) {
    let physicalEntries = [];
    try {
      physicalEntries = fs.readdirSync(TRASH_DIR).filter(f => f !== 'trash_manifest.json');
    } catch (e) {
      physicalEntries = [];
    }
    const existingTrashFiles = new Set(manifest.map(m => m.trashFilename));

    // Auto-odkrywanie ewentualnych starszych elementów bez wpisu w manifeście
    for (const file of physicalEntries) {
      if (!existingTrashFiles.has(file)) {
        const fullPath = path.join(TRASH_DIR, file);
        let isDir = false;
        try { isDir = fs.statSync(fullPath).isDirectory(); } catch (e) {}
        manifest.push({
          id: `legacy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          trashFilename: file,
          originalRelPath: file.replace(/^\d+_DIR_/, '').replace(/^\d+_/, ''),
          name: file.replace(/^\d+_DIR_/, '').replace(/^\d+_/, ''),
          type: isDir ? 'directory' : 'file',
          deletedAt: new Date().toISOString()
        });
      }
    }
  }

  return manifest;
}

export function saveTrashManifest(items) {
  try {
    atomicWriteFile(DOCS_TRASH_MANIFEST_FILE, JSON.stringify(items, null, 2), 'utf8');
  } catch (e) {
    console.error('[Trash Manifest] Błąd zapisu manifestu:', e);
  }
}
const DIST_DIR = path.resolve('dist');
const IMAGES_DIR = path.join(path.resolve('public'), 'images');
if (!fs.existsSync(IMAGES_DIR)) {
  try { fs.mkdirSync(IMAGES_DIR, { recursive: true }); } catch (e) {}
}

export function getReferencedImages() {
  const referenced = new Set();
  function scanDocs(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.toLowerCase() === '.trash') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDocs(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          const matches = content.match(/[\w\-./\\]+\.(?:png|jpe?g|gif|webp|svg)/gi);
          if (matches) {
            for (const m of matches) {
              const clean = m.replace(/\\/g, '/').replace(/^\/+/, '');
              referenced.add(clean.toLowerCase());
              referenced.add(path.basename(clean).toLowerCase());
              const withoutImagesPrefix = clean.replace(/^(?:public\/)?images\//i, '');
              referenced.add(withoutImagesPrefix.toLowerCase());
            }
          }
        } catch (e) {}
      }
    }
  }
  scanDocs(DOCS_DIR);
  return referenced;
}

export function getOrphanedImagesList() {
  const referenced = getReferencedImages();
  const orphaned = [];
  let totalBytes = 0;

  function scanImagesDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanImagesDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) continue;

        const relPath = path.relative(IMAGES_DIR, fullPath).replace(/\\/g, '/');
        const filename = entry.name;

        const isReferenced = referenced.has(filename.toLowerCase()) || 
                             referenced.has(relPath.toLowerCase()) ||
                             referenced.has(`public/images/${relPath}`.toLowerCase()) ||
                             referenced.has(`images/${relPath}`.toLowerCase());

        if (!isReferenced) {
          try {
            const stat = fs.statSync(fullPath);
            totalBytes += stat.size;
            orphaned.push({
              filename: filename,
              relPath: relPath,
              size: stat.size,
              mtime: stat.mtime.toISOString(),
              url: `/public/images/${relPath}`
            });
          } catch (e) {}
        }
      }
    }
  }

  if (fs.existsSync(IMAGES_DIR)) {
    scanImagesDir(IMAGES_DIR);
  }

  orphaned.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

  return { orphaned, totalBytes, count: orphaned.length };
}

const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const TEMPLATES_FILE = path.join(DATA_DIR, 'task_templates.json');

const defaultTaskTemplates = [
  {
    id: "tpl_vm",
    name: "Wdrożenie Nowej Maszyny Wirtualnej (VM)",
    title: "Wdrożenie Maszyny Wirtualnej [Nazwa]",
    category: "SysAdmin",
    priority: "high",
    description: "Utworzenie, sieciowanie i zabezpieczenie nowej maszyny wirtualnej w środowisku Proxmox/VMware.",
    subtasks: [
      "Utworzenie VM i przydzielenie zasobów vCPU/RAM/NVMe",
      "Instalacja systemu operacyjnego i konfiguracja IP/Netplan",
      "Instalacja agentów zarządzania (QEMU Guest Agent / Zabbix)",
      "Wykonanie wstępnego punktu przywracania (Snapshot)"
    ]
  },
  {
    id: "tpl_sec",
    name: "Audyt Bezpieczeństwa Serwera Linux",
    title: "Audyt Bezpieczeństwa i Hardening [Hostname]",
    category: "CyberSec",
    priority: "high",
    description: "Kompleksowy przegląd kont, uszczelnienie konfiguracji SSH, skanowanie Lynis oraz uaktualnienie pakietów.",
    subtasks: [
      "Weryfikacja kont użytkowników i uprawnień sudo",
      "Hardening sshd_config i weryfikacja kluczy ED25519",
      "Uruchomienie audytu podatności Lynis",
      "Zastosowanie krytycznych łatek bezpieczeństwa"
    ]
  },
  {
    id: "tpl_vpn",
    name: "Konfiguracja Tunelu VPN / Firewall",
    title: "Konfiguracja Tunelu VPN IPsec / WireGuard",
    category: "Network",
    priority: "medium",
    description: "Zestawienie zabezpieczonego połączenia VPN pomiędzy lokalizacjami lub dla użytkowników zdalnych.",
    subtasks: [
      "Wyznaczenie podsieci adresowej i bramki",
      "Wygenerowanie kluczy i certyfikatów",
      "Konfiguracja reguł przepuszczających w zaporze (Firewall)",
      "Weryfikacja połączenia i test przepustowości iperf3"
    ]
  }
];

if (!fs.existsSync(TEMPLATES_FILE)) {
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify({ templates: defaultTaskTemplates }, null, 2), 'utf-8');
}
const KANBAN_FILE = path.join(DATA_DIR, 'kanban_data.json');
const QUICK_NOTES_FILE = path.join(DATA_DIR, 'quick_notes.json');

// Migration: Copy old files from DOCS_DIR if DATA_DIR files do not exist yet
const oldKanban = path.join(DOCS_DIR, 'kanban_data.json');
if (fs.existsSync(oldKanban) && !fs.existsSync(KANBAN_FILE)) {
  fs.copyFileSync(oldKanban, KANBAN_FILE);
}

const oldNotes = path.join(DOCS_DIR, 'quick_notes.json');
if (fs.existsSync(oldNotes) && !fs.existsSync(QUICK_NOTES_FILE)) {
  fs.copyFileSync(oldNotes, QUICK_NOTES_FILE);
}




if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

if (!fs.existsSync(KANBAN_FILE)) {
  fs.writeFileSync(KANBAN_FILE, JSON.stringify({ tasks: [] }, null, 2));
}

if (!fs.existsSync(QUICK_NOTES_FILE)) {
  fs.writeFileSync(QUICK_NOTES_FILE, JSON.stringify({ notes: [] }, null, 2));
}

const SCRATCHPAD_FILE = path.join(DATA_DIR, 'scratchpad_data.json');
if (!fs.existsSync(SCRATCHPAD_FILE)) {
  fs.writeFileSync(SCRATCHPAD_FILE, JSON.stringify({ content: '', checklist: [] }, null, 2));
}

// RSS Security Bulletins [dodane]
const RSS_FEEDS_FILE = path.join(DATA_DIR, 'rss_feeds.json');
const defaultRssFeeds = [
  { id: 'cert_pl',        name: 'CERT Polska',             url: 'https://www.cert.pl/feed/',                              enabled: true  },
  { id: 'cisa',           name: 'CISA Advisories',         url: 'https://www.cisa.gov/news.xml',                          enabled: true  },
  { id: 'thehackernews', name: 'The Hacker News',          url: 'https://feeds.feedburner.com/TheHackersNews',            enabled: true  },
  { id: 'bleepingcomp',   name: 'BleepingComputer',        url: 'https://www.bleepingcomputer.com/feed/',                 enabled: false },
  { id: 'sekurak',        name: 'Sekurak.pl',              url: 'https://sekurak.pl/feed/',                               enabled: false }
];
if (!fs.existsSync(RSS_FEEDS_FILE)) {
  fs.writeFileSync(RSS_FEEDS_FILE, JSON.stringify({ feeds: defaultRssFeeds }, null, 2), 'utf-8');
}

// Procedury i Playbooki wieloetapowe (Multi-Stage Runbooks)
const PLAYBOOKS_FILE = path.join(DATA_DIR, 'playbooks_data.json');
const defaultPlaybooks = [
  {
    id: 'pb_default_linux_deploy',
    title: 'Wdrożenie Nowego Węzła Serwerowego Linux',
    category: 'Infrastruktura',
    description: 'Procedura instalacji, konfiguracji sieciowej i utwardzenia systemu Linux.',
    createdAt: '2026-09-04',
    stages: [
      {
        id: 'st_1',
        title: 'Etap A: Rekonesans i Konfiguracja Bazowa',
        tasks: [
          { id: 'tsk_1_1', title: 'Weryfikacja parametrów sprzętowych (CPU, RAM, RAID)', done: false },
          { id: 'tsk_1_2', title: 'Konfiguracja statycznej adresacji IP, DNS oraz NTP', done: false },
          { id: 'tsk_1_3', title: 'Aktualizacja pakietów systemowych i repozytoriów', done: false }
        ]
      },
      {
        id: 'st_2',
        title: 'Etap B: Hardening i Bezpieczeństwo (SecOps)',
        tasks: [
          { id: 'tsk_2_1', title: 'Konfiguracja SSH (klucze ed25519, wyłączenie logowania root)', done: false },
          { id: 'tsk_2_2', title: 'Uruchomienie i konfiguracja zapory sieciowej (UFW / NFTables)', done: false },
          { id: 'tsk_2_3', title: 'Wdrożenie ochrony Fail2ban oraz audytu logów auditd', done: false }
        ]
      },
      {
        id: 'st_3',
        title: 'Etap C: Monitoring, Kopie Zapasowe i Odbiór',
        tasks: [
          { id: 'tsk_3_1', title: 'Instalacja i podpięcie agenta monitoringu', done: false },
          { id: 'tsk_3_2', title: 'Konfiguracja harmonogramu kopii zapasowych i test odzyskania', done: false },
          { id: 'tsk_3_3', title: 'Utworzenie dokumentacji as-built w KnowOpsWiki', done: false }
        ]
      }
    ]
  }
];
if (!fs.existsSync(PLAYBOOKS_FILE)) {
  fs.writeFileSync(PLAYBOOKS_FILE, JSON.stringify({ playbooks: defaultPlaybooks }, null, 2), 'utf-8');
}

const activeTokens = new Map();
const loginAttempts = new Map();

const mutatingAttempts = new Map();

// Garbage collection / czyszczenie nieaktywnych wpisów w pamięci co 30 minut
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginAttempts.entries()) {
    if (now - data.firstAttempt > 3600000) loginAttempts.delete(ip);
  }
  for (const [ip, data] of mutatingAttempts.entries()) {
    if (now - data.firstAttempt > 3600000) mutatingAttempts.delete(ip);
  }
  for (const [token, createdAt] of activeTokens.entries()) {
    if (now - createdAt > 24 * 60 * 60 * 1000) activeTokens.delete(token);
  }
}, 30 * 60 * 1000);
 // ip -> { count, firstAttempt }
function checkMutatingRateLimit(req, res, maxRequests = 30) {
  const clientIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let attempts = mutatingAttempts.get(clientIp) || { count: 0, firstAttempt: now };
  if (now - attempts.firstAttempt > 60000) {
    attempts = { count: 0, firstAttempt: now };
  }
  attempts.count += 1;
  mutatingAttempts.set(clientIp, attempts);
  if (attempts.count > maxRequests) {
    console.warn(`[SECURITY EVENT] Wykryto przekroczenie limitu operacji modyfikacji z IP ${clientIp}`);
    sendJson(429, { error: 'Przekroczono limit dozwolonych operacji zapisu/modyfikacji. Spróbuj za minutę.' });
    return false;
  }
  return true;
}
 // ip -> { count, firstAttempt } // token => createdAt timestamp

function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  activeTokens.set(token, Date.now());
  return token;
}

function verifyAuth(req) {
  // Wariant B: Tryb Single-User / bezhaslowy (brak blokad autoryzacji tokenowej)
  return true;
}



function convertHtmlToMarkdown(html) {
  let md = html;

  // Nagłówki
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');

  // Pogrubienia i pochylenia
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // Bloki kodu i kod liniowy
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Linki
  md = md.replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  // Listy
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, '\n$1\n');
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, '\n$1\n');

  // Akapity i przełamania linii
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Usuwanie pozostałych tagów HTML
  md = md.replace(/<[^>]+>/g, '');

  // Dekodowanie encji HTML
  md = md.replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>')
         .replace(/&amp;/g, '&')
         .replace(/&quot;/g, '"')
         .replace(/&#39;/g, "'");

  return md.trim();
}

// Funkcja parsująca RSS / Atom (XML) przy użyciu Regex [dodane]
function parseRssFeed(xmlText) {
  const items = [];
  
  // Wyszukiwanie tagów <item> (RSS) lub <entry> (Atom)
  const itemRegex = /<(item|entry)[^>]*>([\s\S]*?)<\/\1>/g;
  let match;
  
  const cleanXmlTags = (str) => {
    if (!str) return '';
    // Wyciąganie zawartości CDATA, jeśli istnieje
    const cdataMatch = str.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cdataMatch) return cdataMatch[1].trim();
    return str.replace(/<[^>]+>/g, '').trim();
  };

  const decodeHtmlEntities = (str) => {
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");
  };

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const itemContent = match[2];
    
    // Parsowanie pól (szuka tagów z lub bez namespace)
    const titleMatch = itemContent.match(/<(title)[^>]*>([\s\S]*?)<\/\1>/);
    const linkMatch = itemContent.match(/<(link)[^>]*>([\s\S]*?)<\/\1>/) || itemContent.match(/<link\s+[^>]*href=["']([^"']+)["']/);
    const pubDateMatch = itemContent.match(/<(pubDate|published|updated)[^>]*>([\s\S]*?)<\/\1>/);
    const descMatch = itemContent.match(/<(description|summary|content)[^>]*>([\s\S]*?)<\/\1>/);
    
    let link = '';
    if (linkMatch) {
      link = linkMatch[2] ? cleanXmlTags(linkMatch[2]) : (linkMatch[1] || '');
    }

    const title = titleMatch ? decodeHtmlEntities(cleanXmlTags(titleMatch[2])) : 'Brak tytułu';
    const pubDate = pubDateMatch ? cleanXmlTags(pubDateMatch[2]) : '';
    const description = descMatch ? decodeHtmlEntities(cleanXmlTags(descMatch[2])) : '';

    items.push({
      title,
      link,
      pubDate,
      description: description.substring(0, 300) + (description.length > 300 ? '...' : '')
    });
  }

  return items;
}

// Rebuild static HTML pages with lock mechanism & speed optimization
let isRebuilding = false;
let rebuildPending = false;
let isApiSaving = false;

async function rebuildWiki() {
  if (isRebuilding) {
    rebuildPending = true;
    return { success: true, message: 'Kompilacja w kolejce...' };
  }

  isRebuilding = true;
  try {
    const navData = generateNavigation();
    isRebuilding = false;

    if (rebuildPending) {
      rebuildPending = false;
      setImmediate(() => rebuildWiki());
    }
    return { success: true, message: `Sukces: wygenerowano ${navData.categories.length} kategorii.` };
  } catch (err) {
    isRebuilding = false;
    console.error('[Wiki API] Błąd kompilacji nawigacji:', err);
    return { success: false, error: err.message };
  }
}

// Automatic File System Watcher (Safely handled across OS platforms including Linux/Docker)
let watchDebounceTimer = null;
try {
  const watchOptions = (process.platform === 'win32' || process.platform === 'darwin') ? { recursive: true } : {};
  fs.watch(DOCS_DIR, watchOptions, (eventType, filename) => {
    if (isApiSaving) return;
    if (!filename || filename.includes('node_modules') || filename.includes('.git') || filename.includes('dist')) return;
    if (!filename.endsWith('.md') && !filename.includes('public')) return;
    if (filename.includes('kanban_data.json') || filename.includes('quick_notes.json') || filename.includes('scratchpad_data.json')) return;

    if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
    watchDebounceTimer = setTimeout(() => {
      console.log(`[Wiki Watcher] Wykryto zmianę w plikach (${eventType}): ${filename}. Auto-rekompilacja...`);
      rebuildWiki().catch(e => console.error('[Wiki Watcher] Błąd:', e));
    }, 800);
  });
  console.log('[Wiki Watcher] Automatyczny obserwator plikow w katalogu docs aktywny.');
} catch (err) {
  console.warn('[Wiki Watcher] Ostrzeżenie: Obserwator plików nie został uruchomiony:', err.message);
}

// HTTP Server API
const server = http.createServer(async (req, res) => {
  // CORS - ograniczenie do wlasnego hosta (bez refleksji Origin)
  const requestHost = req.headers['host'] || 'localhost';
  res.setHeader('Access-Control-Allow-Origin', `http://${requestHost}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');


  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = reqUrl.pathname.replace(/\/$/, '');
  while (pathname.startsWith('/api/api')) {
    pathname = pathname.replace('/api/api', '/api');
  }
  if (!pathname.startsWith('/api')) {
    pathname = '/api' + (pathname.startsWith('/') ? pathname : '/' + pathname);
  }
  const normPath = pathname;

  const sendJson = (status, data) => {
    try {
      if (!res.headersSent) {
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
      }
    } catch (e) {
      console.error('[Wiki API] Błąd wysyłania odpowiedzi JSON:', e);
    }
  };

  const getBody = () => new Promise((resolve, reject) => {
    let body = '';
    const bodyTimeout = setTimeout(() => {
      req.destroy();
      reject(new Error('BODY_TIMEOUT'));
    }, 30000);
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 10 * 1024 * 1024) {
        clearTimeout(bodyTimeout);
        req.destroy();
        sendJson(413, { error: 'Zapytanie zbyt duze. Maksymalny rozmiar to 10 MB.' });
        return reject(new Error('REQUEST_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      clearTimeout(bodyTimeout);
      if (!body || !body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        console.warn('[Wiki API Warning] Blad parsowania JSON body:', e.message, 'Przekazana tresc:', body.slice(0, 100));
        resolve({});
      }
    });
  });

  try {
    // normPath defined above

    if (normPath === '/api/login' && req.method === 'POST') {
      const clientIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      let attempts = loginAttempts.get(clientIp) || { count: 0, firstAttempt: now };
      if (now - attempts.firstAttempt > 60000) {
        attempts = { count: 0, firstAttempt: now };
      }
      if (attempts.count >= 5) {
        console.warn(`[SECURITY WARNING] Wykryto próbę Brute-Force z IP ${clientIp}`);
        return sendJson(429, { error: 'Zbyt wiele nieudanych prób logowania. Spróbuj za minutę.' });
      }

      const body = await getBody();
      let passwordMatch = false;
      if (ADMIN_PASSWORD && body.password) {
        try {
          const inputBuf = Buffer.from(String(body.password), 'utf8');
          const secretBuf = Buffer.from(ADMIN_PASSWORD, 'utf8');
          passwordMatch = inputBuf.length === secretBuf.length && crypto.timingSafeEqual(inputBuf, secretBuf);
        } catch { passwordMatch = false; }
      }
      if (passwordMatch) {
        loginAttempts.delete(clientIp);
        const token = generateToken();
        return sendJson(200, { success: true, token });
      } else {
        attempts.count += 1;
        loginAttempts.set(clientIp, attempts);
        console.warn(`[SECURITY EVENT] Nieudane logowanie z IP ${clientIp}`);
        return sendJson(401, { success: false, error: 'Nieprawidłowe hasło administratora' });
      }
    }

    if (normPath === '/api/check-auth' && req.method === 'GET') {
      const authenticated = verifyAuth(req);
      return sendJson(200, { authenticated });
    }

    if (normPath.includes('task-templates') && req.method === 'GET') {
      if (fs.existsSync(TEMPLATES_FILE)) {
        const data = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
        return sendJson(200, data);
      }
      return sendJson(200, { templates: defaultTaskTemplates });
    }

    if (normPath.includes('task-templates') && req.method === 'POST') {
      const body = await getBody();
      if (!body.templates || !Array.isArray(body.templates)) {
        return sendJson(400, { error: 'Wymagana tablica templates' });
      }
      atomicWriteFile(TEMPLATES_FILE, JSON.stringify({ templates: body.templates }, null, 2), 'utf8');
      return sendJson(200, { success: true, message: 'Szablony zadań zostały zapisane.' });
    }

    if (normPath === '/api/kanban' && req.method === 'GET') {
      if (fs.existsSync(KANBAN_FILE)) {
        const data = JSON.parse(fs.readFileSync(KANBAN_FILE, 'utf8'));
        return sendJson(200, data);
      }
      return sendJson(200, { tasks: [] });
    }

    if (normPath === '/api/quick-notes' && req.method === 'GET') {
      if (fs.existsSync(QUICK_NOTES_FILE)) {
        const data = JSON.parse(fs.readFileSync(QUICK_NOTES_FILE, 'utf8'));
        return sendJson(200, data);
      }
      return sendJson(200, { notes: [] });
    }

    if (normPath === '/api/scratchpad' && req.method === 'GET') {
      if (fs.existsSync(SCRATCHPAD_FILE)) {
        try {
          const data = JSON.parse(fs.readFileSync(SCRATCHPAD_FILE, 'utf8'));
          return sendJson(200, {
            content: typeof data.content === 'string' ? data.content : '',
            checklist: Array.isArray(data.checklist) ? data.checklist : [],
            updatedAt: data.updatedAt || null
          });
        } catch (e) {
          console.error('[Wiki API] Błąd odczytu scratchpad_data.json:', e);
        }
      }
      return sendJson(200, { content: '', checklist: [], updatedAt: null });
    }

    if (normPath === '/api/playbooks' && req.method === 'GET') {
      if (fs.existsSync(PLAYBOOKS_FILE)) {
        try {
          const data = JSON.parse(fs.readFileSync(PLAYBOOKS_FILE, 'utf8'));
          return sendJson(200, data);
        } catch (e) {
          console.error('[Wiki API] Błąd odczytu playbooks_data.json:', e);
        }
      }
      return sendJson(200, { playbooks: [] });
    }


    if (normPath === '/api/server-stats' && req.method === 'GET') {
      try {
        const startCpuTimes = os.cpus().map(cpu => cpu.times);
        await new Promise(resolve => setTimeout(resolve, 100));
        const endCpuTimes = os.cpus().map(cpu => cpu.times);

        let idleDiff = 0;
        let totalDiff = 0;
        for (let i = 0; i < startCpuTimes.length; i++) {
          const s = startCpuTimes[i];
          const e = endCpuTimes[i];
          const sTotal = s.user + s.nice + s.sys + s.idle + s.irq;
          const eTotal = e.user + e.nice + e.sys + e.idle + e.irq;
          totalDiff += (eTotal - sTotal);
          idleDiff += (e.idle - s.idle);
        }
        const cpuUsage = totalDiff > 0 ? (1 - idleDiff / totalDiff) * 100 : 0;

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const ramUsagePercent = (usedMem / totalMem) * 100;

        let disk = { total: 0, used: 0, free: 0, percent: 0 };
        try {
          const dfOutput = await new Promise((resolve, reject) => {
            execFile('df', ['-B1', '/'], (err, stdout) => {
              if (err) reject(err);
              else resolve(stdout);
            });
          });
          const lines = dfOutput.trim().split('\n');
          if (lines.length >= 2) {
            const parts = lines[1].split(/\s+/).filter(Boolean);
            if (parts.length >= 5) {
              disk.total = parseInt(parts[1], 10);
              disk.used = parseInt(parts[2], 10);
              disk.free = parseInt(parts[3], 10);
              disk.percent = disk.total > 0 ? (disk.used / disk.total) * 100 : 0;
            }
          }
        } catch (e) {
          console.warn('Błąd odczytu dysku df:', e.message);
        }

        const osInfo = {
          platform: os.platform(),
          release: os.release(),
          type: os.type(),
          uptime: os.uptime(),
          hostname: os.hostname(),
          cpuModel: os.cpus().length > 0 ? os.cpus()[0].model : 'Nieznany',
          cpuCores: os.cpus().length
        };

        return sendJson(200, {
          cpu: { usage: cpuUsage },
          ram: { total: totalMem, used: usedMem, free: freeMem, percent: ramUsagePercent },
          disk,
          os: osInfo
        });

      } catch (err) {
        console.error('[Wiki API Server Stats Error]', err);
        return sendJson(500, { error: 'Błąd pobierania statystyk serwera.' });
      }
    }

    if (normPath === '/api/search' && req.method === 'GET') {
      const query = reqUrl.searchParams.get('q') || '';
      if (!query.trim()) {
        return sendJson(200, { results: [] });
      }

      const results = [];
      const searchTokens = query.toLowerCase().split(/\s+/).filter(Boolean);

      searchCache.forEach(item => {
        const titleLower = item.title.toLowerCase();
        const allTokensMatch = searchTokens.every(token => {
          if (token.startsWith('#')) {
            const cleanTag = token.slice(1).toLowerCase();
            return item.tags && item.tags.some(t => t.toLowerCase() === cleanTag);
          }
          return item.contentLower.includes(token) || 
                 titleLower.includes(token) || 
                 (item.tags && item.tags.some(t => t.toLowerCase().includes(token)));
        });

        if (allTokensMatch) {
          let snippet = '';
          const firstToken = searchTokens[0] || '';
          const idx = item.contentLower.indexOf(firstToken);
          if (idx !== -1) {
            const start = Math.max(0, idx - 40);
            const end = Math.min(item.content.length, idx + firstToken.length + 80);
            snippet = item.content.substring(start, end).replace(/\r?\n/g, ' ');
          } else {
            snippet = item.content.substring(0, 120).replace(/\r?\n/g, ' ');
          }

          results.push({
            relPath: item.relPath,
            title: item.title,
            snippet: snippet.trim(),
            tags: item.tags || []
          });
        }
      });

      return sendJson(200, { results });
    }

    if (normPath === '/api/get-page' && req.method === 'GET') {
      const relPath = reqUrl.searchParams.get('relPath');
      if (!relPath) return sendJson(400, { error: 'Brak parametru relPath' });

      const targetPath = path.resolve(DOCS_DIR, relPath);
      if (!isPathInsideDocs(targetPath) || !fs.existsSync(targetPath)) {
        return sendJson(404, { error: 'Plik nie istnieje' });
      }

      const stat = fs.statSync(targetPath);
      const content = fs.readFileSync(targetPath, 'utf8');
      return sendJson(200, { relPath, content, mtime: stat.mtime.toISOString() });
    }

    if (normPath === '/api/navigation' && req.method === 'GET') {
      const navFile = path.join(DOCS_DIR, 'navigation.json');
      if (fs.existsSync(navFile)) {
        try {
          const navData = JSON.parse(fs.readFileSync(navFile, 'utf8'));
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
          return sendJson(200, navData);
        } catch (e) {
          console.error('[Wiki API] Błąd odczytu navigation.json:', e);
        }
      }
      return sendJson(200, { categories: [] });
    }

    if (normPath === '/api/rescan' && (req.method === 'POST' || req.method === 'GET')) {
      console.log('[Wiki API] Ręczne odświeżenie i skanowanie bazy wiedzy...');
      const rescanResult = await rebuildWiki();
      rebuildSearchCache();
      return sendJson(200, { success: true, result: rescanResult });
    }

    if (normPath === '/api/create-page' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { categoryRel, filename, content } = body;
      if (!categoryRel || !filename) {
        return sendJson(400, { error: 'Wymagane parametry: categoryRel oraz filename' });
      }

      // Sanityzacja categoryRel (ochrona przed path traversal)
      let sanitizedCatRel = categoryRel.replace(/\\/g, '/').replace(/[<>:"|?*\x00]/g, '_');
      sanitizedCatRel = sanitizedCatRel.split('/').map(p => p === '..' ? '__' : p).filter(Boolean).join('/');

      let decodedFilename = decodeURIComponent(filename);
      let normalizedPath = decodedFilename.trim().replace(/\\/g, '/');
      normalizedPath = normalizedPath.replace(/[<>:"|?*\x00]/g, '_');
      let parts = normalizedPath.split('/').map(part => part === '..' ? '__' : part).filter(Boolean);
      let relativeFilePath = parts.join('/');
      if (!relativeFilePath.endsWith('.md')) relativeFilePath += '.md';

      const fullFilePath = path.resolve(DOCS_DIR, sanitizedCatRel, relativeFilePath);
      if (!isPathInsideDocs(fullFilePath)) {
        return sendJson(403, { error: 'Dostep zabroniony' });
      }

      const targetDir = path.dirname(fullFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const articleContent = content || `# ${path.basename(fullFilePath, '.md').replace(/_/g, ' ')}\n\nNowy artykuł stworzony z poziomu panelu Wiki.`;
      atomicWriteFile(fullFilePath, articleContent, 'utf8');
      console.log(`[Wiki API] Utworzono plik i podkatalogi: ${fullFilePath}`);
      await rebuildWiki();
      rebuildSearchCache();
      return sendJson(200, { success: true, message: 'Nowy artykuł został utworzony.', relPath: path.relative(DOCS_DIR, fullFilePath) });
    }

    if (normPath === '/api/delete-page' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { relPath } = body;
      if (!relPath) return sendJson(400, { error: 'Brak parametru relPath' });

      const targetPath = path.resolve(DOCS_DIR, relPath);
      if (!isPathInsideDocs(targetPath) || !fs.existsSync(targetPath)) {
        return sendJson(404, { error: 'Plik nie istnieje' });
      }

      // Bezpieczny kosz (Obsidian-style trash bin) - zachowaj plik w .trash przed usunięciem
      try {
        const trashFilename = `${Date.now()}_${path.basename(targetPath)}`;
        const trashPath = path.join(TRASH_DIR, trashFilename);
        fs.renameSync(targetPath, trashPath);
        console.log(`[Wiki API] Przeniesiono plik do kosza (.trash): ${trashFilename}`);

        const manifest = getTrashManifest();
        manifest.unshift({
          id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          trashFilename,
          originalRelPath: relPath.replace(/\\/g, '/'),
          name: path.basename(targetPath),
          type: 'file',
          deletedAt: new Date().toISOString()
        });
        saveTrashManifest(manifest);
      } catch (err) {
        fs.unlinkSync(targetPath);
        console.log(`[Wiki API] Usunięto plik (bezpośrednio): ${relPath}`);
      }

      const parentDir = path.dirname(targetPath);
      if (parentDir !== DOCS_DIR && fs.existsSync(parentDir)) {
        const remaining = fs.readdirSync(parentDir);
        if (remaining.length === 0) {
          try { fs.rmdirSync(parentDir); } catch (e) {}
          console.log(`[Wiki API] Usunięto pusty podkatalog: ${parentDir}`);
        }
      }

      await rebuildWiki();
      rebuildSearchCache();
      return sendJson(200, { success: true, message: 'Artykuł został usunięty.' });
    }

    if (normPath === '/api/delete-folder' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { relPath } = body;
      if (!relPath || typeof relPath !== 'string') {
        return sendJson(400, { error: 'Brak parametru relPath' });
      }

      const decodedRel = decodeURIComponent(relPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const parts = decodedRel.split('/').map(p => p.trim()).filter(Boolean);

      if (parts.length === 0 || parts.some(p => p === '..' || p === '.' || p.includes('\0'))) {
        return sendJson(400, { error: 'Nieprawidłowa ścieżka katalogu' });
      }

      const targetPath = path.resolve(DOCS_DIR, ...parts);
      const docsBase = path.resolve(DOCS_DIR);
      const trashBase = path.resolve(TRASH_DIR);

      if (!isPathInsideDocs(targetPath, docsBase)) {
        return sendJson(403, { error: 'Dostęp zablokowany: ścieżka poza katalogiem dokumentacji' });
      }

      if (targetPath === docsBase) {
        return sendJson(403, { error: 'Niedozwolona operacja: nie można usunąć katalogu głównego bazy wiedzy' });
      }

      if (targetPath === trashBase || targetPath.startsWith(trashBase + path.sep)) {
        return sendJson(403, { error: 'Niedozwolona operacja: nie można usunąć katalogu kosza systemowego' });
      }

      if (!fs.existsSync(targetPath)) {
        return sendJson(404, { error: 'Katalog nie istnieje' });
      }

      const stat = fs.statSync(targetPath);
      if (!stat.isDirectory()) {
        return sendJson(400, { error: 'Wskazana ścieżka nie jest katalogiem' });
      }

      const folderBaseName = path.basename(targetPath);
      const trashFolderName = `${Date.now()}_DIR_${folderBaseName}`;
      const destinationTrashPath = path.join(TRASH_DIR, trashFolderName);

      isApiSaving = true;
      try {
        fs.renameSync(targetPath, destinationTrashPath);
        console.log(`[Wiki API] Przeniesiono cały katalog do kosza (.trash): ${decodedRel} -> ${trashFolderName}`);
        const manifest = getTrashManifest();
        manifest.unshift({
          id: `dir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          trashFilename: trashFolderName,
          originalRelPath: decodedRel,
          name: folderBaseName,
          type: 'directory',
          deletedAt: new Date().toISOString()
        });
        saveTrashManifest(manifest);
      } catch (renameErr) {
        console.warn(`[Wiki API] renameSync folderu nie powiodło się, próba cpSync i rmSync: ${renameErr.message}`);
        try {
          fs.cpSync(targetPath, destinationTrashPath, { recursive: true });
          fs.rmSync(targetPath, { recursive: true, force: true });
          console.log(`[Wiki API] Skopiowano do kosza i usunięto katalog: ${decodedRel}`);
          const manifest = getTrashManifest();
          manifest.unshift({
            id: `dir_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            trashFilename: trashFolderName,
            originalRelPath: decodedRel,
            name: folderBaseName,
            type: 'directory',
            deletedAt: new Date().toISOString()
          });
          saveTrashManifest(manifest);
        } catch (rmErr) {
          isApiSaving = false;
          console.error('[Wiki API] Błąd podczas usuwania katalogu:', rmErr);
          return sendJson(500, { error: `Błąd uprawnień lub operacji na plikach: ${rmErr.message}` });
        }
      }

      await rebuildWiki();
      rebuildSearchCache();
      setTimeout(() => { isApiSaving = false; }, 1500);

      return sendJson(200, {
        success: true,
        message: `Katalog ${folderBaseName} został pomyślnie usunięty (zabezpieczony w koszu).`,
        deletedRelPath: decodedRel
      });
    }

    if (normPath === '/api/move-folder' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { sourceRelPath, targetParentRelPath, newFolderName } = body;

      if (!sourceRelPath || typeof sourceRelPath !== 'string') {
        return sendJson(400, { error: 'Wymagany parametr sourceRelPath' });
      }

      const decodedSource = decodeURIComponent(sourceRelPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const sourceParts = decodedSource.split('/').map(p => p.trim()).filter(Boolean);

      if (sourceParts.length === 0 || sourceParts.some(p => p === '..' || p === '.' || p.includes('\0') || /[<>:"|?*]/.test(p))) {
        return sendJson(400, { error: 'Nieprawidłowa ścieżka źródłowa folderu' });
      }

      const docsBase = path.resolve(DOCS_DIR);
      const trashBase = path.resolve(TRASH_DIR);
      const sourcePath = path.resolve(DOCS_DIR, ...sourceParts);

      if (!isPathInsideDocs(sourcePath, docsBase)) {
        return sendJson(403, { error: 'Dostęp zablokowany: ścieżka źródłowa poza katalogiem bazy wiedzy' });
      }
      if (sourcePath === docsBase) {
        return sendJson(403, { error: 'Niedozwolona operacja: nie można przenieść katalogu głównego bazy wiedzy' });
      }
      if (sourcePath === trashBase || sourcePath.startsWith(trashBase + path.sep)) {
        return sendJson(403, { error: 'Niedozwolona operacja: nie można manipulować koszem systemowym' });
      }
      if (!fs.existsSync(sourcePath)) {
        return sendJson(404, { error: 'Folder źródłowy nie istnieje' });
      }
      const sourceStat = fs.statSync(sourcePath);
      if (!sourceStat.isDirectory()) {
        return sendJson(400, { error: 'Wskazana ścieżka źródłowa nie jest katalogiem' });
      }

      // Weryfikacja katalogu docelowego nadrzędnego (targetParentRelPath moze byc puste dla korzenia docs/)
      const decodedTargetParent = (targetParentRelPath ? decodeURIComponent(targetParentRelPath) : '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      let targetParentParts = [];
      if (decodedTargetParent.length > 0) {
        targetParentParts = decodedTargetParent.split('/').map(p => p.trim()).filter(Boolean);
        if (targetParentParts.some(p => p === '..' || p === '.' || p.includes('\0') || /[<>:"|?*]/.test(p))) {
          return sendJson(400, { error: 'Nieprawidłowa ścieżka katalogu docelowego' });
        }
      }

      const targetParentPath = path.resolve(DOCS_DIR, ...targetParentParts);
      if (!isPathInsideDocs(targetParentPath, docsBase)) {
        return sendJson(403, { error: 'Dostęp zablokowany: katalog docelowy poza bazą wiedzy' });
      }
      if (targetParentPath === trashBase || targetParentPath.startsWith(trashBase + path.sep)) {
        return sendJson(403, { error: 'Niedozwolona operacja: nie można przenosić do kosza tą metodą' });
      }
      if (!fs.existsSync(targetParentPath) || !fs.statSync(targetParentPath).isDirectory()) {
        return sendJson(404, { error: 'Katalog docelowy nie istnieje' });
      }

      // Nazwa docelowa folderu
      let finalFolderName = (newFolderName && typeof newFolderName === 'string' ? decodeURIComponent(newFolderName) : '').trim();
      finalFolderName = finalFolderName.replace(/[<>:"|?*\x00/\\]/g, '_').trim();
      if (!finalFolderName || finalFolderName === '.' || finalFolderName === '..') {
        finalFolderName = path.basename(sourcePath);
      }

      const targetPath = path.resolve(targetParentPath, finalFolderName);
      if (!isPathInsideDocs(targetPath, docsBase)) {
        return sendJson(400, { error: 'Nieprawidłowa ścieżka końcowa folderu' });
      }

      // Blokada cykli / samozagnieżdżenia
      if (targetPath === sourcePath || targetPath.startsWith(sourcePath + path.sep) || targetParentPath === sourcePath || targetParentPath.startsWith(sourcePath + path.sep)) {
        return sendJson(400, { error: 'Niedozwolona operacja: nie można przenieść katalogu do samego siebie ani do jego podkatalogu.' });
      }

      // Blokada braku zmiany
      if (sourcePath === targetPath) {
        return sendJson(400, { error: 'Folder znajduje się już w wybranej lokalizacji z tą samą nazwą.' });
      }

      // Ochrona przed kolizją / nadpisaniem
      if (fs.existsSync(targetPath)) {
        return sendJson(409, { error: 'Katalog o podanej nazwie już istnieje w lokalizacji docelowej.' });
      }

      isApiSaving = true;
      try {
        fs.renameSync(sourcePath, targetPath);
        console.log(`[Wiki API] Przeniesiono folder: ${decodedSource} -> ${path.relative(DOCS_DIR, targetPath)}`);
      } catch (renameErr) {
        console.warn(`[Wiki API] renameSync folderu nie powiodło się, próba cpSync i rmSync: ${renameErr.message}`);
        try {
          fs.cpSync(sourcePath, targetPath, { recursive: true });
          fs.rmSync(sourcePath, { recursive: true, force: true });
          console.log(`[Wiki API] Skopiowano i usunięto źródłowy folder: ${decodedSource}`);
        } catch (copyErr) {
          isApiSaving = false;
          console.error('[Wiki API] Błąd podczas przenoszenia katalogu:', copyErr);
          return sendJson(500, { error: `Błąd operacji na plikach: ${copyErr.message}` });
        }
      }

      await rebuildWiki();
      rebuildSearchCache();
      setTimeout(() => { isApiSaving = false; }, 1500);

      const finalRelPath = path.relative(DOCS_DIR, targetPath).replace(/\\/g, '/');
      return sendJson(200, {
        success: true,
        message: `Folder "${finalFolderName}" został pomyślnie przeniesiony.`,
        relPath: finalRelPath
      });
    }

    if (normPath === '/api/kanban' && req.method === 'POST') {
      const body = await getBody();
      if (!body.tasks || !Array.isArray(body.tasks)) {
        return sendJson(400, { error: 'Wymagana tablica tasks' });
      }
      atomicWriteFile(KANBAN_FILE, JSON.stringify({ tasks: body.tasks }, null, 2), 'utf8');
      console.log(`[Wiki API] Zaktualizowano tablicę Kanban (${body.tasks.length} zadań)`);
      return sendJson(200, { success: true, message: 'Zadania Kanban zostały zapisane.' });
    }

    if (normPath === '/api/quick-notes' && req.method === 'POST') {
      const body = await getBody();
      if (!body.notes || !Array.isArray(body.notes)) {
        return sendJson(400, { error: 'Wymagana tablica notes' });
      }
      atomicWriteFile(QUICK_NOTES_FILE, JSON.stringify({ notes: body.notes }, null, 2), 'utf8');
      console.log(`[Wiki API] Zaktualizowano Szybkie Notatki (${body.notes.length} notatek)`);
      return sendJson(200, { success: true, message: 'Szybkie Notatki zostały zapisane.' });
    }

    if (normPath === '/api/scratchpad' && req.method === 'POST') {
      const body = await getBody();
      const content = typeof body.content === 'string' ? body.content : '';
      if (content.length > 1024 * 1024) {
        return sendJson(400, { error: 'Treść brudnopisu przekracza maksymalny limit 1MB' });
      }
      const checklist = Array.isArray(body.checklist) ? body.checklist.slice(0, 100).map(item => ({
        id: String(item.id || Date.now() + Math.random().toString(36).slice(2, 6)),
        text: String(item.text || '').replace(/[<>]/g, '').slice(0, 500),
        done: Boolean(item.done)
      })) : [];

      const record = {
        content,
        checklist,
        updatedAt: new Date().toISOString()
      };
      atomicWriteFile(SCRATCHPAD_FILE, JSON.stringify(record, null, 2), 'utf8');
      return sendJson(200, { success: true, message: 'Brudnopis został zsynchronizowany.', record });
    }

    if (normPath === '/api/playbooks' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      if (!body.playbooks || !Array.isArray(body.playbooks)) {
        return sendJson(400, { error: 'Wymagana tablica playbooks' });
      }
      atomicWriteFile(PLAYBOOKS_FILE, JSON.stringify({ playbooks: body.playbooks }, null, 2), 'utf8');
      console.log(`[Wiki API] Zaktualizowano procedury Playbook (${body.playbooks.length} procedur)`);
      return sendJson(200, { success: true, message: 'Procedury Playbook zostały zapisane.' });
    }


    if (normPath === '/api/upload-image' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { filename, base64Data } = body;

      if (!filename || !base64Data) {
        return sendJson(400, { error: 'Wymagane parametry: filename i base64Data' });
      }

      const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      const ext = (path.extname(filename) || '.png').toLowerCase();
      if (!allowedExts.includes(ext)) {
        return sendJson(400, { error: 'Niedozwolone rozszerzenie pliku obrazu. Dozwolone: png, jpg, jpeg, gif, webp' });
      }

      const pureBase64 = base64Data.replace(/^data:image\/[^;]+;base64,/, '').replace(/\s/g, '');
      const imageBuffer = Buffer.from(pureBase64, 'base64');

      if (imageBuffer.length > 5 * 1024 * 1024) {
        return sendJson(400, { error: 'Rozmiar pliku przekracza dopuszczalny limit 5MB' });
      }

      // Weryfikacja sygnatury binarnej (Magic Bytes)
      const isPng = imageBuffer.length >= 8 && imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4e && imageBuffer[3] === 0x47;
      const isJpg = imageBuffer.length >= 3 && imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff;
      const isGif = imageBuffer.length >= 6 && imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x38;
      const isWebp = imageBuffer.length >= 12 && imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x46 && imageBuffer[8] === 0x57 && imageBuffer[9] === 0x45 && imageBuffer[10] === 0x42 && imageBuffer[11] === 0x50;

      const isValidSignature = (ext === '.png' && isPng) || ((ext === '.jpg' || ext === '.jpeg') && isJpg) || (ext === '.gif' && isGif) || (ext === '.webp' && isWebp);
      if (!isValidSignature) {
        return sendJson(400, { error: 'Plik nie jest prawidłowym obrazem (niezgodna sygnatura binarna).' });
      }

      if (!fs.existsSync(IMAGES_DIR)) {
        try {
          fs.mkdirSync(IMAGES_DIR, { recursive: true });
        } catch (e) {}
      }

      const cleanName = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      const uniqueFilename = `${Date.now()}_${cleanName}${ext}`;
      const targetDocsPath = path.join(IMAGES_DIR, uniqueFilename);

      try {
        fs.writeFileSync(targetDocsPath, imageBuffer);
      } catch (err) {
        if (err.code === 'EACCES') {
          console.error('[Wiki API] EACCES upload: sudo chown -R 1000:1000 public/images && sudo chmod -R 775 public/images');
          return sendJson(500, { error: 'Błąd uprawnień zapisu pliku. Sprawdź uprawnienia katalogu images na serwerze.' });
        }
        console.error('[Wiki API] Błąd zapisu obrazu:', err);
        return sendJson(500, { error: 'Błąd zapisu pliku obrazu na serwerze.' });
      }

      console.log(`[Wiki API] Przesłano obrazek: ${uniqueFilename}`);

      const publicUrl = `/public/images/${uniqueFilename}`;
      const markdownSnippet = `![${cleanName}](${publicUrl})`;

      return sendJson(200, {
        success: true,
        filename: uniqueFilename,
        url: publicUrl,
        imageUrl: publicUrl,
        markdown: markdownSnippet
      });
    }

    if (normPath === '/api/import-file' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { categoryRel, filename, content } = body;

      if (!categoryRel || !filename || content === undefined) {
        return sendJson(400, { error: 'Wymagane parametry: categoryRel, filename i content' });
      }

      let sanitizedFilename = filename.trim().replace(/\\/g, '/');
      sanitizedFilename = sanitizedFilename.replace(/[<>:"|?*\x00]/g, '_');
      let parts = sanitizedFilename.split('/').map(p => p.trim() === '..' ? '__' : p.trim()).filter(Boolean);
      let cleanFilename = parts.join('/');
      
      const isHtml = cleanFilename.toLowerCase().endsWith('.html') || cleanFilename.toLowerCase().endsWith('.htm');
      
      let targetFilename = cleanFilename;
      if (isHtml) {
        targetFilename = cleanFilename.replace(/\.html?$/i, '') + '.md';
      } else if (!targetFilename.toLowerCase().endsWith('.md')) {
        targetFilename += '.md';
      }

      const fullFilePath = path.resolve(DOCS_DIR, categoryRel, targetFilename);
      if (!isPathInsideDocs(fullFilePath)) {
        return sendJson(403, { error: 'Dostęp zabroniony: Zapis poza katalogiem docs' });
      }

      const targetDir = path.dirname(fullFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      let finalContent = content;
      if (isHtml) {
        finalContent = convertHtmlToMarkdown(content);
      }

      atomicWriteFile(fullFilePath, finalContent, 'utf8');
      console.log(`[Wiki API] Zaimportowano plik: ${fullFilePath}`);
      rebuildWiki().then(() => rebuildSearchCache()).catch(e => console.error(e));

      return sendJson(200, {
        success: true,
        message: 'Plik został pomyślnie zaimportowany.',
        relPath: path.relative(DOCS_DIR, fullFilePath)
      });
    }

    if (normPath === '/api/scrape-url' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { url, categoryRel, filename } = body;

      if (!url || !categoryRel || !filename) {
        return sendJson(400, { error: 'Wymagane parametry: url, categoryRel, filename' });
      }

      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          return sendJson(400, { error: 'Niedozwolony protokół URL' });
        }
        const host = parsedUrl.hostname.toLowerCase();
        const ssrfBlocked = [
          host === 'localhost', host === '127.0.0.1', host === '0.0.0.0', host === '::1',
          host.startsWith('192.168.'), host.startsWith('10.'), host.startsWith('169.254.'),
          /^172\.(1[6-9]|2\d|3[01])\./.test(host),
          host.endsWith('.local')
        ];
        if (ssrfBlocked.some(Boolean)) {
          return sendJson(403, { error: 'Niedozwolony adres docelowy (ochrona SSRF)' });
        }
      } catch (e) {
        return sendJson(400, { error: 'Nieprawidłowy format adresu URL' });
      }

      let sanitizedFilename = filename.trim().replace(/\\/g, '/').replace(/[^a-zA-Z0-9_\-\.\/]/g, '_');
      if (!sanitizedFilename.endsWith('.md')) sanitizedFilename += '.md';

      const fullFilePath = path.resolve(DOCS_DIR, categoryRel, sanitizedFilename);
      if (!isPathInsideDocs(fullFilePath)) {
        return sendJson(403, { error: 'Dostęp zabroniony' });
      }

      try {
        console.log(`[Wiki API] Rozpoczęto pobieranie URL: ${url}`);
        const response = await fetch(url, {
          redirect: 'error',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (!response.ok) {
          return sendJson(500, { error: `Błąd pobierania strony (Kod HTTP: ${response.status})` });
        }

        const html = await response.text();

        // Podstawowy lekki podział w poszukiwaniu sekcji artykułu
        let mainContentHtml = '';
        const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
        const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

        if (articleMatch) {
          mainContentHtml = articleMatch[1];
        } else if (mainMatch) {
          mainContentHtml = mainMatch[1];
        } else if (bodyMatch) {
          mainContentHtml = bodyMatch[1];
        } else {
          mainContentHtml = html;
        }

        // Konwertuj HTML do Markdown
        let markdown = convertHtmlToMarkdown(mainContentHtml);

        // Zabezpieczenie przed importowaniem pustej treści
        if (!markdown || markdown.length < 10) {
          return sendJson(500, { error: 'Pobrana strona nie zawiera treści dających się zinterpretować jako tekst.' });
        }

        // Dodaj metadane o pochodzeniu
        const auditTrail = `<!-- WŹRÓDŁO: Zaimportowano z URL: ${url} w dniu ${new Date().toISOString().split('T')[0]} przez AI Scraper -->\n# Zaimportowano: ${filename.replace('.md', '').replace(/_/g, ' ')}\n\n*Źródło: [Link zewnętrzny](${url})*\n\n---\n\n`;
        markdown = auditTrail + markdown;

        const targetDir = path.dirname(fullFilePath);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        isApiSaving = true;
        atomicWriteFile(fullFilePath, markdown, 'utf8');
        console.log(`[Wiki API] Pomyślnie zapisano plik z URL: ${fullFilePath}`);

        rebuildWiki().then(() => {
          rebuildSearchCache();
          isApiSaving = false;
        }).catch(e => {
          console.error(e);
          isApiSaving = false;
        });

        return sendJson(200, {
          success: true,
          message: 'Artykuł zaimportowany pomyślnie z URL!',
          relPath: path.relative(DOCS_DIR, fullFilePath)
        });

      } catch (err) {
        console.error('[Wiki API Scrape Error]', err);
        return sendJson(500, { error: 'Błąd połączenia z serwerem zewnętrznym.' });
      }
    }

    
    if (normPath === '/api/rename-file' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { oldPath, newName } = body;

      if (!oldPath || !newName) {
        return sendJson(400, { error: 'Wymagane parametry: oldPath i newName' });
      }

      let decodedOld = decodeURIComponent(oldPath).replace(/^[\/\\]+/, '').replace(/\\/g, '/');
      let sanitizedOld = decodedOld.replace(/[<>:"|?*\x00]/g, '_');
      const sourcePath = path.resolve(DOCS_DIR, sanitizedOld);

      if (!isPathInsideDocs(sourcePath) || !fs.existsSync(sourcePath)) {
        return sendJson(404, { error: 'Plik źródłowy nie istnieje' });
      }

      const dirName = path.dirname(sanitizedOld);
      let cleanNewName = newName.trim().replace(/[<>:"|?*\x00]/g, '_').replace(/\s+/g, '_');
      if (cleanNewName === '..' || cleanNewName === '.') cleanNewName = 'file.md';
      if (!cleanNewName.endsWith('.md')) cleanNewName += '.md';

      const newRelPath = dirName === '.' ? cleanNewName : `${dirName}/${cleanNewName}`;
      const targetPath = path.resolve(DOCS_DIR, newRelPath);

      if (!isPathInsideDocs(targetPath)) {
        return sendJson(400, { error: 'Nieprawidłowa ścieżka docelowa' });
      }

      if (sourcePath !== targetPath && fs.existsSync(targetPath)) {
        return sendJson(409, { error: 'Plik o podanej nazwie już istnieje w katalogu docelowym' });
      }

      isApiSaving = true;
      fs.renameSync(sourcePath, targetPath);
      console.log(`[Wiki API] Zmieniono nazwę pliku: ${sanitizedOld} -> ${newRelPath}`);

      rebuildWiki().then(() => {
        rebuildSearchCache();
        isApiSaving = false;
      }).catch(e => {
        console.error('[Wiki API Rename Error]', e);
        isApiSaving = false;
      });

      return sendJson(200, {
        success: true,
        message: 'Nazwa pliku została zmieniona.',
        oldPath: sanitizedOld,
        newPath: newRelPath
      });
    }

    if (normPath === '/api/save-page' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { relPath, content } = body;

      if (!relPath || typeof content !== 'string') {
        return sendJson(400, { error: 'Wymagane parametry: relPath i content' });
      }

      let decodedPath = decodeURIComponent(relPath);
      let sanitizedRelPath = decodedPath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
      sanitizedRelPath = sanitizedRelPath.replace(/[<>:"|?*\x00]/g, '_');
      sanitizedRelPath = sanitizedRelPath.split('/').map(part => part === '..' ? '__' : part).join('/');
      if (!sanitizedRelPath.endsWith('.md')) sanitizedRelPath += '.md';

      const targetPath = path.resolve(DOCS_DIR, sanitizedRelPath);
      if (!isPathInsideDocs(targetPath)) {
        return sendJson(400, { error: 'Nieprawidłowa ścieżka pliku' });
      }

      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        try {
          fs.mkdirSync(targetDir, { recursive: true });
        } catch (err) {
          if (err.code === 'EACCES') {
            console.error('[Wiki API] EACCES: sudo chown -R 1000:1000 docs data public/images && sudo chmod -R 775 docs data public/images');
            return sendJson(500, { error: 'Błąd uprawnień zapisu pliku. Sprawdź uprawnienia katalogów na serwerze.' });
          }
          throw err;
        }
      }

      isApiSaving = true;
      try {
        atomicWriteFile(targetPath, content, 'utf8');
      } catch (err) {
        isApiSaving = false;
        if (err.code === 'EACCES') {
          console.error('[Wiki API] EACCES writeFile: sudo chown -R 1000:1000 docs data public/images && sudo chmod -R 775 docs data public/images');
          return sendJson(500, { error: 'Błąd uprawnień zapisu pliku. Sprawdź uprawnienia katalogów na serwerze.' });
        }
        throw err;
      }
      console.log(`[Wiki API] Zapisano plik: ${sanitizedRelPath}`);

      try {
        await rebuildWiki();
        rebuildSearchCache();
      } catch (err) {
        console.error('[Wiki API Rebuild Error]', err);
      } finally {
        isApiSaving = false;
      }

      return sendJson(200, {
        success: true,
        message: 'Strona została pomyślnie zapisana.',
        relPath: sanitizedRelPath,
        url: sanitizedRelPath.replace(/\.md$/, '.html')
      });
    }

    if (normPath === '/api/move-page' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { sourceRelPath, targetCategoryRel, targetFilename } = body;

      if (!sourceRelPath || !targetCategoryRel || !targetFilename) {
        return sendJson(400, { error: 'Wymagane parametry: sourceRelPath, targetCategoryRel i targetFilename' });
      }

      const decodedSource = decodeURIComponent(sourceRelPath);
      const sourcePath = path.resolve(DOCS_DIR, decodedSource);
      if (!isPathInsideDocs(sourcePath) || !fs.existsSync(sourcePath)) {
        return sendJson(404, { error: 'Plik źródłowy nie istnieje lub ścieżka jest nieprawidłowa' });
      }

      const decodedTargetCat = decodeURIComponent(targetCategoryRel);
      const decodedTargetFile = decodeURIComponent(targetFilename);

      let sanitizedFile = decodedTargetFile.trim().replace(/[<>:"|?*\x00]/g, '_');
      if (sanitizedFile === '..' || sanitizedFile === '.') sanitizedFile = 'file.md';
      if (!sanitizedFile.endsWith('.md')) sanitizedFile += '.md';

      let sanitizedCat = decodedTargetCat.replace(/\\/g, '/');
      sanitizedCat = sanitizedCat.replace(/[<>:"|?*\x00]/g, '_');
      sanitizedCat = sanitizedCat.split('/').map(part => part === '..' ? '__' : part).join('/');

      const targetPath = path.resolve(DOCS_DIR, sanitizedCat, sanitizedFile);
      if (!isPathInsideDocs(targetPath)) {
        return sendJson(400, { error: 'Nieprawidłowa ścieżka docelowa' });
      }

      if (sourcePath !== targetPath && fs.existsSync(targetPath)) {
        return sendJson(409, { error: 'Plik o podanej nazwie już istnieje w docelowej lokalizacji' });
      }

      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        try {
          fs.mkdirSync(targetDir, { recursive: true });
        } catch (err) {
          if (err.code === 'EACCES') {
            console.error('[Wiki API] EACCES move-page: sudo chown -R 1000:1000 docs data public/images && sudo chmod -R 775 docs data public/images');
            return sendJson(500, { error: 'Błąd uprawnień zapisu pliku. Sprawdź uprawnienia katalogów na serwerze.' });
          }
          throw err;
        }
      }

      isApiSaving = true;
      fs.renameSync(sourcePath, targetPath);
      console.log(`[Wiki API] Przeniesiono plik z: ${sourceRelPath} do: ${path.relative(DOCS_DIR, targetPath)}`);

      const sourceDir = path.dirname(sourcePath);
      if (sourceDir !== DOCS_DIR && fs.existsSync(sourceDir)) {
        const remaining = fs.readdirSync(sourceDir);
        if (remaining.length === 0) {
          try {
            fs.rmdirSync(sourceDir);
            console.log(`[Wiki API] Usunięto pusty podkatalog źródłowy: ${sourceDir}`);
          } catch (e) {
            console.warn('Nie udało się usunąć pustego katalogu:', e.message);
          }
        }
      }

      const buildResult = await rebuildWiki();
      rebuildSearchCache();
      setTimeout(() => { isApiSaving = false; }, 1500);

      const finalRelPath = path.relative(DOCS_DIR, targetPath).replace(/\\/g, '/');
      return sendJson(200, {
        success: true,
        message: 'Artykuł został pomyślnie przeniesiony.',
        relPath: finalRelPath
      });
    }

    if (normPath === '/api/verify-page' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { relPath, verifiedHardware } = body;

      if (!relPath) return sendJson(400, { error: 'Brak parametru relPath' });

      let sanitizedRelPath = relPath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
      if (sanitizedRelPath.endsWith('.html')) {
        sanitizedRelPath = sanitizedRelPath.replace(/\.html$/, '.md');
      }
      sanitizedRelPath = sanitizedRelPath.replace(/[<>:"|?*\x00]/g, '_');

      const targetPath = path.resolve(DOCS_DIR, sanitizedRelPath);
      if (!isPathInsideDocs(targetPath) || !fs.existsSync(targetPath)) {
        return sendJson(404, { error: 'Plik markdown nie istnieje' });
      }

      let content = fs.readFileSync(targetPath, 'utf8');

      if (content.includes('STAN: ZWERYFIKOWANE FIZYCZNIE NA SPRZĘCIE')) {
        return sendJson(200, { success: true, message: 'Ta strona jest juz oznaczona jako zweryfikowana.' });
      }

      const hwText = verifiedHardware ? ` (${verifiedHardware})` : '';
      const verifiedBanner = `\n> [!TIP]\n> **STAN: ZWERYFIKOWANE FIZYCZNIE NA SPRZĘCIE**${hwText}\n> Instrukcja została przetestowana i zweryfikowana w fizycznym środowisku sprzętowym. Potwierdzono poprawne działanie.\n\n`;

      if (content.startsWith('---')) {
        const parts = content.split('---');
        if (parts.length >= 3) {
          parts[2] = verifiedBanner + parts[2].trimStart();
          content = parts.join('---');
        } else {
          content = verifiedBanner + content;
        }
      } else {
        content = verifiedBanner + content;
      }

      isApiSaving = true;
      atomicWriteFile(targetPath, content, 'utf8');
      console.log(`[Wiki API] Oznaczono stronę jako zweryfikowaną: ${sanitizedRelPath}`);

      const buildResult = await rebuildWiki();
      rebuildSearchCache();
      setTimeout(() => { isApiSaving = false; }, 1500);

      return sendJson(200, {
        success: true,
        message: 'Strona została pomyślnie oznaczona jako ZWERYFIKOWANA FIZYCZNIE NA SPRZĘCIE!',
        buildResult
      });
    }

    // Endpointy dla RSS [dodane]
    if (normPath === '/api/rss-feeds') {
      if (req.method === 'GET') {
        const data = fs.readFileSync(RSS_FEEDS_FILE, 'utf8');
        return sendJson(200, JSON.parse(data));
      }
      if (req.method === 'POST') {
        const body = await getBody();
        if (!body.feeds || !Array.isArray(body.feeds)) {
          return sendJson(400, { error: 'Nieprawidłowy format danych. Oczekiwano tablicy feeds.' });
        }
        atomicWriteFile(RSS_FEEDS_FILE, JSON.stringify({ feeds: body.feeds }, null, 2), 'utf8');
        return sendJson(200, { success: true, message: 'Konfiguracja feedów RSS została zapisana.' });
      }
    }

    if (normPath === '/api/rss-articles' && req.method === 'GET') {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      const feedId = parsedUrl.searchParams.get('feedId');
      
      const feedsData = JSON.parse(fs.readFileSync(RSS_FEEDS_FILE, 'utf8'));
      const feeds = feedsData.feeds || [];

      if (feedId === 'all') {
        // Pobierz artykuły ze wszystkich aktywnych feedów
        const activeFeeds = feeds.filter(f => f.enabled);
        const allArticles = [];
        
        for (const feed of activeFeeds) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout
            
            const response = await fetch(feed.url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (response.ok) {
              const xmlText = await response.text();
              const articles = parseRssFeed(xmlText);
              // Oznacz artykuły z którego feeda pochodzą
              articles.forEach(art => {
                art.feedName = feed.name;
                art.feedId = feed.id;
              });
              allArticles.push(...articles);
            }
          } catch (e) {
            console.warn(`[RSS Engine] Błąd pobierania feeda ${feed.name}:`, e.message);
          }
        }
        
        // Zwróć zmergowane artykuły
        return sendJson(200, { articles: allArticles });
      } else {
        const feed = feeds.find(f => f.id === feedId);
        if (!feed) {
          return sendJson(404, { error: 'Nie odnaleziono zadanego feeda RSS' });
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 6000);
          const response = await fetch(feed.url, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (!response.ok) {
            return sendJson(500, { error: 'Błąd serwera źródłowego feeda RSS.' });
          }

          const xmlText = await response.text();
          const articles = parseRssFeed(xmlText);
          articles.forEach(art => {
            art.feedName = feed.name;
            art.feedId = feed.id;
          });
          return sendJson(200, { articles });
        } catch (e) {
          console.error('[RSS Engine] Błąd pobierania feeda:', e);
          return sendJson(500, { error: 'Nie udało się pobrać feeda RSS.' });
        }
      }
    }

    if (normPath === '/api/create-backup' && req.method === 'POST') {
      const backupRes = createWikiBackup();
      if (backupRes.success) {
        return sendJson(200, { success: true, message: `Utworzono kopię zapasową: ${backupRes.filename}`, backup: backupRes });
      } else {
        return sendJson(500, { success: false, error: 'Nie można utworzyć kopii zapasowej.' });
      }
    }

    if (normPath === '/api/export-wiki-zip' && req.method === 'GET') {
      try {
        const zipRes = exportWikiZip();
        if (!zipRes || !zipRes.success || !fs.existsSync(zipRes.path)) {
          return sendJson(500, { error: 'Nie udało się wygenerować archiwum kopii zapasowej ZIP.' });
        }
        const stat = fs.statSync(zipRes.path);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${zipRes.filename}"`,
          'Content-Length': stat.size
        });
        const stream = fs.createReadStream(zipRes.path);
        stream.pipe(res);
        stream.on('close', () => {
          try { fs.unlinkSync(zipRes.path); } catch (e) {}
        });
        return;
      } catch (err) {
        console.error('[Wiki API] Błąd eksportu archiwum ZIP:', err);
        return sendJson(500, { error: `Błąd podczas eksportu archiwum ZIP: ${err.message}` });
      }
    }

    if (normPath === '/api/orphaned-images' && req.method === 'GET') {
      const data = getOrphanedImagesList();
      return sendJson(200, data);
    }

    if (normPath === '/api/delete-orphaned-images' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { filenames } = body;
      if (!Array.isArray(filenames) || filenames.length === 0) {
        return sendJson(400, { error: 'Wymagana tablica nazw/ścieżek plików do usunięcia (filenames)' });
      }

      const imagesTrashDir = path.join(IMAGES_DIR, '.trash');
      if (!fs.existsSync(imagesTrashDir)) {
        fs.mkdirSync(imagesTrashDir, { recursive: true });
      }

      let deletedCount = 0;
      let freedBytes = 0;

      for (const rawName of filenames) {
        if (typeof rawName !== 'string') continue;
        const normalized = path.normalize(rawName.trim()).replace(/\\/g, '/');
        const sanitizedRel = normalized.replace(/^(\.\.[\/])+/g, '').replace(/^\/+/g, '');
        if (!sanitizedRel || sanitizedRel === '.' || sanitizedRel === '..' || sanitizedRel.includes('\0')) continue;

        const filePath = path.resolve(IMAGES_DIR, sanitizedRel);
        if (!isPathInsideDocs(filePath, IMAGES_DIR) || !fs.existsSync(filePath)) continue;
        if (isPathInsideDocs(filePath, imagesTrashDir)) continue;

        const stat = fs.statSync(filePath);
        freedBytes += stat.size;

        const trashDest = path.join(imagesTrashDir, sanitizedRel);
        const trashSubdir = path.dirname(trashDest);
        if (!fs.existsSync(trashSubdir)) {
          fs.mkdirSync(trashSubdir, { recursive: true });
        }

        let finalTrashDest = trashDest;
        if (fs.existsSync(finalTrashDest)) {
          const ext = path.extname(sanitizedRel);
          const baseNoExt = path.basename(sanitizedRel, ext);
          finalTrashDest = path.join(trashSubdir, `${baseNoExt}_${Date.now()}${ext}`);
        }

        try {
          fs.renameSync(filePath, finalTrashDest);
          deletedCount++;
        } catch (err) {
          try {
            fs.cpSync(filePath, finalTrashDest);
            fs.unlinkSync(filePath);
            deletedCount++;
          } catch (e) {
            console.error('[Wiki API] Błąd zabezpieczania osieroconej grafiki w koszu:', e);
          }
        }
      }

      return sendJson(200, {
        success: true,
        message: `Przeniesiono do kosza grafik (.trash) ${deletedCount} plików (odzyskane: ${(freedBytes / 1024 / 1024).toFixed(2)} MB).`,
        deletedCount,
        freedBytes
      });
    }

    if (normPath === '/api/sync-filenames-preview' && req.method === 'GET') {
      try {
        const allItems = analyzeDocsFilenames(DOCS_DIR);
        const mismatches = allItems.filter(i => i.status === 'DO_ZMIANY' || i.status === 'KOLIZJA');
        return sendJson(200, {
          success: true,
          totalScanned: allItems.length,
          count: mismatches.length,
          items: mismatches
        });
      } catch (err) {
        console.error('[Wiki API] Błąd podczas audytu nazw plików:', err);
        return sendJson(500, { error: `Błąd audytu: ${err.message}` });
      }
    }

    if (normPath === '/api/sync-filenames-apply' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { items } = body;
      if (!Array.isArray(items) || items.length === 0) {
        return sendJson(400, { error: 'Wymagana tablica elementów do zsynchronizowania (items)' });
      }

      let renamedCount = 0;
      const errors = [];

      for (const item of items) {
        if (!item || typeof item.relPath !== 'string' || typeof item.targetName !== 'string') {
          continue;
        }
        const cleanRel = path.normalize(item.relPath.trim()).replace(/\\/g, '/').replace(/^\/+/, '');
        if (cleanRel.includes('..') || cleanRel.includes('\0')) {
          errors.push({ relPath: item.relPath, error: 'Nieprawidłowa ścieżka' });
          continue;
        }

        const sourcePath = path.resolve(DOCS_DIR, cleanRel);
        if (!isPathInsideDocs(sourcePath, DOCS_DIR) || !fs.existsSync(sourcePath)) {
          errors.push({ relPath: item.relPath, error: 'Plik źródłowy nie istnieje lub poza zakresem docs' });
          continue;
        }

        const rawTarget = typeof item.targetName === 'string' ? item.targetName.trim() : '';
        if (!rawTarget || rawTarget.includes('/') || rawTarget.includes('\\') || rawTarget.includes('..') || rawTarget.includes('\0')) {
          errors.push({ relPath: item.relPath, error: 'Nazwa docelowa nie może zawierać ścieżek ani separatorów katalogów' });
          continue;
        }

        const cleanTargetName = path.basename(rawTarget);
        if (!cleanTargetName.endsWith('.md')) {
          errors.push({ relPath: item.relPath, error: 'Nieprawidłowe rozszerzenie pliku docelowego (wymagane .md)' });
          continue;
        }

        const targetPath = path.join(path.dirname(sourcePath), cleanTargetName);
        if (!isPathInsideDocs(targetPath, DOCS_DIR)) {
          errors.push({ relPath: item.relPath, error: 'Próba wyjścia poza katalog docs' });
          continue;
        }

        if (fs.existsSync(targetPath) && sourcePath.toLowerCase() !== targetPath.toLowerCase()) {
          errors.push({ relPath: item.relPath, error: `Plik docelowy ${cleanTargetName} już istnieje (kolizja)` });
          continue;
        }

        try {
          fs.renameSync(sourcePath, targetPath);
          renamedCount++;
        } catch (renameErr) {
          console.error(`[Wiki API] Błąd zmiany nazwy ${sourcePath} -> ${targetPath}:`, renameErr);
          errors.push({ relPath: item.relPath, error: renameErr.message });
        }
      }

      if (renamedCount > 0) {
        try {
          generateNavigation();
        } catch (navErr) {
          console.error('[Wiki API] Błąd regeneracji nawigacji po synchronizacji nazw:', navErr);
        }
      }

      return sendJson(200, {
        success: true,
        message: `Pomyślnie zmieniono nazwy ${renamedCount} plików.`,
        renamedCount,
        errors
      });
    }

    if (normPath === '/api/trash-documents' && req.method === 'GET') {
      const rawManifest = getTrashManifest();
      const validItems = [];
      for (const item of rawManifest) {
        const itemPath = path.join(TRASH_DIR, item.trashFilename);
        if (fs.existsSync(itemPath)) {
          let size = 0;
          try {
            const stat = fs.statSync(itemPath);
            size = stat.size;
          } catch (e) {}
          validItems.push({
            ...item,
            size
          });
        }
      }
      return sendJson(200, { items: validItems });
    }

    if (normPath === '/api/restore-document' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { id } = body;
      if (!id) return sendJson(400, { error: 'Brak identyfikatora elementu (id)' });

      const manifest = getTrashManifest();
      const item = manifest.find(m => m.id === id);
      if (!item) return sendJson(404, { error: 'Element nie został odnaleziony w koszu' });

      const sourceTrashPath = path.join(TRASH_DIR, item.trashFilename);
      if (!fs.existsSync(sourceTrashPath)) {
        saveTrashManifest(manifest.filter(m => m.id !== id));
        return sendJson(404, { error: 'Fizyczny plik nie istnieje już w koszu' });
      }

      const cleanRel = (item.originalRelPath || item.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const targetDocsPath = path.resolve(DOCS_DIR, cleanRel);

      if (!isPathInsideDocs(targetDocsPath, DOCS_DIR) || targetDocsPath === path.resolve(DOCS_DIR) || isPathInsideDocs(targetDocsPath, TRASH_DIR)) {
        return sendJson(400, { error: 'Nieprawidłowa lub zablokowana ścieżka przywracania' });
      }

      if (fs.existsSync(targetDocsPath)) {
        return sendJson(409, { error: `Element o ścieżce "${cleanRel}" już istnieje w bazie wiedzy. Zmień jego nazwę przed przywróceniem.` });
      }

      const targetParent = path.dirname(targetDocsPath);
      if (!fs.existsSync(targetParent)) {
        fs.mkdirSync(targetParent, { recursive: true });
      }

      try {
        fs.renameSync(sourceTrashPath, targetDocsPath);
      } catch (renameErr) {
        if (item.type === 'directory') {
          fs.cpSync(sourceTrashPath, targetDocsPath, { recursive: true });
          fs.rmSync(sourceTrashPath, { recursive: true, force: true });
        } else {
          fs.copyFileSync(sourceTrashPath, targetDocsPath);
          fs.unlinkSync(sourceTrashPath);
        }
      }

      saveTrashManifest(manifest.filter(m => m.id !== id));
      await rebuildWiki();
      rebuildSearchCache();

      return sendJson(200, {
        success: true,
        message: `Pomyślnie przywrócono ${item.type === 'directory' ? 'katalog' : 'dokument'}: ${item.name}`,
        relPath: path.relative(DOCS_DIR, targetDocsPath).replace(/\\/g, '/')
      });
    }

    if (normPath === '/api/purge-trash' && req.method === 'POST') {
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { id, all } = body;

      const manifest = getTrashManifest();

      if (all === true) {
        for (const item of manifest) {
          const itemPath = path.join(TRASH_DIR, item.trashFilename);
          try {
            if (fs.existsSync(itemPath)) {
              fs.rmSync(itemPath, { recursive: true, force: true });
            }
          } catch (e) {
            console.error(`[Trash Engine] Błąd trwałego usuwania ${item.trashFilename}:`, e);
          }
        }
        if (fs.existsSync(TRASH_DIR)) {
          const leftovers = fs.readdirSync(TRASH_DIR).filter(f => f !== 'trash_manifest.json');
          for (const lf of leftovers) {
            try {
              fs.rmSync(path.join(TRASH_DIR, lf), { recursive: true, force: true });
            } catch (e) {}
          }
        }
        saveTrashManifest([]);
        return sendJson(200, { success: true, message: 'Kosz bazy wiedzy został całkowicie opróżniony.' });
      }

      if (!id) return sendJson(400, { error: 'Wymagany parametr id lub flaga all: true' });

      const item = manifest.find(m => m.id === id);
      if (item) {
        const itemPath = path.join(TRASH_DIR, item.trashFilename);
        try {
          if (fs.existsSync(itemPath)) {
            fs.rmSync(itemPath, { recursive: true, force: true });
          }
        } catch (e) {
          console.error(`[Trash Engine] Błąd trwałego usuwania ${item.trashFilename}:`, e);
        }
        saveTrashManifest(manifest.filter(m => m.id !== id));
      }

      return sendJson(200, { success: true, message: 'Element został trwale usunięty z kosza.' });
    }

    if (normPath === '/api/backups-list' && req.method === 'GET') {
      const list = rotateBackups(7);
      return sendJson(200, { backups: list });
    }

    if (normPath === '/api/backups-download' && req.method === 'GET') {
      const filename = reqUrl.searchParams.get('filename') || '';
      if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..') || filename.includes('\0')) {
        return sendJson(400, { error: 'Nieprawidłowa nazwa pliku kopii zapasowej' });
      }
      if (!filename.endsWith('.zip') && !filename.endsWith('.tar.gz')) {
        return sendJson(400, { error: 'Niedozwolony format archiwum' });
      }
      const targetPath = path.resolve(BACKUPS_DIR, filename);
      if (!isPathInsideDocs(targetPath, BACKUPS_DIR) || !fs.existsSync(targetPath)) {
        return sendJson(404, { error: 'Archiwum kopii zapasowej nie zostało odnalezione' });
      }
      const stat = fs.statSync(targetPath);
      const isZip = filename.endsWith('.zip');
      res.writeHead(200, {
        'Content-Type': isZip ? 'application/zip' : 'application/gzip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': stat.size
      });
      const stream = fs.createReadStream(targetPath);
      stream.pipe(res);
      return;
    }

    sendJson(404, { error: 'Endpoint nie istnieje' });

  } catch (err) {
    if (err.message === 'REQUEST_TOO_LARGE') return;
    console.error('[Wiki API Exception]', err);
    sendJson(500, { error: 'Wystąpił błąd serwera. Szczegóły w logach.' });
  }
});

function rebuildSearchCache() {
  console.log('[Wiki API] Odbudowywanie in-memory search cache (asynchronicznie)...');
  const start = Date.now();
  const allFiles = [];

  function collectFiles(dir) {
    if (!fs.existsSync(dir)) return;
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file.startsWith('.')) return;
        collectFiles(fullPath);
      } else if (file.endsWith('.md')) {
        const relPath = path.relative(DOCS_DIR, fullPath).replace(/\\/g, '/');
        if (!relPath.includes('navigation.json')) {
          allFiles.push({ fullPath, relPath, file });
        }
      }
    });
  }

  collectFiles(DOCS_DIR);

  const newCache = [];
  let index = 0;

  function processChunk() {
    const chunkSize = 30;
    const end = Math.min(index + chunkSize, allFiles.length);
    for (let i = index; i < end; i++) {
      const item = allFiles[i];
      try {
        const content = fs.readFileSync(item.fullPath, 'utf8');
        const title = item.file.replace('.md', '').replace(/_/g, ' ');
        const tags = extractMarkdownTags(item.fullPath);
        newCache.push({
          relPath: item.relPath,
          title,
          content,
          contentLower: content.toLowerCase(),
          tags
        });
      } catch (e) {}
    }
    index = end;
    if (index < allFiles.length) {
      setImmediate(processChunk);
    } else {
      searchCache = newCache;
      console.log(`[Wiki API] Odbudowano search cache w ${Date.now() - start}ms. Łączna liczba dokumentów: ${searchCache.length}`);
    }
  }

  processChunk();
}

// Automatyczny harmonogram rotacyjnych kopii zapasowych (co 24h z retencją 7 kopii)
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
function runScheduledBackup() {
  try {
    console.log('[Backup Scheduler] Uruchamianie zaplanowanej automatycznej kopii zapasowej...');
    const res = createWikiBackup();
    if (res && res.success) {
      console.log(`[Backup Scheduler] Pomyślnie utworzono kopię zapasową: ${res.filename}`);
      rotateBackups(7);
    }
  } catch (e) {
    console.error('[Backup Scheduler] Błąd podczas zaplanowanej kopii:', e);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server API KnowOps nasłuchuje na porcie ${PORT} (0.0.0.0)`);
  rebuildWiki()
    .then(() => {
      rebuildSearchCache();
    })
    .catch(e => console.error('[Wiki API Startup Build] Błąd:', e.message));

  // Inicjalizacja retencji kopii oraz harmonogramu co 24h
  try {
    rotateBackups(7);
    setInterval(runScheduledBackup, BACKUP_INTERVAL_MS);
  } catch (err) {
    console.error('[Backup Scheduler Init] Błąd:', err.message);
  }
});
// Graceful Shutdown for SIGTERM / SIGINT
const gracefulShutdown = (signal) => {
  console.log(`[Wiki API] Otrzymano sygnał ${signal}. Bezpieczne zamykanie serwera...`);
  if (typeof watchDebounceTimer !== 'undefined' && watchDebounceTimer) {
    clearTimeout(watchDebounceTimer);
  }
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
