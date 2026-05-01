import os

file_path = r'c:\Users\motawa\Documents\MediaVault - PH\src\main\ipcHandlers.js'
log_file_path = r'c:\Users\motawa\Documents\MediaVault - PH\ipc_debug.log'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add a logging helper at the top
logging_helper = """
const logToFile = (msg) => {
  try {
    fs.appendFileSync('ipc_debug.log', `[${new Date().toISOString()}] ${msg}\\n`);
  } catch (e) {}
};
"""

if 'const logToFile' not in content:
    # Insert after requires
    content = content.replace("const { getMainWindow } = require('./windowManager');", 
                              "const { getMainWindow } = require('./windowManager');" + logging_helper)

# Add logs to the handlers
content = content.replace("ipcMain.handle('tmdb-search-discover', async (_e, query) => {", 
                          "ipcMain.handle('tmdb-search-discover', async (_e, query) => {\\n    logToFile(`TMDB Search Start: ${query}`);")

content = content.replace("return { results: [...(movies.results || []).map(r => ({ ...r, media_type: 'movie' })), ...(shows.results || []).map(r => ({ ...r, media_type: 'tv' }))] };",
                          "const out = { results: [...(movies.results || []).map(r => ({ ...r, media_type: 'movie' })), ...(shows.results || []).map(r => ({ ...r, media_type: 'tv' }))] };\\n      logToFile(`TMDB Search End: ${out.results.length} results`);\\n      return out;")

content = content.replace("ipcMain.handle('kitsu-search', async (_e, query) => {", 
                          "ipcMain.handle('kitsu-search', async (_e, query) => {\\n    logToFile(`Kitsu Search Start: ${query}`);")

content = content.replace("return { results };",
                          "logToFile(`Kitsu Search End: ${results.length} results`);\\n      return { results };")

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("ipcHandlers.js patched with file logging.")
