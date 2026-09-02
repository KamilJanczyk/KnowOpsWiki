import os
import unicodedata

backup_dirs = [
    r"C:\Users\kjaki\Desktop\GIT\_kopie\kopie\www_wiki_md_backup_2026-08-26\docs_backup_before_dedup",
    r"C:\Users\kjaki\Desktop\GIT\_kopie\kopie\www_wiki_md_backup_2026-08-26\docs",
    r"C:\Users\kjaki\Desktop\GIT\_kopie\wiki",
    r"C:\Users\kjaki\Desktop\GIT\_kopie\wiki_wsad",
    r"C:\Users\kjaki\Desktop\GIT\_kopie\Notion_git_wiki"
]
output_file = r"C:\Users\kjaki\Desktop\GIT\devopsai\scratch\missing_matches_report.txt"

search_queries = {
    "znajdz konta bez wygasniecia hasla": ["wygas", "neverexpire", "expire"],
    "Naprawa polaczen AD": ["napraw", "polacz", "secure", "channel", "trust"],
    "Z MBR do GPT": ["mbr", "gpt", "mbr2gpt"],
    "Wylaczenie zarzadzania drukarkami": ["drukark", "manage", "wylacz"],
    "Hibernacja": ["hibern", "powercfg"],
    "Odblokowanie ExecutionPolicy": ["execution", "policy", "bypass", "unrestricted", "odblok", "skrypt"]
}

def normalize_text(text):
    return unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('utf-8').lower().strip()

# Scan files
all_md_files = []
for b_dir in backup_dirs:
    if os.path.exists(b_dir):
        for root, dirs, files in os.walk(b_dir):
            for f in files:
                if f.lower().endswith(".md"):
                    all_md_files.append((f, os.path.join(root, f)))

out = []
out.append(f"Loaded {len(all_md_files)} files. Starting search...")

for term, keywords in search_queries.items():
    out.append(f"\nSearching for: '{term}' (keywords: {keywords})")
    matches = []
    for name, full_path in all_md_files:
        name_clean = normalize_text(name)
        for kw in keywords:
            kw_norm = normalize_text(kw)
            if kw_norm in name_clean:
                matches.append((name, full_path, kw_norm))
                
    # Filter unique matches
    unique_matches = {}
    for name, full_path, kw in matches:
        if full_path not in unique_matches:
            unique_matches[full_path] = (name, kw)
            
    if unique_matches:
        for path, (name, kw) in unique_matches.items():
            out.append(f"  - MATCH [{kw}]: {name}")
            out.append(f"    Path: {path}")
    else:
        out.append("  - NO MATCHES FOUND")

with open(output_file, "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print("Results written to scratch/missing_matches_report.txt")
