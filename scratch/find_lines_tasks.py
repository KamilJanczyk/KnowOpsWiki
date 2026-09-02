import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('public/app.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, l in enumerate(lines, start=1):
    l_lower = l.lower()
    if 'task' in l_lower or 'add' in l_lower or 'modal' in l_lower:
        if 'console' not in l_lower and 'render' not in l_lower:
            print(f"{i}: {l.strip()}")
