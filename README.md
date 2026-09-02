# KnowOps Wiki Application

Nowoczesny, lekki, utwardzony portal wiedzy **KnowOps** oraz centrum operacyjne zarządzania zadaniami systemowymi dla inżynierów systemowych, administratorów sieci i ekspertów CyberSec.

---

## Powstanie Projektu i Autorstwo

Projekt oraz kod źródłowy aplikacji zostały stworzone i zaimplementowane przez zaawansowanego agenta sztucznej inteligencji (AI) pod bezpośrednim nadzorem technologicznym, kierownictwem architektonicznym i według wytycznych właściciela projektu.

---

## Architektura i Trwałość Danych (Docker Volumes)

Aplikacja została zaprojektowana w oparciu o architekturę izolacji i trwałości danych. Zmienne dane użytkownika są montowane jako woluminy z dysku hosta w `docker-compose.yml`:

- **`./docs`** -> Montowany pod `/usr/share/nginx/html/docs` (Nginx) oraz `/app/docs` (API). Przechowuje strukturę i pliki dokumentacji Markdown.
- **`./data`** -> Montowany pod `/app/data`. Przechowuje bazy zadań Kanban (`kanban_data.json`), notatki (`quick_notes.json`) oraz szablony zadań (`task_templates.json`).
- **`./public/images`** -> Montowany pod `/usr/share/nginx/html/public/images` oraz `/app/public/images`. Przechowuje przesłane i wklejone obrazy.

Dzięki tej strukturze rekompilacja obrazów Docker (`docker compose up -d --build`) oraz restarty kontenerów nigdy nie naruszają ani nie usuwają treści wprowadzonych przez użytkownika.

---

## Główne Funkcjonalności

1. **Wbudowany Edytor Markdown z Podglądem na Żywo:**
   - Pełne wsparcie dla formatowania tekstu, tabel, bloków kodu i składni Markdown.
   - Pasek narzędzi z szybkimi wzorcami oraz automatyczną walidacją i zapisem.

2. **Diagramy i Schematy Wektorowe (Mermaid.js):**
   - Automatyczne renderowanie schematów blokowych, wykresów Gantta, diagramów sekwencji, klas, stanów oraz struktur Active Directory z bloków `mermaid`.

3. **Zarządzanie Dokumentacją i Nawigacją:**
   - **Przenoszenie Myszką (Drag & Drop):** Przeciąganie dokumentów `.md` bezpośrednio w drzewie nawigacyjnym lewego menu na docelowe katalogi.
   - **Obsługa Wielopoziomowych Podkatalogów:** Wsparcie dla dowolnie zagnieżdżonych struktur podkatalogów (1., 2., 3., N-ty poziom).
   - **Dedykowany Tryb Druku / PDF:** Czyste generowanie dokumentów do druku lub plików PDF bez paneli nawigacyjnych.

4. **Wgrywanie Mediów i Grafiki (`Ctrl + V` / Drop):**
   - Bezpośrednie wklejanie zrzutów ekranu ze schowka oraz przeciąganie grafik na pole edytora z automatyczną weryfikacją rozszerzeń i limitu rozmiaru (5 MB).

5. **Tablica Kanban i Szablony Zadań:**
   - Zarządzanie zadaniami z podpodziałem na checklisty, priorytetyzację (High -> Medium -> Low), automatyczną archiwizacją oraz bazą szablonów wielorazowych zadań administracyjnych.

6. **Wbudowane Narzędzia Administracyjne:**
   - Generator bezpiecznych haseł i fraz passphrase.
   - Kalkulator podsieci IP (CIDR) oraz kalkulator macierzy RAID.
   - Monitor zasobów i statusu serwera hosta (CPU, RAM, Dysk, Uptime na którym uruchomiony jest kontener) oraz czytnik biuletynów bezpieczeństwa RSS.

---

## Bezpieczeństwo i Hardening (SecOps)

Aplikacja posiada zaimplementowane producenckie mechanizmy utwardzania i bezpieczeństwa:

- **Nieuprzywilejowany Kontener (`USER appuser`):** Kontener API Node.js działa na wyizolowanym koncie nieuprzywilejowanym bez uprawnień `root`.
- **Dynamiczny Rate-Limiter API:** Ochrona przed atakami typu Brute-Force na logowanie (max 5 prób / 60s) oraz obostrzenie operacji modyfikacji danych (max 30 żądań POST / 60s per IP).
- **Ochrona przed Path Traversal i SSRF:** Rygorystyczna walidacja ścieżek `DOCS_DIR` oraz blokada zapytań skrapera do podsieci prywatnych (`127.0.0.1`, `localhost`, `192.168.x.x`, `10.x.x.x`).
- **Autoryzacja i Nagłówki HTTP:** Tokeny z 24h okresem ważności, limity czasu procesów potomnych oraz nagłówki `Content-Security-Policy` w serwerze Nginx.
- **Weryfikacja Zdrowia (Healthcheck):** Kontenery wyposażone w automatyczny monitoring HTTP healthcheck.

---

## Szybkie Uruchomienie (Krok po Kroku)

### 1. Sklonowanie Repozytorium z GitHub
Do poprawnego uruchomienia środowiska wymagany jest pełny kod z repozytorium:

```bash
git clone https://github.com/KamilJanczyk/KnowOpsWiki.git
cd KnowOpsWiki
```

### 2. Przygotowanie Pliku Środowiskowego
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

### 3. Uruchomienie Środowiska (Docker Compose)

```bash
docker compose up -d --build
```

Aplikacja będzie dostępna pod adresem: `http://localhost:8085` (lub port skonfigurowany w `WIKI_PORT`).