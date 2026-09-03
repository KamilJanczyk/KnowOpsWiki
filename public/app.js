let currentCategory = 'kanban_board';
let currentSubcategory = '';
let navigationData = null;

// Shared States
let kanbanTasks = [];
let quickNotes = [];
let showOnlyActiveDir = false;
let monitorIntervalId = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadNavigation();
  await handleHashNavigation();
  await loadRightSidebarKanban();

  // Obsługa globalnej wyszukiwarki
  const searchInput = document.getElementById('globalSearchInput');
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = searchInput.value.trim();
        triggerGlobalSearch(query);
      }
    });
  }

  // Obsługa skrótów klawiaturowych i Command Palette [dodane]
  document.addEventListener('keydown', (e) => {
    // Ctrl+K lub Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
    // Zamknięcie modali klawiszem Esc
    if (e.key === 'Escape') {
      closeCommandPalette();
    }
  });

  const cpInput = document.getElementById('commandPaletteInput');
  if (cpInput) {
    cpInput.addEventListener('input', () => {
      renderCommandPaletteResults(cpInput.value.trim());
    });
    cpInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateCommandPalette(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateCommandPalette(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        triggerCommandPaletteSelection();
      }
    });
  }

  window.addEventListener('hashchange', async () => {
    await handleHashNavigation();
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      await loadNavigation();
      if (typeof renderSidebar === 'function') {
        await renderSidebar();
      }
    }
  });
});

async function loadNavigation() {
  try {
    let data = null;
    try {
      const apiRes = await fetch('/api/navigation?t=' + Date.now());
      if (apiRes.ok) {
        data = await apiRes.json();
      }
    } catch (e) {
      console.warn('[loadNavigation] Błąd pobierania z /api/navigation:', e);
    }

    if (!data) {
      const res = await fetch('/docs/navigation.json?t=' + Date.now());
      if (res.ok) {
        data = await res.json();
      }
    }

    if (data) {
      navigationData = data;
      renderTopCategories(data.categories || []);
    }
  } catch (err) {
    console.error('Błąd ładowania nawigacji:', err);
  }
}

async function triggerRescan() {
  try {
    const res = await fetch('/api/rescan?t=' + Date.now());
    if (res.ok) {
      await loadNavigation();
      await renderSidebar();
      alert('Skanowanie bazy wiedzy zakończone pomyślnie.');
    } else {
      alert('Błąd podczas skanowania bazy wiedzy.');
    }
  } catch (err) {
    console.error('Błąd triggerRescan:', err);
    alert('Błąd połączenia z serwerem: ' + err.message);
  }
}

async function triggerGlobalSearch(query) {
  if (!query) return;
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');
  if (breadcrumbArea) breadcrumbArea.innerHTML = `Wyszukiwanie &gt; Fraz: "${query}"`;

  contentArea.innerHTML = `<p style="color:#888;">Trwa wyszukiwanie...</p>`;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&t=` + Date.now());
    const data = await res.json();
    const results = data.results || [];

    let html = `<h2>Wyniki wyszukiwania dla: "${query}"</h2>`;
    html += `<p style="font-size:0.8rem; color:#aaa; margin-bottom:16px;">Znaleziono: ${results.length} dopasowań.</p>`;

    if (results.length === 0) {
      html += `<p style="color:#888;">Brak wyników. Spróbuj wpisać inne słowo kluczowe.</p>`;
    } else {
      html += `<div style="display:flex; flex-direction:column; gap:12px;">`;
      for (const r of results) {
        // Escapowanie snippetu
        const cleanSnippet = r.snippet
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          // Podświetl szukaną frazę
          .replace(new RegExp(query, 'gi'), match => `<mark style="background:var(--sw-gold); color:#000; padding:1px 3px; border-radius:2px; font-weight:bold;">${match}</mark>`);

        html += `<div style="background:#18181b; border:1px solid #27272a; padding:12px; border-radius:6px;">
          <a href="#/${r.relPath}" style="color:var(--sw-gold); font-weight:bold; font-size:0.9rem; text-decoration:none;">📄 ${r.title}</a>
          <div style="font-size:0.7rem; color:#666; margin-top:2px;">Ścieżka: ${r.relPath}</div>
          <p style="font-size:0.78rem; color:#bbb; margin-top:6px; font-style:italic; line-height:1.4;">...${cleanSnippet}...</p>
        </div>`;
      }
      html += `</div>`;
    }

    contentArea.innerHTML = `<div class="markdown-body">${html}</div>`;

  } catch (err) {
    contentArea.innerHTML = `<p style="color:#ef4444;">Błąd wyszukiwania: ${err.message}</p>`;
  }
}

function renderTopCategories(categories) {
  const topNav = document.getElementById('topCatNav');
  if (!topNav) return;

  let html = '';
  for (const cat of categories) {
    const isKanban = cat.id === 'kanban_board';
    const subcategories = cat.subcategories || [];
    const isActive = cat.id === currentCategory;

    if (isKanban) {
      html += `<li class="top-cat-item ${isActive ? 'active' : ''}">
        <a href="#/kanban" class="top-cat-link" onclick="selectCategory('${cat.id}', '')">
          <span>${cat.title}</span>
        </a>
      </li>`;
    } else if (subcategories.length > 0) {
      html += `<li class="top-cat-item ${isActive ? 'active' : ''}">
        <a href="javascript:void(0)" class="top-cat-link" style="cursor:default;" onclick="event.preventDefault()">
          <span>${cat.title}</span>
          <span class="arrow">▼</span>
        </a>
        <div class="top-dropdown-menu">
          ${subcategories.map(sub => {
            const directFile = sub.files && sub.files.find(f => {
              const fileDir = f.relPath.substring(0, f.relPath.lastIndexOf('/'));
              return fileDir === sub.relPath;
            });
            const firstFile = directFile ? directFile.relPath : (sub.files && sub.files.length > 0 ? sub.files[0].relPath : '');
            const subHref = firstFile ? `#/${firstFile}` : `#/${cat.id}/${sub.id}`;
            
            return `
              <a href="${subHref}" class="top-dropdown-item font-semibold" onclick="selectCategory('${cat.id}', '${sub.id}')" style="display: flex; align-items: center; gap: 6px;">
                📁 ${sub.title}
              </a>
            `;
          }).join('')}
        </div>
      </li>`;
    }
  }
  topNav.innerHTML = html;
}

let expandedDirs = {};

window.toggleSidebarDir = function(relPath) {
  const dirId = 'dir-' + relPath.replace(/[^a-zA-Z0-9]/g, '-');
  const el = document.getElementById(dirId);
  if (el) {
    const isCollapsed = (el.style.display === 'none');
    el.style.display = isCollapsed ? 'block' : 'none';
    const header = el.previousElementSibling;
    const arrow = header ? header.querySelector('.dir-arrow') : null;
    if (arrow) {
      arrow.innerText = isCollapsed ? '▼' : '▶';
    }
    expandedDirs[relPath] = isCollapsed;
  }
};

function selectCategory(catId, subId) {
  currentCategory = catId;
  currentSubcategory = subId || '';
  if (navigationData && navigationData.categories) {
    renderTopCategories(navigationData.categories);
  }
  renderSidebar();
}

async function renderSidebar() {
  const sidebarNav = document.getElementById('sidebarNav');
  const sidebarTitle = document.getElementById('sidebarTitle');
  if (!sidebarNav) return;

  if (!navigationData) {
    await loadNavigation();
  }

  const cat = (navigationData.categories || []).find(c => c.id === currentCategory);
  if (!cat) {
    sidebarNav.innerHTML = '';
    if (sidebarTitle) sidebarTitle.innerText = 'NAWIGACJA';
    return;
  }

  if (cat.id === 'kanban_board') {
    if (sidebarTitle) sidebarTitle.innerText = 'PULPIT';
    const currentHash = decodeURIComponent(window.location.hash.replace('#/', ''));

    const isKanbanActive = (!currentHash || currentHash === 'kanban');
    const isNotesActive = (currentHash === 'notes');
    const isPassgenActive = (currentHash === 'tool/passgen');
    const isCidrActive = (currentHash === 'tool/cidr');
    const isRaidActive = (currentHash === 'tool/raid');
    const isMonitorActive = (currentHash === 'tool/monitor');
    const isRssActive = (currentHash === 'tool/rss');
    const isInstrukcjaActive = (currentHash === 'tool/instrukcja');

    sidebarNav.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:2px; margin-top:6px;">
        <a href="#/kanban" class="sidebar-tile-btn ${isKanbanActive ? 'active' : ''}">
          <span class="icon">📋</span>
          <span class="label">Tablica Kanban</span>
        </a>
        <a href="#/notes" class="sidebar-tile-btn ${isNotesActive ? 'active' : ''}">
          <span class="icon">📝</span>
          <span class="label">Szybkie Notatki</span>
        </a>
        <a href="#/tool/passgen" class="sidebar-tile-btn ${isPassgenActive ? 'active' : ''}">
          <span class="icon">🔑</span>
          <span class="label">Hasłomat SecOps</span>
        </a>
        <a href="#/tool/cidr" class="sidebar-tile-btn ${isCidrActive ? 'active' : ''}">
          <span class="icon">🌐</span>
          <span class="label">Kalkulator CIDR</span>
        </a>
        <a href="#/tool/raid" class="sidebar-tile-btn ${isRaidActive ? 'active' : ''}">
          <span class="icon">💾</span>
          <span class="label">Kalkulator RAID & ZFS</span>
        </a>
        <a href="#/tool/rss" class="sidebar-tile-btn ${isRssActive ? 'active' : ''}">
          <span class="icon">📡</span>
          <span class="label">Biuletyn RSS SecOps</span>
        </a>
        <a href="#/tool/monitor" class="sidebar-tile-btn ${isMonitorActive ? 'active' : ''}">
          <span class="label" style="padding-left: 20px;">Monitor Serwera</span>
        </a>
        <a href="#/tool/instrukcja" class="sidebar-tile-btn ${isInstrukcjaActive ? 'active' : ''}">
          <span class="icon">📖</span>
          <span class="label">Instrukcja Obsługi</span>
        </a>
      </div>
    `;
    return;
  }

  const subcategories = cat.subcategories || [];
  let targetSub = subcategories.find(s => s.id === currentSubcategory);

  if (!targetSub && subcategories.length > 0) {
    targetSub = subcategories[0];
    currentSubcategory = targetSub.id;
  }

  if (sidebarTitle) {
    sidebarTitle.innerText = (targetSub ? targetSub.title : cat.title).toUpperCase();
  }

  if (!targetSub) {
    sidebarNav.innerHTML = '';
    return;
  }

  const currentHash = decodeURIComponent(window.location.hash.replace('#/', ''));

  const hashParts = currentHash.split('/');
  let pathAcc = '';
  for (let i = 0; i < hashParts.length - 1; i++) {
    pathAcc = pathAcc ? `${pathAcc}/${hashParts[i]}` : hashParts[i];
    expandedDirs[pathAcc] = true;
  }

  function renderTree(items, depth = 0) {
    let subHtml = '';
    for (const item of (items || [])) {
      const indent = depth * 12;
      if (item.type === 'directory') {
        const isExpanded = expandedDirs[item.relPath] || false;
        const dirId = 'dir-' + item.relPath.replace(/[^a-zA-Z0-9]/g, '-');
        subHtml += `<li class="topic-group-header" style="padding-left: ${indent + 8}px; font-weight: bold; font-size: 0.72rem; color: var(--sw-gold); margin-top: 3px; margin-bottom: 2px; list-style-type: none; display: flex; align-items: center; justify-content: space-between; cursor: pointer; white-space: nowrap; overflow: hidden;" onclick="toggleSidebarDir('${item.relPath}')" ondragover="window.handleSidebarDragOver(event)" ondragleave="window.handleSidebarDragLeave(event)" ondrop="window.handleSidebarDrop(event, '${item.relPath}')">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">📁 ${item.title}</span>
          <span class="dir-arrow" style="font-size: 0.6rem; color: #888; font-weight: normal; margin-left: 6px; flex-shrink: 0;">${isExpanded ? '▼' : '▶'}</span>
        </li>`;
        subHtml += `<div id="${dirId}" style="display: ${isExpanded ? 'block' : 'none'};">`;
        subHtml += renderTree(item.items, depth + 1);
        subHtml += `</div>`;
      } else {
        const isFileActive = (currentHash === item.relPath);
        subHtml += `<li class="topic-item ${isFileActive ? 'active' : ''}" style="padding-left: ${indent + 8}px;" draggable="true" ondragstart="window.handleSidebarDragStart(event, '${item.relPath}')">
          <a href="#/${item.relPath}">${item.title}</a>
        </li>`;
      }
    }
    return subHtml;
  }

  let html = '';
  let itemsToRender = targetSub.items || [];

  // Wyznaczenie aktywnego katalogu na podstawie hasha
  let activeDirRelPath = null;
  if (hashParts.length > 2) {
    activeDirRelPath = hashParts.slice(0, -1).join('/');
  }

  const hasMatchingDir = activeDirRelPath && (targetSub.items || []).some(item => item.type === 'directory' && item.relPath === activeDirRelPath);

  let focusToggleHtml = '';
  if (hasMatchingDir) {
    if (showOnlyActiveDir) {
      itemsToRender = (targetSub.items || []).filter(item => item.type !== 'directory' || item.relPath === activeDirRelPath);
      expandedDirs[activeDirRelPath] = true;
      focusToggleHtml = `<li style="list-style:none; margin-bottom:8px; padding:0 8px;">
        <button class="toolbar-btn" style="width:100%; text-align:center; background:#1e1b4b; border-color:#312e81; color:#c7d2fe;" onclick="window.toggleSidebarFocus(false)">Pokaż wszystkie działy</button>
      </li>`;
    } else {
      focusToggleHtml = `<li style="list-style:none; margin-bottom:8px; padding:0 8px;">
        <button class="toolbar-btn" style="width:100%; text-align:center;" onclick="window.toggleSidebarFocus(true)">Włącz widok skupienia</button>
      </li>`;
    }
  }

  if (itemsToRender && itemsToRender.length > 0) {
    html = focusToggleHtml + renderTree(itemsToRender, 0);
  } else {
    html = renderTree((targetSub.files || []).map(f => ({ type: 'file', title: f.title, relPath: f.relPath })), 0);
  }
  sidebarNav.innerHTML = html;
}

window.toggleSidebarFocus = function(val) {
  showOnlyActiveDir = val;
  renderSidebar();
};

async function handleHashNavigation() {
  showOnlyActiveDir = false;
  if (monitorIntervalId) {
    clearInterval(monitorIntervalId);
    monitorIntervalId = null;
  }
  const hash = decodeURIComponent(window.location.hash.replace('#/', ''));

  if (!hash || hash === 'kanban') {
    selectCategory('kanban_board', '');
    await loadKanbanBoard();
    return;
  }
  if (hash === 'notes') {
    selectCategory('kanban_board', '');
    await loadQuickNotes();
    return;
  }
  if (hash === 'tool/passgen') {
    selectCategory('kanban_board', '');
    renderPassphraseGenerator();
    return;
  }
  if (hash === 'tool/cidr') {
    selectCategory('kanban_board', '');
    renderCidrCalculator();
    return;
  }
  if (hash === 'tool/raid') {
    selectCategory('kanban_board', '');
    renderRaidCalculator();
    return;
  }
  if (hash === 'tool/monitor') {
    selectCategory('kanban_board', '');
    renderServerMonitor();
    return;
  }
  if (hash === 'tool/rss') {
    selectCategory('kanban_board', '');
    renderRssReader();
    return;
  }
  if (hash === 'tool/instrukcja') {
    selectCategory('kanban_board', '');
    renderWikiInstruction();
    return;
  }

  // Handle category/subcategory link e.g. "01_Sciagi/06_Komendy_GNU_Linux"
  const parts = hash.split('/');
  if (navigationData) {
    const cat = navigationData.categories.find(c => c.id === parts[0]);
    if (cat) {
      if (parts.length === 2 && cat.subcategories) {
        const sub = cat.subcategories.find(s => s.id === parts[1]);
        if (sub && sub.files && sub.files.length > 0) {
          selectCategory(cat.id, sub.id);
          const directFile = sub.files.find(f => {
            const fileDir = f.relPath.substring(0, f.relPath.lastIndexOf('/'));
            return fileDir === sub.relPath;
          });
          const targetFile = directFile || sub.files[0];
          window.location.hash = '#/' + targetFile.relPath;
          return;
        }
      } else if (parts.length >= 3) {
        selectCategory(parts[0], parts[1]);
        await loadArticle(hash);
        return;
      }
    }
  }

  await loadArticle(hash);
}


function renderMermaidDiagrams(container = null) {
  if (typeof mermaid === 'undefined') return;

  const target = container || document;
  const mermaidBlocks = target.querySelectorAll('pre code.language-mermaid, pre code.lang-mermaid, div.mermaid, pre.mermaid, code.language-mermaid');

  if (mermaidBlocks.length === 0) return;

  mermaidBlocks.forEach((block, index) => {
    let rawCode = block.innerText || block.textContent;
    rawCode = rawCode.trim();

    let parentEl = block;
    if (block.tagName.toLowerCase() === 'code' && block.parentElement && block.parentElement.tagName.toLowerCase() === 'pre') {
      parentEl = block.parentElement;
    }

    const div = document.createElement('div');
    div.className = 'mermaid';
    div.style.background = '#0d0d0e';
    div.style.padding = '12px';
    div.style.borderRadius = '6px';
    div.style.border = '1px solid #27272a';
    div.style.margin = '12px 0';
    div.style.display = 'flex';
    div.style.justifyContent = 'center';
    div.style.overflowX = 'auto';
    div.id = 'mermaid-id-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '-' + index;
    div.textContent = rawCode;

    if (parentEl && parentEl.parentNode) {
      parentEl.parentNode.replaceChild(div, parentEl);
    }
  });

  setTimeout(() => {
    try {
      if (typeof mermaid.run === 'function') {
        mermaid.run({ querySelector: '.mermaid' });
      } else if (typeof mermaid.init === 'function') {
        mermaid.init(undefined, target.querySelectorAll('.mermaid'));
      }
    } catch (e) {
      console.warn('[Wiki API Mermaid Render Error]', e);
    }
  }, 50);
}

function addCopyButtons(container = null) {
  const target = container || document.getElementById('articleContentArea');
  if (!target) return;

  const preBlocks = target.querySelectorAll('pre');
  preBlocks.forEach((pre) => {
    pre.style.position = 'relative';
    if (pre.querySelector('.copy-code-btn')) return;

    // Syntax Highlighting przez highlight.js [dodane: punkt 8]
    if (typeof hljs !== 'undefined') {
      const codeEl = pre.querySelector('code');
      if (codeEl && !codeEl.dataset.highlighted) {
        hljs.highlightElement(codeEl);
      }
    }

    const btn = document.createElement('button');
    btn.className = 'copy-code-btn';
    btn.textContent = 'Kopiuj';
    btn.type = 'button';

    btn.addEventListener('click', async () => {
      const code = pre.querySelector('code');
      const textToCopy = code ? code.textContent : pre.textContent;

      try {
        await navigator.clipboard.writeText(textToCopy);
        btn.textContent = 'Skopiowano!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Kopiuj';
          btn.classList.remove('copied');
        }, 1500);
      } catch (err) {
        console.warn('Błąd kopiowania:', err);
        btn.textContent = 'Błąd';
      }
    });

    pre.appendChild(btn);
  });
}

// Multi-tiered Safe Markdown Parser
function parseMarkdown(text) {
  if (!text) return '';

  // Wikilinks: [[Nazwa Artykulu]] -> [Nazwa Artykulu](#/sciezka.md) [dodane: punkt 13]
  text = text.replace(/\[\[([^\]]+)\]\]/g, (match, wikiName) => {
    const normalized = wikiName.trim();
    if (navigationData && navigationData.categories) {
      for (const cat of navigationData.categories) {
        for (const sub of (cat.subcategories || [])) {
          for (const file of (sub.files || [])) {
            if (
              file.title.toLowerCase() === normalized.toLowerCase() ||
              file.relPath.toLowerCase().includes(normalized.toLowerCase().replace(/\s+/g, '_'))
            ) {
              return `[${normalized}](#/${file.relPath})`;
            }
          }
        }
      }
    }
    // Artykul nie znaleziony w navigationData
    return `<span style="color:#ef4444; text-decoration:underline dotted; cursor:help;" title="Artykul nie znaleziony w wiki: ${normalized}">[[${normalized}]]</span>`;
  });

  const normalizedText = text.replace(/[´’‘]/g, '`');
  let html = '';
  try {
    if (typeof marked !== 'undefined') {
      if (typeof marked.parse === 'function') html = marked.parse(normalizedText);
      else if (typeof marked === 'function') html = marked(normalizedText);
    } else if (typeof window.markdownit !== 'undefined') {
      const md = window.markdownit({ html: true, linkify: true });
      html = md.render(normalizedText);
    }
  } catch (e) {
    console.warn('Błąd parsowania markdown:', e);
  }

  if (!html) {
    let cleanText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    cleanText = cleanText.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    cleanText = cleanText.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    cleanText = cleanText.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    cleanText = cleanText.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    cleanText = cleanText.replace(/`([^`]+)`/g, '<code>$1</code>');
    cleanText = cleanText.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    cleanText = cleanText.replace(/\n/g, '<br>');
    html = cleanText;
  }

  // Dynamic path rewriting for media directory
  html = html.replace(/src="[^"]*?media\/(.*?)"/g, 'src="/docs/media/$1"');

  // Obsługa stylizowanych bloków alertów (Callout Alerts / Notion-style) [dodane]
  if (html) {
    html = html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
      const alertMatch = content.match(/\[!(NOTE|WARNING|CAUTION|IMPORTANT|TIP)\]/i);
      if (alertMatch) {
        const type = alertMatch[1].toUpperCase();
        
        // Usunięcie znacznika alertu [!TYP]
        let cleanContent = content.replace(/\[!(NOTE|WARNING|CAUTION|IMPORTANT|TIP)\]/gi, '').trim();
        
        // Oczyszczenie z ewentualnych zbędnych znaczników akapitu/przejścia do nowej linii po znaczniku
        cleanContent = cleanContent.replace(/^<p>\s*(<br\s*\/?>)?/i, '<p>');
        if (cleanContent.startsWith('<p></p>')) {
          cleanContent = cleanContent.replace('<p></p>', '');
        }

        const alertClass = `markdown-alert markdown-alert-${type.toLowerCase()}`;
        const titleText = type === 'NOTE' ? 'INFORMACJA' :
                          type === 'WARNING' ? 'OSTRZEŻENIE' :
                          type === 'CAUTION' ? 'UWAGA KRYTYCZNA' :
                          type === 'IMPORTANT' ? 'WAŻNE' :
                          type === 'TIP' ? 'WSKAZÓWKA' : type;

        return `<div class="${alertClass}">
          <div class="markdown-alert-title">${titleText}</div>
          <div class="markdown-alert-body">${cleanContent}</div>
        </div>`;
      }
      return match;
    });
  }

  return html;
}

// Load Article with robust fallback
let currentArticlePath = '';

async function loadArticle(articlePath) {
  articlePath = decodeURIComponent(articlePath).replace(/^#\/?/, "");
  currentArticlePath = articlePath;
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');

  try {
    let markdownText = '';
    
    window.currentMtime = '';
    try {
      const apiRes = await fetch(`/api/get-page?relPath=${encodeURIComponent(articlePath)}&t=` + Date.now());
      if (apiRes.ok) {
        const apiData = await apiRes.json();
        markdownText = apiData.content || '';
        if (apiData.mtime) {
          window.currentMtime = new Date(apiData.mtime).toLocaleString('pl-PL');
        }
      }
    } catch (e) {
      console.warn('[loadArticle] Nie udało się pobrać metadanych z API:', e);
    }

    if (!markdownText) {
      const res = await fetch(`/docs/${articlePath}?t=` + Date.now());
      if (res.ok) {
        const rawText = await res.text();
        if (!rawText.trim().startsWith('<!DOCTYPE')) {
          markdownText = rawText;
        }
      }
    }

    if (markdownText === null || typeof markdownText === "undefined") {
      throw new Error(`Plik ${articlePath} nie został odnaleziony na serwerze.`);
    }

        const pathParts = articlePath.split('/');
    if (breadcrumbArea) {
      const bCrumbText = pathParts.map(p => p.replace('.md', '').replace(/_/g, ' ')).join(' &gt; ');
      breadcrumbArea.innerHTML = bCrumbText;
    }

    const actionHeaderHtml = `<div style="display:flex; justify-content:space-between; align-items:center; background:#18181b; border:1px solid #3f3f46; padding:8px 12px; border-radius:6px; margin-bottom:12px;">
      <div style="display:flex; flex-direction:column;"><span style="font-size:0.72rem; color:#a1a1aa; font-weight:600;">DOKUMENT: ${articlePath}</span><span style="font-size:0.65rem; color:#6b7280; margin-top:2px;">Ostatnia modyfikacja: ${window.currentMtime || "Brak danych"}</span></div>
      <div style="display:flex; gap:6px;">
        <button class="btn-action" style="background:#166534; border:1px solid #22c55e; color:#ffffff; font-weight:600; font-size:0.68rem; padding:4px 8px; border-radius:4px; cursor:pointer;" onclick="openCreateItemModalForCurrentFolder()">+ DODAJ STRONĘ W TYM FOLDERZE</button>
        <button class="btn-action" style="background:#1e3a8a; border:1px solid #3b82f6; color:#ffffff; font-weight:600; font-size:0.68rem; padding:4px 8px; border-radius:4px; cursor:pointer;" onclick="openMovePageModal()">PRZENIEŚ DOKUMENT</button>
        <button class="btn-action" style="background:var(--sw-gold); color:#000000; font-weight:600; font-size:0.68rem; padding:4px 8px; border-radius:4px; cursor:pointer;" onclick="openEditorModal()">EDYTUJ TEN DOKUMENT</button>
      </div>
    </div>`;
    contentArea.innerHTML = actionHeaderHtml + `<div class="markdown-body">${parseMarkdown(markdownText)}</div>`;
    renderMermaidDiagrams();
    addCopyButtons();

  } catch (err) {
    contentArea.innerHTML = `<div class="markdown-body">
      <h2>Błąd ładowania artykułu</h2>
      <p style="color:#ef4444;">Nie udało się załadować pliku: ${articlePath} (${err.message})</p>
    </div>`;
  }
}

// ================= KANBAN & NOTES MODULES ================= //

async function loadKanbanBoard() {
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');

  if (breadcrumbArea) breadcrumbArea.innerHTML = 'Pulpit &gt; Tablica Kanban';

  try {
    const res = await fetch('/api/kanban?t=' + Date.now());
    const data = await res.json();
    kanbanTasks = data.tasks || [];

    const archivedCount = kanbanTasks.filter(t => t.archived || t.status === 'done').length;

    let html = `<div class="kanban-wrapper">
      <div class="tool-header">
        <h2>TABLICA ZADAŃ SYSTEMOWYCH KANBAN</h2>
        <div>
          <button class="btn-action" onclick="openAddTaskModal()">+ Nowe Zadanie</button>
          <button class="btn-action btn-archive" onclick="openArchiveModal()">🗃️ Archiwum Zadań (${archivedCount})</button>
        </div>
      </div>

      <div class="kanban-grid">
        <div class="kanban-col" id="col-todo">
          <div class="col-title col-todo-title">DO ZROBIENIA</div>
          <div class="task-cards-container" id="cards-todo"></div>
        </div>
        <div class="kanban-col" id="col-in_progress">
          <div class="col-title col-progress-title">W TRAKCIE</div>
          <div class="task-cards-container" id="cards-in_progress"></div>
        </div>
      </div>
    </div>`;

    contentArea.innerHTML = html;
    renderKanbanCards();
    await loadRightSidebarKanban();

  } catch (err) {
    contentArea.innerHTML = `<p style="color:#ef4444;">Błąd ładowania zadań Kanban: ${err.message}</p>`;
  }
}

let modalDraftSubtasks = [];
let editingTaskId = null;

function renderKanbanCards() {
  const statuses = ['todo', 'in_progress'];
  statuses.forEach(status => {
    const container = document.getElementById(`cards-${status}`);
    if (!container) return;

    const filtered = kanbanTasks.filter(t => t.status === status && !t.archived);
    const prioWeights = { high: 3, medium: 2, low: 1 };
    filtered.sort((a, b) => (prioWeights[b.priority || 'medium'] || 2) - (prioWeights[a.priority || 'medium'] || 2));
    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-card">Brak zadań w tej kolumnie</div>`;
      return;
    }

    let cardsHtml = '';
    for (const t of filtered) {
      const priorityClass = `prio-${t.priority || 'medium'}`;
      const subtasks = t.subtasks || [];
      const totalSub = subtasks.length;
      const doneSub = subtasks.filter(s => s.done).length;
      const progressPercent = totalSub > 0 ? Math.round((doneSub / totalSub) * 100) : 0;

      let subtasksHtml = '';
      if (totalSub > 0) {
        subtasksHtml = `<div class="subtasks-container">
          <div class="subtasks-header">
            <span>Podzadania (${doneSub}/${totalSub})</span>
            <span>${progressPercent}%</span>
          </div>
          <div class="subtask-progress-bar">
            <div class="subtask-progress-fill" style="width: ${progressPercent}%;"></div>
          </div>
          ${subtasks.map(s => `
            <label class="subtask-checkbox-item">
              <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtask('${t.id}', '${s.id}')">
              <span class="${s.done ? 'subtask-done' : ''}">${s.title}</span>
            </label>
          `).join('')}
        </div>`;
      }

      cardsHtml += `<div class="kanban-card ${priorityClass}">
        <div class="card-head">
          <span class="card-cat">${t.category || 'SysAdmin'}</span>
          <span class="card-prio">${(t.priority || 'medium').toUpperCase()}</span>
        </div>
        <div class="card-title">${t.title}</div>
        ${t.description ? `<div class="card-desc">${t.description}</div>` : ''}
        ${subtasksHtml}
        <div class="card-footer">
          <span class="card-date">${t.createdAt || ''}</span>
          <div class="card-actions">
            <button onclick="openEditTaskModal('${t.id}')" title="Edytuj / Podzadania" style="background:#27272a; color:#f4f4f5;">✏️</button>
            ${status !== 'todo' ? `<button onclick="moveTask('${t.id}', 'prev')" title="Cofnij">◀</button>` : ''}
            ${status === 'in_progress' 
              ? `<button onclick="archiveTask('${t.id}')" style="background:#10b981; color:#fff;" title="Przenieś do Zrobione / Archiwum">✓ Zrobione</button>`
              : `<button onclick="moveTask('${t.id}', 'next')" title="Dalej">▶</button>`
            }
          </div>
        </div>
      </div>`;
    }
    container.innerHTML = cardsHtml;
  });
}

async function toggleSubtask(taskId, subtaskId) {
  const task = kanbanTasks.find(t => t.id === taskId);
  if (task && task.subtasks) {
    const sub = task.subtasks.find(s => s.id === subtaskId);
    if (sub) {
      sub.done = !sub.done;
      await saveKanbanTasks();
      renderKanbanCards();
    }
  }
}

async function openAddTaskModal() {
  await loadTaskTemplates();
  if (!kanbanTasks || kanbanTasks.length === 0) {
    try {
      const res = await fetch('/api/kanban?t=' + Date.now());
      const data = await res.json();
      kanbanTasks = data.tasks || [];
    } catch (e) {
      console.warn('Nie udało się pobrać zadań:', e);
    }
  }

  editingTaskId = null;
  modalDraftSubtasks = [];
  document.getElementById('taskTitleInput').value = '';
  document.getElementById('taskDescInput').value = '';
  document.getElementById('taskCategorySelect').value = 'SysAdmin';
  document.getElementById('taskPrioritySelect').value = 'medium';
  document.getElementById('newSubtaskInput').value = '';
  renderModalSubtasks();
  
  const modal = document.getElementById('addTaskModalOverlay');
  if (modal) modal.style.display = 'flex';
}

function openEditTaskModal(taskId) {
  const task = kanbanTasks.find(t => t.id === taskId);
  if (!task) return;

  editingTaskId = taskId;
  modalDraftSubtasks = JSON.parse(JSON.stringify(task.subtasks || []));
  
  document.getElementById('taskTitleInput').value = task.title || '';
  document.getElementById('taskDescInput').value = task.description || '';
  document.getElementById('taskCategorySelect').value = task.category || 'SysAdmin';
  document.getElementById('taskPrioritySelect').value = task.priority || 'medium';
  document.getElementById('newSubtaskInput').value = '';
  renderModalSubtasks();

  const modal = document.getElementById('addTaskModalOverlay');
  if (modal) modal.style.display = 'flex';
}

function closeAddTaskModal() {
  editingTaskId = null;
  modalDraftSubtasks = [];
  const modal = document.getElementById('addTaskModalOverlay');
  if (modal) modal.style.display = 'none';
}

function addSubtaskToModal() {
  const input = document.getElementById('newSubtaskInput');
  const title = input.value.trim();
  if (!title) return;

  modalDraftSubtasks.push({
    id: 'sub_' + Date.now() + '_' + Math.floor(Math.random()*1000),
    title,
    done: false
  });
  input.value = '';
  renderModalSubtasks();
}

function removeSubtaskFromModal(idx) {
  modalDraftSubtasks.splice(idx, 1);
  renderModalSubtasks();
}

function renderModalSubtasks() {
  const container = document.getElementById('modalSubtasksList');
  if (!container) return;

  if (modalDraftSubtasks.length === 0) {
    container.innerHTML = '<div style="font-size:0.72rem; color:#666; font-style:italic;">Brak zdefiniowanych podzadań.</div>';
    return;
  }

  let html = '';
  modalDraftSubtasks.forEach((sub, idx) => {
    html += `<div class="modal-subtask-item">
      <span>${sub.title}</span>
      <button type="button" class="note-del-btn" onclick="removeSubtaskFromModal(${idx})">✕</button>
    </div>`;
  });
  container.innerHTML = html;
}

async function saveKanbanTasks() {
  try {
    const res = await fetch('/api/kanban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: kanbanTasks })
    });
    if (!res.ok) {
      throw new Error(`Błąd serwera HTTP ${res.status}`);
    }
    await loadRightSidebarKanban();
  } catch (err) {
    alert('Błąd zapisywania zadania na serwerze: ' + err.message);
  }
}

async function submitNewTask() {
  const title = document.getElementById('taskTitleInput').value.trim();
  if (!title) {
    alert('Proszę podać tytuł zadania.');
    return;
  }

  const category = document.getElementById('taskCategorySelect').value;
  const priority = document.getElementById('taskPrioritySelect').value;
  const description = document.getElementById('taskDescInput').value.trim();

  if (!kanbanTasks) kanbanTasks = [];

  if (editingTaskId) {
    const task = kanbanTasks.find(t => t.id === editingTaskId);
    if (task) {
      task.title = title;
      task.category = category;
      task.priority = priority;
      task.description = description;
      task.subtasks = modalDraftSubtasks;
    }
  } else {
    const newTask = {
      id: 'task_' + Date.now(),
      title,
      category,
      priority,
      status: 'todo',
      archived: false,
      description,
      subtasks: modalDraftSubtasks,
      createdAt: new Date().toISOString().split('T')[0]
    };
    kanbanTasks.push(newTask);
  }

  await saveKanbanTasks();
  closeAddTaskModal();
  await loadKanbanBoard();
}

function openArchiveModal() {
  const listContainer = document.getElementById('archivedTasksList');
  if (!listContainer) return;

  const archived = kanbanTasks.filter(t => t.archived || t.status === 'done');
  if (archived.length === 0) {
    listContainer.innerHTML = '<p style="color:#888; text-align:center; padding:20px;">Brak zarchiwizowanych / wykonanych zadań.</p>';
  } else {
    let html = '';
    for (const t of archived) {
      html += `<div class="archived-item">
        <div>
          <div class="archived-title">✓ ${t.title}</div>
          <div class="archived-meta">${t.category || 'SysAdmin'} | ${t.createdAt || ''} ${t.description ? ' - ' + t.description : ''}</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-secondary" onclick="restoreTask('${t.id}')">Przywróć</button>
          <button class="note-del-btn" onclick="deleteTaskPermanently('${t.id}')" title="Usuń trwale">✕</button>
        </div>
      </div>`;
    }
    listContainer.innerHTML = html;
  }

  const modal = document.getElementById('archiveModalOverlay');
  if (modal) modal.style.display = 'flex';
}

function closeArchiveModal() {
  const modal = document.getElementById('archiveModalOverlay');
  if (modal) modal.style.display = 'none';
}

async function moveTask(taskId, dir) {
  const statuses = ['todo', 'in_progress'];
  const task = kanbanTasks.find(t => t.id === taskId);
  if (!task) return;

  let idx = statuses.indexOf(task.status);
  if (dir === 'next' && idx < statuses.length - 1) idx++;
  if (dir === 'prev' && idx > 0) idx--;

  task.status = statuses[idx];
  await saveKanbanTasks();
  renderKanbanCards();
}

async function archiveTask(taskId) {
  const task = kanbanTasks.find(t => t.id === taskId);
  if (task) {
    task.status = 'done';
    task.archived = true;
    await saveKanbanTasks();
    await loadKanbanBoard();
  }
}

async function restoreTask(taskId) {
  const task = kanbanTasks.find(t => t.id === taskId);
  if (task) {
    task.status = 'in_progress';
    task.archived = false;
    await saveKanbanTasks();
    openArchiveModal();
    await loadKanbanBoard();
  }
}

async function deleteTaskPermanently(taskId) {
  kanbanTasks = kanbanTasks.filter(t => t.id !== taskId);
  await saveKanbanTasks();
  openArchiveModal();
  await loadKanbanBoard();
}

// Quick Notes Module
async function loadQuickNotes() {
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');
  if (breadcrumbArea) breadcrumbArea.innerHTML = 'Pulpit &gt; Szybkie Notatki';

  try {
    const res = await fetch('/api/quick-notes?t=' + Date.now());
    const data = await res.json();
    quickNotes = data.notes || [];

    let html = `<div class="notes-wrapper">
      <div class="tool-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <h2>SZYBKIE NOTATKI ADMINISTRACYJNE</h2>
        <div style="display:flex; gap:10px; align-items:center;">
          <input type="text" id="notesSearchInput" oninput="filterNotesCards(this.value)" placeholder="Szukaj notatki..." style="background:#18181b; border:1px solid #333; color:#fff; padding:6px 12px; border-radius:4px; font-size:0.75rem; width:200px;">
          <button class="btn-action" onclick="addQuickNote()">+ Nowa Notatka</button>
        </div>
      </div>

      <div class="notes-grid" id="notesGrid" style="margin-top:14px;"></div>
    </div>`;

    contentArea.innerHTML = html;
    renderNotesCards();

  } catch (err) {
    contentArea.innerHTML = `<p style="color:#ef4444;">Błąd ładowania notatek: ${err.message}</p>`;
  }
}

function renderNotesCards(notesToRender = null) {
  const container = document.getElementById('notesGrid');
  if (!container) return;

  const activeNotes = notesToRender || quickNotes;

  if (activeNotes.length === 0) {
    container.innerHTML = `<p style="color:#888;">Brak notatek${notesToRender ? ' spełniających kryteria wyszukiwania' : ''}.</p>`;
    return;
  }

  let html = '';
  for (const n of activeNotes) {
    html += `<div class="note-card note-color-${n.color || 'gold'}">
      <div class="note-head">
        <input type="text" class="note-title-input" id="note-title-${n.id}" value="${n.title || ''}" oninput="updateNote('${n.id}', 'title', this.value)" placeholder="Tytuł notatki...">
        <button class="note-del-btn" onclick="deleteNote('${n.id}')" title="Usuń notatkę">✕</button>
      </div>
      <textarea class="note-body-input" oninput="updateNote('${n.id}', 'content', this.value)" placeholder="Treść notatki...">${n.content || ''}</textarea>
    </div>`;
  }
  container.innerHTML = html;
}

let saveNotesTimeout = null;

function addQuickNote() {
  const newNote = {
    id: 'note_' + Date.now(),
    title: 'Nowa Notatka',
    color: 'gold',
    content: '',
    updatedAt: new Date().toISOString().split('T')[0]
  };
  quickNotes.unshift(newNote);
  saveNotesImmediately();

  // Reset filtra wyszukiwania
  const searchInput = document.getElementById('notesSearchInput');
  if (searchInput) searchInput.value = '';

  renderNotesCards();
  
  setTimeout(() => {
    const el = document.getElementById('note-title-' + newNote.id);
    if (el) { el.focus(); el.select(); }
  }, 50);
}

function updateNote(id, field, val) {
  const note = quickNotes.find(n => n.id === id);
  if (note) {
    note[field] = val;
    if (saveNotesTimeout) clearTimeout(saveNotesTimeout);
    saveNotesTimeout = setTimeout(() => {
      saveNotesImmediately();
    }, 400);
  }
}

window.filterNotesCards = function(query) {
  const filtered = quickNotes.filter(n => 
    (n.title || '').toLowerCase().includes(query.toLowerCase()) ||
    (n.content || '').toLowerCase().includes(query.toLowerCase())
  );
  renderNotesCards(filtered);
};

function deleteNote(id) {
  quickNotes = quickNotes.filter(n => n.id !== id);
  saveNotesImmediately();
  
  const searchInput = document.getElementById('notesSearchInput');
  if (searchInput && searchInput.value) {
    filterNotesCards(searchInput.value);
  } else {
    renderNotesCards();
  }
}

function saveNotesImmediately() {
  fetch('/api/quick-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: quickNotes })
  });
}

function renderPassphraseGenerator() {
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');
  if (breadcrumbArea) breadcrumbArea.innerHTML = 'Pulpit &gt; Hasłomat SecOps';

  contentArea.innerHTML = `<div class="passgen-box" style="max-width:700px; background:#111; border:1px solid #333; padding:20px; border-radius:6px;">
    <h2 style="color:var(--sw-gold); margin-bottom:6px;">HASŁOMAT SECOPS (SŁOWNIKOWY GENERATOR HASEŁ)</h2>
    <p style="font-size:0.75rem; color:#aaa; margin-bottom:16px;">Generowanie odpornych haseł słownikowych (Diceware) z estymacją entropii Shannona w bitach.</p>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
      <div>
        <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.75rem;">Liczba słów:</label>
        <select id="passWordsCount" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px;">
          <option value="4">4 słowa (~51 bitów entropii)</option>
          <option value="5" selected>5 słów (~64 bity entropii - zalecane)</option>
          <option value="6">6 słów (~77 bitów entropii)</option>
        </select>
      </div>
      <div>
        <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.75rem;">Separator:</label>
        <select id="passSeparator" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px;">
          <option value="-">Myślnik (-)</option>
          <option value=".">Kropka (.)</option>
          <option value="_">Podkreślenie (_)</option>
          <option value=" ">Spacja ( )</option>
        </select>
      </div>
    </div>

    <button class="btn-action" onclick="generatePassphraseNow()" style="margin-bottom:16px;">Wygeneruj Bezpieczne Hasło</button>

    <div id="passphraseResult" style="display:none; background:#18181b; border:1px solid #333; padding:14px; border-radius:4px;">
      <div style="font-size:0.75rem; color:#888; margin-bottom:4px;">Wygenerowane Hasło:</div>
      <div id="generatedPassphraseText" style="font-family:monospace; font-size:1.1rem; color:var(--sw-gold); font-weight:700; word-break:break-all; margin-bottom:8px;"></div>
      <div id="entropyInfo" style="font-size:0.7rem; color:#34d399;"></div>
    </div>
  </div>`;
}

function generatePassphraseNow() {
  const wordList = ['alfa', 'brawo', 'cyfra', 'delta', 'ekran', 'fizyka', 'granit', 'haslo', 'impuls', 'jantar', 'kabel', 'laser', 'marta', 'numer', 'optyka', 'piston', 'radar', 'serwer', 'twardy', 'wirus', 'ziemia', 'wektor', 'baza', 'skrypt', 'pamięć'];
  const count = parseInt(document.getElementById('passWordsCount').value, 10);
  const sep = document.getElementById('passSeparator').value;

  let chosen = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(Math.random() * wordList.length);
    chosen.push(wordList[r]);
  }

  const pass = chosen.join(sep);
  const entropy = Math.round(count * Math.log2(wordList.length));

  document.getElementById('generatedPassphraseText').innerText = pass;
  document.getElementById('entropyInfo').innerText = `Estymowana entropia: ~${entropy} bitów.`;
  document.getElementById('passphraseResult').style.display = 'block';
}

function renderCidrCalculator() {
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');
  if (breadcrumbArea) breadcrumbArea.innerHTML = 'Pulpit &gt; Kalkulator CIDR';

  contentArea.innerHTML = `<div class="cidr-box" style="max-width:700px; background:#111; border:1px solid #333; padding:20px; border-radius:6px;">
    <h2 style="color:var(--sw-gold); margin-bottom:6px;">KALKULATOR SIECI IP I MASKI CIDR</h2>
    <p style="font-size:0.75rem; color:#aaa; margin-bottom:16px;">Przeliczanie podsieci IPv4, maski podsieci, liczby adresów, zakresu użytkowego oraz podgląd binarny.</p>

    <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:16px;">
      <div>
        <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.75rem;">Adres IP i Maska (CIDR):</label>
        <input type="text" id="cidrInput" value="192.168.1.135/24" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px;" placeholder="np. 10.0.0.0/16">
      </div>
      <div style="display:flex; align-items:flex-end;">
        <button class="btn-action" onclick="calculateCidrNow()" style="width:100%;">Przelicz Podsieć</button>
      </div>
    </div>

    <div id="cidrResult" style="display:none; background:#18181b; border:1px solid #333; padding:14px; border-radius:4px; font-size:0.8rem;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:14px;">
        <div><strong>Adres Sieci:</strong> <span id="resNetIp" style="color:var(--sw-gold);"></span></div>
        <div><strong>Maska Podsieci:</strong> <span id="resSubnetMask" style="color:var(--sw-gold);"></span></div>
        <div><strong>Pierwszy Host:</strong> <span id="resFirstIp"></span></div>
        <div><strong>Ostatni Host:</strong> <span id="resLastIp"></span></div>
        <div><strong>Adres Rozgłoszeniowy:</strong> <span id="resBcastIp"></span></div>
        <div><strong>Liczba Hostów:</strong> <span id="resHostsCount" style="color:#34d399;"></span></div>
      </div>
      
      <div style="margin-top:14px; padding-top:12px; border-top:1px dashed #333; font-family:monospace; font-size:0.82rem; color:#ffffff; line-height:1.5; letter-spacing:0.5px;">
        <div>IP (Binarnie):    <span id="binIp" style="color:var(--sw-gold); font-weight:700;"></span></div>
        <div>Maska (Binarnie): <span id="binMask" style="color:#ffffff; font-weight:700;"></span></div>
        <div>Sieć (Binarnie):  <span id="binNet" style="color:#ffffff; font-weight:700;"></span></div>
      </div>

      <div id="subnetSplitterBox" style="margin-top: 18px; padding-top: 14px; border-top: 1px solid #333;">
        <h3 style="color:#fff; font-size:0.85rem; margin-bottom:8px;">PODZIAŁ NA PODSIECI (SUBNETTING)</h3>
        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.7rem;">Wybierz liczbę podsieci:</label>
            <select id="splitCountSelect" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px; font-size:0.75rem;">
              <option value="2">2 podsieci (+1 bit maski)</option>
              <option value="4">4 podsieci (+2 bity maski)</option>
              <option value="8">8 podsieci (+3 bity maski)</option>
              <option value="16">16 podsieci (+4 bity maski)</option>
              <option value="32">32 podsieci (+5 bitów maski)</option>
              <option value="64">64 podsieci (+6 bitów maski)</option>
            </select>
          </div>
          <div style="display:flex; align-items:flex-end;">
            <button class="btn-action" onclick="splitSubnetNow()" style="width:100%; font-size:0.75rem; padding:6px 0;">Podziel Sieć</button>
          </div>
        </div>
        
        <div id="splitResultsTableContainer" style="display:none; max-height: 250px; overflow-y: auto; border: 1px solid #222; border-radius: 4px; margin-top: 10px;">
          <table style="width:100%; border-collapse:collapse; font-size:0.72rem; text-align:left; color:#ccc;">
            <thead>
              <tr style="background:#18181b; border-bottom:1px solid #333;">
                <th style="padding:6px; color:var(--sw-gold);">#</th>
                <th style="padding:6px; color:var(--sw-gold);">Podsieć (CIDR)</th>
                <th style="padding:6px; color:var(--sw-gold);">Zakres Hostów</th>
                <th style="padding:6px; color:var(--sw-gold);">Rozgłoszeniowy (Broadcast)</th>
              </tr>
            </thead>
            <tbody id="splitResultsTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
}

function calculateCidrNow() {
  const val = document.getElementById('cidrInput').value.trim();
  const parts = val.split('/');
  if (parts.length !== 2) {
    alert('Wprowadź poprawny format CIDR np. 192.168.1.0/24');
    return;
  }

  const ipStr = parts[0];
  const maskBits = parseInt(parts[1], 10);

  const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (!ipRegex.test(ipStr)) {
    alert('Wprowadź poprawny adres IPv4 (np. 192.168.1.135)');
    return;
  }

  if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) {
    alert('Maska CIDR musi być z zakresu 0 - 32');
    return;
  }

  function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }

  function longToIp(long) {
    return [
      (long >>> 24) & 255,
      (long >>> 16) & 255,
      (long >>> 8) & 255,
      long & 255
    ].join('.');
  }

  function ipToBinaryString(long) {
    const binary = (long >>> 0).toString(2).padStart(32, '0');
    return [
      binary.substring(0, 8),
      binary.substring(8, 16),
      binary.substring(16, 24),
      binary.substring(24, 32)
    ].join('.');
  }

  const ipLong = ipToLong(ipStr);
  const maskLong = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  const netLong = (ipLong & maskLong) >>> 0;
  const bcastLong = (netLong | ~maskLong) >>> 0;

  let firstHostStr = '';
  let lastHostStr = '';
  let usableHosts = 0;
  const totalHosts = Math.pow(2, 32 - maskBits);

  if (maskBits <= 30) {
    firstHostStr = longToIp(netLong + 1);
    lastHostStr = longToIp(bcastLong - 1);
    usableHosts = totalHosts - 2;
  } else if (maskBits === 31) {
    firstHostStr = longToIp(netLong);
    lastHostStr = longToIp(bcastLong);
    usableHosts = 2;
  } else if (maskBits === 32) {
    firstHostStr = longToIp(netLong);
    lastHostStr = longToIp(netLong);
    usableHosts = 1;
  }

  document.getElementById('resNetIp').innerText = longToIp(netLong);
  document.getElementById('resSubnetMask').innerText = `${longToIp(maskLong)} (/${maskBits})`;
  document.getElementById('resFirstIp').innerText = firstHostStr;
  document.getElementById('resLastIp').innerText = lastHostStr;
  document.getElementById('resBcastIp').innerText = longToIp(bcastLong);
  document.getElementById('resHostsCount').innerText = `${usableHosts} (ogółem: ${totalHosts})`;

  document.getElementById('binIp').innerText = ipToBinaryString(ipLong);
  document.getElementById('binMask').innerText = ipToBinaryString(maskLong);
  document.getElementById('binNet').innerText = ipToBinaryString(netLong);

  // Ukryj stare wyniki podziału
  document.getElementById('splitResultsTableContainer').style.display = 'none';

  document.getElementById('cidrResult').style.display = 'block';
}

window.splitSubnetNow = function() {
  const val = document.getElementById('cidrInput').value.trim();
  const parts = val.split('/');
  if (parts.length !== 2) return;

  const ipStr = parts[0];
  const maskBits = parseInt(parts[1], 10);
  const borrowBits = parseInt(document.getElementById('splitCountSelect').value, 10);
  const newMaskBits = maskBits + Math.log2(borrowBits);

  if (newMaskBits > 32) {
    alert(`Nie można podzielić sieci /${maskBits} na ${borrowBits} podsieci, ponieważ maska przekroczyłaby /32.`);
    return;
  }

  function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }

  function longToIp(long) {
    return [
      (long >>> 24) & 255,
      (long >>> 16) & 255,
      (long >>> 8) & 255,
      long & 255
    ].join('.');
  }

  const ipLong = ipToLong(ipStr);
  const maskLong = maskBits === 0 ? 0 : (~0 << (32 - maskBits)) >>> 0;
  const netLong = (ipLong & maskLong) >>> 0;

  const newSubnetSize = Math.pow(2, 32 - newMaskBits);
  const tbody = document.getElementById('splitResultsTableBody');
  tbody.innerHTML = '';

  for (let i = 0; i < borrowBits; i++) {
    const subNetLong = (netLong + i * newSubnetSize) >>> 0;
    const subBcastLong = (subNetLong + newSubnetSize - 1) >>> 0;

    let hostRangeStr = '';
    if (newMaskBits <= 30) {
      hostRangeStr = `${longToIp(subNetLong + 1)} - ${longToIp(subBcastLong - 1)}`;
    } else if (newMaskBits === 31) {
      hostRangeStr = `${longToIp(subNetLong)} - ${longToIp(subBcastLong)}`;
    } else {
      hostRangeStr = `${longToIp(subNetLong)}`;
    }

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #222';
    tr.style.background = i % 2 === 0 ? '#111' : '#0c0c0c';
    tr.innerHTML = `
      <td style="padding:6px; color:#888;">#${i + 1}</td>
      <td style="padding:6px; font-weight:bold; color:var(--sw-gold);">${longToIp(subNetLong)}/${newMaskBits}</td>
      <td style="padding:6px;">${hostRangeStr}</td>
      <td style="padding:6px; color:#aaa;">${longToIp(subBcastLong)}</td>
    `;
    tbody.appendChild(tr);
  }

  document.getElementById('splitResultsTableContainer').style.display = 'block';
}

function renderRaidCalculator() {
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');
  if (breadcrumbArea) breadcrumbArea.innerHTML = 'Pulpit &gt; Kalkulator RAID &amp; ZFS';

  contentArea.innerHTML = `<div class="raid-box" style="max-width:700px; background:#111; border:1px solid #333; padding:20px; border-radius:6px; line-height:1.5;">
    <h2 style="color:var(--sw-gold); margin-bottom:6px;">KALKULATOR POJEMNOŚCI I WYDAJNOŚCI RAID / ZFS</h2>
    <p style="font-size:0.75rem; color:#aaa; margin-bottom:16px;">Szybkie planowanie i szacowanie przestrzeni dyskowej oraz wydajności I/O macierzy standardowych oraz systemów plików ZFS.</p>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
      <div>
        <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.75rem;">Typ macierzy (RAID/ZFS):</label>
        <select id="raidType" onchange="calculateRaidNow()" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px; font-size:0.78rem;">
          <option value="raid0">RAID 0 (Striping - wydajność)</option>
          <option value="raid1">RAID 1 (Mirroring - bezpieczeństwo)</option>
          <option value="raid5">RAID 5 / ZFS RAIDZ1 (Pojedyncza parzystość)</option>
          <option value="raid6">RAID 6 / ZFS RAIDZ2 (Podwójna parzystość)</option>
          <option value="raidz3">ZFS RAIDZ3 (Potrójna parzystość)</option>
          <option value="raid10" selected>RAID 10 / ZFS Mirror Stripe (Przeplatany mirror)</option>
        </select>
      </div>
      <div>
        <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.75rem;">Typ i szybkość dysku bazowego:</label>
        <select id="raidDriveType" onchange="calculateRaidNow()" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px; font-size:0.78rem;">
          <option value="hdd">HDD 7.2k RPM (~150 MB/s)</option>
          <option value="sata_ssd" selected>SATA SSD (~500 MB/s)</option>
          <option value="nvme_ssd">NVMe SSD (~3000 MB/s)</option>
        </select>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:12px;">
      <div>
        <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.75rem;">Liczba dysków:</label>
        <input type="number" id="raidDriveCount" value="4" min="2" max="32" oninput="calculateRaidNow()" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px; font-size:0.78rem;">
      </div>
      <div>
        <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.75rem;">Pojemność jednego dysku:</label>
        <input type="number" id="raidDriveSize" value="2" min="1" step="any" oninput="calculateRaidNow()" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px; font-size:0.78rem;">
      </div>
      <div>
        <label style="display:block; margin-bottom:4px; color:#ccc; font-size:0.75rem;">Jednostka:</label>
        <select id="raidDriveUnit" onchange="calculateRaidNow()" style="width:100%; background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px; font-size:0.78rem;">
          <option value="TB" selected>TB (Terabajty)</option>
          <option value="GB">GB (Gigabajty)</option>
        </select>
      </div>
    </div>

    <div id="raidValidationError" style="color:#ef4444; font-size:0.75rem; font-weight:bold; margin-top:8px; display:none; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); padding:8px; border-radius:4px;"></div>

    <div id="raidResultBox" style="margin-top:16px; background:#18181b; border:1px solid #333; padding:14px; border-radius:4px; font-size:0.8rem; display:none;">
      <div style="margin-bottom:8px;"><strong>Pojemność użyteczna (Netto):</strong> <span id="raidUsableSpace" style="color:var(--sw-gold); font-weight:bold; font-size:0.95rem;"></span></div>
      <div style="margin-bottom:8px;"><strong>Narzut nadmiarowości (Parity/Mirror):</strong> <span id="raidOverheadSpace" style="color:#ffffff;"></span></div>
      <div style="margin-bottom:8px;"><strong>Odporność na awarie:</strong> <span id="raidFaultTolerance" style="color:#ffffff; font-weight:bold;"></span></div>
      <div style="margin-bottom:8px;"><strong>Szacowana wydajność odczytu:</strong> <span id="raidReadSpeed" style="color:#ffffff;"></span></div>
      <div style="margin-bottom:8px;"><strong>Szacowana wydajność zapisu:</strong> <span id="raidWriteSpeed" style="color:#ffffff;"></span></div>
    </div>
  </div>`;

  calculateRaidNow();
}

window.calculateRaidNow = function() {
  const type = document.getElementById('raidType').value;
  const n = parseInt(document.getElementById('raidDriveCount').value, 10);
  const size = parseFloat(document.getElementById('raidDriveSize').value);
  const unit = document.getElementById('raidDriveUnit').value;
  const driveType = document.getElementById('raidDriveType').value;
  const errorDiv = document.getElementById('raidValidationError');
  const resultBox = document.getElementById('raidResultBox');

  if (!errorDiv || !resultBox) return;

  if (isNaN(n) || n < 2) {
    errorDiv.innerText = 'Liczba dysków musi wynosić co najmniej 2.';
    errorDiv.style.display = 'block';
    resultBox.style.display = 'none';
    return;
  }
  if (isNaN(size) || size <= 0) {
    errorDiv.innerText = 'Pojemność dysku musi być większa od 0.';
    errorDiv.style.display = 'block';
    resultBox.style.display = 'none';
    return;
  }

  let isError = false;

  if (type === 'raid5' && n < 3) {
    errorDiv.innerText = 'RAID 5 / ZFS RAIDZ1 wymaga minimum 3 dysków.';
    isError = true;
  } else if (type === 'raid6' && n < 4) {
    errorDiv.innerText = 'RAID 6 / ZFS RAIDZ2 wymaga minimum 4 dysków.';
    isError = true;
  } else if (type === 'raidz3' && n < 5) {
    errorDiv.innerText = 'ZFS RAIDZ3 wymaga minimum 5 dysków.';
    isError = true;
  } else if (type === 'raid10') {
    if (n < 4) {
      errorDiv.innerText = 'RAID 10 wymaga minimum 4 dysków.';
      isError = true;
    } else if (n % 2 !== 0) {
      errorDiv.innerText = 'RAID 10 wymaga parzystej liczby dysków.';
      isError = true;
    }
  }

  if (isError) {
    errorDiv.style.display = 'block';
    resultBox.style.display = 'none';
    return;
  }

  errorDiv.style.display = 'none';
  resultBox.style.display = 'block';

  let dSpeedRead = 150;
  let dSpeedWrite = 150;
  if (driveType === 'sata_ssd') {
    dSpeedRead = 500;
    dSpeedWrite = 480;
  } else if (driveType === 'nvme_ssd') {
    dSpeedRead = 3000;
    dSpeedWrite = 2500;
  }

  let usable = 0;
  let tolerance = '';
  let readSpeed = 0;
  let writeSpeed = 0;

  switch(type) {
    case 'raid0':
      usable = n * size;
      tolerance = '0 dysków (awaria dowolnego dysku niszczy macierz)';
      readSpeed = n * dSpeedRead;
      writeSpeed = n * dSpeedWrite;
      break;
    case 'raid1':
      usable = size;
      tolerance = `${n - 1} dysków (wymaga przetrwania co najmniej 1 dysku)`;
      readSpeed = n * dSpeedRead;
      writeSpeed = dSpeedWrite;
      break;
    case 'raid5':
      usable = (n - 1) * size;
      tolerance = '1 dysk';
      readSpeed = (n - 1) * dSpeedRead;
      writeSpeed = (n / 4) * dSpeedWrite; // szacunek write penalty
      break;
    case 'raid6':
      usable = (n - 2) * size;
      tolerance = '2 dyski';
      readSpeed = (n - 2) * dSpeedRead;
      writeSpeed = (n / 6) * dSpeedWrite; // szacunek write penalty
      break;
    case 'raidz3':
      usable = (n - 3) * size;
      tolerance = '3 dyski';
      readSpeed = (n - 3) * dSpeedRead;
      writeSpeed = (n / 8) * dSpeedWrite;
      break;
    case 'raid10':
      usable = (n / 2) * size;
      tolerance = 'od 1 do ' + (n / 2) + ' dysków (maks. 1 dysk na parę mirror)';
      readSpeed = n * dSpeedRead;
      writeSpeed = (n / 2) * dSpeedWrite;
      break;
  }

  const overhead = (n * size) - usable;

  document.getElementById('raidUsableSpace').innerText = `${usable.toFixed(2)} ${unit}`;
  document.getElementById('raidOverheadSpace').innerText = `${overhead.toFixed(2)} ${unit} (${((overhead / (n * size)) * 100).toFixed(0)}%)`;
  document.getElementById('raidFaultTolerance').innerText = tolerance;
  document.getElementById('raidReadSpeed').innerText = `~${readSpeed.toFixed(0)} MB/s (${(readSpeed / dSpeedRead).toFixed(1)}x prędkości pojedynczego dysku)`;
  document.getElementById('raidWriteSpeed').innerText = `~${writeSpeed.toFixed(0)} MB/s (${(writeSpeed / dSpeedWrite).toFixed(1)}x prędkości pojedynczego dysku)`;
};

function renderServerMonitor() {
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');
  if (breadcrumbArea) breadcrumbArea.innerHTML = 'Pulpit &gt; Monitor Serwera';

  contentArea.innerHTML = `<div class="monitor-box" style="max-width:800px; background:#111; border:1px solid #333; padding:20px; border-radius:6px; line-height:1.5;">
    <h2 style="color:var(--sw-gold); margin-bottom:4px;">MONITOR ZASOBÓW SERWERA</h2>
    <p style="font-size:0.75rem; color:#aaa; margin-bottom:20px;">Dane o obciążeniu podzespołów systemowych pobierane na żywo z serwera w odstępie 3-sekundowym.</p>

    <div id="monitorErrorMsg" style="color:#ef4444; font-size:0.75rem; font-weight:bold; margin-bottom:12px; display:none; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); padding:8px; border-radius:4px;"></div>

    <div style="display:grid; grid-template-columns:1fr; gap:16px; margin-bottom:20px;">
      <!-- CPU CARD -->
      <div style="background:#18181b; border:1px solid #333; padding:14px; border-radius:4px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:0.78rem;">
          <span style="font-weight:bold; color:#fff;">PROCESOR (CPU)</span>
          <span id="cpuUsageVal" style="color:var(--sw-gold); font-weight:bold;">0.0%</span>
        </div>
        <div style="background:#222; border-radius:4px; height:10px; overflow:hidden; width:100%;">
          <div id="cpuUsageBar" style="background:#10b981; height:100%; width:0%; transition:width 0.4s ease, background-color 0.4s ease;"></div>
        </div>
      </div>

      <!-- RAM CARD -->
      <div style="background:#18181b; border:1px solid #333; padding:14px; border-radius:4px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:0.78rem;">
          <span style="font-weight:bold; color:#fff;">PAMIĘĆ RAM</span>
          <span id="ramUsageVal" style="color:var(--sw-gold); font-weight:bold;">0 / 0 MB (0%)</span>
        </div>
        <div style="background:#222; border-radius:4px; height:10px; overflow:hidden; width:100%;">
          <div id="ramUsageBar" style="background:#10b981; height:100%; width:0%; transition:width 0.4s ease, background-color 0.4s ease;"></div>
        </div>
      </div>

      <!-- DISK CARD -->
      <div style="background:#18181b; border:1px solid #333; padding:14px; border-radius:4px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:0.78rem;">
          <span style="font-weight:bold; color:#fff;">ZASOBY DYSKOWE (/)</span>
          <span id="diskUsageVal" style="color:var(--sw-gold); font-weight:bold;">0 / 0 GB (0%)</span>
        </div>
        <div style="background:#222; border-radius:4px; height:10px; overflow:hidden; width:100%;">
          <div id="diskUsageBar" style="background:#10b981; height:100%; width:0%; transition:width 0.4s ease, background-color 0.4s ease;"></div>
        </div>
      </div>
    </div>

    <!-- SYSTEM SYSTEM INFO -->
    <div style="background:#18181b; border:1px solid #333; padding:14px; border-radius:4px; font-size:0.78rem;">
      <h3 style="color:var(--sw-gold); font-size:0.82rem; margin-top:0; margin-bottom:10px; border-bottom:1px solid #222; padding-bottom:6px;">INFORMACJE O SYSTEMIE OPERACYJNYM</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <div><strong>Serwer (Hostname):</strong> <span id="sysHostname" style="color:#ccc;">-</span></div>
        <div><strong>System (Platform):</strong> <span id="sysPlatform" style="color:#ccc;">-</span></div>
        <div><strong>Model procesora:</strong> <span id="sysCpuModel" style="color:#ccc;">-</span></div>
        <div><strong>Rdzenie logiczne:</strong> <span id="sysCpuCores" style="color:#ccc;">-</span></div>
        <div><strong>Czas działania (Uptime):</strong> <span id="sysUptime" style="color:#ccc;">-</span></div>
        <div><strong>Wersja jądra (Kernel):</strong> <span id="sysKernel" style="color:#ccc;">-</span></div>
      </div>
    </div>
  </div>`;

  async function updateMonitor() {
    try {
      const res = await fetch('/api/server-stats');
      if (!res.ok) throw new Error('Błąd komunikacji z serwerem statystyk');
      const data = await res.json();

      const errorDiv = document.getElementById('monitorErrorMsg');
      if (errorDiv) errorDiv.style.display = 'none';

      // Update CPU
      const cpuUsage = data.cpu.usage;
      const cpuValSpan = document.getElementById('cpuUsageVal');
      const cpuBar = document.getElementById('cpuUsageBar');
      if (cpuValSpan) cpuValSpan.innerText = `${cpuUsage.toFixed(1)}%`;
      if (cpuBar) {
        cpuBar.style.width = `${cpuUsage}%`;
        cpuBar.style.backgroundColor = cpuUsage > 85 ? '#ef4444' : (cpuUsage > 70 ? '#f59e0b' : '#10b981');
      }

      // Update RAM
      const ram = data.ram;
      const ramValSpan = document.getElementById('ramUsageVal');
      const ramBar = document.getElementById('ramUsageBar');
      const ramUsedMb = ram.used / (1024 * 1024);
      const ramTotalMb = ram.total / (1024 * 1024);
      if (ramValSpan) ramValSpan.innerText = `${ramUsedMb.toFixed(0)} / ${ramTotalMb.toFixed(0)} MB (${ram.percent.toFixed(0)}%)`;
      if (ramBar) {
        ramBar.style.width = `${ram.percent}%`;
        ramBar.style.backgroundColor = ram.percent > 85 ? '#ef4444' : (ram.percent > 70 ? '#f59e0b' : '#10b981');
      }

      // Update Disk
      const disk = data.disk;
      const diskValSpan = document.getElementById('diskUsageVal');
      const diskBar = document.getElementById('diskUsageBar');
      const diskUsedGb = disk.used / (1024 * 1024 * 1024);
      const diskTotalGb = disk.total / (1024 * 1024 * 1024);
      if (diskValSpan) diskValSpan.innerText = `${diskUsedGb.toFixed(1)} / ${diskTotalGb.toFixed(1)} GB (${disk.percent.toFixed(0)}%)`;
      if (diskBar) {
        diskBar.style.width = `${disk.percent}%`;
        diskBar.style.backgroundColor = disk.percent > 90 ? '#ef4444' : (disk.percent > 75 ? '#f59e0b' : '#10b981');
      }

      // Update System Info
      const os = data.os;
      const hostnameSpan = document.getElementById('sysHostname');
      const platformSpan = document.getElementById('sysPlatform');
      const cpuModelSpan = document.getElementById('sysCpuModel');
      const cpuCoresSpan = document.getElementById('sysCpuCores');
      const uptimeSpan = document.getElementById('sysUptime');
      const kernelSpan = document.getElementById('sysKernel');

      if (hostnameSpan) hostnameSpan.innerText = os.hostname;
      if (platformSpan) platformSpan.innerText = `${os.platform} (${os.type})`;
      if (cpuModelSpan) cpuModelSpan.innerText = os.cpuModel;
      if (cpuCoresSpan) cpuCoresSpan.innerText = `${os.cpuCores} vCPU`;
      if (kernelSpan) kernelSpan.innerText = os.release;

      if (uptimeSpan) {
        const u = os.uptime;
        const days = Math.floor(u / 86400);
        const hours = Math.floor((u % 86400) / 3600);
        const mins = Math.floor((u % 3600) / 60);
        let uptimeStr = '';
        if (days > 0) uptimeStr += `${days} d, `;
        if (hours > 0 || days > 0) uptimeStr += `${hours} h, `;
        uptimeStr += `${mins} m`;
        uptimeSpan.innerText = uptimeStr;
      }

    } catch (e) {
      const errorDiv = document.getElementById('monitorErrorMsg');
      if (errorDiv) {
        errorDiv.innerText = e.message;
        errorDiv.style.display = 'block';
      }
    }
  }

  updateMonitor();
  monitorIntervalId = setInterval(updateMonitor, 3000);
}

// RSS Reader Module [dodane]
let rssFeeds = [];
let selectedRssFeedId = 'all';
let currentRssVisibleArticles = [];

async function renderRssReader() {
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');
  if (breadcrumbArea) breadcrumbArea.innerHTML = 'Pulpit &gt; Biuletyn RSS SecOps';

  contentArea.innerHTML = `
    <div class="rss-wrapper" style="max-width:900px; line-height:1.5;">
      <h2 style="color:var(--sw-gold); margin-bottom:6px; text-transform:uppercase;">Biuletyny Bezpieczeństwa RSS</h2>
      <p style="font-size:0.75rem; color:#aaa; margin-bottom:16px;">Skanowanie najnowszych podatności, ostrzeżeń oraz biuletynów bezpieczeństwa z zdefiniowanych źródeł.</p>

      <div style="display:grid; grid-template-columns:1fr 2fr; gap:20px; margin-top:14px; align-items:start;">
        <!-- Panel boczny: Źródła RSS -->
        <div style="background:#111; border:1px solid #333; padding:16px; border-radius:6px;">
          <h3 style="color:#fff; font-size:0.85rem; margin-top:0; margin-bottom:10px; border-bottom:1px solid #222; padding-bottom:6px;">ŹRÓDŁA FEEDÓW</h3>
          
          <div id="rssFeedsList" style="display:flex; flex-direction:column; gap:8px; margin-bottom:14px;">
            <p style="font-size:0.72rem; color:#666;">Ładowanie kanałów...</p>
          </div>

          <div style="border-top:1px solid #222; padding-top:12px; margin-top:12px;">
            <h4 style="color:var(--sw-gold); font-size:0.75rem; margin-top:0; margin-bottom:8px;">DODAJ NOWY KANAŁ</h4>
            <div style="display:flex; flex-direction:column; gap:8px;">
              <input type="text" id="newRssName" placeholder="Nazwa kanału..." style="background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px; font-size:0.72rem;">
              <input type="text" id="newRssUrl" placeholder="Adres URL feeda..." style="background:#18181b; border:1px solid #333; color:#fff; padding:6px; border-radius:4px; font-size:0.72rem;">
              <button class="btn-action" onclick="addNewRssFeed()" style="font-size:0.72rem; padding:6px;">Dodaj kanał</button>
            </div>
          </div>
        </div>

        <!-- Panel główny: Artykuły -->
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="background:#111; border:1px solid #333; padding:12px 16px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <label style="color:#ccc; font-size:0.75rem; margin-right:8px;">Filtruj źródło:</label>
              <select id="rssFeedFilterSelect" onchange="changeRssFeedFilter(this.value)" style="background:#18181b; border:1px solid #333; color:#fff; padding:6px 10px; border-radius:4px; font-size:0.75rem; outline:none;">
                <option value="all">Wszystkie aktywne</option>
              </select>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
              <button class="btn-action" onclick="markAllCurrentRssAsRead()" style="font-size:0.75rem; padding:6px 12px; background:#1e3a8a; border:1px solid #3b82f6; color:#fff;" title="Oznacz wpisy z zaznaczonych źródeł jako przeczytane">Oznacz zaznaczone jako przeczytane</button>
              <div id="rssRestoreBtnContainer"></div>
              <button class="btn-action" onclick="refreshRssArticles()" style="font-size:0.75rem; padding:6px 12px;">Odśwież wpisy</button>
            </div>
          </div>

          <div id="rssArticlesContainer">
            <p style="font-size:0.8rem; color:#888;">Ładowanie artykułów...</p>
          </div>
        </div>
      </div>
    </div>
  `;

  await loadRssFeeds();
}

async function loadRssFeeds() {
  try {
    const res = await fetch('/api/rss-feeds?t=' + Date.now());
    const data = await res.json();
    rssFeeds = data.feeds || [];
    
    renderRssFeedsList();
    populateRssFilterSelect();
    await refreshRssArticles();
  } catch (err) {
    const feedsList = document.getElementById('rssFeedsList');
    if (feedsList) feedsList.innerHTML = `<p style="color:#ef4444; font-size:0.72rem;">Błąd ładowania: ${err.message}</p>`;
  }
}

function renderRssFeedsList() {
  const container = document.getElementById('rssFeedsList');
  if (!container) return;

  if (rssFeeds.length === 0) {
    container.innerHTML = '<p style="font-size:0.72rem; color:#888;">Brak zdefiniowanych kanałów.</p>';
    return;
  }

  let html = '';
  for (const feed of rssFeeds) {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#18181b; border:1px solid #27272a; padding:6px 8px; border-radius:4px; gap:6px;">
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.75rem; color:#e4e4e7; flex:1; min-width:0; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">
          <input type="checkbox" ${feed.enabled ? 'checked' : ''} onchange="toggleRssFeedEnabled('${feed.id}', this.checked)" style="cursor:pointer;">
          <span title="${feed.name} (${feed.url})">${feed.name}</span>
        </label>
        <button onclick="deleteRssFeed('${feed.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.72rem; padding:2px 4px;" title="Usuń źródło">Usuń</button>
      </div>
    `;
  }
  container.innerHTML = html;
}

function populateRssFilterSelect() {
  const select = document.getElementById('rssFeedFilterSelect');
  if (!select) return;

  let html = '<option value="all">Wszystkie aktywne</option>';
  for (const feed of rssFeeds) {
    html += `<option value="${feed.id}" ${selectedRssFeedId === feed.id ? 'selected' : ''}>${feed.name}</option>`;
  }
  select.innerHTML = html;
}

async function changeRssFeedFilter(val) {
  selectedRssFeedId = val;
  await refreshRssArticles();
}

async function refreshRssArticles() {
  const container = document.getElementById('rssArticlesContainer');
  if (!container) return;

  container.innerHTML = '<p style="font-size:0.8rem; color:#888;">Pobieranie i analizowanie artykułów...</p>';

  try {
    const res = await fetch(`/api/rss-articles?feedId=${selectedRssFeedId}&t=` + Date.now());
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Nieznany błąd serwera');
    }
    const data = await res.json();
    const articles = data.articles || [];

    // Zarządzanie ukrytymi artykułami (LocalStorage)
    const hiddenArticles = JSON.parse(localStorage.getItem('knowops_wiki_hidden_rss') || '[]');
    
    const restoreContainer = document.getElementById('rssRestoreBtnContainer');
    if (restoreContainer) {
      if (hiddenArticles.length > 0) {
        restoreContainer.innerHTML = `<button class="btn-action" onclick="restoreHiddenRssArticles()" style="font-size:0.75rem; padding:6px 12px; background:#27272a; color:#ccc; border:1px solid #3f3f46;">Przywróć ukryte wpisy (${hiddenArticles.length})</button>`;
      } else {
        restoreContainer.innerHTML = '';
      }
    }

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const visibleArticles = articles.filter(art => {
      const isHidden = hiddenArticles.includes(art.link);
      if (isHidden) return false;

      if (art.pubDate) {
        const artDate = new Date(art.pubDate).getTime();
        if (!isNaN(artDate)) {
          return artDate >= sevenDaysAgo;
        }
      }
      return true;
    });

    if (visibleArticles.length === 0) {
      currentRssVisibleArticles = [];
      container.innerHTML = '<p style="font-size:0.8rem; color:#888; background:#111; border:1px solid #333; padding:16px; border-radius:6px;">Brak artykułów w tym kanale lub wszystkie zostały ukryte.</p>';
      return;
    }

    currentRssVisibleArticles = visibleArticles;
    // Sortowanie artykułów po dacie (od najświeższych)
    visibleArticles.sort((a, b) => {
      const dA = a.pubDate ? new Date(a.pubDate) : 0;
      const dB = b.pubDate ? new Date(b.pubDate) : 0;
      return dB - dA;
    });

    let html = '';
    for (const art of visibleArticles) {
      const pubDateFormatted = art.pubDate ? new Date(art.pubDate).toLocaleString('pl-PL') : 'Brak daty';
      html += `
        <div class="rss-card" style="background:#111; border:1px solid #333; padding:16px; border-radius:6px; margin-bottom:12px; transition:border-color 0.2s;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:6px; margin-bottom:6px;">
            <span style="background:#1e293b; color:#94a3b8; font-size:0.65rem; font-weight:bold; padding:2px 6px; border-radius:4px; border:1px solid #334155;">
              ${art.feedName || 'Źródło'}
            </span>
            <span style="font-size:0.68rem; color:#666;">
              ${pubDateFormatted}
            </span>
          </div>
          <h3 style="margin-top:4px; margin-bottom:8px; font-size:0.95rem; line-height:1.3;">
            <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="color:var(--sw-gold); text-decoration:none; font-weight:bold;">
              ${art.title}
            </a>
          </h3>
          <p style="font-size:0.78rem; color:#ccc; margin-bottom:10px; line-height:1.4;">
            ${art.description || 'Brak opisu.'}
          </p>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <button onclick="hideRssArticle('${art.link.replace(/'/g, "\\'")}')" style="background:none; border:none; color:#a1a1aa; cursor:pointer; font-size:0.72rem; padding:4px 0; text-decoration:underline;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#a1a1aa'">
              Ukryj wpis
            </button>
            <a href="${art.link}" target="_blank" rel="noopener noreferrer" style="font-size:0.72rem; color:#3b82f6; text-decoration:none; font-weight:bold;">
              Przejdź do artykułu &gt;
            </a>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;

  } catch (err) {
    container.innerHTML = `
      <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); padding:16px; border-radius:6px; color:#ef4444; font-size:0.8rem;">
        Błąd pobierania biuletynów: ${err.message}
      </div>
    `;
  }
}


window.markAllCurrentRssAsRead = function() {
  if (!currentRssVisibleArticles || currentRssVisibleArticles.length === 0) {
    alert('Brak widocznych artykułów do oznaczenia jako przeczytane.');
    return;
  }
  if (!confirm('Czy na pewno chcesz oznaczyć wszystkie widoczne wpisy ze zaznaczonych źródeł jako przeczytane?')) {
    return;
  }
  const hiddenArticles = JSON.parse(localStorage.getItem('knowops_wiki_hidden_rss') || '[]');
  for (const art of currentRssVisibleArticles) {
    if (art.link && !hiddenArticles.includes(art.link)) {
      hiddenArticles.push(art.link);
    }
  }
  localStorage.setItem('knowops_wiki_hidden_rss', JSON.stringify(hiddenArticles));
  refreshRssArticles();
};

window.hideRssArticle = function(link) {
  const hiddenArticles = JSON.parse(localStorage.getItem('knowops_wiki_hidden_rss') || '[]');
  if (!hiddenArticles.includes(link)) {
    hiddenArticles.push(link);
    localStorage.setItem('knowops_wiki_hidden_rss', JSON.stringify(hiddenArticles));
  }
  refreshRssArticles();
};

window.restoreHiddenRssArticles = function() {
  if (confirm('Czy chcesz przywrócić wszystkie ukryte wpisy RSS?')) {
    localStorage.removeItem('knowops_wiki_hidden_rss');
    refreshRssArticles();
  }
};


async function toggleRssFeedEnabled(id, enabled) {
  const feed = rssFeeds.find(f => f.id === id);
  if (feed) {
    feed.enabled = enabled;
    await saveRssFeedsToServer();
  }
}

async function deleteRssFeed(id) {
  if (!confirm('Czy na pewno chcesz usunąć to źródło RSS?')) return;
  rssFeeds = rssFeeds.filter(f => f.id !== id);
  await saveRssFeedsToServer();
  renderRssFeedsList();
  populateRssFilterSelect();
  if (selectedRssFeedId === id) {
    selectedRssFeedId = 'all';
    const select = document.getElementById('rssFeedFilterSelect');
    if (select) select.value = 'all';
  }
  await refreshRssArticles();
}

async function addNewRssFeed() {
  const nameInput = document.getElementById('newRssName');
  const urlInput = document.getElementById('newRssUrl');
  if (!nameInput || !urlInput) return;

  const name = nameInput.value.trim();
  const url = urlInput.value.trim();

  if (!name || !url) {
    alert('Oba pola są wymagane.');
    return;
  }

  const newFeed = {
    id: 'rss_' + Date.now(),
    name,
    url,
    enabled: true
  };

  rssFeeds.push(newFeed);
  await saveRssFeedsToServer();

  nameInput.value = '';
  urlInput.value = '';
  
  renderRssFeedsList();
  populateRssFilterSelect();
  await refreshRssArticles();
}

async function saveRssFeedsToServer() {
  try {
    const res = await fetch('/api/rss-feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feeds: rssFeeds })
    });
    if (!res.ok) {
      throw new Error('Błąd serwera podczas zapisu');
    }
  } catch (err) {
    alert('Nie udało się zapisać zmian źródeł: ' + err.message);
  }
}

function renderWikiInstruction() {
  const contentArea = document.getElementById('articleContentArea');
  const breadcrumbArea = document.getElementById('breadcrumbArea');
  if (breadcrumbArea) breadcrumbArea.innerHTML = 'Pulpit &gt; Instrukcja Obsługi';

  contentArea.innerHTML = `<div class="instruction-box" style="max-width:800px; background:#111; border:1px solid #333; padding:20px; border-radius:6px; line-height:1.6;">
    <h2 style="color:var(--sw-gold); margin-bottom:12px;">INSTRUKCJA OBSŁUGI PORTALU KNOWOPS WIKI</h2>
    <p style="font-size:0.85rem; color:#ccc; margin-bottom:14px;">Portal KnowOps Wiki służy do zarządzania bazą wiedzy, procedurami administracyjnymi, zadaniami produkcyjnymi oraz narzędziami SecOps.</p>
    
    <h3 style="color:#fff; font-size:0.9rem; margin-top:16px; margin-bottom:8px;">1. Główne Moduły Systemu</h3>
    <ul style="font-size:0.82rem; color:#aaa; margin-left:20px; margin-bottom:16px;">
      <li><strong>Pulpit (Tablica Kanban):</strong> Przeglądaj i dodawaj zadania w 4 kolumnach (TODO, IN_PROGRESS, DONE, ARCHIVED). Zadania zrobione można przeglądać w Archiwum Zadań.</li>
      <li><strong>Szybkie Notatki:</strong> Twórz i edytuj w czasie rzeczywistym notatki administracyjne. Dodano w nich dynamiczne wyszukiwanie i filtrowanie kafelków w locie.</li>
      <li><strong>Biuletyn RSS SecOps:</strong> Skanowanie najnowszych podatności i advisories (np. CERT Polska, CISA). Umożliwia włączanie/wyłączanie źródeł, dodawanie nowych kanałów oraz ukrywanie przeczytanych artykułów w pamięci podręcznej.</li>
      <li><strong>Kategorie Główne:</strong> Nawiguj po kafelkach głównych (Sieci, Fortinet, Microsoft, Linux, Bazy Danych, Aplikacje, Poczta, Konteneryzacja, Proxmox VE, VMware).</li>
    </ul>

    <h3 style="color:#fff; font-size:0.9rem; margin-top:16px; margin-bottom:8px;">2. Zarządzanie Dokumentami</h3>
    <p style="font-size:0.82rem; color:#ccc; margin-bottom:10px;">Aplikacja działa w oparciu o trójpoziomową strukturę katalogów: <strong>Kategoria (Główna) &gt; Podkategoria (Dział) &gt; Dokument (.md)</strong>. Możesz zarządzać tą strukturą na dwa sposoby:</p>
    
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
      <div style="background:#18181b; padding:12px; border:1px solid #27272a; border-radius:4px;">
        <h4 style="color:var(--sw-gold); font-size:0.8rem; margin-bottom:6px;">Metoda 1: Przez interfejs WWW</h4>
        <ul style="font-size:0.75rem; color:#aaa; margin-left:14px; padding:0;">
          <li style="margin-bottom:4px;">Kliknij niebieski przycisk <strong>„+ Dodaj Stronę / Dział”</strong> na dole lewego menu.</li>
          <li style="margin-bottom:4px;">Aby utworzyć nową podkategorię, wybierz kategorię nadrzędną, wpisz nową nazwę podkategorii (np. <code>03_Mój_Dział</code>) oraz nazwę pliku.</li>
          <li style="margin-bottom:4px;">System automatycznie założy odpowiednie foldery i plik na dysku, po czym odświeży nawigację.</li>
        </ul>
      </div>
      <div style="background:#18181b; padding:12px; border:1px solid #27272a; border-radius:4px;">
        <h4 style="color:var(--sw-gold); font-size:0.8rem; margin-bottom:6px;">Metoda 2: Bezpośrednio (lokalnie na dysku)</h4>
        <ul style="font-size:0.75rem; color:#aaa; margin-left:14px; padding:0;">
          <li style="margin-bottom:4px;">Przejdź do lokalnego katalogu <code>knowops/docs/</code> na swoim komputerze.</li>
          <li style="margin-bottom:4px;">Utwórz lub zmień foldery zachowując schemat: <code>docs/Kategoria_Główna/Podkategoria/Plik.md</code>.</li>
          <li style="margin-bottom:4px;">Po zakończeniu modyfikacji plików, kliknij przycisk <strong>„Przeskanuj”</strong> w lewym sidebarze, aby przebudować menu.</li>
        </ul>
      </div>
    </div>

    <h3 style="color:#fff; font-size:0.9rem; margin-top:16px; margin-bottom:8px;">3. Zaawansowane Funkcje i Automatyzacja</h3>
    <ul style="font-size:0.82rem; color:#aaa; margin-left:20px; margin-bottom:16px;">
      <li><strong>Paleta Poleceń (Ctrl+K):</strong> Wciśnięcie skrótu klawiszowego Ctrl+K (lub Cmd+K) otwiera wyszukiwarkę dokumentów. Pozwala na błyskawiczne znajdowanie i przechodzenie do stron za pomocą strzałek klawiatury i klawisza Enter.</li>
      <li><strong>Autozapis (Auto-save):</strong> Edytor automatycznie zapisuje zmiany w tle na serwerze po przerwaniu pisania na 1.5 sekundy. Przy zamykaniu edytora następuje natychmiastowe wymuszenie zapisu i przeładowanie widoku.</li>
      <li><strong>Wyszukiwarka Pełnotekstowa:</strong> Przeszukuje całą bazę wiedzy z poziomu pamięci serwera (in-memory cache) z automatycznym podświetlaniem pasujących fraz.</li>
      <li><strong>Składnia Wikilinks:</strong> W plikach markdown możesz tworzyć wewnętrzne linki do innych dokumentów za pomocą składni <code>[[Nazwa Dokumentu]]</code>. System automatycznie dopasuje link lub oznaczy go na czerwono, jeśli dokument nie istnieje.</li>
      <li><strong>Podświetlanie Kodu (Syntax Highlighting):</strong> Bloki kodu w dokumentach są automatycznie kolorowane za pomocą biblioteki Highlight.js (zgodnie z wykrytym językiem programowania lub skryptu).</li>
      <li><strong>Importuj z URL (Web Scraper):</strong> Pobieranie artykułów i dokumentacji bezpośrednio z zewnętrznych linków. System wycina właściwą treść (ignorując reklamy/stopki), konwertuje HTML na Markdown i zapisuje we wskazanym podkatalogu.</li>
      <li><strong>Kalkulator CIDR i Subnetting:</strong> Analizator sieciowy z binarną reprezentacją adresacji IP i modułem automatycznego podziału podsieci.</li>
      <li><strong>Kalkulator RAID & ZFS:</strong> Narzędzie szacowania przestrzeni i wydajności macierzy (pojemność netto, odporność na awarie, prędkość odczytu/zapisu dla dysków HDD/SSD/NVMe).</li>
      <li><strong>Hasłomat SecOps:</strong> Generator silnych haseł słownikowych Diceware z wyliczeniem entropii Shannona.</li>
    </ul>

    <h3 style="color:#fff; font-size:0.9rem; margin-top:16px; margin-bottom:8px;">4. Druk oraz Eksport do PDF</h3>
    <ul style="font-size:0.82rem; color:#aaa; margin-left:20px; margin-bottom:16px;">
      <li><strong>Dedykowany Tryb Druku:</strong> Po kliknięciu przycisku "Drukuj / PDF" w lewym menu (lub wciśnięciu Ctrl+P) system automatycznie ukrywa panele nawigacyjne, stopki, nagłówki oraz przyciski edycyjne, pozostawiając samą treść dokumentu na białym tle do czystego wydruku lub zapisu do pliku PDF.</li>
    </ul>
  </div>`;
}


function buildRecursiveFolderOptions(items, prefix = '&nbsp;&nbsp;&nbsp;&nbsp;') {
  let html = '';
  for (const item of (items || [])) {
    if (item.type === 'directory') {
      html += `<option value="${item.relPath}">${prefix}📂 ${item.title}</option>`;
      if (item.items && item.items.length > 0) {
        html += buildRecursiveFolderOptions(item.items, prefix + '&nbsp;&nbsp;&nbsp;&nbsp;');
      }
    }
  }
  return html;
}

window.openMovePageModal = function() {
  const modal = document.getElementById('movePageModalOverlay');
  const parentSelect = document.getElementById('movePageTargetSelect');
  const nameInput = document.getElementById('movePageNameInput');
  const currentPathInput = document.getElementById('movePageCurrentPath');
  
  if (!modal || !parentSelect || !nameInput || !currentPathInput) return;

  const currentPath = decodeURIComponent(window.location.hash.replace('#/', ''));
  currentPathInput.value = currentPath;

  const lastSlash = currentPath.lastIndexOf('/');
  const filename = lastSlash !== -1 ? currentPath.substring(lastSlash + 1) : currentPath;
  nameInput.value = filename;

  if (navigationData && navigationData.categories) {
    let optionsHtml = '';
    for (const cat of navigationData.categories) {
      if (cat.id === 'kanban_board') continue;
      optionsHtml += `<option value="${cat.id}">📁 [KATEGORIA GŁÓWNA] ${cat.title}</option>`;
      for (const sub of (cat.subcategories || [])) {
        optionsHtml += `<option value="${cat.id}/${sub.id}">&nbsp;&nbsp;📂 ${sub.title}</option>`;
        if (sub.items && sub.items.length > 0) {
          optionsHtml += buildRecursiveFolderOptions(sub.items, '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;');
        }
      }
    }
    parentSelect.innerHTML = optionsHtml;
  }

  modal.style.display = 'flex';
};

window.closeMovePageModal = function() {
  const modal = document.getElementById('movePageModalOverlay');
  if (modal) modal.style.display = 'none';
};

window.submitMovePage = async function() {
  const sourceRelPath = document.getElementById('movePageCurrentPath').value.trim();
  const targetCategoryRel = document.getElementById('movePageTargetSelect').value;
  const targetFilename = document.getElementById('movePageNameInput').value.trim();

  if (!sourceRelPath || !targetCategoryRel || !targetFilename) {
    alert('Wszystkie pola są wymagane.');
    return;
  }

  try {
    const res = await fetch('/api/move-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceRelPath, targetCategoryRel, targetFilename })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Nieznany błąd serwera');

    closeMovePageModal();
    alert('Dokument został pomyślnie przeniesiony.');
    
    await loadNavigation();
    window.location.hash = `#/${data.relPath}`;
  } catch (err) {
    alert(`Błąd podczas przenoszenia pliku: ${err.message}`);
  }
};


// ================= CREATE ITEM MODAL ================= //

window.openCreateItemModalForCurrentFolder = function() {
  let parentPath = '';
  if (currentArticlePath) {
    const cleanPath = decodeURIComponent(currentArticlePath).replace(/^#\/?/, '');
    const lastSlash = cleanPath.lastIndexOf('/');
    if (lastSlash !== -1) {
      parentPath = cleanPath.substring(0, lastSlash);
    } else {
      parentPath = cleanPath;
    }
  }
  openCreateItemModal(parentPath);
};

function openCreateItemModal(presetParentPath = null) {
  const modal = document.getElementById('createItemModal');
  const parentSelect = document.getElementById('createItemParentSelect');
  if (!modal) return;

  if (navigationData && navigationData.categories && parentSelect) {
    let optionsHtml = '';
    for (const cat of navigationData.categories) {
      if (cat.id === 'kanban_board') continue;
      optionsHtml += `<option value="${cat.id}">📁 [KATEGORIA GŁÓWNA] ${cat.title}</option>`;
      for (const sub of (cat.subcategories || [])) {
        optionsHtml += `<option value="${cat.id}/${sub.id}">&nbsp;&nbsp;📂 ${sub.title}</option>`;
        if (sub.items && sub.items.length > 0) {
          optionsHtml += buildRecursiveFolderOptions(sub.items, '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;');
        }
      }
    }
    parentSelect.innerHTML = optionsHtml;

    if (presetParentPath) {
      parentSelect.value = presetParentPath;
    }
  }

  const nameInput = document.getElementById('createItemNameInput');
  if (nameInput) nameInput.value = '';
  modal.style.display = 'flex';
}

function closeCreateItemModal() {
  const modal = document.getElementById('createItemModal');
  if (modal) modal.style.display = 'none';
}

function toggleCreateItemType() {
  const isDoc = document.querySelector('input[name="itemType"]:checked').value === 'doc';
  const nameLabel = document.getElementById('createItemNameLabel');
  if (nameLabel) {
    nameLabel.innerText = isDoc ? '3. Nazwa nowego dokumentu (tytuł):' : '3. Nazwa nowego działu (folderu):';
  }
}

async function submitCreateItemForm() {
  const typeRadio = document.querySelector('input[name="itemType"]:checked');
  const isDoc = typeRadio ? typeRadio.value === 'doc' : true;
  const parentSelect = document.getElementById('createItemParentSelect');
  const parentPath = parentSelect ? parentSelect.value : '';
  const nameInput = document.getElementById('createItemNameInput');
  const rawName = nameInput ? nameInput.value.trim() : '';

  if (!parentPath) {
    alert('Proszę wybrać sekcję nadrzędną.');
    return;
  }

  if (!rawName) {
    alert('Proszę podać nazwę elementu.');
    return;
  }

  let cleanName = rawName.replace(/[<>:"|?*\x00\/\\]/g, '_').trim().replace(/\s+/g, '_');
  let relPath = '';

  if (isDoc) {
    if (!cleanName.endsWith('.md')) cleanName += '.md';
    relPath = `${parentPath}/${cleanName}`;
  } else {
    relPath = `${parentPath}/${cleanName}/01_Instrukcja.md`;
  }

  const titleText = rawName.replace(/_/g, ' ');
  const initialContent = isDoc ? `# ${titleText}\n\n*Dokument utworzony. Kliknij "EDYTUJ TEN DOKUMENT" powyżej, aby wprowadzić treść.*\n` : `# Dział: ${titleText}\n\n*Struktura nowego działu.*\n`;

  try {
    const res = await fetch('/api/save-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath, content: initialContent })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Błąd serwera (${res.status}): ${errText.substring(0, 100)}`);
    }

    const data = await res.json();
    if (data.success) {
      closeCreateItemModal();
      await loadNavigation();

      const parts = relPath.split('/');
      const catId = parts[0];
      const subId = parts[1] || '';

      // Auto-rozwiń wszystkie podkatalogi prowadzące do nowego pliku
      let pathAcc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        pathAcc = pathAcc ? `${pathAcc}/${parts[i]}` : parts[i];
        expandedDirs[pathAcc] = true;
      }

      currentCategory = catId;
      currentSubcategory = subId;
      if (navigationData && navigationData.categories) {
        renderTopCategories(navigationData.categories);
      }
      await renderSidebar();

      const newHash = '#/' + relPath;
      if (window.location.hash === newHash) {
        await handleHashNavigation();
      } else {
        window.location.hash = newHash;
      }
    } else {
      alert('Błąd tworzenia elementu: ' + (data.error || 'Nieznany błąd'));
    }
  } catch (err) {
    alert('Błąd połączenia z serwerem: ' + err.message);
  }
}

function populateImportFolders() {
  const select = document.getElementById('importFolderSelect');
  if (!select || !navigationData) return;
  
  let html = '<option value="">-- Wybierz katalog docelowy --</option>';
  for (const cat of navigationData.categories) {
    if (cat.id === 'kanban_board') continue;
    html += `<option value="${cat.id}">[Główny] ${cat.title}</option>`;
    if (cat.subcategories) {
      for (const sub of cat.subcategories) {
        html += `<option value="${cat.id}/${sub.id}">&nbsp;&nbsp;📂 ${sub.title}</option>`;
        if (sub.items) {
          function addSubfolders(itemsList, prefix = '&nbsp;&nbsp;&nbsp;&nbsp;') {
            for (const item of itemsList) {
              if (item.type === 'directory') {
                html += `<option value="${item.relPath}">${prefix}📂 ${item.title}</option>`;
                if (item.items) {
                  addSubfolders(item.items, prefix + '&nbsp;&nbsp;&nbsp;&nbsp;');
                }
              }
            }
          }
          addSubfolders(sub.items);
        }
      }
    }
  }
  select.innerHTML = html;
}

window.submitImport = function() {
  if (currentImportTab === 'file') {
    submitImportFile();
  } else {
    submitImportUrl();
  }
};

window.submitImportFile = function() {
  const folder = document.getElementById('importFolderSelect').value;
  const fileInput = document.getElementById('importFileInput');
  
  if (!folder) {
    alert('Proszę wybrać katalog docelowy!');
    return;
  }
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Proszę wybrać plik do importu!');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async function(e) {
    const content = e.target.result;
    try {
      const res = await fetch('/api/import-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryRel: folder,
          filename: file.name,
          content: content
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Plik zaimportowany pomyślnie!');
        closeImportFileModal();
        await loadNavigation();
        window.location.hash = '#/' + data.relPath;
      } else {
        alert('Błąd importu: ' + data.error);
      }
    } catch (err) {
      alert('Błąd sieci: ' + err.message);
    }
  };
  reader.readAsText(file);
};

window.submitImportUrl = async function() {
  const folder = document.getElementById('importFolderSelect').value;
  const url = document.getElementById('importUrlInput').value.trim();
  const filename = document.getElementById('importUrlFilename').value.trim();

  if (!folder) {
    alert('Proszę wybrać katalog docelowy!');
    return;
  }
  if (!url) {
    alert('Proszę wprowadzić adres URL!');
    return;
  }
  if (!filename) {
    alert('Proszę wprowadzić nazwę pliku docelowego!');
    return;
  }

  try {
    const btn = document.querySelector('#importFileModalOverlay .btn-action');
    const oldText = btn.textContent;
    btn.textContent = 'Pobieranie i import...';
    btn.disabled = true;

    const res = await fetch('/api/scrape-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        categoryRel: folder,
        filename
      })
    });

    const data = await res.json();
    btn.textContent = oldText;
    btn.disabled = false;

    if (data.success) {
      alert('Artykuł zaimportowany pomyślnie z podanego URL!');
      closeImportFileModal();
      await loadNavigation();
      window.location.hash = '#/' + data.relPath;
    } else {
      alert('Błąd importu z URL: ' + data.error);
    }
  } catch (err) {
    alert('Błąd sieci: ' + err.message);
    const btn = document.querySelector('#importFileModalOverlay .btn-action');
    if (btn) {
      btn.textContent = 'Importuj';
      btn.disabled = false;
    }
  }
};

async function loadRightSidebarKanban() {
  const container = document.getElementById('rightKanbanList');
  if (!container) return;

  try {
    let tasks = [];
    if (window.kanbanTasks && window.kanbanTasks.length > 0) {
      tasks = window.kanbanTasks;
    } else {
      const res = await fetch('/api/kanban?t=' + Date.now());
      const data = await res.json();
      tasks = data.tasks || [];
    }

    const activeTasks = tasks.filter(t => t.status === 'in_progress' && !t.archived);
    const prioWeights = { high: 3, medium: 2, low: 1 };
    activeTasks.sort((a, b) => (prioWeights[b.priority || 'medium'] || 2) - (prioWeights[a.priority || 'medium'] || 2));

    if (activeTasks.length === 0) {
      container.innerHTML = `<div style="font-size:0.68rem; color:#555; text-align:center; padding:10px;">Brak aktywnych zadań</div>`;
      return;
    }

    let html = '';
    for (const t of activeTasks) {
      const prioClass = `prio-${t.priority || 'medium'}`;
      const subtasks = t.subtasks || [];
      const total = subtasks.length;
      const done = subtasks.filter(s => s.done).length;
      const progress = total > 0 ? Math.round((done / total) * 100) : 0;
      
      html += `
        <div class="right-kanban-item ${prioClass}">
          <div class="right-kanban-item-title">${t.title}</div>
          ${t.description ? `<div class="right-kanban-item-desc">${t.description}</div>` : ''}
          ${total > 0 ? `<div class="right-kanban-item-progress">Podzadania: ${done}/${total} (${progress}%)</div>` : ''}
        </div>
      `;
    }
    container.innerHTML = html;
  } catch (err) {
    console.warn('Błąd ładowania zadań do prawego paska:', err);
    container.innerHTML = `<div style="font-size:0.65rem; color:#ef4444; text-align:center;">Błąd ładowania</div>`;
  }
}

// ================= COMMAND PALETTE (Ctrl+K) [dodane] ================= //
let commandPaletteSelectedIndex = -1;
let commandPaletteFilteredItems = [];

function getAllDocuments() {
  const docs = [];
  if (!navigationData || !navigationData.categories) return docs;
  
  function walkSubcategory(sub, catTitle) {
    if (sub.files) {
      for (const f of sub.files) {
        docs.push({
          title: f.title,
          relPath: f.relPath,
          category: catTitle,
          subcategory: sub.title
        });
      }
    }
    if (sub.items) {
      for (const item of sub.items) {
        walkSubcategory(item, catTitle);
      }
    }
  }

  for (const cat of navigationData.categories) {
    if (cat.id === 'kanban_board') continue;
    if (cat.subcategories) {
      for (const sub of cat.subcategories) {
        walkSubcategory(sub, cat.title);
      }
    }
  }
  return docs;
}

window.openCommandPalette = function() {
  const modal = document.getElementById('commandPaletteModal');
  const input = document.getElementById('commandPaletteInput');
  if (!modal || !input) return;

  modal.style.display = 'flex';
  input.value = '';
  commandPaletteSelectedIndex = -1;
  commandPaletteFilteredItems = getAllDocuments();
  renderCommandPaletteResultsList();
  setTimeout(() => input.focus(), 50);
};

window.closeCommandPalette = function() {
  const modal = document.getElementById('commandPaletteModal');
  if (modal) modal.style.display = 'none';
};

window.renderCommandPaletteResults = function(query) {
  const allDocs = getAllDocuments();
  if (!query) {
    commandPaletteFilteredItems = allDocs;
  } else {
    const q = query.toLowerCase();
    commandPaletteFilteredItems = allDocs.filter(d => 
      d.title.toLowerCase().includes(q) || 
      d.relPath.toLowerCase().includes(q) ||
      d.subcategory.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q)
    );
  }
  commandPaletteSelectedIndex = commandPaletteFilteredItems.length > 0 ? 0 : -1;
  renderCommandPaletteResultsList();
};

function renderCommandPaletteResultsList() {
  const container = document.getElementById('commandPaletteResults');
  if (!container) return;

  if (commandPaletteFilteredItems.length === 0) {
    container.innerHTML = '<p style="font-size:0.75rem; color:#666; text-align:center; padding:20px;">Brak pasujących dokumentów</p>';
    return;
  }

  let html = '';
  commandPaletteFilteredItems.forEach((item, index) => {
    const isSelected = index === commandPaletteSelectedIndex;
    const bg = isSelected ? '#1e293b' : 'transparent';
    const border = isSelected ? '1px solid #3b82f6' : '1px solid transparent';
    const color = isSelected ? 'var(--sw-gold)' : '#fff';
    
    html += `
      <div onclick="selectCommandPaletteItem('${item.relPath.replace(/'/g, "\\'")}')" style="background:${bg}; border:${border}; padding:8px 12px; border-radius:6px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition:background 0.1s;">
        <div>
          <span style="color:${color}; font-weight:600; font-size:0.8rem;">${item.title}</span>
          <div style="font-size:0.65rem; color:#666; margin-top:2px;">${item.category} &gt; ${item.subcategory}</div>
        </div>
        <span style="font-size:0.65rem; color:#555;">${item.relPath}</span>
      </div>
    `;
  });
  container.innerHTML = html;

  if (commandPaletteSelectedIndex !== -1) {
    const selectedEl = container.children[commandPaletteSelectedIndex];
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }
}

window.navigateCommandPalette = function(direction) {
  if (commandPaletteFilteredItems.length === 0) return;
  
  commandPaletteSelectedIndex += direction;
  if (commandPaletteSelectedIndex < 0) {
    commandPaletteSelectedIndex = commandPaletteFilteredItems.length - 1;
  } else if (commandPaletteSelectedIndex >= commandPaletteFilteredItems.length) {
    commandPaletteSelectedIndex = 0;
  }
  renderCommandPaletteResultsList();
};

window.triggerCommandPaletteSelection = function() {
  if (commandPaletteSelectedIndex === -1 || commandPaletteFilteredItems.length === 0) return;
  const item = commandPaletteFilteredItems[commandPaletteSelectedIndex];
  if (item) {
    window.selectCommandPaletteItem(item.relPath);
  }
};

window.selectCommandPaletteItem = function(relPath) {
  window.closeCommandPalette();
  window.location.hash = '#/' + relPath;
};


// --- ZMIANY: Tabulator oraz zmiana nazwy ---
document.addEventListener('DOMContentLoaded', () => {
  const textareas = ['editorTextarea', 'createItemContentTextarea'];
  textareas.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = this.selectionStart;
          const end = this.selectionEnd;
          this.value = this.value.substring(0, start) + "  " + this.value.substring(end);
          this.selectionStart = this.selectionEnd = start + 2;
          if (typeof updateEditorPreview === 'function' && id === 'editorTextarea') {
            updateEditorPreview();
          }
        }
      });
    }
  });
});

window.renameCurrentFile = async function() {
  const targetFile = typeof currentArticlePath !== 'undefined' && currentArticlePath ? currentArticlePath : decodeURIComponent(window.location.hash.replace('#/', ''));
  if (!targetFile || !targetFile.endsWith('.md')) {
    alert('Brak wczytanego pliku .md do zmiany nazwy. Wybierz artykuł z menu.');
    return;
  }
  
  const currentName = targetFile.split('/').pop();
  const newName = prompt('Podaj nową nazwę pliku (wraz z .md):', currentName);
  
  if (!newName || newName === currentName) return;
  if (!newName.endsWith('.md')) {
    alert('Plik musi mieć rozszerzenie .md');
    return;
  }

  try {
    const res = await fetch('/api/rename-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath: targetFile, newName: newName })
    });
    const data = await res.json();
    if (data.success) {
      alert('Zmieniono nazwę pomyślnie!');
      if (typeof triggerRescan === 'function') await triggerRescan();
      window.location.hash = '#/' + data.newPath;
    } else {
      alert('Błąd zmiany nazwy: ' + (data.error || 'Nieznany błąd'));
    }
  } catch (err) {
    alert('Błąd połączenia z serwerem: ' + err.message);
  }
};


let currentEditingPath = '';
let autoSaveTimeout = null;

async function openEditorModal(targetPath) {
  let relPath = targetPath || currentArticlePath || decodeURIComponent(window.location.hash.replace('#/', ''));
  if (!relPath || !relPath.endsWith('.md')) {
    if (typeof currentArticlePath !== 'undefined' && currentArticlePath && currentArticlePath.endsWith('.md')) {
      relPath = currentArticlePath;
    }
  }

  if (!relPath || !relPath.endsWith('.md')) {
    alert('Wybierz z lewego menu konkretny plik dokumentu (.md), który chcesz edytować.');
    return;
  }

  currentEditingPath = relPath;

  try {
    let rawText = '';
    const res = await fetch(`/docs/${relPath}?t=` + Date.now());
    if (res.ok) {
      const text = await res.text();
      if (!text.trim().startsWith('<!DOCTYPE')) rawText = text;
    }
    if (!rawText) {
      const apiRes = await fetch(`/api/get-page?relPath=${encodeURIComponent(relPath)}&t=` + Date.now());
      if (apiRes.ok) {
        const apiData = await apiRes.json();
        rawText = apiData.content || '';
      }
    }

    const modalPathEl = document.getElementById('editorModalPath');
    const modalTextareaEl = document.getElementById('editorTextarea');
    if (modalPathEl) modalPathEl.innerText = relPath;
    if (modalTextareaEl) {
      modalTextareaEl.value = rawText;
      setupImageUploadHandlers(modalTextareaEl);
    }

    const statusIndicator = document.getElementById('editorSaveStatus');
    if (statusIndicator) {
      statusIndicator.innerText = 'Wszystkie zmiany zapisane';
      statusIndicator.style.color = '#888';
    }

    const modal = document.getElementById('articleEditorModal');
    if (modal) {
      modal.style.display = 'flex';
      updateEditorPreview();
    } else {
      alert('Nie znaleziono okna edytora articleEditorModal w strukturze HTML.');
    }

  } catch (err) {
    alert('Nie udało się wczytać artykułu do edycji: ' + err.message);
  }
}

async function closeEditorModal() {
  const modal = document.getElementById('articleEditorModal');
  if (modal) modal.style.display = 'none';

  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
    await saveCurrentArticleFromModal(true);
  }

  if (currentEditingPath && typeof loadArticle === 'function') {
    await loadArticle(currentEditingPath);
  }
}

async function saveCurrentArticleFromModal(silent = false) {
  if (!currentEditingPath) return;

  let newContent = document.getElementById('editorTextarea').value;
  newContent = newContent.replace(/[´’‘]/g, '`');

  try {
    const res = await fetch('/api/save-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: currentEditingPath, content: newContent })
    });

    const data = await res.json();
    if (data.success) {
      if (!silent) {
        closeEditorModal();
        if (typeof loadArticle === 'function') await loadArticle(currentEditingPath);
      }
    } else {
      if (!silent) {
        alert('Błąd zapisu: ' + (data.error || 'Nieznany błąd'));
      }
    }
  } catch (err) {
    if (!silent) alert('Błąd połączenia z serwerem: ' + err.message);
  }
}

function updateEditorPreview() {
  const textarea = document.getElementById('editorTextarea');
  const preview = document.getElementById('editorPreview') || document.getElementById('editorPreviewArea');
  if (textarea && preview && typeof parseMarkdown === 'function') {
    preview.innerHTML = parseMarkdown(textarea.value);
    if (typeof renderMermaidDiagrams === 'function') {
      renderMermaidDiagrams(preview);
    }
  }
}

function setupImageUploadHandlers(textarea) {
  if (!textarea || textarea.dataset.uploadInitialized === 'true') return;
  textarea.dataset.uploadInitialized = 'true';

  textarea.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData))?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf('image') === 0) {
        e.preventDefault();
        const file = item.getAsFile();
        await uploadAndInsertImage(file, textarea);
      }
    }
  });

  textarea.addEventListener('dragover', (e) => e.preventDefault());
  textarea.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (const file of e.dataTransfer.files) {
        if (file.type.startsWith('image/')) {
          await uploadAndInsertImage(file, textarea);
        }
      }
    }
  });
}

async function uploadAndInsertImage(file, textarea) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64Data = e.target.result;
    try {
      const res = await fetch('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          base64Data
        })
      });
      const data = await res.json();
      if (data.success && data.imageUrl) {
        const imageMarkdown = `\n![${file.name}](${data.imageUrl})\n`;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = textarea.value.substring(0, start) + imageMarkdown + textarea.value.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + imageMarkdown.length;
        if (typeof updateEditorPreview === 'function') updateEditorPreview();
      } else {
        alert('Błąd wgrywania obrazu: ' + (data.error || 'Nieznany błąd'));
      }
    } catch (err) {
      alert('Błąd połączenia podczas wgrywania obrazu: ' + err.message);
    }
  };
  reader.readAsDataURL(file);
}


window.openAddTaskModal = openAddTaskModal;
window.openEditTaskModal = openEditTaskModal;
window.closeAddTaskModal = closeAddTaskModal;
window.addSubtaskToModal = addSubtaskToModal;
window.removeSubtaskFromModal = removeSubtaskFromModal;
window.submitNewTask = submitNewTask;


// ================= KANBAN TASK TEMPLATES MODULE ================= //

let taskTemplates = [];

async function loadTaskTemplates() {
  try {
    const res = await fetch('/api/task-templates?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      taskTemplates = data.templates || [];
      renderTaskTemplatesSelect();
    }
  } catch (e) {
    console.warn('Nie udało się pobrać szablonów zadań:', e);
  }
}

function renderTaskTemplatesSelect() {
  const select = document.getElementById('taskTemplateSelect');
  if (!select) return;

  let html = '<option value="">-- Wybierz czysty formularz lub szablon --</option>';
  for (const tpl of taskTemplates) {
    html += `<option value="${tpl.id}">${tpl.name}</option>`;
  }
  select.innerHTML = html;
}

function applySelectedTaskTemplate() {
  const select = document.getElementById('taskTemplateSelect');
  if (!select) return;
  const tplId = select.value;
  if (!tplId) return;

  const tpl = taskTemplates.find(t => t.id === tplId);
  if (!tpl) return;

  document.getElementById('taskTitleInput').value = tpl.title || '';
  document.getElementById('taskCategorySelect').value = tpl.category || 'SysAdmin';
  document.getElementById('taskPrioritySelect').value = tpl.priority || 'medium';
  document.getElementById('taskDescInput').value = tpl.description || '';

  modalDraftSubtasks = (tpl.subtasks || []).map(s => {
    return typeof s === 'string' ? { id: 'sub_' + Date.now() + '_' + Math.floor(Math.random()*1000), title: s, done: false } : JSON.parse(JSON.stringify(s));
  });

  renderModalSubtasks();
}

async function saveCurrentDraftAsTemplate() {
  const title = document.getElementById('taskTitleInput').value.trim();
  if (!title) {
    alert('Najpierw wpisz tytuł lub treść zadania, aby zapisać je jako szablon.');
    return;
  }

  const tplName = prompt('Podaj nazwę nowego szablonu (np. "Wdrożenie Serwera Nginx"):', title);
  if (!tplName) return;

  const newTpl = {
    id: 'tpl_' + Date.now(),
    name: tplName,
    title: title,
    category: document.getElementById('taskCategorySelect').value,
    priority: document.getElementById('taskPrioritySelect').value,
    description: document.getElementById('taskDescInput').value.trim(),
    subtasks: modalDraftSubtasks.map(s => s.title)
  };

  taskTemplates.push(newTpl);
  try {
    const res = await fetch('/api/task-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templates: taskTemplates })
    });
    if (res.ok) {
      alert(`Szablon "${tplName}" został zapisany!`);
      renderTaskTemplatesSelect();
      document.getElementById('taskTemplateSelect').value = newTpl.id;
    }
  } catch (e) {
    alert('Błąd podczas zapisywania szablonu: ' + e.message);
  }
}

window.loadTaskTemplates = loadTaskTemplates;
window.renderTaskTemplatesSelect = renderTaskTemplatesSelect;
window.applySelectedTaskTemplate = applySelectedTaskTemplate;
window.saveCurrentDraftAsTemplate = saveCurrentDraftAsTemplate;


// ================= EDITOR TOOLBAR & IMAGE UPLOAD FUNCTIONS ================= //

window.insertEditorText = function(type) {
  const textarea = document.getElementById('editorTextarea');
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selectedText = text.substring(start, end);

  let replacement = '';
  let cursorOffset = 0;

  switch (type) {
    case 'bold':
      replacement = `**${selectedText || 'tekst'}**`;
      cursorOffset = selectedText ? 0 : -2;
      break;
    case 'italic':
      replacement = `*${selectedText || 'tekst'}*`;
      cursorOffset = selectedText ? 0 : -1;
      break;
    case 'h1':
      replacement = `\n# ${selectedText || 'Nagłówek 1'}\n`;
      break;
    case 'h2':
      replacement = `\n## ${selectedText || 'Nagłówek 2'}\n`;
      break;
    case 'code':
      replacement = `\n\`\`\`\n${selectedText || 'kod'}\n\`\`\`\n`;
      break;
    case 'table':
      replacement = `\n| Nagłówek 1 | Nagłówek 2 |\n| --- | --- |\n| Dane 1 | Dane 2 |\n`;
      break;
    case 'mermaid_flow':
      replacement = `\n\`\`\`mermaid\ngraph TD\n  A[Start] --> B{Decyzja?}\n  B -- Tak --> C[Proces A]\n  B -- Nie --> D[Proces B]\n  C --> E[Koniec]\n  D --> E\n\`\`\`\n`;
      break;
    case 'mermaid_seq':
      replacement = `\n\`\`\`mermaid\nsequenceDiagram\n  Klient->>Serwer: Zapytanie HTTP GET\n  Serwer->>Baza: Kwerenda SELECT\n  Baza-->>Serwer: Wynik kwerendy\n  Serwer-->>Klient: Odpowiedź JSON (200 OK)\n\`\`\`\n`;
      break;
    case 'mermaid_git':
      replacement = `\n\`\`\`mermaid\ngitGraph\n  commit\n  commit\n  branch develop\n  checkout develop\n  commit\n  commit\n  checkout main\n  merge develop\n  commit\n\`\`\`\n`;
      break;
    case 'mermaid_pie':
      replacement = `\n\`\`\`mermaid\npie title Użycie pamięci masowej\n  "Bazy Danych" : 42.5\n  "Pliki Logów" : 30.0\n  "Kopie Zapasowe" : 27.5\n\`\`\`\n`;
      break;
    case 'mermaid_gantt':
      replacement = `\n\`\`\`mermaid\ngantt\n  title Harmonogram Wdrożenia\n  dateFormat YYYY-MM-DD\n  section Przygotowanie\n  Projekt techniczny :active, des1, 2026-09-01, 5d\n  Konfiguracja sieciowa : des2, after des1, 3d\n  section Wdrożenie\n  Instalacja Kubernetes : des3, after des2, 5d\n  Testy integracyjne : des4, after des3, 2d\n\`\`\`\n`;
      break;
    case 'mermaid_state':
      replacement = `\n\`\`\`mermaid\nstateDiagram-v2\n  [*] --> Offline\n  Offline --> Online : Uruchomienie usługi\n  Online --> Awaria : Błąd krytyczny\n  Awaria --> Offline : Reset / Naprawa\n  Online --> [*] : Zatrzymanie\n\`\`\`\n`;
      break;
    case 'mermaid_class':
      replacement = `\n\`\`\`mermaid\nclassDiagram\n  class Serwer {\n    +String ip\n    +start()\n    +stop()\n  }\n\`\`\`\n`;
      break;
    case 'mermaid_ad':
      replacement = `\n\`\`\`mermaid\ngraph LR\n  DC1["DC1 (PDC Emulator)"] --> DC2["DC2 (Replica)"]\n  User["Użytkownik AD"] --> Kerberos["Usługa Kerberos/LDAP"]\n\`\`\`\n`;
      break;
    case 'mermaid_tree':
      replacement = `\n\`\`\`mermaid\ngraph TD\n  Root["Firma-OU"] --> Admins["Inżynierowie-OU"]\n  Root --> Servers["Serwery-OU"]\n\`\`\`\n`;
      break;
  }

  textarea.value = text.substring(0, start) + replacement + text.substring(end);
  textarea.focus();
  const newPos = start + replacement.length + cursorOffset;
  textarea.selectionStart = textarea.selectionEnd = newPos;
  if (typeof updateEditorPreview === 'function') updateEditorPreview();
};

window.openEditorImageUpload = function() {
  const input = document.getElementById('editorImageInput');
  if (input) input.click();
};

window.handleEditorImageUpload = async function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64Data = e.target.result;
    try {
      const res = await fetch('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          base64Data: base64Data
        })
      });
      const data = await res.json();
      if (data.success && data.imageUrl) {
        const textarea = document.getElementById('editorTextarea');
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const snippet = `\n![${file.name}](${data.imageUrl})\n`;
        textarea.value = text.substring(0, start) + snippet + text.substring(end);
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = start + snippet.length;
        if (typeof updateEditorPreview === 'function') updateEditorPreview();
      } else {
        alert('Błąd wgrywania obrazu: ' + (data.error || 'Nieznany błąd'));
      }
    } catch (err) {
      alert('Błąd połączenia podczas wgrywania obrazu: ' + err.message);
    }
  };
  reader.readAsDataURL(file);
};

window.deleteCurrentArticleFromModal = async function() {
  if (!currentEditingPath) return;

  if (!confirm(`Czy na pewno chcesz trwale usunąć plik: ${currentEditingPath}?`)) {
    return;
  }

  try {
    const res = await fetch('/api/delete-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relPath: currentEditingPath })
    });

    const data = await res.json();
    if (data.success) {
      closeEditorModal();
      if (typeof triggerRescan === 'function') await triggerRescan();
      const parts = currentEditingPath.split('/');
      if (typeof selectCategory === 'function') selectCategory(parts[0], parts[1] || '');
    } else {
      alert('Błąd usuwania pliku: ' + (data.error || 'Nieznany błąd'));
    }
  } catch (err) {
    alert('Błąd połączenia z serwerem: ' + err.message);
  }
};

window.openEditorModal = openEditorModal;
window.closeEditorModal = closeEditorModal;
window.saveCurrentArticleFromModal = saveCurrentArticleFromModal;
window.updateEditorPreview = updateEditorPreview;
