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

1. **Wbudowany edytor Markdown z podglądem na żywo:**
   - Pełne wsparcie dla formatowania tekstu, tabel, bloków kodu i składni Markdown (`markdown-it`).
   - Pasek narzędzi z szybkimi wzorcami formatowania, wstawianiem tabel, diagramów Mermaid oraz dedykowanym przyciskiem **Tagi** do natychmiastowego definiowania i edycji metadanych YAML Frontmatter na początku dokumentu.
   - Nakładka podświetlania składni w polu edycji (`Highlight Overlay`) z automatyczną walidacją i zapisem.

2. **Diagramy i schematy wektorowe (Mermaid.js):**
   - Automatyczne renderowanie schematów blokowych, wykresów Gantta, diagramów sekwencji, klas, stanów oraz wykresów Git z bloków `mermaid`.

3. **Zarządzanie dokumentacją, folderami i nawigacją:**
   - **Dwuetapowe deterministyczne sortowanie numeryczne:** Pełne zachowanie kolejności według fizycznych prefiksów numerycznych (`01`, `02`, `03`...) pobieranych ze ścieżek fizycznych (`relPath`). W każdym folderze pliki Markdown prezentowane są zawsze na początku (w kolejności numerycznej/alfabetycznej), a podkatalogi pod nimi (również w ścisłym porządku numerycznym), przy zachowaniu oczyszczonych, czytelnych tytułów w interfejsie.
   - **Bezpieczne usuwanie całych katalogów i podfolderów:** Możliwość usunięcia dowolnego działu lub zagnieżdżonego podfolderu z poziomu drzewa nawigacyjnego lub nagłówka. Dedykowane okno modalne dynamicznie kalkuluje i wyświetla liczbę zawartych plików oraz podkatalogów. Usunięte katalogi są bezpiecznie zabezpieczane w koszu systemowym (`docs/.trash/`) z sygnaturą czasową.
   - **Bezpieczne przenoszenie folderów i działów (GUI & Drag and Drop):** Zaawansowane okno modalne z wyszukiwarką/filtrem lokalizacji docelowych w czasie rzeczywistym oraz pełna obsługa przeciągania myszą (Drag & Drop) dla katalogów. Architektura zawiera rygorystyczną walidację antycykliczną (blokada przeniesienia folderu do samego siebie lub do któregokolwiek z jego podfolderów potomnych) oraz detekcję kolizji nazw (`409 Conflict`).
   - **Przenoszenie pojedynczych dokumentów (Modal & Drag and Drop):** Przeciąganie dokumentów `.md` w drzewie bocznym oraz modal z wyszukiwarką podpowiedzi istniejących folderów i możliwością utworzenia nowej ścieżki w locie.
   - **Obsługa wielopoziomowych podkatalogów:** Pełne wsparcie dla dowolnie zagnieżdżonych struktur podkatalogów (1., 2., 3., N-ty poziom).
   - **Stały pasek akcji artykułu (Sticky Action Header):** Belka nagłówkowa ze ścieżką pliku, datą ostatniej modyfikacji oraz przyciskami szybkiej edycji, dodawania podstrony i przenoszenia dokumentu. Pozycjonowanie lepkie (`position: sticky; top: 0;`) sprawia, że pasek pozostaje stale zakotwiczony na górze okna podczas przewijania długich procedur.
   - **Zoptymalizowany tryb druku i eksportu A4 / PDF:** Dedykowany arkusz stylów `@media print` wraz z dyrektywą `@page { size: A4 portrait; margin: 12mm 15mm; }`. Gwarantuje idealne dopasowanie w skali 100% ("Rozmiar rzeczywisty") bez obcinania prawej krawędzi, automatyczne zawijanie wierszy w kodzie (`pre`), dopasowanie tabel, ochronę przed łamaniem nagłówków między stronami oraz ukrywanie elementów interfejsu.

4. **Bezpieczne wgrywanie mediów i weryfikacja binarna (Magic Bytes):**
   - Bezpośrednie wklejanie zrzutów ekranu ze schowka (`Ctrl + V`) oraz przeciąganie grafik na pole edytora (Drag & Drop).
   - Ochrona oparta na weryfikacji nagłówków binarnych (Magic Bytes): dopuszczane są wyłącznie rzeczywiste pliki graficzne (PNG, JPEG, GIF, WebP). Blokowane są wszelkie próby podszywania się pod grafikę (np. pliki wykonywalne, skrypty z podwójnym rozszerzeniem). Limit rozmiaru: 5 MB.

5. **Podświetlanie składni kodu i szybkie kopiowanie:**
   - Integracja z biblioteką `Highlight.js` dla bloków kodu w widoku artykułu.
   - Przycisk "Kopiuj" pojawiający się po najechaniu na dowolny blok kodu, z dynamicznym potwierdzeniem skopiowania do schowka.

6. **Wyszukiwarka pełnotekstowa:**
   - Szybkie przeszukiwanie całej bazy wiedzy z poziomu paska narzędziowego.
   - Wyniki z podświetlaniem poszukiwanej frazy (`mark`) i bezpośrednimi linkami do dokumentów.

7. **Tablica Kanban i szablony zadań administracyjnych:**
   - Wizualne zarządzanie zadaniami technicznymi w kolumnach (Do zrobienia, W trakcie, Do weryfikacji, Zrobione).
   - Podział zadań na checklisty (subtaski), trzystopniowa priorytetyzacja (Wysoki, Średni, Niski), archiwizacja zadań.
   - Baza gotowych szablonów zadań systemowych (Wdrożenie VM, Audyt serwera Linux, Konfiguracja tunelu VPN, Analiza incydentu SOC).

8. **Wieloetapowe procedury operacyjne (Playbooks SOP):**
   - Dedykowany moduł interaktywnych procedur krok po kroku.
   - Postęp procedury w czasie rzeczywistym z checklistami, opisem technicznym i zapisem stanu w `data/playbooks_data.json`.

9. **Podręczne notatki (Quick Notes):**
   - Tablica szybkich notatek technicznych w `data/quick_notes.json` do błyskawicznego zapisywania poleceń, adresów IP i wycinków konfiguracji.

10. **Wbudowane narzędzia inżynierskie:**
    - Generator bezpiecznych haseł i losowych fraz passphrase o wysokiej entropii.
    - Kalkulator podsieci IP (CIDR) z wyliczaniem maski, adresu sieci, broadcastu i puli hostów.
    - Kalkulator macierzy dyskowych RAID (RAID 0, 1, 5, 6, 10) z analizą pojemności użytecznej i odporności na awarie.
    - Monitor zasobów systemowych hosta (CPU, RAM, Dysk, Uptime) odczytywany w czasie rzeczywistym z poziomu kontenera.
    - Agregator i czytnik biuletynów bezpieczeństwa oraz kanałów RSS CyberSec.

11. **Eksport pełnej kopii zapasowej do archiwum ZIP (`/api/export-wiki-zip`):**
    - Możliwość natychmiastowego wygenerowania i pobrania pełnej kopii zapasowej bazy wiedzy bezpośrednio z lewego paska narzędziowego GUI (przycisk "Kopia ZIP").
    - Archiwum kompresuje katalogi dokumentacji (`docs/`), baz danych JSON (`data/`) oraz zasobów graficznych (`public/images/`), z automatycznym wykluczeniem kosza systemowego (`docs/.trash/`).
    - Strumieniowe przesyłanie archiwum z automatycznym usuwaniem pliku tymczasowego po zakończeniu transmisji eliminuje ryzyko zapełnienia przestrzeni dyskowej serwera.

12. **System kategoryzacji tagami (YAML Frontmatter):**
    - Pełne wsparcie dla metadanych dokumentów za pośrednictwem nagłówka Frontmatter w formacie tablicowym `tags: [cybersec, linux, nginx]`, pionowej listy YAML (`- tag`) lub rozdzielanych przecinkami wartości. Dedykowany przycisk **Tagi** w pasku narzędziowym edytora automatycznie wstawia blok Frontmatter lub ustawia kursor na istniejących tagach.
    - Automatyczne wyciąganie unikalnych tagów i ich prezentacja w postaci estetycznych pigułek (`#tag`) bezpośrednio pod nagłówkiem czytanego dokumentu.
    - Chmura tagów w lewym menu nawigacyjnym z licznikiem wystąpień oraz pełna integracja z wyszukiwarką pełnotekstową (błyskawiczne filtrowanie po wpisaniu lub kliknięciu frazy `#tag`).

13. **Menedżer czyszczenia osieroconych grafik (`/api/orphaned-images`, `/api/delete-orphaned-images`):**
    - Zautomatyzowany skaner analizujący odwołania do plików graficznych we wszystkich dokumentach Markdown w katalogu `docs/` i porównujący je z zawartością `public/images/`.
    - Dedykowane okno modalne z podglądem miniaturek osieroconych plików, kalkulatorem zajmowanego miejsca i opcjami masowego zaznaczania.
    - Zabezpieczenie przed bezpowrotną utratą danych: usuwane grafiki są bezpiecznie archiwizowane w koszu systemowym (`docs/.trash/orphaned_images/`) z unikalnym znacznikiem czasu.

---

## Bezpieczeństwo i hardening (SecOps)

Aplikacja została zaprojektowana zgodnie z najnowocześniejszymi wytycznymi bezpieczeństwa systemowego i sieciowego:

- **Izolacja sieciowa kontenerów:** Serwis API Node.js nasłuchuje na porcie 9000 wyłącznie wewnątrz prywatnej sieci Docker (`knowops-internal`). Port 9000 nie jest mapowany na hosta — cały ruch z zewnątrz przechodzi przez Nginx działający jako Reverse Proxy.
- **Nieuprzywilejowany użytkownik (`USER node` - UID 1000):** Proces API działa w kontenerze z uprawnieniami nieuprzywilejowanymi, z flagą `no-new-privileges:true`.
- **Ścisła ochrona przed Path Traversal:** Funkcja `isPathInsideDocs` rygorystycznie weryfikuje granice katalogu bazowego `docs/`, blokując wyjście poza dozwolony obszar oraz próby odwołań do katalogów siostrzanych.
- **Mitygacja SSRF (Server-Side Request Forgery):** Wbudowana blokada zapytań skrapera i czytnika do adresów pętli zwrotnej (`127.0.0.1`, `localhost`), sieci prywatnych RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) oraz adresów metadanych dostawców chmurowych (`169.254.169.254`).
- **Weryfikacja nagłówków binarnych (Magic Bytes):** Rzeczywista inspekcja pierwszych bajtów każdego przesyłanego pliku graficznego zapobiegająca wgrywaniu powłok sieciowych (Web Shell) ukrytych pod rozszerzeniami `.png`/`.jpg`.
- **Dynamiczny Rate-Limiter:** Ochrona przed atakami siłowymi na endpointy autoryzacyjne (max 5 prób na minutę) oraz ograniczenie operacji zapisu i modyfikacji plików (max 30 żądań POST na minutę per IP).
- **Sanityzacja XSS i mitygacja ReDoS:** Eskapowanie znaków niebezpiecznych w parsowaniu oraz zabezpieczenie wyrażeń regularnych przed atakami blokującymi pętlę zdarzeń Node.js (Catastrophic Backtracking).
- **Atomowy zapis plików:** Funkcja `atomicWriteFile` gwarantuje spójność plików konfiguracyjnych i dokumentacji w przypadku nagłego restartu lub odcięcia zasilania.
- **Utwardzone nagłówki HTTP (Nginx):** Restrykcyjne polityki `Content-Security-Policy`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` oraz `Strict-Transport-Security`.
- **Weryfikacja stanu (Healthcheck):** Cykliczne monitorowanie poprawności działania procesów wewnątrz kontenerów.

---

## Zapewnienie jakości i testy jednostkowe

Projekt posiada zintegrowany zestaw automatycznych testów jednostkowych Node.js Test Runner:

```bash
npm test
```

Zestaw testów weryfikuje kluczowe mechanizmy bezpieczeństwa aplikacji:
- Prawidłowe rozpoznawanie Magic Bytes dla PNG, JPEG, GIF, WebP,
- Skuteczne blokowanie fałszywych plików z podmienionym rozszerzeniem,
- Blokadę SSRF dla adresów prywatnych, lokalnych i chmurowych,
- Ochronę Path Traversal i granice katalogu `docs/`,
- Poprawność kodowania encji HTML (Sanityzacja XSS),
- Eskapowanie znaków specjalnych RegExp (Mitygacja ReDoS),
- Poprawność struktury i sanityzacji procedur Playbooków,
- Dwuetapowe sortowanie dwupoziomowe (pliki Markdown przed podkatalogami z zachowaniem prefiksów numerycznych 01, 02, 03...),
- Bezpieczeństwo usuwania folderów (ochrona korzenia `docs/`, kosza `.trash/` i blokada Path Traversal),
- Bezpieczeństwo przenoszenia folderów (ochrona przed cyklami i samozagnieżdżeniem, ochrona przed kolizjami i ucieczką ze ścieżki),
- Ekstrakcję i normalizację tagów YAML Frontmatter (warianty inline, lista pionowa, rozdzielanie przecinkami),
- Wykrywanie osieroconych grafik i mitygację Path Traversal przy usuwaniu zasobów mediów,
- Weryfikację integralności silnika eksportu archiwum ZIP bazy wiedzy (`exportWikiZip`).

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
- Wprowadzono opis mechanizmu bezpiecznego usuwania całych działów i podfolderów (`/api/delete-folder`) z zabezpieczeniem w koszu `.trash`.
- Wprowadzono opis bezpiecznego przenoszenia całych folderów przez GUI i Drag & Drop (`/api/move-folder`) z walidacją antycykliczną i wyszukiwarką docelową.
- Zaktualizowano zasady dwuetapowego, deterministycznego sortowania elementów lewego menu z priorytetem prefiksów numerycznych (`01`, `02`, `03`...).
- Wdrożono dokumentację eksportu pełnej kopii zapasowej do archiwum ZIP (`/api/export-wiki-zip`) z poziomu paska narzędzi.
- Wdrożono dokumentację obsługi tagów YAML Frontmatter, pigułek tagów pod artykułami, chmury tagów i wyszukiwarki z filtrem `#tag`.
- Wdrożono dokumentację menedżera czyszczenia osieroconych grafik (`/api/orphaned-images`, `/api/delete-orphaned-images`) z zabezpieczeniem w koszu systemowym.
- Uzupełniono specyfikację stałego paska akcji dokumentu (Sticky Action Header) w pozycjonowaniu CSS.
- Wprowadzono szczegółowy opis zoptymalizowanego mechanizmu wydruku i generowania PDF w standardzie formatu A4.
- Zaktualizowano opis procedur operacyjnych (Playbooks SOP), szybkich notatek oraz weryfikacji binarnej Magic Bytes.
- Rozszerzono pakiet testów jednostkowych do 14 testów automatycznych weryfikujących mechanizmy bezpieczeństwa, integralności, tagów i archiwizacji.
- Dodano dedykowany przycisk "Tagi" w pasku narzędziowym edytora Markdown (`insertEditorText('tags')`) oraz zaktualizowano i rozszerzono wbudowaną instrukcję obsługi portalu dostępną w module Pulpit (`renderWikiInstruction`).
