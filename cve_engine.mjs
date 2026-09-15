import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const CVE_CACHE_FILE = path.join(DATA_DIR, 'cve_cache.json');
const CVE_WATCHLIST_FILE = path.join(DATA_DIR, 'cve_watchlist.json');
const CVE_TRANSLATIONS_FILE = path.join(DATA_DIR, 'cve_translations.json');

const CISA_KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 godziny

// Definicja standardowych kategorii infrastruktury SecOps
export const CVE_CATEGORIES = {
  virtualization: {
    id: 'virtualization',
    name: 'Wirtualizacja',
    keywords: ['vmware', 'esxi', 'vcenter', 'vsphere', 'proxmox', 'hyper-v', 'xen', 'kvm', 'nutanix', 'qemu']
  },
  containers: {
    id: 'containers',
    name: 'Kontenery & K8s',
    keywords: ['docker', 'kubernetes', 'k8s', 'containerd', 'openshift', 'podman', 'rancher', 'helm', 'cri-o']
  },
  identity: {
    id: 'identity',
    name: 'Tożsamość & Active Directory',
    keywords: ['active directory', 'kerberos', 'ldap', 'samba', 'freeipa', 'keycloak', 'okta', 'activedirectory', 'domain controller', 'ntlm']
  },
  network_firewall: {
    id: 'network_firewall',
    name: 'Sieć & Firewall / VPN',
    keywords: ['fortinet', 'fortios', 'palo alto', 'pan-os', 'cisco', 'ios', 'ios xe', 'juniper', 'junos', 'mikrotik', 'routeros', 'pfsense', 'opnsense', 'wireguard', 'openvpn', 'check point', 'f5', 'big-ip', 'sonicwall', 'sophos']
  },
  databases: {
    id: 'databases',
    name: 'Bazy Danych',
    keywords: ['postgresql', 'postgres', 'mysql', 'mariadb', 'redis', 'mongodb', 'oracle', 'mssql', 'sql server', 'sqlite', 'elasticsearch']
  },
  web_services: {
    id: 'web_services',
    name: 'Usługi Sieciowe & Web',
    keywords: ['nginx', 'apache', 'openssh', 'ssh', 'bind', 'dns', 'haproxy', 'openssl', 'php', 'node.js', 'nodejs', 'tomcat', 'caddy', 'lighttpd']
  },
  os_linux: {
    id: 'os_linux',
    name: 'Linux OS & Kernel',
    keywords: ['linux', 'kernel', 'debian', 'ubuntu', 'red hat', 'rhel', 'centos', 'rocky', 'almalinux', 'suse', 'alpine', 'systemd', 'glibc', 'sudo', 'polkit']
  },
  os_windows: {
    id: 'os_windows',
    name: 'Windows Server',
    keywords: ['windows', 'microsoft', 'windows server', 'smb', 'rpc', 'spooler', 'powershell']
  },
  other: {
    id: 'other',
    name: 'Inne Technologie',
    keywords: []
  }
};

/**
 * Automatyczna kategoryzacja podatności na podstawie dostawcy, produktu i opisu
 */
export function categorizeVulnerability(vendor, product, description) {
  const combined = `${vendor || ''} ${product || ''} ${description || ''}`.toLowerCase();

  for (const [catKey, catDef] of Object.entries(CVE_CATEGORIES)) {
    if (catKey === 'other') continue;
    for (const kw of catDef.keywords) {
      // Weryfikacja słowa kluczowego z dopasowaniem granic słów
      const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
      if (regex.test(combined)) {
        return catKey;
      }
    }
  }
  return 'other';
}

/**
 * Odczyt lub inicjalizacja konfiguracji obserwacji (Watchlist)
 */
export function getCveWatchlist() {
  if (fs.existsSync(CVE_WATCHLIST_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CVE_WATCHLIST_FILE, 'utf8'));
      return {
        selectedCategories: Array.isArray(data.selectedCategories) ? data.selectedCategories : Object.keys(CVE_CATEGORIES),
        selectedVendors: Array.isArray(data.selectedVendors) ? data.selectedVendors : [],
        minScore: typeof data.minScore === 'number' ? data.minScore : 0,
        onlyKev: Boolean(data.onlyKev),
        audited: data.audited && typeof data.audited === 'object' ? data.audited : {}
      };
    } catch (e) {
      console.error('[CVE Engine] Błąd odczytu cve_watchlist.json:', e.message);
    }
  }

  const defaultWatchlist = {
    selectedCategories: ['virtualization', 'containers', 'os_linux', 'web_services', 'identity', 'network_firewall', 'databases'],
    selectedVendors: ['VMware', 'Docker', 'Linux', 'Nginx', 'Apache', 'Microsoft', 'Fortinet', 'Palo Alto', 'Cisco', 'OpenSSH'],
    minScore: 0,
    onlyKev: false,
    audited: {}
  };

  try {
    fs.writeFileSync(CVE_WATCHLIST_FILE, JSON.stringify(defaultWatchlist, null, 2), 'utf8');
  } catch (e) {}

  return defaultWatchlist;
}

/**
 * Zapis konfiguracji obserwacji (Watchlist)
 */
export function saveCveWatchlist(data) {
  const current = getCveWatchlist();
  const updated = {
    ...current,
    selectedCategories: Array.isArray(data.selectedCategories) ? data.selectedCategories : current.selectedCategories,
    selectedVendors: Array.isArray(data.selectedVendors) ? data.selectedVendors : current.selectedVendors,
    minScore: typeof data.minScore === 'number' ? data.minScore : current.minScore,
    onlyKev: typeof data.onlyKev === 'boolean' ? data.onlyKev : current.onlyKev,
    audited: data.audited && typeof data.audited === 'object' ? data.audited : current.audited
  };

  fs.writeFileSync(CVE_WATCHLIST_FILE, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

/**
 * Aktualizacja statusu audytu dla konkretnego CVE
 */
export function setCveAuditStatus(cveId, status, notes = '') {
  if (!cveId) throw new Error('Brak wymaganego identyfikatora CVE');
  const validStatuses = ['unreviewed', 'mitigated', 'in_progress', 'not_applicable'];
  if (!validStatuses.includes(status)) {
    throw new Error(`Nieprawidłowy status audytu: ${status}`);
  }

  const watchlist = getCveWatchlist();
  if (status === 'unreviewed') {
    delete watchlist.audited[cveId];
  } else {
    watchlist.audited[cveId] = {
      status,
      notes: String(notes || '').slice(0, 500),
      updatedAt: new Date().toISOString()
    };
  }

  saveCveWatchlist(watchlist);
  return watchlist.audited[cveId] || { status: 'unreviewed' };
}

/**
 * Szacowanie poziomu krytyczności na podstawie opisu luki (jeśli brak oficjalnego CVSS w KEV)
 */
function estimateSeverity(item) {
  const text = `${item.vulnerabilityName || ''} ${item.shortDescription || ''}`.toLowerCase();
  const isRansomware = (item.knownRansomwareCampaignUse || '').toLowerCase() === 'known';

  if (isRansomware || text.includes('remote code execution') || text.includes('command injection') || text.includes('pre-authentication') || text.includes('unauthenticated')) {
    return { score: 9.8, severity: 'CRITICAL' };
  }
  if (text.includes('privilege escalation') || text.includes('authentication bypass') || text.includes('arbitrary file') || text.includes('memory corruption')) {
    return { score: 8.4, severity: 'HIGH' };
  }
  if (text.includes('denial of service') || text.includes('information disclosure') || text.includes('cross-site scripting')) {
    return { score: 6.5, severity: 'MEDIUM' };
  }
  return { score: 7.5, severity: 'HIGH' };
}

/**
 * Pobieranie i synchronizacja feedu podatności z CISA KEV oraz buforowanie w cve_cache.json
 */
export async function fetchCveFeed(forceRefresh = false) {
  // 1. Sprawdzenie istniejącego cache w data/cve_cache.json
  if (!forceRefresh && fs.existsSync(CVE_CACHE_FILE)) {
    try {
      const stat = fs.statSync(CVE_CACHE_FILE);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < CACHE_TTL_MS) {
        const cachedContent = JSON.parse(fs.readFileSync(CVE_CACHE_FILE, 'utf8'));
        if (cachedContent && Array.isArray(cachedContent.items) && cachedContent.items.length > 0) {
          return cachedContent;
        }
      }
    } catch (e) {
      console.warn('[CVE Engine] Nie można odczytać cache, próba pobrania online:', e.message);
    }
  }

  // 2. Pobranie danych online ze źródła CISA KEV
  console.log('[CVE Engine] Pobieranie aktualnego katalogu podatności CISA KEV...');
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(CISA_KEV_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'KnowOpsWiki-SecOps/1.0' }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Serwer CISA KEV zwrócił kod HTTP ${response.status}`);
    }

    const data = await response.json();
    const vulnerabilities = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [];

    // Transformacja i kategoryzacja rekordów
    const items = vulnerabilities.map(v => {
      const cveId = String(v.cveID || '').trim();
      const vendor = String(v.vendorProject || '').trim();
      const product = String(v.product || '').trim();
      const name = String(v.vulnerabilityName || '').trim();
      const desc = String(v.shortDescription || '').trim();
      const dateAdded = v.dateAdded || '';
      const dueDate = v.dueDate || '';
      const action = v.requiredAction || '';
      const ransomware = (v.knownRansomwareCampaignUse || '').toLowerCase() === 'known';
      const category = categorizeVulnerability(vendor, product, `${name} ${desc}`);
      const { score, severity } = estimateSeverity(v);

      return {
        id: cveId,
        vendor,
        product,
        title: name || cveId,
        description: desc,
        dateAdded,
        dueDate,
        requiredAction: action,
        ransomware,
        isKev: true,
        category,
        categoryName: CVE_CATEGORIES[category] ? CVE_CATEGORIES[category].name : 'Inne',
        score,
        severity,
        nvdUrl: `https://nvd.nist.gov/vuln/detail/${cveId}`,
        cveOrgUrl: `https://www.cve.org/CVERecord?id=${cveId}`
      };
    });

    // Sortowanie od najnowszych
    items.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));

    const result = {
      lastUpdated: new Date().toISOString(),
      totalCount: items.length,
      kevCount: items.length,
      categories: CVE_CATEGORIES,
      items
    };

    // Zapis do cache
    try {
      fs.writeFileSync(CVE_CACHE_FILE, JSON.stringify(result, null, 2), 'utf8');
      console.log(`[CVE Engine] Pomyślnie zbuforowano ${items.length} rekordów CVE w cve_cache.json`);
    } catch (writeErr) {
      console.error('[CVE Engine] Błąd zapisu cve_cache.json:', writeErr.message);
    }

    return result;
  } catch (err) {
    console.error('[CVE Engine Error] Błąd podczas pobierania CISA KEV:', err.message);

    // Fallback: jeśli istnieje jakikolwiek wcześniejszy cache, zwróć go
    if (fs.existsSync(CVE_CACHE_FILE)) {
      try {
        console.log('[CVE Engine] Użycie poprzedniego bufora CVE po błędzie sieci.');
        return JSON.parse(fs.readFileSync(CVE_CACHE_FILE, 'utf8'));
      } catch (cacheErr) {}
    }

    // Ostateczny fallback: zestaw bazowy podatności infrastrukturalnych
    return getFallbackSeedDataset(err.message);
  }
}

/**
 * Zapasowy zestaw podatności (Seed Dataset) gwarantujący działanie modułu w środowiskach izolowanych
 */
function getFallbackSeedDataset(errorMessage = '') {
  const seedItems = [
    {
      id: 'CVE-2024-3400',
      vendor: 'Palo Alto Networks',
      product: 'PAN-OS',
      title: 'Palo Alto Networks PAN-OS OS Command Injection Vulnerability',
      description: 'Podatność command injection w GlobalProtect umożliwiająca nieuwierzytelnionemu atakującemu wykonanie dowolnego kodu z uprawnieniami roota.',
      dateAdded: '2024-04-12',
      dueDate: '2024-04-19',
      requiredAction: 'Zastosować poprawki producenta lub wyłączyć telemetry data collection.',
      ransomware: true,
      isKev: true,
      category: 'network_firewall',
      categoryName: 'Sieć & Firewall / VPN',
      score: 10.0,
      severity: 'CRITICAL',
      nvdUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-3400',
      cveOrgUrl: 'https://www.cve.org/CVERecord?id=CVE-2024-3400'
    },
    {
      id: 'CVE-2024-6387',
      vendor: 'OpenSSH',
      product: 'OpenSSH',
      title: 'OpenSSH regreSSHion Remote Code Execution Vulnerability',
      description: 'Luka typu race-condition w serwerze sshd na systemach Linux opartych na glibc umożliwiająca nieuwierzytelnione wykonanie kodu z prawami root.',
      dateAdded: '2024-07-01',
      dueDate: '2024-07-22',
      requiredAction: 'Zaktualizować OpenSSH do wersji >= 9.8p1 lub ustawić LoginGraceTime 0 w sshd_config.',
      ransomware: false,
      isKev: true,
      category: 'web_services',
      categoryName: 'Usługi Sieciowe & Web',
      score: 8.1,
      severity: 'HIGH',
      nvdUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-6387',
      cveOrgUrl: 'https://www.cve.org/CVERecord?id=CVE-2024-6387'
    },
    {
      id: 'CVE-2023-34048',
      vendor: 'VMware',
      product: 'vCenter Server',
      title: 'VMware vCenter Server Out-of-Bounds Write Vulnerability',
      description: 'Przepełnienie bufora w protokole DCERPC vCenter Server umożliwiające zdalne wykonanie kodu przez sieć.',
      dateAdded: '2024-01-22',
      dueDate: '2024-02-12',
      requiredAction: 'Zastosować biuletyn VMSA-2023-0023 wydany przez VMware.',
      ransomware: true,
      isKev: true,
      category: 'virtualization',
      categoryName: 'Wirtualizacja',
      score: 9.8,
      severity: 'CRITICAL',
      nvdUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2023-34048',
      cveOrgUrl: 'https://www.cve.org/CVERecord?id=CVE-2023-34048'
    },
    {
      id: 'CVE-2024-21626',
      vendor: 'Docker',
      product: 'runc',
      title: 'runc Leaky File Descriptor Container Breakout Vulnerability',
      description: 'Luka w mechanizmie runc umożliwiająca ucieczkę z kontenera do systemu plików hosta poprzez deskryptor pliku cwd.',
      dateAdded: '2024-02-09',
      dueDate: '2024-03-01',
      requiredAction: 'Zaktualizować środowisko Docker / containerd oraz runc do wersji >= 1.1.12.',
      ransomware: false,
      isKev: true,
      category: 'containers',
      categoryName: 'Kontenery & K8s',
      score: 8.6,
      severity: 'HIGH',
      nvdUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2024-21626',
      cveOrgUrl: 'https://www.cve.org/CVERecord?id=CVE-2024-21626'
    }
  ];

  return {
    lastUpdated: new Date().toISOString(),
    totalCount: seedItems.length,
    kevCount: seedItems.length,
    categories: CVE_CATEGORIES,
    isOfflineFallback: true,
    fallbackError: errorMessage,
    items: seedItems
  };
}

/**
 * Słownik terminologii cyberbezpieczeństwa (SecOps Glossary)
 * Zapewnia zachowanie oryginalnych terminów branżowych w nawiasach (dwujęzyczność SecOps)
 */
export const CVE_SECOPS_GLOSSARY = [
  { en: /\bpre-authentication remote code execution\b/gi, pl: 'zdalne wykonanie kodu przed uwierzytelnieniem (Pre-Auth RCE)' },
  { en: /\bremote code execution\b/gi, pl: 'zdalne wykonanie kodu (RCE)' },
  { en: /\bexecute unauthorized code or commands\b/gi, pl: 'wykonanie nieautoryzowanego kodu lub poleceń' },
  { en: /\bexecute arbitrary os commands\b/gi, pl: 'wykonanie dowolnych poleceń systemu operacyjnego' },
  { en: /\bexecute arbitrary code\b/gi, pl: 'wykonanie dowolnego kodu' },
  { en: /\bexecute script files\b/gi, pl: 'uruchomienie plików skryptowych' },
  { en: /\bread arbitrary files\b/gi, pl: 'odczyt dowolnych plików' },
  { en: /\bwrite arbitrary files\b/gi, pl: 'zapis dowolnych plików' },
  { en: /\bwrite data outside the intended\b/gi, pl: 'zapis danych poza zamierzonym' },
  { en: /\bachieve code execution\b/gi, pl: 'wykonanie kodu' },
  { en: /\bachieve container breakout\b/gi, pl: 'ucieczkę z kontenera (Container Breakout)' },
  { en: /\bfile transfer and execution\b/gi, pl: 'przesłanie i uruchomienie plików' },
  { en: /\bcode execution\b/gi, pl: 'wykonanie dowolnego kodu' },
  { en: /\bcommand injection\b/gi, pl: 'wstrzyknięcie poleceń (Command Injection)' },
  { en: /\bstatic code injection\b/gi, pl: 'statyczne wstrzyknięcie kodu (Code Injection)' },
  { en: /\bSQL injection\b/gi, pl: 'wstrzyknięcie kodu SQL (SQL Injection)' },
  { en: /\bprivilege escalation attack\b/gi, pl: 'atak eskalacji uprawnień' },
  { en: /\bescalate privileges locally up to SYSTEM\b/gi, pl: 'lokalne podniesienie uprawnień do poziomu SYSTEM' },
  { en: /\belevate privileges locally\b/gi, pl: 'lokalne podniesienie uprawnień' },
  { en: /\bprivilege escalation\b/gi, pl: 'eskalację uprawnień (Privilege Escalation)' },
  { en: /\belevation of privilege\b/gi, pl: 'podniesienie uprawnień (Elevation of Privilege)' },
  { en: /\bpath traversal\b/gi, pl: 'przejście przez ścieżkę (Path Traversal)' },
  { en: /\bdirectory traversal\b/gi, pl: 'przejście przez ścieżkę katalogów (Directory Traversal)' },
  { en: /\bdenial of service \(dos\) condition\b/gi, pl: 'stan odmowy usługi (DoS)' },
  { en: /\bdenial of service\b/gi, pl: 'odmowę usługi (Denial of Service - DoS)' },
  { en: /\bdistributed denial of service\b/gi, pl: 'rozproszoną odmowę usługi (DDoS)' },
  { en: /\bauthentication bypass using an alternate path or channel\b/gi, pl: 'ominięcie uwierzytelnienia przez alternatywny kanał (Auth Bypass)' },
  { en: /\bauthentication bypass\b/gi, pl: 'ominięcie uwierzytelnienia (Authentication Bypass)' },
  { en: /\bauthentication-bypass\b/gi, pl: 'ominięcie uwierzytelnienia (Authentication Bypass)' },
  { en: /\bimproper authentication\b/gi, pl: 'nieprawidłowe uwierzytelnienie (Improper Authentication)' },
  { en: /\bmissing authentication enforcement\b/gi, pl: 'brak egzekwowania uwierzytelnienia' },
  { en: /\bmissing authentication for critical function\b/gi, pl: 'brak uwierzytelnienia dla funkcji krytycznej' },
  { en: /\bmissing authentication\b/gi, pl: 'brak uwierzytelnienia' },
  { en: /\bincorrect authorization\b/gi, pl: 'nieprawidłową autoryzację (Incorrect Authorization)' },
  { en: /\bmissing authorization\b/gi, pl: 'brak weryfikacji uprawnień (Missing Authorization)' },
  { en: /\bimproper authorization\b/gi, pl: 'nieprawidłową autoryzację (Improper Authorization)' },
  { en: /\bimproper privilege management\b/gi, pl: 'nieprawidłowe zarządzanie uprawnieniami' },
  { en: /\bout-of-bounds read and write\b/gi, pl: 'odczyt i zapis poza granicami bufora' },
  { en: /\bout-of-bounds write\b/gi, pl: 'zapis poza granicami bufora (Out-of-bounds Write)' },
  { en: /\bout of bounds write\b/gi, pl: 'zapis poza granicami bufora (Out-of-bounds Write)' },
  { en: /\bout-of-bounds read\b/gi, pl: 'odczyt poza granicami bufora (Out-of-bounds Read)' },
  { en: /\bout of bounds read\b/gi, pl: 'odczyt poza granicami bufora (Out-of-bounds Read)' },
  { en: /\bheap-based buffer overflow\b/gi, pl: 'przepełnienie bufora na stercie (Heap Buffer Overflow)' },
  { en: /\bheap-based\b/gi, pl: 'oparte na stercie' },
  { en: /\bbuffer overflow\b/gi, pl: 'przepełnienie bufora (Buffer Overflow)' },
  { en: /\bheap overflow\b/gi, pl: 'przepełnienie sterty (Heap Overflow)' },
  { en: /\bstack overflow\b/gi, pl: 'przepełnienie stosu (Stack Overflow)' },
  { en: /\brace condition\b/gi, pl: 'wyścig (Race Condition)' },
  { en: /\buse-after-free\b/gi, pl: 'użycie pamięci po zwolnieniu (Use-After-Free)' },
  { en: /\btype confusion\b/gi, pl: 'błąd konwersji typów (Type Confusion)' },
  { en: /\bcross-site scripting\b/gi, pl: 'Cross-Site Scripting (XSS)' },
  { en: /\bserver-side request forgery \(ssrf\)\b/gi, pl: 'Server-Side Request Forgery (SSRF)' },
  { en: /\bserver-side request forgery\b/gi, pl: 'Server-Side Request Forgery (SSRF)' },
  { en: /\bsecurity feature bypass\b/gi, pl: 'obejście mechanizmów bezpieczeństwa' },
  { en: /\bsecurity bypass\b/gi, pl: 'ominięcie zabezpieczeń' },
  { en: /\bmemory corruption\b/gi, pl: 'uszkodzenie pamięci (Memory Corruption)' },
  { en: /\binformation disclosure\b/gi, pl: 'nieuprawnione ujawnienie informacji' },
  { en: /\bkernel memory disclosure\b/gi, pl: 'ujawnienie pamięci jądra' },
  { en: /\bunspecified vulnerability\b/gi, pl: 'bliżej nieokreśloną podatność' },
  { en: /\bunspecified\b/gi, pl: 'bliżej nieokreśloną' },
  { en: /\barbitrary file\b/gi, pl: 'dowolny plik' },
  { en: /\barbitrary files\b/gi, pl: 'dowolne pliki' },
  { en: /\bcontainer breakout\b/gi, pl: 'ucieczkę z kontenera (Container Breakout)' },
  { en: /\bcontainer escape\b/gi, pl: 'ucieczkę z kontenera (Container Escape)' },
  { en: /\bleaky file descriptor\b/gi, pl: 'wyciek deskryptora pliku (Leaky File Descriptor)' },
  { en: /\bunauthenticated remote threat actor\b/gi, pl: 'nieuwierzytelnionemu zdalnemu podmiotowi zagrażającemu' },
  { en: /\bunauthenticated threat actor\b/gi, pl: 'nieuwierzytelnionemu podmiotowi zagrażającemu' },
  { en: /\bunauthenticated remote attacker\b/gi, pl: 'nieuwierzytelnionemu atakującemu zdalnemu' },
  { en: /\bunauthenticated, remote attacker\b/gi, pl: 'nieuwierzytelnionemu atakującemu zdalnemu' },
  { en: /\bremote unauthenticated attacker\b/gi, pl: 'nieuwierzytelnionemu atakującemu zdalnemu' },
  { en: /\bunauthenticated attacker\b/gi, pl: 'nieuwierzytelnionemu atakującemu' },
  { en: /\bunauthenticated caller\b/gi, pl: 'nieuwierzytelnionemu wywołującemu' },
  { en: /\bunauthenticated user\b/gi, pl: 'nieuwierzytelnionemu użytkownikowi' },
  { en: /\bunauthenticated\b/gi, pl: 'nieuwierzytelniony' },
  { en: /\bremote authenticated attacker\b/gi, pl: 'uwierzytelnionemu atakującemu zdalnemu' },
  { en: /\bauthenticated user\b/gi, pl: 'uwierzytelnionemu użytkownikowi' },
  { en: /\bauthenticated attacker\b/gi, pl: 'uwierzytelnionemu atakującemu' },
  { en: /\bauthenticated\b/gi, pl: 'uwierzytelniony' },
  { en: /\bremote attacker\b/gi, pl: 'zdalnemu atakującemu' },
  { en: /\blocal attacker\b/gi, pl: 'lokalnemu atakującemu' },
  { en: /\ban attacker\b/gi, pl: 'atakującemu' },
  { en: /\ban attacked\b/gi, pl: 'atakującemu' },
  { en: /\bwith root privileges\b/gi, pl: 'z uprawnieniami roota (administratora)' },
  { en: /\bwith administrative privileges\b/gi, pl: 'z uprawnieniami administratora' },
  { en: /\bwith elevated privileges\b/gi, pl: 'z podwyższonymi uprawnieniami' },
  { en: /\bwith root access\b/gi, pl: 'z dostępem roota (uprawnieniami administratora)' },
  { en: /\broot privileges\b/gi, pl: 'uprawnieniami roota (administratora)' },
  { en: /\badministrative privileges\b/gi, pl: 'uprawnieniami administratora' },
  { en: /\belevated privileges\b/gi, pl: 'podwyższonymi uprawnieniami' },
  { en: /\broot access\b/gi, pl: 'dostęp roota (uprawnienia administratora)' },
  { en: /\bsensitive resources\b/gi, pl: 'poufnych zasobów' },
  { en: /\bsensitive data\b/gi, pl: 'poufnych danych' },
  { en: /\bsensitive information\b/gi, pl: 'poufnych informacji' },
  { en: /\bzero-day vulnerability\b/gi, pl: 'podatność zero-day (luka dnia zerowego)' }
];

export const CVE_SECOPS_PHRASES = [
  { en: /\bvia IPv6 networking subsystem\b/gi, pl: 'za pośrednictwem podsystemu sieciowego IPv6' },
  { en: /\bvia an? alternate path or channel\b/gi, pl: 'za pośrednictwem alternatywnej ścieżki lub kanału' },
  { en: /\binvolving an alternate path or channel\b/gi, pl: 'wykorzystującą alternatywną ścieżkę lub kanał' },
  { en: /\bvia a crafted HTML page\b/gi, pl: 'za pośrednictwem spreparowanej strony HTML' },
  { en: /\bvia crafted HTML page\b/gi, pl: 'za pośrednictwem spreparowanej strony HTML' },
  { en: /\bvia specially crafted packets\b/gi, pl: 'poprzez specjalnie spreparowane pakiety' },
  { en: /\bvia crafted packets\b/gi, pl: 'poprzez spreparowane pakiety' },
  { en: /\binside the sandbox\b/gi, pl: 'wewnątrz piaskownicy (sandbox)' },
  { en: /\binside a sandbox\b/gi, pl: 'wewnątrz piaskownicy (sandbox)' },
  { en: /\bon an affected device\b/gi, pl: 'na podatnym urządzeniu' },
  { en: /\bon an affected system\b/gi, pl: 'na podatnym systemie' },
  { en: /\bto an affected system\b/gi, pl: 'do podatnego systemu' },
  { en: /\bto an affected device\b/gi, pl: 'do podatnego urządzenia' },
  { en: /\bto the underlying operating system\b/gi, pl: 'do bazowego systemu operacyjnego' },
  { en: /\bthrough an active remote sessions?\b/gi, pl: 'poprzez aktywną sesję zdalną' },
  { en: /\bwithout authorization or host confirmation\b/gi, pl: 'bez autoryzacji ani potwierdzenia przez hosta' },
  { en: /\bwithout authorization\b/gi, pl: 'bez autoryzacji' },
  { en: /\band other products using Linux\b/gi, pl: 'oraz innych rozwiązań wykorzystujących jądro Linux' },
  { en: /\band other products using\b/gi, pl: 'oraz innych rozwiązań wykorzystujących' },
  { en: /\bincluding, but not limited to,\b/gi, pl: 'w tym między innymi' },
  { en: /\bincluding but not limited to,\b/gi, pl: 'w tym między innymi' },
  { en: /\bincluding but not limited to\b/gi, pl: 'w tym między innymi' },
  { en: /\bmultiple web browsers that utilize\b/gi, pl: 'wiele przeglądarek internetowych wykorzystujących' },
  { en: /\bnetworking subsystem\b/gi, pl: 'podsystem sieciowy' }
];

export const CVE_TITLE_PATTERNS = [
  { en: /\bUnspecified Vulnerability$/i, pl: 'bliżej nieokreślona' },
  { en: /\bRemote Code Execution Vulnerability$/i, pl: 'zdalne wykonanie kodu (RCE)' },
  { en: /\bCommand Injection Vulnerability$/i, pl: 'wstrzyknięcie poleceń (Command Injection)' },
  { en: /\bStatic Code Injection Vulnerability$/i, pl: 'statyczne wstrzyknięcie kodu (Code Injection)' },
  { en: /\bHeap-Based Buffer Overflow Vulnerability$/i, pl: 'przepełnienie bufora na stercie (Heap Buffer Overflow)' },
  { en: /\bHeap-based Buffer Overflow Vulnerability$/i, pl: 'przepełnienie bufora na stercie (Heap Buffer Overflow)' },
  { en: /\bOut of Bounds Write Vulnerability$/i, pl: 'zapis poza granicami bufora (Out-of-Bounds Write)' },
  { en: /\bOut-of-bounds Write Vulnerability$/i, pl: 'zapis poza granicami bufora (Out-of-Bounds Write)' },
  { en: /\bOut-of-bounds Read and Write Vulnerability$/i, pl: 'odczyt i zapis poza granicami bufora' },
  { en: /\bOut-of-bounds Read Vulnerability$/i, pl: 'odczyt poza granicami bufora (Out-of-Bounds Read)' },
  { en: /\bPath Traversal Vulnerability$/i, pl: 'przejście przez ścieżkę (Path Traversal)' },
  { en: /\bDirectory Traversal Vulnerability$/i, pl: 'przejście przez ścieżkę katalogów (Directory Traversal)' },
  { en: /\bAuthentication Bypass Using an Alternate Path or Channel Vulnerability$/i, pl: 'ominięcie uwierzytelnienia przez alternatywny kanał' },
  { en: /\bAuthentication Bypass Vulnerability$/i, pl: 'ominięcie uwierzytelnienia (Authentication Bypass)' },
  { en: /\bImproper Privilege Management and Missing Authorization Vulnerability$/i, pl: 'nieprawidłowe zarządzanie uprawnieniami i brak autoryzacji' },
  { en: /\bIncorrect Authorization Vulnerability$/i, pl: 'nieprawidłowa autoryzacja' },
  { en: /\bImproper Authentication Vulnerability$/i, pl: 'nieprawidłowe uwierzytelnienie' },
  { en: /\bMissing Authentication for Critical Function Vulnerability$/i, pl: 'brak uwierzytelnienia dla funkcji krytycznej' },
  { en: /\bImproper Neutralization of Special Elements Used in a Template Engine Vulnerability$/i, pl: 'wstrzyknięcie elementów w silniku szablonów (SSTI)' },
  { en: /\bImproper Neutralization of Argument Delimiters in a Command Vulnerability$/i, pl: 'neutralizacja separatorów argumentów poleceń' },
  { en: /\bLink Following Vulnerability$/i, pl: 'podążanie za dowiązaniami (Link Following)' },
  { en: /\bType Confusion Vulnerability$/i, pl: 'błąd konwersji typów (Type Confusion)' },
  { en: /\bPrivilege Escalation Vulnerability$/i, pl: 'eskalacja uprawnień (Privilege Escalation)' },
  { en: /\bElevation of Privilege Vulnerability$/i, pl: 'podniesienie uprawnień (Elevation of Privilege)' }
];

function translateSecOpsSentence(sentence) {
  let text = (sentence || '').trim();
  if (!text) return '';

  const bpProd = text.match(/^This vulnerability (?:could affect|can impact|could impact|may affect|can affect)\s+(?:multiple\s+)?(?:products|web browsers)?(?:,?\s*including(?:,?\s*but not limited to,?)?|,\s*such as)?\s*(.+?)\.?$/i);
  if (bpProd) {
    let prods = bpProd[1];
    for (const ph of CVE_SECOPS_PHRASES) prods = prods.replace(ph.en, ph.pl);
    for (const g of CVE_SECOPS_GLOSSARY) prods = prods.replace(g.en, g.pl);
    return `Podatność ta może dotyczyć wielu produktów, w tym między innymi ${prods}.`;
  }

  const bpImpact = text.match(/^This vulnerability (?:could affect|can impact|could impact|may affect|can affect)\s+(.+?)\.?$/i);
  if (bpImpact) {
    let target = bpImpact[1];
    for (const ph of CVE_SECOPS_PHRASES) target = target.replace(ph.en, ph.pl);
    for (const g of CVE_SECOPS_GLOSSARY) target = target.replace(g.en, g.pl);
    return `Podatność ta może wpłynąć na ${target}.`;
  }

  const bpAttacker = text.match(/^An attacker who successfully exploit(?:ed|s) this vulnerability could\s+(.+?)\.?$/i);
  if (bpAttacker) {
    let consequence = bpAttacker[1];
    for (const ph of CVE_SECOPS_PHRASES) consequence = consequence.replace(ph.en, ph.pl);
    for (const g of CVE_SECOPS_GLOSSARY) consequence = consequence.replace(g.en, g.pl);
    return `Atakujący, który pomyślnie wykorzysta tę podatność, może ${consequence}.`;
  }

  const bpExploit = text.match(/^Successful exploitation (?:allows|could allow|can allow)(?: for)?\s+(.+?)\.?$/i);
  if (bpExploit) {
    let consequence = bpExploit[1];
    for (const ph of CVE_SECOPS_PHRASES) consequence = consequence.replace(ph.en, ph.pl);
    for (const g of CVE_SECOPS_GLOSSARY) consequence = consequence.replace(g.en, g.pl);
    return `Pomyślna eksploatacja podatności może umożliwić ${consequence}.`;
  }

  const bpChained = text.match(/^This vulnerability (?:can be|was|could be) chained with\s+(.+?)\.?$/i);
  if (bpChained) {
    let target = bpChained[1];
    for (const ph of CVE_SECOPS_PHRASES) target = target.replace(ph.en, ph.pl);
    for (const g of CVE_SECOPS_GLOSSARY) target = target.replace(g.en, g.pl);
    return `Podatność ta może zostać połączona w łańcuchu ataków z ${target}.`;
  }

  const mainPattern = text.match(/^(.+?)\s+(?:contain|contains|has|is vulnerable to)\s+(?:both an? )?(.+?)\s+vulnerability(?: in (.+?))?\s+(?:that|which)\s+(?:may allow|allows|could allow|can allow for|can allow|could enable|enables)\s+(.+?)\.?$/i);
  if (mainPattern) {
    const [, vendorProduct, vulnType, component, consequence] = mainPattern;
    let compPl = component ? ` w module ${component}` : '';
    let vulnPl = vulnType;
    for (const ph of CVE_SECOPS_PHRASES) vulnPl = vulnPl.replace(ph.en, ph.pl);
    for (const g of CVE_SECOPS_GLOSSARY) vulnPl = vulnPl.replace(g.en, g.pl);

    let vulnPhrase = vulnPl.toLowerCase().includes('bliżej nieokreślon')
      ? 'bliżej nieokreśloną podatność'
      : `podatność (${vulnPl.replace(/^an?\s+/i, '')})`;

    let toMatch = consequence.match(/^(.+?)\s+to\s+(.+)$/i);
    if (toMatch) {
      let attacker = toMatch[1].replace(/^(?:an?|the)\s+/i, '');
      let action = toMatch[2];
      for (const ph of CVE_SECOPS_PHRASES) {
        attacker = attacker.replace(ph.en, ph.pl);
        action = action.replace(ph.en, ph.pl);
      }
      for (const g of CVE_SECOPS_GLOSSARY) {
        attacker = attacker.replace(g.en, g.pl);
        action = action.replace(g.en, g.pl);
      }
      return `Oprogramowanie ${vendorProduct} zawiera ${vulnPhrase}${compPl}, która może umożliwić ${attacker} na ${action}.`;
    } else {
      let action = consequence;
      for (const ph of CVE_SECOPS_PHRASES) action = action.replace(ph.en, ph.pl);
      for (const g of CVE_SECOPS_GLOSSARY) action = action.replace(g.en, g.pl);
      return `Oprogramowanie ${vendorProduct} zawiera ${vulnPhrase}${compPl}, która może umożliwić ${action}.`;
    }
  }

  let out = text;
  for (const ph of CVE_SECOPS_PHRASES) out = out.replace(ph.en, ph.pl);
  for (const g of CVE_SECOPS_GLOSSARY) out = out.replace(g.en, g.pl);
  out = out.replace(/\bcontains an?\b/gi, 'zawiera')
           .replace(/\bcontains\b/gi, 'zawiera')
           .replace(/\bcontain an?\b/gi, 'zawierają')
           .replace(/\bcontain\b/gi, 'zawierają')
           .replace(/\bdue to an?\b/gi, 'wynikającą z')
           .replace(/\bdue to\b/gi, 'z powodu')
           .replace(/\ballowing an?\b/gi, 'umożliwiającą')
           .replace(/\ballowing\b/gi, 'umożliwiając')
           .replace(/\bthat allows\b/gi, 'która umożliwia')
           .replace(/\bthat may allow\b/gi, 'która może umożliwić')
           .replace(/\bthat could allow\b/gi, 'która mogłaby umożliwić')
           .replace(/\bpotentially exposing\b/gi, 'potencjalnie narażając')
           .replace(/\bmay lead to\b/gi, 'może prowadzić do')
           .replace(/\bleads to\b/gi, 'prowadzi do')
           .replace(/\bcould lead to\b/gi, 'może doprowadzić do');
  return out;
}

/**
 * Regułowe tłumaczenie techniczne opisów CVE z zachowaniem nomenklatury SecOps
 */
export function translateSecOpsRules(text, isRemediation = false) {
  if (!text || typeof text !== 'string') return '';
  let result = text.trim();

  if (isRemediation) {
    if (/Apply mitigations in accordance with vendor instructions/i.test(result)) {
      let extra = '';
      if (/discontinue use of the product if mitigations are unavailable/i.test(result)) {
        extra = ' Jeśli środki zaradcze są niedostępne, należy wycofać produkt z użytku.';
      }
      return `Zastosować środki mitygujące zgodnie z oficjalnymi instrukcjami producenta oprogramowania.${extra}`;
    }
    if (/Apply updates per vendor instructions/i.test(result)) {
      let extra = '';
      if (/discontinue use of the product if mitigations are unavailable/i.test(result)) {
        extra = ' W przypadku braku poprawek zaleca się zaprzestanie korzystania z oprogramowania.';
      }
      return `Zastosować oficjalne aktualizacje zgodnie z zaleceniami producenta.${extra}`;
    }
    if (/Apply patches or workarounds/i.test(result)) {
      return result.replace(/Apply patches or workarounds issued by (.+?)\.?/i, 'Zastosować oficjalne poprawki lub obejścia opublikowane przez $1.');
    }
  }

  for (const t of CVE_TITLE_PATTERNS) {
    if (t.en.test(result)) {
      const product = result.replace(t.en, '').trim();
      return `Podatność ${product}: ${t.pl}`;
    }
  }

  if (/Vulnerability$/i.test(result)) {
    result = result.replace(/(.+?)\s+Vulnerability$/i, 'Podatność $1');
    for (const g of CVE_SECOPS_GLOSSARY) result = result.replace(g.en, g.pl);
    return result;
  }

  const sentences = result.split(/(?<=[.?!])\s+/);
  return sentences.map(translateSecOpsSentence).join(' ');
}

/**
 * Zwraca obiekt podatności uzupełniony o przetłumaczone pola
 */
export function translateCveRecord(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    translatedTitle: translateSecOpsRules(item.title || item.id),
    translatedDescription: translateSecOpsRules(item.description || ''),
    translatedRequiredAction: translateSecOpsRules(item.requiredAction || '', true),
    isTranslated: true
  };
}

let translationsCache = null;
let saveCacheTimeout = null;

/**
 * Zwraca bufor tłumaczeń z dysku (data/cve_translations.json)
 */
export function getTranslationsCache() {
  if (translationsCache) return translationsCache;
  if (fs.existsSync(CVE_TRANSLATIONS_FILE)) {
    try {
      translationsCache = JSON.parse(fs.readFileSync(CVE_TRANSLATIONS_FILE, 'utf8'));
      if (translationsCache && typeof translationsCache === 'object') return translationsCache;
    } catch (e) {
      console.warn('[CVE Engine] Błąd odczytu cve_translations.json, inicjalizacja pustego bufora:', e.message);
    }
  }
  translationsCache = {};
  return translationsCache;
}

/**
 * Zapisuje bufor tłumaczeń na dysk (debounced)
 */
export function saveTranslationsCache(cache) {
  translationsCache = cache;
  if (saveCacheTimeout) clearTimeout(saveCacheTimeout);
  saveCacheTimeout = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CVE_TRANSLATIONS_FILE, JSON.stringify(translationsCache, null, 2), 'utf8');
    } catch (e) {
      console.error('[CVE Engine] Błąd zapisu cve_translations.json:', e.message);
    }
  }, 500);
}

/**
 * Tłumaczy pojedynczy ciąg znaków na żywo z obsługą bufora dyskowego i bezpiecznym fallbackiem
 */
export async function translateLiveText(text, targetLang = 'pl', sourceLang = 'en') {
  if (!text || typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';

  const cache = getTranslationsCache();
  const cacheKey = `${sourceLang}_${targetLang}:${trimmed}`;
  if (cache[cacheKey]) {
    return cache[cacheKey];
  }

  // 1. Silnik MyMemory (wysoka dostępność w środowiskach kontenerowych Docker)
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmed)}&langpair=${encodeURIComponent(sourceLang)}|${encodeURIComponent(targetLang)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'KnowOpsWiki/2.8 (SecOps Wiki)'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.responseData && data.responseData.translatedText) {
        let translated = String(data.responseData.translatedText).trim();
        if (translated && !translated.startsWith('MYMEMORY WARNING:')) {
          cache[cacheKey] = translated;
          saveTranslationsCache(cache);
          return translated;
        }
      }
    }
  } catch (err) {
    // przejście do silnika zapasowego
  }

  // 2. Silnik Google GTX (zapasowy)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(trimmed)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translated = data[0].map(chunk => (chunk && chunk[0]) ? chunk[0] : '').join('').trim();
        if (translated) {
          cache[cacheKey] = translated;
          saveTranslationsCache(cache);
          return translated;
        }
      }
    }
  } catch (err) {}

  // 3. Fallback do reguł leksykalnych SecOps
  const fallback = translateSecOpsRules(trimmed);
  return fallback || trimmed;
}

/**
 * Tłumaczy wsadowo zestaw elementów lub ciągów znaków
 */
export async function batchTranslateLive(items, targetLang = 'pl', sourceLang = 'en') {
  if (!Array.isArray(items)) return [];
  const results = [];
  for (const item of items) {
    if (typeof item === 'string') {
      results.push(await translateLiveText(item, targetLang, sourceLang));
    } else if (item && typeof item === 'object') {
      const title = item.title || item.id || '';
      const description = item.description || '';
      const requiredAction = item.requiredAction || '';

      const [translatedTitle, translatedDescription, translatedRequiredAction] = await Promise.all([
        title ? translateLiveText(title, targetLang, sourceLang) : Promise.resolve(''),
        description ? translateLiveText(description, targetLang, sourceLang) : Promise.resolve(''),
        requiredAction ? translateLiveText(requiredAction, targetLang, sourceLang) : Promise.resolve('')
      ]);

      results.push({
        ...item,
        translatedTitle: translatedTitle || item.title || item.id,
        translatedDescription: translatedDescription || item.description,
        translatedRequiredAction: translatedRequiredAction || item.requiredAction,
        isLiveTranslated: true
      });
    }
  }
  return results;
}


