import os
import re
import urllib.parse

media_dir = r"C:\Users\kjaki\Desktop\GIT\devopsai\docs\media"
microsoft_dir = r"C:\Users\kjaki\Desktop\GIT\devopsai\docs\04_Microsoft"

# Compile regex to match link-wrapped images
# Format: [ ![Grafika](path1) ](path2)
link_image_pat = re.compile(r'\[\s*!\[(.*?)\]\((.*?)\)\s*\]\((.*?)\)', re.DOTALL)

# Walk files in docs/04_Microsoft
fixed_count = 0
for root, dirs, files in os.walk(microsoft_dir):
    for f in files:
        if f.endswith(".md"):
            filepath = os.path.join(root, f)
            with open(filepath, "r", encoding="utf-8") as file:
                content = file.read()
            
            modified = False
            
            def replace_mangled(match):
                global fixed_count
                alt = match.group(1)
                p1 = match.group(2).strip()
                p2 = match.group(3).strip()
                
                # Check if p1 is a md/broken link and p2 is an image
                p1_lower = p1.lower()
                p2_lower = p2.lower()
                
                img_path = None
                if p1_lower.endswith(".md") and any(p2_lower.endswith(ext) for ext in [".png", ".jpg", ".jpeg", ".gif"]):
                    img_path = p2
                elif p2_lower.endswith(".md") and any(p1_lower.endswith(ext) for ext in [".png", ".jpg", ".jpeg", ".gif"]):
                    img_path = p1
                    
                if img_path:
                    # URL decode
                    decoded = urllib.parse.unquote(img_path)
                    # Normalize filename: e.g. "Active Directory/image 1.png" -> "Active_Directory_image_1.png"
                    # But wait, Notion exports images in folders like "Active Directory/image 1.png" or "Active Directory/Untitled 1.png"
                    # In docs/media, we have them as "Active_Directory_image_1.png" or "Active_Directory_Untitled_1.png"
                    normalized_name = decoded.replace("/", "_").replace(" ", "_")
                    
                    # Verify if file exists in media
                    media_file_path = os.path.join(media_dir, normalized_name)
                    if os.path.exists(media_file_path):
                        fixed_count += 1
                        return f"![Grafika](../../media/{normalized_name})"
                    else:
                        # Try case insensitive search in media folder
                        for mf in os.listdir(media_dir):
                            if mf.lower() == normalized_name.lower():
                                fixed_count += 1
                                return f"![Grafika](../../media/{mf})"
                
                # If no match, return original
                return match.group(0)
            
            new_content = link_image_pat.sub(replace_mangled, content)
            if new_content != content:
                with open(filepath, "w", encoding="utf-8") as file:
                    file.write(new_content)
                print(f"Fixed mangled images in: {os.path.basename(filepath)}")

print(f"Total mangled images fixed: {fixed_count}")
