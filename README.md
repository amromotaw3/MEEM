<div align="center">

# MediaVault — Own Your Stream

[![Version](https://img.shields.io/badge/version-26.15.0-6366f1?style=for-the-badge)](https://github.com/amromotaw3/MediaVault-Landing/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Android-blue?style=for-the-badge)](https://github.com/amromotaw3/MediaVault-Landing/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)

**The next-generation personal media hub.**
Stream torrents, discover trending content, manage your local library, and watch anime — all in one premium interface.

</div>

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎬 **Local Media Library** | Scan local folders, auto-fetch metadata & posters from TMDB, organize movies & series with smart grouping |
| 🧩 **Stremio Add-on Support** | Install community add-ons to access unlimited content sources with one-click install |
| ⚡ **Torrent Streaming** | Stream torrents in real-time without waiting for full download via WebTorrent |
| 🐉 **Anime Hub** | Dedicated anime section with Jikan API trending and tracking |
| 🔍 **Smart Discover** | Trending movies, trending series, popular, top-rated, upcoming, and anime — powered by TMDB |
| 🔒 **Privacy Vault** | PIN-protected vault to hide private media from the main library |
| 📝 **Subtitle Studio** | Search, download, and sync subtitles from OpenSubtitles with a visual timeline editor |
| 🎵 **Music Player** | Play local music with cover art, metadata display, and volume controls |
| 📺 **DLNA / Casting** | Cast media to smart TVs and devices on the local network |
| 👤 **Multi-Profile** | Multiple user profiles with separate libraries and preferences |
| 🔄 **Auto Updates** | Built-in auto-updater for both PC (electron-updater) and Android (APK download) |
| 🖥️📱 **Cross-Platform** | Windows (Electron) and Android (Capacitor) |
| 🎨 **Premium Dark UI** | Glassmorphism design with Inter font, smooth animations, and responsive layouts |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [Git](https://git-scm.com/)

### Installation

```bash
git clone https://github.com/amromotaw3/MediaVault.git
cd MediaVault
npm install
npm start
```

### Building

**Windows Installer:**
```bash
npm run build
```
Creates a production installer via `electron-builder`.

**Android APK:**
Built via Capacitor — sync and build from the `android/` directory.

---

## 🏗️ Architecture

```
MediaVault/
├── main.js                    # Electron main process entry
├── package.json               # Dependencies & build config
├── capacitor.config.json      # Capacitor (Android) config
│
├── src/
│   ├── main/                  # Main process modules
│   │   ├── ipcHandlers.js     # All IPC handlers (TMDB, files, etc.)
│   │   ├── addons.js          # Stremio add-on engine
│   │   ├── streamer.js        # Torrent streaming & media server
│   │   ├── downloader.js      # Download manager
│   │   ├── libraryScanner.js  # Local media scanner
│   │   ├── subtitles.js       # OpenSubtitles integration
│   │   ├── updater.js         # Auto-update lifecycle
│   │   ├── store.js           # Persistent data store
│   │   ├── windowManager.js   # Window creation & management
│   │   ├── mediaServer.js     # Local media streaming server
│   │   └── discordRPC.js      # Discord Rich Presence
│   │
│   └── renderer/              # Frontend (UI)
│       ├── index.html         # Main application shell
│       ├── renderer.js        # Core UI logic (~11k lines)
│       ├── TMDBService.js     # TMDB API service
│       ├── preload.js         # Electron preload (context bridge)
│       ├── css/               # Stylesheets
│       │   ├── base.css       # Design tokens & variables
│       │   ├── layout.css     # Sidebar, grid, main layout
│       │   ├── components.css # Reusable UI components
│       │   ├── pages.css      # Page-specific styles
│       │   ├── player.css     # Video player styles
│       │   ├── mobile.css     # Android responsive overrides
│       │   └── detail-cinematic.css  # Detail page cinema mode
│       └── js/                # Modular JS
│           ├── bridge.js      # Android Capacitor bridge
│           ├── detail-unified.js
│           ├── recommendation-service.js
│           └── thumbnail-generator.js
│
├── android/                   # Capacitor Android project
├── build_assets/              # Icons & installer assets
├── scripts/                   # Build & utility scripts
└── tests/                     # Test files
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Desktop Runtime | Electron 28+ |
| Mobile Runtime | Capacitor |
| Frontend | Vanilla JS, HTML5, CSS3 |
| Movie Metadata | TMDB API |
| Anime Data | Jikan API, Kitsu API |
| Content Sources | Stremio Addon Protocol |
| Torrent Engine | WebTorrent |
| Auto-Updates | electron-updater |
| Data Storage | electron-store |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built with ❤️ by <strong>Amro Motawa</strong></sub>
</div>
