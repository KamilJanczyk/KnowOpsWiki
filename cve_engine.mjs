import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const CVE_CACHE_FILE = path.join(DATA_DIR, 'cve_cache.json');
const CVE_WATCHLIST_FILE = path.join(DATA_DIR, 'cve_watchlist.json');

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
