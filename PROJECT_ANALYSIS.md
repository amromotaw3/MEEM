# MediaVault — Technical Project Analysis & Database Schema

This document contains a comprehensive analysis of the MediaVault application, covering its architecture, codebase structure, landing page configuration, and Supabase database schema.

---

## 🖥️ 1. Project Overview & Architecture

MediaVault is a multi-platform personal media hub allowing users to stream torrents, utilize Stremio add-ons, scan local media, browse anime/manga, and watch media together. It consists of two active repositories:

1. **MediaVault (Main App):** Hybrid application built using Electron (Desktop) and Capacitor (Android).
2. **MediaVault Landing Page:** Single-page marketing/download site built with vanilla HTML, CSS, and JS.

### Directory Structure (Main App)
```
MediaVault/
├── main.js                    # Electron main process entry
├── package.json               # Dependencies & build config
├── capacitor.config.json      # Capacitor (Android) config
│
├── src/
│   ├── main/                  # Main process modules (Node.js)
│   │   ├── StremioAddonService.js
│   │   ├── SubtitleManager.js
│   │   ├── TraktService.js
│   │   ├── addons.js          # Stremio add-on engine
│   │   ├── streamer.js        # Torrent streaming & P2P
│   │   ├── downloader.js      # Download manager
│   │   ├── libraryScanner.js  # Local media scanner
│   │   ├── subtitles.js       # OpenSubtitles integration
│   │   ├── store.js           # Persistent data store (electron-store)
│   │   ├── windowManager.js   # Window creation & management
│   │   └── mediaServer.js     # Local media streaming server
│   │
│   └── renderer/              # Frontend (UI)
│       ├── index.html         # Main application shell
│       ├── renderer.js        # Core UI logic (~11k lines of vanilla JS)
│       ├── TMDBService.js     # TMDB API service
│       ├── preload.js         # Electron preload (context bridge)
│       └── css/               # Modular stylesheets
│
├── android/                   # Capacitor Android project
├── supabase/                  # Supabase configs & migrations
└── build_assets/              # Icons & installer assets
```

---

## 🗄️ 2. Supabase Database Schema

The database backend runs on Postgres on Supabase (Project ID: `vvjnkgdrhyxilnderjdy`). Row-Level Security (RLS) is enabled on all tables.

### 📊 Table Definitions

#### 1. `public.users_accounts`
Stores primary user accounts, subscriptions, third-party API integration keys, and settings.
* **`id`** (`uuid`, Primary Key): Default `gen_random_uuid()`
* **`email`** (`text`, Unique): Cleaned and lowered user email.
* **`password_hash`** (`text`): Encrypted password using `pgcrypto` (bcrypt).
* **`role`** (`text`): User role, defaults to `'user'` (admin for superuser).
* **`max_devices`** (`integer`): Max allowed simultaneous active devices (defaults to 3).
* **`subscription_expires_at`** (`timestamptz`): Expiration date (defaults to 30 days after creation).
* **`is_banned`** (`boolean`): If true, blocks all logins.
* **`created_at`** (`timestamptz`): Account creation time.
* **API Keys:**
  * `tmdb_api_key` (`text`, nullable)
  * `subdl_api_key` (`text`, nullable)
  * `fanart_api_key` (`text`, nullable)
* **Trakt Integration:**
  * `trakt_access_token` (`text`, nullable)
  * `trakt_refresh_token` (`text`, nullable)
  * `trakt_created_at` (`bigint`, nullable)
  * `trakt_expires_in` (`integer`, nullable)
* **SubDL Subtitles Preferences:**
  * `subdl_enabled` (`boolean`, default: `false`)
  * `subdl_languages` (`text`, default: `'AR,EN'`)
  * `subdl_hearing_impairment` (`text`, default: `'hiInclude'`)

#### 2. `public.user_devices`
Tracks active hardware devices logged into user accounts to enforce the device limit.
* **`id`** (`uuid`, Primary Key)
* **`user_id`** (`uuid`): Foreign Key referencing `users_accounts.id`
* **`hardware_id`** (`text`): Unique system hardware identifier.
* **`device_name`** (`text`): Friendly name of the device.
* **`created_at`** (`timestamptz`)

#### 3. `public.hardware_blacklist`
Blocks specific devices globally from authenticating.
* **`hardware_id`** (`text`, Primary Key): Banned hardware fingerprint.
* **`reason`** (`text`): Context for the blacklist.
* **`is_banned`** (`boolean`, default `true`)
* **`banned_at`** (`timestamptz`, default `now()`)

#### 4. `public.account_profiles`
Multi-profile system mapping to a single account (similar to Netflix).
* **`id`** (`uuid`, Primary Key)
* **`user_id`** (`uuid`): Foreign Key referencing `users_accounts.id`
* **`name`** (`text`): Profile name.
* **`avatar`** (`text`): Path to avatar icon.
* **`profile_pin`** (`text`): Optional PIN lock.
* **`max_age_rating`** (`integer`, default `18`): Content age restriction filter.
* **`watchlist`** (`jsonb`, default `'[]'`): Saved watchlist items.
* **`pinned`** (`jsonb`, default `'[]'`): Pinned items list.
* **`playback`** (`jsonb`, default `'{}'`): UI playback settings.
* **`locked_items`** (`jsonb`, default `'[]'`): Locked folders/media items.

#### 5. `public.continue_watching`
Tracks user playback progress.
* **`profile_id`** (`uuid`): FK referencing `account_profiles.id`
* **`media_id`** (`text`): Unique identifier of movie/episode.
* **`last_position_seconds`** (`integer`, default `0`)
* **`updated_at`** (`timestamptz`)

#### 6. `public.movie_requests`
Allows users to request media additions.
* **`id`** (`uuid`, Primary Key)
* **`user_id`** (`uuid`): FK referencing `users_accounts.id`
* **`title`** (`text`): Title requested.
* **`status`** (`text`, default `'open'`): Request status.

#### 7. `public.media_content` & `public.image_cache`
Caching layer tables for media catalog data and resolved poster URLs.

---

## ⚙️ 3. Key Database Procedures (RPCs)

Supabase contains SQL functions running with `SECURITY DEFINER` to let the frontend execute secure transactions safely:

### 1. `public.handle_register(email text, password text, hardware_id text)`
Inserts a new user record.
* Normalizes email to lowercase.
* Uses Blowfish-encrypted hashing (`pgcrypto.crypt`) for password security.
* Grants `admin` and unlimited devices (`max_devices = 9999`) to `amro.motawa@icloud.com`.
* Grants `user` and `max_devices = 2` with 30-day trials to other signups.

### 2. `public.handle_secure_login(email text, password text, hardware_id text)`
Logs in the user and registers their device if permitted.
* Rejects authentication if the `hardware_id` matches a record in `hardware_blacklist`.
* Rejects authentication if `users_accounts.is_banned` is true.
* Verifies password hash.
* Checks how many devices are currently registered in `user_devices` for this account. If the device is new and the count exceeds `max_devices`, it throws `DEVICE_LIMIT_REACHED`.
* If validation succeeds, registers the device (if not already listed) and returns the user details and profiles.

---

## 🛠️ 4. Active Migration Registry

The Supabase project runs the following migrations in order:
1. `20260522112119_drop_and_recreate_hardware_ban`
2. `20260522112130_fix_device_session_func`
3. `20260522112714_fix_rpc_parameter_names`
4. `20260525134338_fix_mediavault_cloud_core_v4`

---

## 🌐 5. Landing Page Details

* **Repository:** `MediaVault landing page`
* **Tech Stack:** Vanilla HTML, CSS, and JS.
* **Latest Release API:** Queries `https://api.github.com/repos/amromotaw3/MediaVault-Landing/releases/latest` to parse asset lists, automatically updating Windows (`.exe`) and Android (`.apk`) download links along with the version badge text on load.
* **Design Philosophy:** Dark theme, glassmorphism, floating blur background mesh blobs, smooth page scroll offsets.
