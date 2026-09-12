# KnowOps Wiki Application

Nowoczesny, lekki, bezpieczny portal wiedzy **KnowOps** oraz centrum operacyjne zarządzania zadaniami systemowymi dla inżynierów systemowych, administratorów sieci i ekspertów CyberSec.

![Strona główna KnowOpsWiki](.github/assets/main_page.png)

---

## Status projektu i cel (wersja beta)

> [!NOTE]
> **Aplikacja znajduje się w fazie Beta** — projekt jest aktywnie rozwijany, testowany i sukcesywnie ulepszany o nowe funkcjonalności. KnowOpsWiki powstało jako własne, samowystarczalne i zabezpieczone zgodnie z zasadami SecOps **zastępstwo dla komercyjnego środowiska Notion**, zapewniając 100% kontroli nad prywatnymi danymi, szybkie lokalne działanie w kontenerach Docker oraz brak zależności od zewnętrznych usług chmurowych.

---

## Model użytkowania i architektura dostępu (single-user)

> [!IMPORTANT]
> **Model single-user:** 
> Na obecnym etapie rozważania architektoniczne i funkcjonalne zakładają, że aplikacja jest przeznaczona do **użytku osobistego dla jednego inżyniera / administratora** (Single-User Environment). System nie zawiera wbudowanego modułu wieloużytkownikowego z podziałem uprawnień (RBAC / multi-account).

**Zalecany model wdrożenia i bezpieczny dostęp:**
- **Self-Hosted w sieci lokalnej (LAN / VPN):** Uruchomienie na własnym serwerze domowym lub firmowym z dostępem z poziomu sieci lokalnej bądź za pośrednictwem szyfrowanego tunelu VPN (np. WireGuard, Tailscale).
- **Publikacja w sieci publicznej (Cloudflare Tunnel & Access):** W przypadku wystawiania portalu na zewnątrz zaleca się zabezpieczenie dostępu poprzez **Cloudflare Tunnel (`cloudflared`)** z podłączoną warstwą uwierzytelniania **Cloudflare Zero Trust / Access** (np. logowanie One-Time Pin / Google / OAuth). Hasło zdefiniowane w `.env` (`ADMIN_PASSWORD`) służy do zabezpieczenia tokenów sesyjnych API.

---

## Powstanie projektu i autorstwo

Projekt oraz kod źródłowy aplikacji zostały stworzone i zaimplementowane przez zaawansowanego agenta sztucznej inteligencji (AI) pod bezpośrednim nadzorem technologicznym, kierownictwem architektonicznym i według wytycznych właściciela projektu.

---

## Architektura i trwałość danych (Docker volumes)

Aplikacja została zaprojektowana w oparciu o architekturę izolacji i trwałości danych. Zmienne dane użytkownika są montowane jako woluminy z dysku hosta w `docker-compose.yml`:

- **`./docs`** -> Montowany pod `/usr/share/nginx/html/docs` (Nginx) oraz `/app/docs` (API). Przechowuje strukturę i pliki dokumentacji Markdown. Środowisko automatycznie inicjalizuje ten katalog z szablonu `./docs.example` przy pierwszym uruchomieniu, a właściwy plik `./docs` jest wykluczony w `.gitignore` dla ochrony produkcyjnej dokumentacji.
- **`./data`** -> Montowany pod `/app/data`. Przechowuje bazy zadań Kanban (`kanban_data.json`), procedur operacyjnych (`playbooks_data.json`), notatek (`quick_notes.json`) oraz szablonów zadań (`task_templates.json`).
- **`./public/images`** -> Montowany pod `/usr/share/nginx/html/public/images` oraz `/app/public/images`. Przechowuje przesłane i wklejone obrazy po rygorystycznej walidacji binarnej.
- **`./backups`** -> Montowany pod `/app/backups`. Przechowuje automatyczne rotacyjne archiwa kopii zapasowych bazy wiedzy (polityka retencji 7 kopii), zapewniając ich pełną trwałość na dysku hosta.

Dzięki tej strukturze rekompilacja obrazów Docker (`docker compose up -d --build`) oraz restarty kontenerów nigdy nie naruszają ani nie usuwają treści wprowadzonych przez użytkownika.

---

## Przykładowa struktura katalogów i migracja treści

Projekt udostępnia domyślny, czysty i wolny od praw autorskich szkielet struktury katalogów oraz przykładowych plików szablonowych w katalogu `docs/`. Struktura ta służy do natychmiastowej weryfikacji aplikacji oraz jako baza startowa do budowania własnej bazy wiedzy.

> [!NOTE]
> **Elastyczna migracja treści:** 
> Do katalogu `docs/` można swobodnie migrować i kopiować własne pliki `.md` oraz katalogi pochodzące z innych systemów lub notatek (o ile nie naruszają one niczyich praw autorskich ani poufności). Serwer po uruchomieniu automatycznie odczytuje pełną strukturę katalogów i buduje dynamiczne drzewo nawigacyjne.

Przykładowe drzewo struktury szkieletowej w `docs/`:

```text
docs/
├── 01_Cyberbezpieczenstwo/
│   ├── 01_SOC_i_Incident_Response/
│   │   ├── 01_Procedura_Obslugi_Incydentow.md
│   │   └── 02_Analiza_Logow_i_SIEM.md
│   └── 02_Hardening_Systemowy/
│       ├── 01_Hardening_Serwerow_Linux.md
│       └── 02_Hardening_Windows_Active_Directory.md
├── 02_Infrastruktura_i_Wirtualizacja/
│   ├── 01_VMware_vSphere/
│   │   ├── 01_Procedury_Backupu_ESXi.md
│   │   └── 02_Konfiguracja_Klastrow_HA.md
│   └── 02_Docker_i_Konteneryzacja/
│       ├── 01_Dobre_Praktyki_Dockerfile.md
│       └── 02_Zarzadzanie_Wolumenami.md
├── 03_Uslugi_Sieciowe_i_Serwery/
│   ├── 01_Nginx_i_Reverse_Proxy/
│   │   ├── 01_Konfiguracja_Certyfikatow_SSL.md
│   │   └── 02_Limitowanie_Zadan_Rate_Limiting.md
│   └── 02_Active_Directory_i_DNS/
│       ├── 01_Polityki_GPO_Security.md
│       └── 02_Struktura_Jednostek_OU.md
└── 04_Zarzadzanie_i_Procedury_SOP/
    └── 01_Procedury_Operacyjne/
        ├── 01_Checklista_Przegladu_Tygodniowego.md
        └── 02_Procedura_Aktualizacji_Serwerow.md
```

---

## Główne funkcjonalności

1. **Wbudowany edytor Markdown z podglądem na żywo i odpornością (Live Preview & Self-Healing):**
   - Pełne wsparcie dla formatowania tekstu, tabel, bloków kodu i składni Markdown (`markdown-it`).
   - **Ramki wyróżnień typu Callouts / Admonitions (GitHub / Obsidian):** Pełne wsparcie dla bloków wyróżnień w składni Markdown z automatycznym kolorowaniem lewej krawędzi (4px) i dopasowanym tłem: `> [!NOTE]` (informacja, błękitny), `> [!TIP]` (wskazówka, szmaragdowy), `> [!IMPORTANT]` (ważne, fioletowy), `> [!WARNING]` (ostrzeżenie, bursztynowy), `> [!CAUTION]` (uwaga krytyczna, czerwony). Parser obsługuje również opcjonalne własne nagłówki w pierwszej linii (np. `> [!WARNING] Zanim zrestartujesz klaster`) oraz bezpieczną sanityzację XSS (`escapeHtml`).
   - Pasek narzędzi z szybkimi wzorcami formatowania, wstawianiem tabel, bloków kodu, diagramów Mermaid oraz dedykowanym przyciskiem **Tagi** (wyróżnionym złotym kolorem) do natychmiastowego definiowania i edycji metadanych YAML Frontmatter na początku dokumentu.
   - Mechanizm **Self-Healing Toolbar** (`ensureEditorToolbarTagsButton`): dynamiczna weryfikacja i automatyczne wstrzykiwanie kontrolek paska narzędziowego w warstwie JavaScript przy każdym otwarciu edytora, eliminujące błędy spowodowane agresywną pamięcią podręczną przeglądarki.
   - Nakładka podświetlania składni w polu edycji (`Highlight Overlay`) z automatyczną walidacją i synchronizacją przewijania.
   - **Autozapis i ochrona przed utratą danych (Draft Recovery):** Ciągły autozapis wprowadzanego tekstu w czasie rzeczywistym w pamięci podręcznej `localStorage` (`knowops_draft_...`) wraz ze wskaźnikiem statusu zapisu oraz automatycznym przywracaniem wersji roboczej w przypadku nagłego zamknięcia karty lub przeglądarki.

2. **Diagramy i schematy wektorowe (Mermaid.js):**
   - Automatyczne renderowanie schematów blokowych (Flowchart), diagramów sekwencji (Sequence), wykresów Git (Git Graph), wykresów kołowych (Pie Chart), harmonogramów Gantta, diagramów stanów (State Diagram), diagramów klas (Class Diagram).
   - Wbudowane wzorce dla architektury systemowej: dedykowane szablony diagramów sieci Active Directory oraz drzew struktur organizacyjnych jednostek OU.

3. **Zarządzanie dokumentacją, folderami i nawigacją:**
   - **Dwuetapowe deterministyczne sortowanie numeryczne i hierarchia kolorów:** Pełne zachowanie kolejności według fizycznych prefiksów numerycznych (`01`, `02`, `03`...) pobieranych ze ścieżek fizycznych (`relPath`). W każdym folderze pliki Markdown prezentowane są zawsze na początku (w kolejności numerycznej/alfabetycznej), a podkatalogi pod nimi (również w ścisłym porządku numerycznym), przy zachowaniu oczyszczonych, czytelnych tytułów w interfejsie. Drzewo nawigacji stosuje naprzemienne kolorowanie poziomów zagłębienia (złoty dla folderu głównego, błękitny dla podfolderu, powrót do złotego dla pod-podfolderu), co ułatwia orientację w rozbudowanych strukturach.
   - **Menedżer kosza bazy wiedzy (Kosz Wiki):** Usunięte artykuły i katalogi są bezpiecznie archiwizowane w koszu systemowym (`docs/.trash/`) i rejestrowane w trwałym manifeście `trash_manifest.json` wraz z datą, typem i oryginalną ścieżką. Dedykowane okno modalne "Kosz Wiki" umożliwia przeglądanie usuniętych elementów, weryfikację ich rozmiaru i ścieżki pierwotnej, przywrócenie ich do bazy z automatycznym odtworzeniem brakujących katalogów nadrzędnych oraz trwałe opróżnianie kosza (`/api/trash-documents`, `/api/restore-document`, `/api/purge-trash`).
   - **Bezpieczne usuwanie całych katalogów i podfolderów:** Możliwość usunięcia dowolnego działu lub zagnieżdżonego podfolderu z poziomu drzewa nawigacyjnego lub nagłówka. Dedykowane okno modalne dynamicznie kalkuluje i wyświetla liczbę zawartych plików oraz podkatalogów (`/api/delete-folder`).
   - **Bezpieczne przenoszenie folderów i działów (GUI oraz Drag and Drop):** Zaawansowane okno modalne z wyszukiwarką i filtrem lokalizacji docelowych w czasie rzeczywistym oraz pełna obsługa przeciągania myszą (Drag & Drop) dla katalogów. Architektura zawiera rygorystyczną walidację antycykliczną (blokada przeniesienia folderu do samego siebie lub do któregokolwiek z jego podfolderów potomnych) oraz detekcję kolizji nazw (`409 Conflict`, `/api/move-folder`).
   - **Przenoszenie i zmiana nazwy dokumentów:** Przeciąganie dokumentów `.md` w drzewie bocznym, modal przenoszenia z wyszukiwarką istniejących ścieżek (`/api/move-page`) oraz możliwość zmiany nazwy pliku w locie (`/api/rename-file`).
   - **Kreator nowych stron i działów:** Dedykowany modal dodawania stron (`createItemModal`, `/api/create-page`) z dynamicznym wyborem kategorii, tworzeniem nowych podfolderów w locie i natychmiastową rekompilacją drzewa nawigacji.
   - **Obsługa wielopoziomowych podkatalogów:** Pełne wsparcie dla dowolnie zagnieżdżonych struktur podkatalogów (1., 2., 3., N-ty poziom).
   - **Stały pasek akcji artykułu (Sticky Action Header):** Belka nagłówkowa ze ścieżką pliku, datą ostatniej modyfikacji oraz przyciskami: eksportu offline, dodawania podstrony w bieżącym dziale, przenoszenia dokumentu i edycji. Pozycjonowanie lepkie (`position: sticky; top: 0;`) sprawia, że pasek pozostaje stale zakotwiczony na górze okna podczas przewijania długich procedur.
   - **Zoptymalizowany tryb druku i eksportu A4 / PDF:** Dedykowany arkusz stylów `@media print` wraz z dyrektywą `@page { size: A4 portrait; margin: 12mm 15mm; }`. Gwarantuje idealne dopasowanie w skali 100% ("Rozmiar rzeczywisty") bez obcinania prawej krawędzi, automatyczne zawijanie wierszy w kodzie (`pre`), dopasowanie tabel, ochronę przed łamaniem nagłówków między stronami oraz ukrywanie elementów interfejsu.

4. **Bezpieczne wgrywanie mediów i weryfikacja binarna (Magic Bytes):**
   - Bezpośrednie wklejanie zrzutów ekranu ze schowka (`Ctrl + V`) oraz przeciąganie grafik na pole edytora (Drag & Drop).
   - Ochrona oparta na weryfikacji nagłówków binarnych (Magic Bytes): dopuszczane są wyłącznie rzeczywiste pliki graficzne (PNG, JPEG, GIF, WebP). Blokowane są wszelkie próby podszywania się pod grafikę (np. pliki wykonywalne, skrypty z podwójnym rozszerzeniem). Limit rozmiaru: 5 MB.

5. **Podświetlanie składni kodu i szybkie kopiowanie:**
   - Integracja z biblioteką `Highlight.js` dla bloków kodu w widoku artykułu.
   - Przycisk "Kopiuj" pojawiający się po najechaniu na dowolny blok kodu, z dynamicznym potwierdzeniem skopiowania do schowka.

6. **Wyszukiwarka pełnotekstowa i system kategoryzacji tagami (YAML Frontmatter):**
   - Szybkie przeszukiwanie całej bazy wiedzy w czasie rzeczywistym z poziomu paska narzędziowego.
   - Wyniki z podświetlaniem poszukiwanej frazy (`mark`) i bezpośrednimi linkami do dokumentów.
   - Pełne wsparcie dla metadanych dokumentów za pośrednictwem nagłówka Frontmatter w formacie tablicowym `tags: [cybersec, linux, nginx]`, pionowej listy YAML (`- tag`) lub rozdzielanych przecinkami wartości. Dedykowany przycisk **Tagi** w pasku narzędziowym edytora automatycznie wstawia blok Frontmatter lub ustawia kursor na istniejących tagach.
   - Automatyczne wyciąganie unikalnych tagów i ich prezentacja w postaci estetycznych pigułek (`#tag`) bezpośrednio pod nagłówkiem czytanego dokumentu.
   - Chmura tagów w lewym menu nawigacyjnym z licznikiem wystąpień oraz pełna integracja z wyszukiwarką pełnotekstową (błyskawiczne filtrowanie po wpisaniu lub kliknięciu frazy `#tag`).

7. **Tablica Kanban, szablony zadań (Task Templates) i inteligentne sortowanie:**
   - Wizualne zarządzanie zadaniami technicznymi w 4 kolumnach (Do zrobienia, W trakcie, Do weryfikacji, Zrobione).
   - Podział zadań na checklisty (subtaski), trzystopniowa priorytetyzacja (Wysoki, Średni, Niski), archiwizacja zadań.
   - **Inteligentne sortowanie kart i subtasków:** Zadania z aktywnymi, nieukończonymi podzadaniami pozycjonowane są na górze kolumny, natomiast zadania w 100% zrealizowane automatycznie opadają na spód. W prawym bocznym panelu aktywnych zadań ukończone podzadania są automatycznie ukrywane dla zachowania maksymalnej przejrzystości.
   - **Baza gotowych szablonów zadań systemowych:** Wbudowane wzorce inżynierskie (Wdrożenie Maszyny Wirtualnej VM, Audyt Bezpieczeństwa Serwera Linux, Konfiguracja Tunelu VPN WireGuard, Analiza Incydentu Bezpieczeństwa SOC Alert).
   - **Tworzenie własnych szablonów zadań:** Możliwość zapisania dowolnie zdefiniowanego zadania (z tytułem, kategorią, priorytetem, opisem i checklistą) jako trwały szablon w `data/task_templates.json` za pomocą przycisku "Zapamiętaj jako Szablon" w oknie dodawania zadania.

8. **Wieloetapowe procedury operacyjne (Playbooks SOP):**
   - Dedykowany moduł interaktywnych procedur krok po kroku.
   - Postęp procedury w czasie rzeczywistym z checklistami, opisem technicznym, dynamicznym dodawaniem i usuwaniem etapów oraz trwałym zapisem stanu w `data/playbooks_data.json`.

9. **Podręczne notatki techniczne (Quick Notes):**
   - Tablica szybkich notatek technicznych w `data/quick_notes.json` do błyskawicznego zapisywania poleceń, adresów IP i wycinków konfiguracji z natychmiastowym filtrowaniem i kolorowaniem kafelków.

10. **Podręczny notatnik roboczy i szybki brudnopis (Scratchpad / Quick Draft - skrót Alt+N):**
    - Globalny, wysuwany z prawej krawędzi panel boczny (Off-canvas Drawer) dostępny w każdym miejscu aplikacji bez konieczności opuszczania aktualnie czytanego dokumentu.
    - Wywoływany za pomocą skrótu klawiszowego `Alt + N` (lub `Alt + S`) oraz dyskretnego uchwytu na prawej krawędzi okna.
    - Autozapis w czasie rzeczywistym w `localStorage` oraz asynchroniczna synchronizacja w tle z serwerem API (`/api/scratchpad`, plik `data/scratchpad_data.json`).
    - Dwie zakładki robocze:
      - *Brudnopis (tekst / kod)*: wielowierszowy edytor monospaced z automatycznym licznikiem znaków i linii, idealny do agregacji poleceń i wycinków konfiguracji.
      - *Szybka checklista*: lista zadań do odhaczenia (`Enter` dodaje zadanie, kliknięcie oznacza stan ukończenia).
    - Zintegrowany przycisk **Przekształć w stronę Wiki**: błyskawicznie przenosi treść brudnopisu do kreatora nowej strony Markdown bez konieczności ręcznego kopiowania.
    - Szybkie kopiowanie całej treści do schowka systemowego jednym kliknięciem.

11. **Wbudowane narzędzia inżynierskie i interaktywna instrukcja:**
    - **Hasłomat SecOps:** Generator bezpiecznych haseł i losowych fraz passphrase Diceware o wysokiej entropii z oceną siły.
    - **Kalkulator CIDR:** Zaawansowany kalkulator podsieci IPv4 z wyliczaniem maski, wildcard, adresu sieci, broadcastu, puli użytecznych hostów oraz reprezentacji binarnej.
    - **Kalkulator RAID & ZFS:** Analiza macierzy dyskowych RAID (RAID 0, 1, 5, 6, 10) oraz pul pamięci ZFS z wyliczaniem pojemności netto, narzutu parzystości i odporności na jednoczesne awarie dysków.
    - **Monitor zasobów serwera:** Monitorowanie parametrów systemowych hosta w czasie rzeczywistym (CPU, RAM, Dysk, Uptime, jądro systemu) odczytywanych przez endpoint `/api/server-stats`.
    - **Biuletyn RSS SecOps:** Agregator i czytnik biuletynów bezpieczeństwa oraz kanałów RSS CyberSec (CERT Polska, CISA, The Hacker News) z możliwością zarządzania subskrypcjami.
    - **Wbudowana interaktywna instrukcja portalu (`#/tool/instrukcja`):** Kompletny, wbudowany podręcznik inżynierski dostępny bezpośrednio z poziomu Pulpitu, prezentujący zasady formatowania Markdown, tabel, diagramów Mermaid, definicji tagów YAML oraz skrótów klawiszowych.

12. **Import plików zewnętrznych i Web Scraper (HTML to Markdown):**
    - Dedykowane okno modalne "Importuj plik (MD / HTML)" dostępne bezpośrednio z lewego panelu bocznego.
    - **Zakładka "Z dysku":** Import lokalnych plików `.md`, `.html`, `.htm` oraz `.txt` do wybranego działu bazy wiedzy.
    - **Zakładka "Z linku / URL":** Wbudowany Web Scraper (`/api/scrape-url`) pobierający artykuły ze stron internetowych, oczyszczający kod HTML i konwertujący treść na czysty Markdown z restrykcyjną ochroną anty-SSRF.

13. **Menedżer czyszczenia osieroconych grafik (`/api/orphaned-images`, `/api/delete-orphaned-images`):**
    - Zautomatyzowany skaner analizujący odwołania do plików graficznych we wszystkich dokumentach Markdown w katalogu `docs/` i porównujący je z całą strukturą katalogu `public/images/` (łącznie ze wszystkimi podkatalogami).
    - Dedykowane okno modalne z podglądem miniaturek osieroconych plików, ścieżkami względnymi, kalkulatorem zajmowanego miejsca i opcjami masowego zaznaczania.
    - Zabezpieczenie przed bezpowrotną utratą danych: usuwane grafiki nie są bezpowrotnie kasowane, lecz bezpiecznie przenoszone do dedykowanego kosza `public/images/.trash/` z zachowaniem struktury podkatalogów źródłowych.

14. **Narzędzia konsolowe i synchronizacja nazw plików (GUI i CLI):**
    - **Interaktywny moduł synchronizacji nazw plików z H1 (GUI):** Dedykowany przycisk "Uporządkuj nazwy z H1" w lewym panelu bocznym oraz okno modalne prezentujące listę rozbieżności między nagłówkiem `# Tytuł` a fizyczną nazwą pliku. Moduł umożliwia selektywny wybór plików do zmiany, automatycznie zachowuje prefiksy numeryczne (`01_`, `02_`), transliteruje polskie znaki diakrytyczne oraz chroni przed kolizjami nazw (`/api/sync-filenames-preview`, `/api/sync-filenames-apply`).
    - **Szybkie tworzenie stron ([add_page.mjs](file:///c:/Users/kjaki/Desktop/GIT/KnowOpsWiki/add_page.mjs)):** Narzędzie konsolowe pozwalające tworzyć nowe strony i podkatalogi bezpośrednio z wiersza poleceń lub sesji SSH (`node add_page.mjs "Tytuł Strony"`), z automatyczną rekompilacją bazy nawigacyjnej.
    - **Silnik kopii zapasowej CLI ([backup_wiki.mjs](file:///c:/Users/kjaki/Desktop/GIT/KnowOpsWiki/backup_wiki.mjs)):** Narzędzie do tworzenia archiwów bazy wiedzy z poziomu konsoli lub zadań crona serwera, z opcjonalną synchronizacją z Dyskiem Google (`rclone copy`) przy zdefiniowaniu zmiennej `GOOGLE_DRIVE_REMOTE` w pliku `.env`.
    - **Skrypt konsolowy synchronizacji ([scripts/sync_markdown_filenames.mjs](file:///c:/Users/kjaki/Desktop/GIT/KnowOpsWiki/scripts/sync_markdown_filenames.mjs)) oraz starter ([sync_markdown_filenames.sh](file:///c:/Users/kjaki/Desktop/GIT/KnowOpsWiki/sync_markdown_filenames.sh)):** Narzędzie konsolowe z automatycznym wykrywaniem środowiska (lokalny Node.js lub kontener Docker `knowops-api`). Domyślne uruchomienie wykonuje bezpieczny audyt (Dry Run): `./sync_markdown_filenames.sh`, natomiast flaga `--apply` fizycznie nanosi zmiany w systemie plików: `./sync_markdown_filenames.sh --apply`.

15. **Eksport pełnej kopii zapasowej do archiwum ZIP oraz rotacyjny harmonogram kopii:**
    - **Kopia ZIP w locie (`/api/export-wiki-zip`):** Możliwość natychmiastowego wygenerowania i pobrania pełnej kopii zapasowej bazy wiedzy bezpośrednio z lewego paska narzędziowego GUI oraz sekcji konserwacji na pulpicie (przycisk "Kopia ZIP"). Kompresuje katalogi `docs/`, `data/` oraz `public/images/` z automatycznym wykluczeniem kosza systemowego.
    - **Automatyczny harmonogram rotacyjny (kopie auto 7):** Wbudowany mechanizm serwera Node.js wykonujący pełną kopię zapasową co 24 godziny z automatyczną rotacją i retencją 7 najnowszych archiwów. Kopie składowane są w wolumenie `./backups` (zamontowanym w kontenerze jako `/app/backups`), co zapewnia ich trwałość na dysku maszyny hosta.
    - **Interfejs zarządzania kopiami automatycznymi:** Dedykowany modal "Kopie Auto (7)" na pulpicie i w menu nawigacyjnym (`/api/backups-list`, `/api/backups-download`, `/api/backups-trigger`) pozwalający na weryfikację listy archiwów, ich rozmiaru, daty utworzenia, pobranie wybranego archiwum lub wymuszenie natychmiastowego wykonania kopii.

16. **Autonomiczny eksport procedur offline do samowystarczalnego HTML (`exportArticleOfflineHtml`):**
    - Przycisk **„Eksportuj offline”** umieszczony w stałym pasku akcji (Sticky Action Header) każdego czytanego dokumentu.
    - Generuje pojedynczy, całkowicie samowystarczalny plik `.html` gotowy do pracy w środowiskach bez dostępu do sieci (Air-gapped, disaster recovery, stacje bastionowe).
    - Wszystkie powiązane z dokumentem grafiki lokalne (`/public/images/...`) są automatycznie pobierane, konwertowane i osadzane wewnątrz pliku HTML jako Base64 Data URI (`data:image/png;base64,...`).
    - Plik zawiera pełny, wbudowany arkusz stylów CSS Dark Theme, zachowując wierne formatowanie tabel, wyróżnień callout, bloków kodu i schematów.

---

## Bezpieczeństwo i hardening (SecOps)

Aplikacja została zaprojektowana zgodnie z najnowocześniejszymi wytycznymi bezpieczeństwa systemowego i sieciowego:

- **Izolacja sieciowa kontenerów:** Serwis API Node.js nasłuchuje na porcie 9000 wyłącznie wewnątrz prywatnej sieci Docker (`knowops-internal`). Port 9000 nie jest mapowany na hosta — cały ruch z zewnątrz przechodzi przez Nginx działający jako Reverse Proxy.
- **Nieuprzywilejowany użytkownik (`USER node` - UID 1000):** Proces API działa w kontenerze z uprawnieniami nieuprzywilejowanymi, z flagą `no-new-privileges:true`.
- **Ścisła ochrona przed Path Traversal:** Funkcja `isPathInsideDocs` rygorystycznie weryfikuje granice katalogu bazowego `docs/`, blokując wyjście poza dozwolony obszar oraz próby odwołań do katalogów siostrzanych.
- **Mitygacja SSRF (Server-Side Request Forgery):** Wbudowana blokada zapytań skrapera i czytnika do adresów pętli zwrotnej (`127.0.0.1`, `localhost`), sieci prywatnych RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) oraz adresów metadanych dostawców chmurowych (`169.254.169.254`).
- **Weryfikacja nagłówków binarnych (Magic Bytes):** Rzeczywista inspekcja pierwszych bajtów każdego przesyłanego pliku graficznego zapobiegająca wgrywaniu powłok sieciowych (Web Shell) ukrytych pod rozszerzeniami `.png`/`.jpg`.
- **Dynamiczny Rate-Limiter:** Ochrona przed atakami siłowymi na endpointy autoryzacyjne (max 5 prób na minutę) oraz ograniczenie operacji zapisu i modyfikacji plików (max 30 żądań POST na minutę per IP).
- **Bezpieczeństwo kryptograficzne:** Uwierzytelnianie tokenowe z porównywaniem hasła w stałym czasie za pomocą `crypto.timingSafeEqual`, uniemożliwiające ataki typu Timing Attack.
- **Sanityzacja XSS i mitygacja ReDoS:** Eskapowanie znaków niebezpiecznych w parsowaniu oraz zabezpieczenie wyrażeń regularnych przed atakami blokującymi pętlę zdarzeń Node.js (Catastrophic Backtracking).
- **Atomowy zapis plików:** Funkcja `atomicWriteFile` gwarantuje spójność plików konfiguracyjnych i dokumentacji w przypadku nagłego restartu lub odcięcia zasilania.
- **Utwardzone nagłówki HTTP (Nginx):** Restrykcyjne polityki `Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Strict-Transport-Security` oraz wyłączony ETag dla plików HTML zapobiegający problemom z pamięcią podręczną przeglądarek.
- **Weryfikacja stanu (Healthcheck):** Cykliczne monitorowanie poprawności działania procesów wewnątrz kontenerów.

---

## Zapewnienie jakości i testy jednostkowe

Projekt posiada zintegrowany zestaw automatycznych testów jednostkowych Node.js Test Runner:

```bash
npm test
```

Zestaw 25 testów automatycznych weryfikuje kluczowe mechanizmy bezpieczeństwa, integralności i funkcjonalności aplikacji:
1. Prawidłowe rozpoznawanie Magic Bytes dla plików graficznych PNG, JPEG, GIF, WebP,
2. Skuteczne blokowanie fałszywych plików graficznych z podmienionym rozszerzeniem (ochrona przed Web Shell),
3. Blokadę SSRF dla adresów pętli zwrotnej, sieci prywatnych RFC 1918 i metadanych chmurowych,
4. Ochronę przed Path Traversal i weryfikację granic katalogu bazowego `docs/`,
5. Ścisłą kontrolę granic ścieżek z blokadą odwołań do katalogów siostrzanych,
6. Poprawność kodowania encji HTML (Sanityzacja XSS),
7. Bezpieczne eskapowanie znaków specjalnych RegExp (Mitygacja ReDoS),
8. Poprawność struktury i sanityzacji danych wieloetapowych procedur operacyjnych (Playbooks SOP),
9. Dwuetapowe deterministyczne sortowanie nawigacji (pliki Markdown przed podkatalogami z zachowaniem prefiksów numerycznych 01, 02, 03...),
10. Bezpieczeństwo usuwania folderów (ochrona korzenia `docs/`, kosza `.trash/` i mitygacja Path Traversal),
11. Bezpieczeństwo przenoszenia folderów (ochrona przed cyklami samozagnieżdżenia, kolizjami nazw i ucieczką poza strukturę),
12. Ekstrakcję i normalizację tagów YAML Frontmatter z plików Markdown (format inline, lista pionowa, rozdzielanie przecinkami),
13. Wykrywanie osieroconych grafik w podkatalogach i mitygację Path Traversal przy przenoszeniu do kosza,
14. Weryfikację integralności silnika eksportu pełnego archiwum ZIP bazy wiedzy (`exportWikiZip`),
15. Walidację danych wejściowych, limitów rozmiaru payloadu i sanityzację brudnopisu Scratchpad,
16. Weryfikację logiki edytora tagów YAML Frontmatter (wstawianie nowego nagłówka, uzupełnianie istniejącego frontmattera i lokalizacja istniejących tagów),
17. Dynamiczne zarządzanie podzadaniami Kanban (szybkie dodawanie, przełączanie stanu ukończenia z sygnaturą czasu, przeliczanie paska postępu, sanityzacja XSS),
18. Poprawność struktury, definicji motywu ciemnego i sanityzacji bloków diagramów wektorowych Mermaid.js,
19. Inteligentne sortowanie kart i podzadań Kanban (aktywne subtaski u góry, opadanie zadań w 100% gotowych na spód kolumny oraz ukrywanie ukończonych w bocznym pasku),
20. Deterministyczne naprzemienne przypisywanie stylów dla poziomów zagłębienia folderów w drzewie nawigacyjnym (złoty dla poziomów parzystych, błękitny dla nieparzystych),
21. Integralność Menedżera Kosza Bazy Wiedzy (weryfikacja manifestu usunięcia, ochrona przed Path Traversal przy przywracaniu, blokada odtworzenia do korzenia lub wnętrza kosza),
22. Transformację bloków wyróżnień Callouts / Admonitions (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) z obsługą niestandardowych tytułów i sanityzacją XSS,
23. Rotację i retencję automatycznych kopii zapasowych (utrzymywanie 7 najnowszych archiwów, automatyczne usuwanie starszych plików ZIP),
24. Synchronizację nazw plików Markdown z pierwszym nagłówkiem H1 (ekstrakcja tytułu H1, ignorowanie YAML frontmatter, transliteracja znaków diakrytycznych, zachowanie prefiksu numerycznego),
25. Bezpieczeństwo synchronizacji nazw plików Markdown (ochrona przed Path Traversal w ścieżkach źródłowych i docelowych, wymóg rozszerzenia .md, detekcja kolizji nazw i atomowa zmiana nazwy).

---

## Szybkie uruchomienie (krok po kroku)

### 1. Sklonowanie repozytorium z GitHub
Do poprawnego uruchomienia środowiska wymagany jest pełny kod z repozytorium:

```bash
git clone https://github.com/KamilJanczyk/KnowOpsWiki.git
cd KnowOpsWiki
```

### 2. Przygotowanie pliku środowiskowego
Skopiuj plik wzorcowy `.env.example` do pliku `.env` i ustaw własne bezpieczne hasło administratora:

```bash
cp .env.example .env
```

Przykładowa treść pliku `.env`:
```env
API_PORT=9000
ADMIN_PASSWORD=TwojeBezpieczneHaslo123!
WIKI_PORT=8085
```

### 3. Uruchomienie środowiska (Docker Compose)

```bash
docker compose up -d --build
```

Aplikacja będzie dostępna pod adresem: `http://localhost:8085` (lub port skonfigurowany w `WIKI_PORT`).

---

## Oznaczenie zmian i audyt dokumentacji (Audit Trail)

Niniejsza dokumentacja została zaktualizowana i zweryfikowana pod kątem pełnej zgodności ze stanem faktycznym kodu aplikacji:
- Wprowadzono pełny opis bazy szablonów zadań systemowych (Task Templates) oraz mechanizmu tworzenia i zapisywania własnych szablonów z poziomu modalu Kanban w `data/task_templates.json`.
- Wdrożono dokumentację modułu importu plików zewnętrznych (.md, .html, .txt) oraz Web Scrapera ze striptizem HTML i ochroną anty-SSRF.
- Dodano specyfikację narzędzia konsolowego [add_page.mjs](file:///c:/Users/kjaki/Desktop/GIT/KnowOpsWiki/add_page.mjs) do tworzenia dokumentacji przez terminal SSH / CLI.
- Uzupełniono opis silnika kopii zapasowej [backup_wiki.mjs](file:///c:/Users/kjaki/Desktop/GIT/KnowOpsWiki/backup_wiki.mjs) z automatyczną synchronizacją z Google Drive (`rclone`).
- Wprowadzono dokumentację wbudowanej interaktywnej instrukcji obsługi portalu (`#/tool/instrukcja` / `renderWikiInstruction`).
- Zaktualizowano opis mechanizmu Self-Healing Toolbar w edytorze oraz autozapisu z ochroną przed utratą danych (Draft Recovery).
- Rozszerzono pakiet testów jednostkowych do pełnej listy 25 zautomatyzowanych testów Node.js Test Runner.
- Zaktualizowano opis mechanizmów kryptograficznych (ochrona przed Timing Attack przez `crypto.timingSafeEqual`) oraz utwardzenia Nginx (`etag off`).
- Wprowadzono opis mechanizmu bezpiecznego usuwania całych działów i podfolderów (`/api/delete-folder`) z zabezpieczeniem w koszu `.trash`.
- Wprowadzono opis bezpiecznego przenoszenia całych folderów przez GUI i Drag & Drop (`/api/move-folder`) z walidacją antycykliczną i wyszukiwarką docelową.
- Zaktualizowano zasady dwuetapowego, deterministycznego sortowania elementów lewego menu z priorytetem prefiksów numerycznych (`01`, `02`, `03`...) oraz naprzemienną kolorystyką poziomów folderów (złoty / błękitny).
- Wdrożono Menedżera Kosza Bazy Wiedzy (`docs/.trash/`) z trwałym rejestrem `trash_manifest.json`, modalem "Kosz Wiki", przywracaniem dokumentów i folderów do pierwotnych ścieżek oraz bezpiecznym opróżnianiem kosza.
- Wdrożono parser bloków wyróżnień typu Callouts / Admonitions (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) z obsługą własnych nagłówków i sanityzacją XSS.
- Wdrożono autonomiczny eksport procedur offline do pojedynczego, w pełni samowystarczalnego pliku HTML z grafikami zakodowanymi w Base64 Data URI i pełnymi stylami CSS Dark Theme (`exportArticleOfflineHtml`).
- Wdrożono automatyczny rotacyjny harmonogram kopii zapasowych (co 24 godziny z retencją 7 kopii w dedykowanym wolumenie `./backups`) oraz interfejs GUI "Kopie Auto (7)".
- Wdrożono narzędzie konsolowe [scripts/sync_markdown_filenames.mjs](file:///c:/Users/kjaki/Desktop/GIT/KnowOpsWiki/scripts/sync_markdown_filenames.mjs) oraz interaktywny moduł GUI „Uporządkuj nazwy z H1” z podglądem różnic, detekcją kolizji i selektywną akceptacją zmian nazw plików Markdown na podstawie nagłówka `# Tytuł`.
- Zoptymalizowano tablicę Kanban i panel boczny: inteligentne opadanie ukończonych zadań 100%, sortowanie aktywnych podzadań na górze oraz ukrywanie ukończonych subtasków w bocznym pasku.
- Zaktualizowano menedżera czyszczenia grafik: bezpieczne przenoszenie do kosza `public/images/.trash/` z zachowaniem struktury podkatalogów źródłowych.
- Wdrożono dokumentację eksportu pełnej kopii zapasowej do archiwum ZIP (`/api/export-wiki-zip`) z poziomu paska narzędzi.
- Wdrożono dokumentację obsługi tagów YAML Frontmatter, pigułek tagów pod artykułami, chmury tagów i wyszukiwarki z filtrem `#tag`.
- Uzupełniono specyfikację stałego paska akcji dokumentu (Sticky Action Header) w pozycjonowaniu CSS.
- Wprowadzono szczegółowy opis zoptymalizowanego mechanizmu wydruku i generowania PDF w standardzie formatu A4.
- Wdrożono moduł Podręcznego Notatnika Roboczego (Scratchpad / Quick Draft) z globalnym skrótem klawiszowym `Alt + N`, dwoma trybami roboczymi, autozapisem oraz opcją bezpośredniej konwersji do strony Wiki (`promoteScratchpadToWikiPage`).

