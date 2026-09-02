import os
import shutil
import re
import unicodedata

# Search across all backup directories in _kopie
backup_dirs = [
    r"C:\Users\kjaki\Desktop\GIT\_kopie\kopie\www_wiki_md_backup_2026-08-26\docs_backup_before_dedup",
    r"C:\Users\kjaki\Desktop\GIT\_kopie\kopie\www_wiki_md_backup_2026-08-26\docs",
    r"C:\Users\kjaki\Desktop\GIT\_kopie\wiki",
    r"C:\Users\kjaki\Desktop\GIT\_kopie\wiki_wsad",
    r"C:\Users\kjaki\Desktop\GIT\_kopie\Notion_git_wiki"
]
target_dir = r"C:\Users\kjaki\Desktop\GIT\devopsai\docs\04_Microsoft"

# Define the exact layout requested by the user
structure = {
    "01_Architektura_Teoria_i_Wdrozenie_AD": [
        "Active Directory - Architektura, Bezpieczeństwo i Teoria (Standard 2026)",
        "Active Directory & M365 - Kompletna Checklista Wdrożeniowa i Hardening",
        "Active Directory & Hybryda 2026 - Kompleksowy Przewodnik Wdrożenia",
        "RODC (Read-Only Domain Controller) - Wdrożenie, Bezpieczeństwo i PRP",
        "Relacje zaufania [teoria]",
        "Wyświetlanie nazwy użytkownika razem z nazwą firmy"
    ],
    "02_Bezpieczenstwo_i_Uprawnienia_AD": [
        "AD - delegowanie uprawnień administracyjnych",
        "JEA - Just Enough Administration",
        "Blokowanie dodawania kont komputerów do domeny przez użytkownika",
        "Bezpieczeństwo",
        "Zmiana domyślnej ścieżki pojawiania się kont KOMPUTERÓW",
        "Dodawanie komputera do domeny offline",
        "Zabezpieczenie środowiska przed zaszyfrowaniem",
        "Monitorowanie logowań i wylogowań w AD"
    ],
    "03_Powiazane_Uslugi_Krytyczne_Infrastruktura_AD": [
        "GPO", "CA", "LAPS", "ADFS", "Bitlocker", "WEC", "WSUS", "DHCP", "DNS", "IPAM", "NPS", "ADMX", "KMS"
    ],
    "04_Repozytorium_Skryptow_i_Polecen_AD": [
        "AD - data ostatniego logowania",
        "znajdź konta bez wygaśnięcia hasła",
        "dystrybucyjna grupa dynamiczna",
        "modyfikacja atrybutów",
        "Grupy",
        "Wypisanie użytkowników z OU",
        "Skrypty tworzenia kont, przypomnienia o hasłach, monitorowanie logowań"
    ],
    "05_Utrzymanie_i_Troubleshooting_AD": [
        "RSAT", "GPresult", "Naprawa połączeń AD", "Przeniesienie FSMO", "Naprawa relacji zaufania", "Optymalizacja bazy", "Kosz AD", "netdom", "Replikacja"
    ],
    "06_Tozsamosc_Chmurowa_i_Platforma_Azure": [
        "AAD", "ENTRA - Tenant", "CHMURA AZURE"
    ],
    "07_Zarzadzanie_Urzadzeniami_Endpoint_Management": [
        "INTUNE", "SCCM / MECM"
    ],
    "08_Uslugi_SaaS_i_Wspolpraca": [
        "SHAREPOINT", "TEAMS", "COPILOT"
    ],
    "09_Pamiec_Masowa_i_Serwery_Plikow": [
        "iSCSI", "Serwer Plików (NTFS, SMB)", "SŻD", "Foldery robocze", "FSRM", "DFS", "Home Folder", "BranchCache", "Migawki plików"
    ],
    "10_Wirtualizacja_Srodowiska_Pracy": [
        "Dostęp zdalny (Routing)", "VPN i DirectAccess", "RDS", "VDI", "Skrypt czyszczący drukarki RDS"
    ],
    "11_Uslugi_Aplikacyjne_i_Serwerowe_Niezalezne_od_AD": [
        "IIS", "FTP", "Serwer Wydruku", "Serwer SMTP"
    ],
    "12_OS_Zarzadzanie_Dyskami_i_Wdrozenia": [
        "Windows RE", "Z MBR do GPT"
    ],
    "13_OS_Diagnostyka_i_Utrzymanie_Serwisu": [
        "Synchronizacja czasu", "Defender limits", "MRT", "Sprawdzanie klucza", "Aktywacja", "Test RAM", "Resource Monitor"
    ],
    "14_OS_Profil_Konfiguracja_i_Drukarki": [
        "Drukowanie z folderu", "Problem z wyłączaniem", "Bufor wydruku", "Wyłączenie zarządzania drukarkami", "Autologowanie bez hasła", "Ctrl+Alt+Del", "Hibernacja"
    ],
    "15_OS_Automatyzacja_i_Skrypty_Klienckie": [
        "WINGET", "Aktualizowanie systemu skryptem", "xcopy", "Odblokowanie ExecutionPolicy"
    ]
}

def normalize_text(text):
    text = text.replace('ł', 'l').replace('Ł', 'L')
    return unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('utf-8').lower().strip()

# Scan all md files in all backup directories
all_md_files = []
for b_dir in backup_dirs:
    if os.path.exists(b_dir):
        for root, dirs, files in os.walk(b_dir):
            for f in files:
                if f.lower().endswith(".md"):
                    all_md_files.append((f, os.path.join(root, f)))

print(f"Total backup files loaded from all sources: {len(all_md_files)}")

# Clean targets: delete any existing files in targets and prepare subfolders
for folder in structure.keys():
    fpath = os.path.join(target_dir, folder)
    if os.path.exists(fpath):
        for f in os.listdir(fpath):
            os.remove(os.path.join(fpath, f))
    else:
        os.makedirs(fpath, exist_ok=True)

# Helper function to sanitize a filename for destination
def clean_filename(title):
    clean = re.sub(r'[^\w\s\-]', '', title)
    clean = clean.replace(' ', '_')
    if len(clean) > 80:
        clean = clean[:80]
    return clean

# Loop over structure and find matches
for sub, items in structure.items():
    print(f"\nProcessing subfolder: {sub}")
    dest_sub_path = os.path.join(target_dir, sub)
    
    for idx, item in enumerate(items, start=1):
        item_norm = normalize_text(item)
        
        # Explicit robust overrides for special filenames (using fully normalized forms now that L is fixed)
        manual_overrides = {
            "znajdz konta bez wygasniecia hasla": "AD – znajdź konta użytkowników z ustawionym hasłem.md",
            "naprawa polaczen ad": "Nie można skontaktować się z kontrolerem domeny Ac.md",
            "z mbr do gpt": "Z MRB do GPT - konwersja partycji.md",
            "wylaczenie zarzadzania drukarkami": "Aby wyłączyć opcję zarządzania drukarkami w system.md",
            "serwer plikow (ntfs, smb)": "Serwer Plików [NTFS, SMB] - informacje ogólne, rol.md",
            "defender limits": "Windows Defender - ograniczenia zużycia procesora.md",
            "hibernacja": "Wyłączenie hibernacji.md",
            "odblokowanie executionpolicy": "Odblokowanie uruchamiania skryptów.md"
        }
        
        matched_candidates = []
        
        if item_norm in manual_overrides:
            target_name = manual_overrides[item_norm]
            target_norm = normalize_text(target_name)
            for name, full_path in all_md_files:
                if normalize_text(name) == target_norm:
                    matched_candidates.append(full_path)
        
        if not matched_candidates:
            for name, full_path in all_md_files:
                name_clean = name.replace(".md", "").replace("_", " ").replace("-", " ")
                name_norm = normalize_text(name_clean)
                
                # Substring matching
                if item_norm in name_norm or name_norm in item_norm:
                    matched_candidates.append(full_path)
        
        # Word-by-word fallback
        if not matched_candidates and len(item_norm.split()) > 1:
            words = [w for w in item_norm.split() if len(w) > 3 and w not in ["bezpieczenstwo", "wdrozenie", "serwer", "zarzadzanie"]]
            if words:
                for name, full_path in all_md_files:
                    name_clean = name.replace(".md", "").replace("_", " ").replace("-", " ")
                    name_norm = normalize_text(name_clean)
                    if all(w in name_norm for w in words):
                        matched_candidates.append(full_path)
        
        # Acronym mapping fallback
        if not matched_candidates:
            acronym_mapping = {
                "gpo": ["gpo.md", "gpresult"],
                "ca": ["ca.md", "szablony certyfikatow", "architektura, administracja i uprawnienia ca"],
                "laps": ["laps.md"],
                "adfs": ["adfs"],
                "bitlocker": ["bitlocker"],
                "wec": ["wec", "forwarding zdarzen"],
                "wsus": ["wsus"],
                "dhcp": ["dhcp"],
                "dns": ["dns"],
                "ipam": ["ipam"],
                "nps": ["nps"],
                "admx": ["admx", "central store"],
                "kms": ["kms"],
                "rsat": ["rsat", "remote server administration tools"],
                "szd": ["szd", "systemy zapobiegania", "fsrm"]
            }
            if item_norm in acronym_mapping:
                for alt_term in acronym_mapping[item_norm]:
                    alt_norm = normalize_text(alt_term)
                    for name, full_path in all_md_files:
                        name_clean = name.replace(".md", "").replace("_", " ").replace("-", " ")
                        name_norm = normalize_text(name_clean)
                        if alt_norm in name_norm:
                            matched_candidates.append(full_path)
                            
        # De-duplicate matches
        best_match = None
        if matched_candidates:
            matched_candidates = list(set(matched_candidates)) # remove duplicates
            matched_candidates.sort(key=lambda p: os.path.getsize(p), reverse=True)
            best_match = matched_candidates[0]
            
        if best_match:
            sanitized_name = clean_filename(item)
            dest_filename = f"{idx:02d}_{sanitized_name}.md"
            dest_filepath = os.path.join(dest_sub_path, dest_filename)
            
            # Read content
            with open(best_match, "r", encoding="utf-8", errors="ignore") as f_src:
                content = f_src.read()
                
            # Clean image reference paths
            cleaned_content = re.sub(r'\(!\[.*?\]\)\(.*?/media/(.*?)\)', r'![Image](../../media/\1)', content)
            cleaned_content = re.sub(r'!\[(.*?)\]\(.*?/media/(.*?)\)', r'![\1](../../media/\2)', cleaned_content)
            cleaned_content = re.sub(r'!\[(.*?)\]\((.*?media/.*?)(\?.*?)\)', r'![\1](\2)', cleaned_content)
            
            # Write to destination
            with open(dest_filepath, "w", encoding="utf-8") as f_dest:
                f_dest.write(cleaned_content)
                
            print(f"  [OK] Matched '{item}' -> {os.path.basename(best_match)} (size: {os.path.getsize(best_match)} bytes) -> Saved as {dest_filename}")
        else:
            print(f"  [MISSING] Could not find any match for '{item}'")
            dest_filename = f"{idx:02d}_{clean_filename(item)}.md"
            dest_filepath = os.path.join(dest_sub_path, dest_filename)
            with open(dest_filepath, "w", encoding="utf-8") as f_dest:
                f_dest.write(f"# {item}\n\nDokumentacja w trakcie opracowywania.\n")

print("\nMigration completed!")
