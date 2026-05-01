import os

file_path = r'c:\Users\motawa\Documents\MediaVault - PH\src\renderer\renderer.js'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Target for replacement: The code block in performDiscoverSearch that calculates allResults
old_block = """      const allResults = [
        ...(tmdbResult.status === 'fulfilled' ? (tmdbResult.value.results || []) : []),
        ...(kitsuResult.status === 'fulfilled' ? (kitsuResult.value.results || []) : [])
      ];"""

new_block = """      console.log('[Search] TMDB fulfilled:', tmdbResult.status === 'fulfilled', 'Value:', tmdbResult.value);
      console.log('[Search] Kitsu fulfilled:', kitsuResult.status === 'fulfilled', 'Value:', kitsuResult.value);
      
      const allResults = [
        ...(tmdbResult.status === 'fulfilled' ? (tmdbResult.value?.results || []) : []),
        ...(kitsuResult.status === 'fulfilled' ? (kitsuResult.value?.results || []) : [])
      ];"""

if old_block in content:
    content = content.replace(old_block, new_block)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Renderer patched successfully (Failsafe + Logging).")
else:
    # Try more flexible search
    if 'const allResults =' in content and 'tmdbResult.value.results' in content:
        import re
        pattern = r'const allResults = \[[\s\S]+?\];'
        if re.search(pattern, content):
            content = re.sub(pattern, new_block, content)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print("Renderer patched successfully (via regex).")
        else:
            print("Could not find allResults block.")
    else:
        print("Anchor not found in renderer.js")
