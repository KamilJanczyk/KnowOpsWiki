import os
import unicodedata

backup_dir = r"C:\Users\kjaki\Desktop\GIT\_kopie\kopie\www_wiki_md_backup_2026-08-26\docs_backup_before_dedup"
output_file = r"C:\Users\kjaki\Desktop\GIT\devopsai\scratch\microsoft_source_files_report.txt"

# Target mapping requested by user
target_mapping = {
    "01_Architektura_Teoria_i_Wdrozenie_AD": [
        "Active Directory - Architektura, Bezpieczeństwo i Teoria (Standard 2026)",
        "Active Directory & M365 - Kompletna Checklista Wdrożeniowa i Hardening",
        "Active Directory & Hybryda 2026 - Kompleksowy Przewodnik Wdrożenia",
        "RODC (Read-Only Domain Controller)",
        "Relacje zaufania [teoria]",
        "Wyświetlanie nazwy użytkownika"
    ],
    "02_Bezpieczenstwo_i_Uprawnienia_AD": [
        "AD - delegowanie uprawnień",
        "JEA - Just Enough Administration",
        "Blokowanie dodawania kont komputerów",
        "Bezpieczeństwo",
        "Zmiana domyślnej ścieżki pojawiania się kont KOMPUTERÓW",
        "Dodawanie komputera do domeny offline",
        "Zabezpieczenie środowiska przed zaszyfrowaniem",
        "Monitorowanie logowań"
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
        "AAD", "ENTRA", "Tenant", "CHMURA AZURE"
    ],
    "07_Zarzadzanie_Urzadzeniami_Endpoint_Management": [
        "INTUNE", "SCCM", "MECM"
    ],
    "08_Uslugi_SaaS_i_Wspolpraca": [
        "SHAREPOINT", "TEAMS", "COPILOT"
    ],
    "09_Pamiec_Masowa_i_Serwery_Plikow": [
        "iSCSI", "Serwer Plików", "NTFS", "SMB", "SŻD", "Foldery robocze", "FSRM", "DFS", "Home Folder", "BranchCache", "Migawki plików"
    ],
    "10_Wirtualizacja_Srodowiska_Pracy": [
        "Dostęp zdalny", "VPN i DirectAccess", "RDS", "VDI", "Skrypt czyszczący drukarki"
    ],
    "11_Uslugi_Aplikacyjne_i_Serwerowe_Niezalezne_od_AD": [
        "IIS", "FTP", "Serwer Wydruku", "Serwer SMTP"
    ],
    "12_OS_Zarzadzanie_Dyskami_i_Wdrozenia": [
        "Windows RE", "MBR do GPT"
    ],
    "13_OS_Diagnostyka_i_Utrzymanie_Serwisu": [
        "Synchronizacja czasu", "Defender limits", "MRT", "Sprawdzanie klucza", "Aktywacja", "Test RAM", "Resource Monitor"
    ],
    "14_OS_Profil_Konfiguracja_i_Drukarki": [
        "Drukowanie z folderu", "Problem z wyłączaniem", "Bufor wydruku", "Wyłączenie zarządzania drukarkami", "Autologowanie bez hasła", "Ctrl+Alt+Del", "Hibernacja"
    ],
    "15_OS_Automatyzacja_i_Skrypty_Klienckie": [
        "WINGET", "Aktualizowanie systemu", "xcopy", "Odblokowanie ExecutionPolicy"
    ]
}

def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('utf-8').lower()

all_md_files = []
for root, dirs, files in os.walk(backup_dir):
    for f in files:
        if f.lower().endswith(".md"):
            all_md_files.append((f, os.path.join(root, f)))

out = []
out.append(f"Total md files found in backup: {len(all_md_files)}")

results = {}
for target_sub, items in target_mapping.items():
    results[target_sub] = []
    out.append(f"\n=========================================\nSUBFOLDER: {target_sub}\n=========================================")
    for item in items:
        matched = []
        item_norm = normalize_text(item)
        for name, full_path in all_md_files:
            name_clean = name.replace(".md", "").replace("_", " ").replace("-", " ")
            name_norm = normalize_text(name_clean)
            if item_norm in name_norm or name_norm in item_norm:
                matched.append((name, full_path))
        
        # If no direct match, try a fallback of matching word by word
        if not matched and len(item_norm.split()) > 1:
            words = [w for w in item_norm.split() if len(w) > 3]
            for name, full_path in all_md_files:
                name_clean = name.replace(".md", "").replace("_", " ").replace("-", " ")
                name_norm = normalize_text(name_clean)
                if all(w in name_norm for w in words):
                    matched.append((name, full_path))
                    
        results[target_sub].append((item, matched))
        if matched:
            out.append(f"  - '{item}' -> MATCHED:")
            for m in matched:
                out.append(f"      * Name: {m[0]}")
                out.append(f"        Path: {m[1]}")
        else:
            out.append(f"  - '{item}' -> NOT MATCHED")

with open(output_file, "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print("Report generated successfully in scratch/microsoft_source_files_report.txt")
