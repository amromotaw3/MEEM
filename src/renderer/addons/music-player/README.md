# 🎵 MEEM Music Player Add-on (Spotify-Grade Vue 3 / Nuxt Experience)

A cross-platform, modular **Music Player Add-on** crafted with **Vue 3 Composition API (`<script setup>`)**, **TypeScript**, and **Tailwind CSS**. Replicates a Spotify-grade streaming and offline audio experience.

---

## 🌟 Key Features

### 1. 🎧 Discover Music Page (`views/DiscoverMusic.vue`)
- **Featured Hero Banner**: Dynamic hero section highlighting the latest featured release with 1-click play and queue actions.
- **Horizontal Carousels**: Smooth horizontal scrolling for *Trending Tracks* with hover play buttons and offline indicators.
- **New Albums Grid**: Rich 2-to-4 column responsive grid for album browsing.
- **Curated Playlists Grid**: Atmospheric playlist cards with gradient overlays.
- **Live Search**: Client-side filtering across track titles and artist names.

### 2. 🎛️ Global Audio Player Bar (`components/BottomPlayerBar.vue`)
- **Sticky Glassmorphic Bar**: Persistent bottom player bar (`z-50`) with backdrop blur (`backdrop-blur-2xl`).
- **Full Playback Controls**: Play/Pause, Next/Previous, Shuffle, Repeat (Off, All, One).
- **Interactive Seek Bar**: Live `currentTime` and `duration` tracking with smooth hover indicator.
- **Volume & Mute Control**: Linear slider and 1-click mute toggle.
- **Quick Expand**: Button to open the full-screen visualizer and lyrics view.

### 3. 🎤 Synced Lyrics View (`components/SyncedLyrics.vue` & `components/FullScreenPlayer.vue`)
- **Real-Time Active Line Highlight**: Detects exact audio `currentTime` and scales/illuminates the active lyric line.
- **Auto-Scroll (`scrollIntoView`)**: Smoothly centers the currently active line on screen.
- **Interactive Lyric Seeking**: Click any lyric line to jump playback directly to that timestamp.
- **LRCLIB Integration (`services/lrcParser.ts`)**: Auto-fetches synchronized `.lrc` lyrics from the open-source LRCLIB API with automatic title/artist fallback search.

### 4. 💾 Offline Downloading System (`services/offlineStorage.ts`)
- **IndexedDB Storage**: Saves full audio `Blob` and album cover `Blob` alongside metadata (`title`, `artist`, `album`, `duration`).
- **Live Download Progress**: Tracks streaming download percentages in real-time.
- **Instant Local Playback**: `useAudioPlayer` automatically checks IndexedDB first and streams from `URL.createObjectURL(blob)` when offline.

### 5. 🌙 Sleep Timer (`components/SleepTimerModal.vue`)
- **Presets & End-of-Track Mode**: Set countdowns for 15m, 30m, 45m, 60m, or trigger on track finish.
- **Auto-Pause & Clean Cancellation**: Automatically calls `pause()` and resets state when the countdown expires.

---

## 📂 Architecture & Directory Structure

```
addons/music-player/
├── index.ts                      # Main module entry & exports
├── README.md                     # Comprehensive documentation
├── types/
│   └── music.ts                  # Track, Album, Playlist, LyricLine, SleepTimerState
├── services/
│   ├── lrcParser.ts              # LRC parser & LRCLIB API client
│   └── offlineStorage.ts         # IndexedDB audio & cover storage manager
├── composables/
│   └── useAudioPlayer.ts         # Singleton audio engine & reactive store
├── components/
│   ├── BottomPlayerBar.vue       # Sticky bottom bar UI
│   ├── FullScreenPlayer.vue      # Expanded modal player & ambient background
│   ├── SyncedLyrics.vue          # Auto-scrolling Spotify-style lyrics
│   └── SleepTimerModal.vue       # Countdown & End-of-Track modal
└── views/
    └── DiscoverMusic.vue         # Standalone route page
```

---

## 🚀 Quick Start & Integration

### In a Vue 3 / Nuxt 3 App:

```vue
<!-- App.vue or layouts/default.vue -->
<template>
  <div class="min-h-screen bg-neutral-950">
    <router-view />

    <!-- Global Persistent Music Player -->
    <BottomPlayerBar />
    <FullScreenPlayer />
  </div>
</template>

<script setup lang="ts">
import { BottomPlayerBar, FullScreenPlayer } from './addons/music-player';
</script>
```

### In a Page Route:

```vue
<template>
  <DiscoverMusic />
</template>

<script setup lang="ts">
import { DiscoverMusic } from '@/addons/music-player';
</script>
```

### Using the Audio Composable Directly:

```typescript
import { useAudioPlayer, type Track } from '@/addons/music-player';

const { play, pause, togglePlay, currentTrack, isPlaying } = useAudioPlayer();

const myTrack: Track = {
  id: 'song-1',
  title: 'Starboy',
  artist: 'The Weeknd',
  duration: 230,
  url: 'https://example.com/audio.mp3',
  coverUrl: 'https://example.com/cover.jpg'
};

// Start playback
play(myTrack);
```
