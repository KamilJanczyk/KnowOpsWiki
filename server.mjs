import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { createWikiBackup } from './backup_wiki.mjs';

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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
if (!ADMIN_PASSWORD) { console.warn('[SECURITY WARNING] ADMIN_PASSWORD nie jest zdefiniowany w środowisku!'); }
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
const DIST_DIR = path.resolve('dist');
const IMAGES_DIR = path.join(path.resolve('public'), 'images');
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

if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
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
  if (!ADMIN_PASSWORD) return true; // Tryb single-user bez hasła w env (LAN/CF Zero Trust)
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || !activeTokens.has(token)) return false;
  const createdAt = activeTokens.get(token);
  if (Date.now() - createdAt > 24 * 60 * 60 * 1000) { // 24h Expiry
    activeTokens.delete(token);
    return false;
  }
  return true;
}

function runCommand(cmd, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
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
  console.log('[Wiki API] Rekompilacja bazy wiedzy...');
  try {
    const out = await runCommand('node build_navigation.mjs', process.cwd());
    console.log('[Wiki API] Sukces kompilacji:', out.trim());
    isRebuilding = false;

    if (rebuildPending) {
      rebuildPending = false;
      setTimeout(() => rebuildWiki(), 200);
    }
    return { success: true, message: out };
  } catch (err) {
    isRebuilding = false;
    console.error('[Wiki API] Błąd kompilacji:', err.message);
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
    if (filename.includes('kanban_data.json') || filename.includes('quick_notes.json')) return;

    if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
    watchDebounceTimer = setTimeout(() => {
      console.log(`[Wiki Watcher] Wykryto zmianę w plikach (${eventType}): ${filename}. Auto-rekompilacja...`);
      rebuildWiki().catch(e => console.error('[Wiki Watcher] Błąd:', e));
    }, 800);
  });
  console.log('👀 Automatyczny obserwator plików w katalogu docs aktywny!');
} catch (err) {
  console.warn('[Wiki Watcher] Ostrzeżenie: Obserwator plików nie został uruchomiony:', err.message);
}

// HTTP Server API
const server = http.createServer(async (req, res) => {
  // Ograniczenie CORS - zezwol tylko na żądania z tej samej domeny/hosta
  const requestOrigin = req.headers['origin'] || '';
  const requestHost = req.headers['host'] || 'localhost';
  const allowedOrigin = requestOrigin || `http://${requestHost}`;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
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
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 10 * 1024 * 1024) {
        req.destroy();
        sendJson(413, { error: 'Zapytanie zbyt duże. Maksymalny rozmiar to 10 MB.' });
        return reject(new Error('REQUEST_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (!body || !body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        console.warn('[Wiki API Warning] Błąd parsowania JSON body:', e.message, 'Przekazana treść:', body.slice(0, 100));
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
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      const body = await getBody();
      if (!body.templates || !Array.isArray(body.templates)) {
        return sendJson(400, { error: 'Wymagana tablica templates' });
      }
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify({ templates: body.templates }, null, 2), 'utf8');
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

    if (normPath === '/api/server-stats' && req.method === 'GET') {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
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
            exec('df -B1 /', (err, stdout) => {
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
      const searchLower = query.toLowerCase();

      searchCache.forEach(item => {
        const matchedContent = item.contentLower.includes(searchLower);
        const matchedTitle = item.title.toLowerCase().includes(searchLower);

        if (matchedContent || matchedTitle) {
          let snippet = '';
          if (matchedContent) {
            const idx = item.contentLower.indexOf(searchLower);
            const start = Math.max(0, idx - 40);
            const end = Math.min(item.content.length, idx + searchLower.length + 60);
            snippet = item.content.substring(start, end).replace(/\r?\n/g, ' ');
          } else {
            snippet = item.content.substring(0, 100).replace(/\r?\n/g, ' ');
          }

          results.push({
            relPath: item.relPath,
            title: item.title,
            snippet: snippet.trim()
          });
        }
      });

      return sendJson(200, { results });
    }

    if (normPath === '/api/get-page' && req.method === 'GET') {
      const relPath = reqUrl.searchParams.get('relPath');
      if (!relPath) return sendJson(400, { error: 'Brak parametru relPath' });

      const targetPath = path.resolve(DOCS_DIR, relPath);
      if (!targetPath.startsWith(DOCS_DIR) || !fs.existsSync(targetPath)) {
        return sendJson(404, { error: 'Plik nie istnieje' });
      }

      const stat = fs.statSync(targetPath);
      const content = fs.readFileSync(targetPath, 'utf8');
      return sendJson(200, { relPath, content, mtime: stat.mtime.toISOString() });
    }

    if (normPath === '/api/rescan' && (req.method === 'POST' || req.method === 'GET')) {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      console.log('[Wiki API] Ręczne odświeżenie i skanowanie bazy wiedzy...');
      const rescanResult = await rebuildWiki();
      rebuildSearchCache();
      return sendJson(200, { success: true, result: rescanResult });
    }

    if (normPath === '/api/create-page' && req.method === 'POST') {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      const body = await getBody();
      const { categoryRel, filename, content } = body;
      if (!categoryRel || !filename) {
        return sendJson(400, { error: 'Wymagane parametry: categoryRel oraz filename' });
      }

      let decodedFilename = decodeURIComponent(filename);
      let normalizedPath = decodedFilename.trim().replace(/\\/g, '/');
      normalizedPath = normalizedPath.replace(/[<>:"|?*\x00]/g, '_');
      let parts = normalizedPath.split('/').map(part => part === '..' ? '__' : part).filter(Boolean);
      let relativeFilePath = parts.join('/');
      if (!relativeFilePath.endsWith('.md')) relativeFilePath += '.md';

      const fullFilePath = path.resolve(DOCS_DIR, categoryRel, relativeFilePath);
      if (!fullFilePath.startsWith(DOCS_DIR)) {
        return sendJson(403, { error: 'Dostęp zabroniony' });
      }

      const targetDir = path.dirname(fullFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const articleContent = content || `# ${path.basename(fullFilePath, '.md').replace(/_/g, ' ')}\n\nNowy artykuł stworzony z poziomu panelu Wiki.`;
      fs.writeFileSync(fullFilePath, articleContent, 'utf8');
      console.log(`[Wiki API] Utworzono plik i podkatalogi: ${fullFilePath}`);
      await rebuildWiki();
      rebuildSearchCache();
      return sendJson(200, { success: true, message: 'Nowy artykuł został utworzony.', relPath: path.relative(DOCS_DIR, fullFilePath) });
    }

    if (normPath === '/api/delete-page' && req.method === 'POST') {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { relPath } = body;
      if (!relPath) return sendJson(400, { error: 'Brak parametru relPath' });

      const targetPath = path.resolve(DOCS_DIR, relPath);
      if (!targetPath.startsWith(DOCS_DIR) || !fs.existsSync(targetPath)) {
        return sendJson(404, { error: 'Plik nie istnieje' });
      }

      fs.unlinkSync(targetPath);
      console.log(`[Wiki API] Usunięto plik: ${relPath}`);

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

    if (normPath === '/api/kanban' && req.method === 'POST') {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      const body = await getBody();
      if (!body.tasks || !Array.isArray(body.tasks)) {
        return sendJson(400, { error: 'Wymagana tablica tasks' });
      }
      fs.writeFileSync(KANBAN_FILE, JSON.stringify({ tasks: body.tasks }, null, 2), 'utf8');
      console.log(`[Wiki API] Zaktualizowano tablicę Kanban (${body.tasks.length} zadań)`);
      return sendJson(200, { success: true, message: 'Zadania Kanban zostały zapisane.' });
    }

    if (normPath === '/api/quick-notes' && req.method === 'POST') {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      const body = await getBody();
      if (!body.notes || !Array.isArray(body.notes)) {
        return sendJson(400, { error: 'Wymagana tablica notes' });
      }
      fs.writeFileSync(QUICK_NOTES_FILE, JSON.stringify({ notes: body.notes }, null, 2), 'utf8');
      console.log(`[Wiki API] Zaktualizowano Szybkie Notatki (${body.notes.length} notatek)`);
      return sendJson(200, { success: true, message: 'Szybkie Notatki zostały zapisane.' });
    }

    if (normPath === '/api/upload-image' && req.method === 'POST') {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
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
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
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
      if (!fullFilePath.startsWith(DOCS_DIR)) {
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

      fs.writeFileSync(fullFilePath, finalContent, 'utf8');
      console.log(`[Wiki API] Zaimportowano plik: ${fullFilePath}`);
      rebuildWiki().then(() => rebuildSearchCache()).catch(e => console.error(e));

      return sendJson(200, {
        success: true,
        message: 'Plik został pomyślnie zaimportowany.',
        relPath: path.relative(DOCS_DIR, fullFilePath)
      });
    }

    if (normPath === '/api/scrape-url' && req.method === 'POST') {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
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
      if (!fullFilePath.startsWith(DOCS_DIR)) {
        return sendJson(403, { error: 'Dostęp zabroniony' });
      }

      try {
        console.log(`[Wiki API] Rozpoczęto pobieranie URL: ${url}`);
        const response = await fetch(url, {
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
        fs.writeFileSync(fullFilePath, markdown, 'utf8');
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
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { oldPath, newName } = body;

      if (!oldPath || !newName) {
        return sendJson(400, { error: 'Wymagane parametry: oldPath i newName' });
      }

      let decodedOld = decodeURIComponent(oldPath).replace(/^[\/\\]+/, '').replace(/\\/g, '/');
      let sanitizedOld = decodedOld.replace(/[<>:"|?*\x00]/g, '_');
      const sourcePath = path.resolve(DOCS_DIR, sanitizedOld);

      if (!sourcePath.startsWith(DOCS_DIR) || !fs.existsSync(sourcePath)) {
        return sendJson(404, { error: 'Plik źródłowy nie istnieje' });
      }

      const dirName = path.dirname(sanitizedOld);
      let cleanNewName = newName.trim().replace(/[<>:"|?*\x00]/g, '_').replace(/\s+/g, '_');
      if (cleanNewName === '..' || cleanNewName === '.') cleanNewName = 'file.md';
      if (!cleanNewName.endsWith('.md')) cleanNewName += '.md';

      const newRelPath = dirName === '.' ? cleanNewName : `${dirName}/${cleanNewName}`;
      const targetPath = path.resolve(DOCS_DIR, newRelPath);

      if (!targetPath.startsWith(DOCS_DIR)) {
        return sendJson(400, { error: 'Nieprawidłowa ścieżka docelowa' });
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
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
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
      if (!targetPath.startsWith(DOCS_DIR)) {
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
        fs.writeFileSync(targetPath, content, 'utf8');
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
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { sourceRelPath, targetCategoryRel, targetFilename } = body;

      if (!sourceRelPath || !targetCategoryRel || !targetFilename) {
        return sendJson(400, { error: 'Wymagane parametry: sourceRelPath, targetCategoryRel i targetFilename' });
      }

      const decodedSource = decodeURIComponent(sourceRelPath);
      const sourcePath = path.resolve(DOCS_DIR, decodedSource);
      if (!sourcePath.startsWith(DOCS_DIR) || !fs.existsSync(sourcePath)) {
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
      if (!targetPath.startsWith(DOCS_DIR)) {
        return sendJson(400, { error: 'Nieprawidłowa ścieżka docelowa' });
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
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      if (!checkMutatingRateLimit(req, res)) return;
      const body = await getBody();
      const { relPath, verifiedHardware } = body;

      if (!relPath) return sendJson(400, { error: 'Brak parametru relPath' });

      let sanitizedRelPath = relPath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
      if (sanitizedRelPath.endsWith('.html')) {
        sanitizedRelPath = sanitizedRelPath.replace(/\.html$/, '.md');
      }
      sanitizedRelPath = sanitizedRelPath.replace(/[^a-zA-Z0-9_\-\.\/]/g, '_');

      const targetPath = path.resolve(DOCS_DIR, sanitizedRelPath);
      if (!targetPath.startsWith(DOCS_DIR) || !fs.existsSync(targetPath)) {
        return sendJson(404, { error: 'Plik markdown nie istnieje' });
      }

      let content = fs.readFileSync(targetPath, 'utf8');

      if (content.includes('STAN: ZWERYFIKOWANE FIZYCZNIE NA SPRZĘCIE')) {
        return sendJson(200, { success: true, message: 'Ta strona jest już oznaczona jako zweryfikowana.' });
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
      fs.writeFileSync(targetPath, content, 'utf8');
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
        if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
        const data = fs.readFileSync(RSS_FEEDS_FILE, 'utf8');
        return sendJson(200, JSON.parse(data));
      }
      if (req.method === 'POST') {
        if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
        const body = await getBody();
        if (!body.feeds || !Array.isArray(body.feeds)) {
          return sendJson(400, { error: 'Nieprawidłowy format danych. Oczekiwano tablicy feeds.' });
        }
        fs.writeFileSync(RSS_FEEDS_FILE, JSON.stringify({ feeds: body.feeds }, null, 2), 'utf8');
        return sendJson(200, { success: true, message: 'Konfiguracja feedów RSS została zapisana.' });
      }
    }

    if (normPath === '/api/rss-articles' && req.method === 'GET') {
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
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
      if (!verifyAuth(req)) return sendJson(401, { error: 'Wymagane logowanie' });
      const backupRes = createWikiBackup();
      if (backupRes.success) {
        return sendJson(200, { success: true, message: `Utworzono kopię zapasową: ${backupRes.filename}`, backup: backupRes });
      } else {
        return sendJson(500, { success: false, error: 'Nie można utworzyć kopii zapasowej.' });
      }
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
        newCache.push({
          relPath: item.relPath,
          title,
          content,
          contentLower: content.toLowerCase()
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server API KnowOps nasłuchuje na porcie ${PORT} (0.0.0.0)`);
  rebuildWiki()
    .then(() => {
      rebuildSearchCache();
    })
    .catch(e => console.error('[Wiki API Startup Build] Błąd:', e.message));
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
