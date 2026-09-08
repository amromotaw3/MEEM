<template>
  <div class="relative min-h-screen bg-neutral-950 text-white select-none pb-28">
    <!-- ── Header & Search ── -->
    <header class="sticky top-0 z-30 bg-neutral-950/80 backdrop-blur-xl border-b border-white/5 px-6 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <span class="text-2xl">🎧</span>
        <h1 class="text-xl font-black tracking-tight text-white">Discover Music</h1>
      </div>

      <!-- Search Input -->
      <div class="relative w-72 md:w-96">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search songs, artists, albums..."
          class="w-full bg-white/5 border border-white/10 rounded-full px-4 py-2 pl-10 text-sm text-white placeholder-white/40 focus:outline-none focus:border-emerald-500 transition-colors"
        />
        <svg class="absolute left-3.5 top-2.5 w-4 h-4 text-white/40 fill-none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
    </header>

    <div class="max-w-7xl mx-auto px-6 py-6 space-y-10">
      <!-- ── Hero Banner ── -->
      <section v-if="!searchQuery && featuredTrack" class="relative rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-gradient-to-r from-emerald-950/60 to-neutral-900/40 p-8 md:p-12 flex flex-col md:flex-row items-center justify-between gap-8">
        <div class="space-y-4 max-w-xl">
          <span class="inline-block px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest rounded-full border border-emerald-500/30">
            Featured Release
          </span>
          <h2 class="text-3xl md:text-5xl font-black text-white tracking-tight leading-tight">
            {{ featuredTrack.title }}
          </h2>
          <p class="text-lg text-white/70 font-medium">by <span class="text-white font-bold">{{ featuredTrack.artist }}</span></p>
          <div class="flex items-center space-x-4 pt-2">
            <button
              @click="play(featuredTrack, trendingTracks)"
              class="flex items-center space-x-2 px-6 py-3 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-black transition-all hover:scale-105 active:scale-95 shadow-lg shadow-emerald-500/20"
            >
              <span>▶ Play Now</span>
            </button>
            <button
              @click="addToQueue(featuredTrack)"
              class="px-5 py-3 rounded-full bg-white/10 hover:bg-white/20 text-white font-bold text-sm border border-white/10 transition-colors"
            >
              + Add to Queue
            </button>
          </div>
        </div>

        <div class="w-56 h-56 md:w-64 md:h-64 rounded-2xl overflow-hidden shadow-2xl border border-white/15 flex-shrink-0">
          <img :src="featuredTrack.coverUrl" :alt="featuredTrack.title" class="w-full h-full object-cover" />
        </div>
      </section>

      <!-- ── Section: Trending Tracks (Horizontal Carousel) ── -->
      <section class="space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-xl font-black text-white tracking-tight">Trending Tracks</h3>
          <span class="text-xs text-white/40 font-semibold uppercase tracking-wider">Scroll for more →</span>
        </div>

        <div class="flex space-x-5 overflow-x-auto pb-4 no-scrollbar scroll-smooth">
          <div
            v-for="track in filteredTrending"
            :key="track.id"
            class="group relative w-44 flex-shrink-0 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-2xl p-3.5 transition-all duration-300 hover:-translate-y-1 shadow-lg"
          >
            <!-- Cover Art with Overlay Play Button -->
            <div class="relative w-full aspect-square rounded-xl overflow-hidden bg-neutral-800 mb-3">
              <img :src="track.coverUrl" :alt="track.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              <button
                @click="play(track, trendingTracks)"
                class="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-emerald-500 text-black flex items-center justify-center font-bold shadow-lg opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0"
              >
                ▶
              </button>
            </div>

            <!-- Title & Artist -->
            <h4 class="text-sm font-bold text-white truncate">{{ track.title }}</h4>
            <p class="text-xs text-white/50 truncate mt-0.5">{{ track.artist }}</p>

            <!-- Actions -->
            <div class="flex items-center justify-between mt-3 pt-2 border-t border-white/5">
              <span class="text-[11px] font-mono text-white/40">{{ formatTime(track.duration) }}</span>
              <button
                @click="downloadTrack(track)"
                :title="track.isOffline ? 'Offline' : 'Download'"
                class="text-xs text-white/40 hover:text-emerald-400 transition-colors"
              >
                {{ track.isOffline ? '✓' : '⬇' }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Section: New Albums (Grid Layout) ── -->
      <section class="space-y-4">
        <h3 class="text-xl font-black text-white tracking-tight">New Albums & Releases</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
          <div
            v-for="album in newAlbums"
            :key="album.id"
            @click="play(album.tracks[0], album.tracks)"
            class="group cursor-pointer bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-2xl p-4 transition-all duration-300 hover:-translate-y-1 shadow-lg"
          >
            <div class="relative aspect-square rounded-xl overflow-hidden bg-neutral-800 mb-3">
              <img :src="album.coverUrl" :alt="album.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span class="w-12 h-12 rounded-full bg-emerald-500 text-black flex items-center justify-center text-xl font-black shadow-xl">▶</span>
              </div>
            </div>
            <h4 class="text-sm font-bold text-white truncate">{{ album.title }}</h4>
            <p class="text-xs text-white/50 truncate mt-0.5">{{ album.artist }} • {{ album.releaseYear || '2026' }}</p>
          </div>
        </div>
      </section>

      <!-- ── Section: Curated Playlists Grid ── -->
      <section class="space-y-4">
        <h3 class="text-xl font-black text-white tracking-tight">Curated Playlists</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-5">
          <div
            v-for="pl in curatedPlaylists"
            :key="pl.id"
            @click="play(pl.tracks[0], pl.tracks)"
            class="group cursor-pointer bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-2xl p-4 transition-all duration-300 hover:-translate-y-1 shadow-lg"
          >
            <div class="relative aspect-square rounded-xl overflow-hidden bg-neutral-800 mb-3">
              <img :src="pl.coverUrl" :alt="pl.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform" />
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <span class="w-12 h-12 rounded-full bg-emerald-500 text-black flex items-center justify-center text-xl font-black shadow-xl">▶</span>
              </div>
            </div>
            <h4 class="text-sm font-bold text-white truncate">{{ pl.title }}</h4>
            <p class="text-xs text-white/50 truncate mt-0.5">{{ pl.description }}</p>
          </div>
        </div>
      </section>
    </div>

    <!-- ── Global Audio Player & Full Screen View ── -->
    <BottomPlayerBar />
    <FullScreenPlayer />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { Track, Playlist, Album } from '../types/music';
import { useAudioPlayer } from '../composables/useAudioPlayer';
import BottomPlayerBar from '../components/BottomPlayerBar.vue';
import FullScreenPlayer from '../components/FullScreenPlayer.vue';

const { play, addToQueue, downloadTrack } = useAudioPlayer();

const searchQuery = ref('');

// ─── DEMO CATALOG ─────────────────────────────────────────────────────────
const trendingTracks = ref<Track[]>([
  {
    id: 'track-1',
    title: 'Starboy',
    artist: 'The Weeknd ft. Daft Punk',
    album: 'Starboy',
    duration: 230,
    url: 'https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=500&auto=format&fit=crop',
    lrc: `[00:00.00]♪ Intro
[00:08.50]I'm tryna put you in the worst mood, ah
[00:12.30]P1 cleaner than your church shoes, ah
[00:16.10]Milli point two just to hurt you, ah
[00:20.00]All red Lamb' just to tease you, ah
[00:24.00]None of these toys on lease too, ah
[00:28.00]Made your whole year in a week too, yah
[00:32.00]Main bitch out your league too, ah
[00:36.00]Side bitch out of your league too, ah
[00:40.00]Look what you've done
[00:44.00]I'm a motherfuckin' starboy`,
  },
  {
    id: 'track-2',
    title: 'Midnight City',
    artist: 'M83',
    album: "Hurry Up, We're Dreaming",
    duration: 244,
    url: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=chill-abstract-intention-12099.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop',
  },
  {
    id: 'track-3',
    title: 'Levitating',
    artist: 'Dua Lipa',
    album: 'Future Nostalgia',
    duration: 203,
    url: 'https://cdn.pixabay.com/download/audio/2022/10/14/audio_9939f792cb.mp3?filename=tuesday-glitch-122703.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop',
  },
  {
    id: 'track-4',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    duration: 200,
    url: 'https://cdn.pixabay.com/download/audio/2021/08/04/audio_bb630cc098.mp3?filename=smoke-143172.mp3',
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop',
  },
]);

const featuredTrack = computed(() => trendingTracks.value[0]);

const filteredTrending = computed(() => {
  if (!searchQuery.value) return trendingTracks.value;
  const q = searchQuery.value.toLowerCase();
  return trendingTracks.value.filter(
    (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
  );
});

const newAlbums = ref<Album[]>([
  {
    id: 'alb-1',
    title: 'After Hours',
    artist: 'The Weeknd',
    releaseYear: 2020,
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&auto=format&fit=crop',
    tracks: trendingTracks.value,
  },
  {
    id: 'alb-2',
    title: 'Future Nostalgia',
    artist: 'Dua Lipa',
    releaseYear: 2021,
    coverUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=500&auto=format&fit=crop',
    tracks: trendingTracks.value,
  },
  {
    id: 'alb-3',
    title: 'Starboy Deluxe',
    artist: 'The Weeknd',
    releaseYear: 2016,
    coverUrl: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?w=500&auto=format&fit=crop',
    tracks: trendingTracks.value,
  },
  {
    id: 'alb-4',
    title: 'Hurry Up, Dreaming',
    artist: 'M83',
    releaseYear: 2011,
    coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop',
    tracks: trendingTracks.value,
  },
]);

const curatedPlaylists = ref<Playlist[]>([
  {
    id: 'pl-1',
    title: 'Lofi Midnight Chill',
    description: 'Relaxing beats to code and study to.',
    coverUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=500&auto=format&fit=crop',
    tracks: trendingTracks.value,
  },
  {
    id: 'pl-2',
    title: 'Synthwave Neon Drive',
    description: 'Retro 80s futuristic electronic energy.',
    coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&auto=format&fit=crop',
    tracks: trendingTracks.value,
  },
  {
    id: 'pl-3',
    title: 'Pop Global Hits',
    description: 'Top trending tracks around the world.',
    coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=500&auto=format&fit=crop',
    tracks: trendingTracks.value,
  },
  {
    id: 'pl-4',
    title: 'Acoustic Coffeehouse',
    description: 'Warm acoustic melodies for cozy days.',
    coverUrl: 'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=500&auto=format&fit=crop',
    tracks: trendingTracks.value,
  },
]);

function formatTime(secs: number): string {
  if (!secs) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
</script>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
