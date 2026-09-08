<template>
  <div
    v-if="isFullScreen && currentTrack"
    class="fixed inset-0 z-[80] flex flex-col bg-neutral-950 select-none overflow-hidden transition-all duration-500 animate-in fade-in"
  >
    <!-- Dynamic Ambient Backdrop Blur Glow -->
    <div
      class="absolute inset-0 opacity-30 blur-3xl scale-125 pointer-events-none transition-all duration-1000"
      :style="{
        backgroundImage: currentTrack.coverUrl ? `url('${currentTrack.coverUrl}')` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }"
    ></div>
    <div class="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/80 to-neutral-950/40 pointer-events-none"></div>

    <!-- ── Top Bar ── -->
    <header class="relative z-10 flex items-center justify-between px-6 py-5">
      <button
        @click="toggleFullScreen(false)"
        class="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/70 hover:text-white transition-all shadow-md"
        title="Minimize"
      >
        <svg class="w-6 h-6 fill-none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <!-- View Switcher -->
      <div class="flex items-center bg-white/10 p-1 rounded-full backdrop-blur-md border border-white/10 text-xs font-bold">
        <button
          @click="activeTab = 'art'"
          :class="['px-4 py-1.5 rounded-full transition-all', activeTab === 'art' ? 'bg-white text-black shadow-lg' : 'text-white/60 hover:text-white']"
        >
          Cover Art
        </button>
        <button
          @click="activeTab = 'lyrics'"
          :class="['px-4 py-1.5 rounded-full transition-all', activeTab === 'lyrics' ? 'bg-white text-black shadow-lg' : 'text-white/60 hover:text-white']"
        >
          Lyrics
        </button>
      </div>

      <button
        @click="showSleepModal = true"
        :class="['p-2 rounded-full transition-colors', sleepTimer.isActive ? 'text-emerald-400 bg-emerald-500/10' : 'text-white/70 bg-white/5 hover:bg-white/15']"
        title="Sleep Timer"
      >
        🌙
      </button>
    </header>

    <!-- ── Main Content Area ── -->
    <main class="relative z-10 flex-1 flex flex-col md:flex-row items-center justify-center p-6 md:p-12 gap-8 md:gap-16 min-h-0">
      <!-- Mode: Cover Art View -->
      <div
        v-if="activeTab === 'art'"
        class="w-full h-full flex flex-col items-center justify-center max-w-md animate-in zoom-in-95 duration-300"
      >
        <div class="relative w-72 h-72 md:w-96 md:h-96 rounded-3xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.8)] border border-white/10 group">
          <img
            v-if="currentTrack.coverUrl"
            :src="currentTrack.coverUrl"
            :alt="currentTrack.title"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-7xl bg-neutral-900">
            🎵
          </div>
        </div>
      </div>

      <!-- Mode: Lyrics View (Spotify Style) -->
      <div
        v-else-if="activeTab === 'lyrics'"
        class="w-full h-full flex-1 max-w-4xl animate-in fade-in duration-300"
      >
        <SyncedLyrics />
      </div>
    </main>

    <!-- ── Bottom Control Deck ── -->
    <footer class="relative z-10 w-full max-w-4xl mx-auto px-6 pb-8 pt-2 space-y-4">
      <!-- Title & Download Action -->
      <div class="flex items-center justify-between">
        <div class="min-w-0 flex-1">
          <h2 class="text-2xl md:text-3xl font-black text-white truncate tracking-tight">
            {{ currentTrack.title }}
          </h2>
          <p class="text-base text-white/60 font-medium truncate mt-0.5">{{ currentTrack.artist }}</p>
        </div>

        <button
          @click="handleDownload"
          class="flex items-center space-x-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 text-white text-xs font-bold transition-all ml-4"
        >
          <span v-if="currentTrack.isOffline" class="text-emerald-400 font-bold">✓ Saved Offline</span>
          <span v-else>⬇ Download</span>
        </button>
      </div>

      <!-- Seek Bar -->
      <div class="space-y-1">
        <div
          class="relative w-full h-2 bg-white/10 rounded-full cursor-pointer group py-2"
          @click="handleSeek"
        >
          <div class="absolute top-2 left-0 h-2 bg-white/20 rounded-full w-full"></div>
          <div
            class="absolute top-2 left-0 h-2 bg-white group-hover:bg-emerald-400 rounded-full transition-colors"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>
        <div class="flex justify-between text-xs font-mono text-white/40">
          <span>{{ formatTime(currentTime) }}</span>
          <span>{{ formatTime(duration) }}</span>
        </div>
      </div>

      <!-- Playback Buttons -->
      <div class="flex items-center justify-center space-x-8 md:space-x-12 pt-2">
        <button
          @click="toggleShuffle"
          :class="['text-xl transition-colors', isShuffle ? 'text-emerald-400' : 'text-white/40 hover:text-white']"
        >
          🔀
        </button>
        <button @click="previous" class="text-2xl text-white/80 hover:text-white transition-transform active:scale-90">
          ⏮
        </button>
        <button
          @click="togglePlay"
          class="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center font-black text-2xl hover:scale-105 active:scale-95 transition-transform shadow-xl shadow-white/20"
        >
          <div v-if="isLoading" class="w-6 h-6 border-3 border-black border-t-transparent rounded-full animate-spin"></div>
          <span v-else-if="isPlaying">⏸</span>
          <span v-else class="ml-1">▶</span>
        </button>
        <button @click="next" class="text-2xl text-white/80 hover:text-white transition-transform active:scale-90">
          ⏭
        </button>
        <button
          @click="toggleRepeat"
          :class="['text-xl transition-colors', repeatMode !== 'off' ? 'text-emerald-400 font-bold' : 'text-white/40 hover:text-white']"
        >
          {{ repeatMode === 'one' ? '🔂' : '🔁' }}
        </button>
      </div>
    </footer>

    <!-- Sleep Timer Modal -->
    <SleepTimerModal v-if="showSleepModal" @close="showSleepModal = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useAudioPlayer } from '../composables/useAudioPlayer';
import SyncedLyrics from './SyncedLyrics.vue';
import SleepTimerModal from './SleepTimerModal.vue';

const activeTab = ref<'art' | 'lyrics'>('art');
const showSleepModal = ref(false);

const {
  currentTrack,
  isPlaying,
  isLoading,
  currentTime,
  duration,
  progressPercent,
  repeatMode,
  isShuffle,
  isFullScreen,
  sleepTimer,
  togglePlay,
  seek,
  next,
  previous,
  toggleRepeat,
  toggleShuffle,
  toggleFullScreen,
  downloadTrack,
} = useAudioPlayer();

function handleSeek(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  seek(pct * (duration.value || 0));
}

function handleDownload() {
  if (currentTrack.value && !currentTrack.value.isOffline) {
    downloadTrack(currentTrack.value);
  }
}

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
</script>
