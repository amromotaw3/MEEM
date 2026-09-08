<template>
  <div
    v-if="currentTrack"
    class="fixed bottom-0 left-0 right-0 z-50 h-20 bg-neutral-950/85 backdrop-blur-2xl border-t border-white/10 px-4 md:px-6 flex items-center justify-between select-none shadow-[0_-10px_30px_rgba(0,0,0,0.5)] transition-all duration-300"
  >
    <!-- ── LEFT: Track Info ── -->
    <div class="flex items-center space-x-3.5 min-w-0 w-1/4 max-w-[280px]">
      <div
        @click="toggleFullScreen(true)"
        class="relative w-12 h-12 rounded-lg overflow-hidden bg-neutral-800 flex-shrink-0 cursor-pointer group shadow-md"
      >
        <img
          v-if="currentTrack.coverUrl"
          :src="currentTrack.coverUrl"
          :alt="currentTrack.title"
          class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
        />
        <div v-else class="w-full h-full flex items-center justify-center text-xl bg-neutral-800">
          🎵
        </div>
        <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
          <span class="text-xs text-white">▲</span>
        </div>
      </div>

      <div class="min-w-0 flex-1">
        <h4
          @click="toggleFullScreen(true)"
          class="text-sm font-bold text-white truncate cursor-pointer hover:underline"
        >
          {{ currentTrack.title }}
        </h4>
        <p class="text-xs text-white/50 truncate">{{ currentTrack.artist }}</p>
      </div>

      <!-- Offline Download Icon -->
      <button
        @click="handleDownload"
        :title="currentTrack.isOffline ? 'Downloaded Offline' : 'Download Track'"
        class="p-1.5 text-white/50 hover:text-white transition-colors"
      >
        <span v-if="currentTrack.isOffline" class="text-emerald-400 text-sm font-bold">✓</span>
        <span v-else-if="downloadProgress !== undefined" class="text-xs font-mono text-emerald-400">
          {{ downloadProgress }}%
        </span>
        <svg v-else class="w-4 h-4 fill-none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </button>
    </div>

    <!-- ── CENTER: Controls & Progress ── -->
    <div class="flex flex-col items-center justify-center flex-1 max-w-xl px-4 space-y-1">
      <!-- Button Row -->
      <div class="flex items-center space-x-4 md:space-x-6">
        <!-- Shuffle -->
        <button
          @click="toggleShuffle"
          :class="['p-1 transition-colors', isShuffle ? 'text-emerald-400' : 'text-white/40 hover:text-white']"
          title="Shuffle"
        >
          🔀
        </button>

        <!-- Prev -->
        <button
          @click="previous"
          class="p-1 text-white/70 hover:text-white transition-colors"
          title="Previous"
        >
          ⏮
        </button>

        <!-- Play / Pause -->
        <button
          @click="togglePlay"
          class="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center font-black hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-white/20"
        >
          <div v-if="isLoading" class="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
          <span v-else-if="isPlaying" class="text-sm">⏸</span>
          <span v-else class="text-sm ml-0.5">▶</span>
        </button>

        <!-- Next -->
        <button
          @click="next"
          class="p-1 text-white/70 hover:text-white transition-colors"
          title="Next"
        >
          ⏭
        </button>

        <!-- Repeat -->
        <button
          @click="toggleRepeat"
          :class="['p-1 text-xs transition-colors', repeatMode !== 'off' ? 'text-emerald-400 font-bold' : 'text-white/40 hover:text-white']"
          :title="`Repeat: ${repeatMode}`"
        >
          {{ repeatMode === 'one' ? '🔂' : '🔁' }}
        </button>
      </div>

      <!-- Seek Bar -->
      <div class="w-full flex items-center space-x-2 text-[11px] font-mono text-white/40">
        <span>{{ formatTime(currentTime) }}</span>
        <div
          class="relative flex-1 h-1 bg-white/10 rounded-full cursor-pointer group py-2"
          @click="handleSeek"
        >
          <div class="absolute top-2 left-0 h-1 bg-white/30 rounded-full w-full"></div>
          <div
            class="absolute top-2 left-0 h-1 bg-white group-hover:bg-emerald-400 rounded-full transition-colors"
            :style="{ width: `${progressPercent}%` }"
          ></div>
          <div
            class="absolute top-1 -ml-1.5 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow"
            :style="{ left: `${progressPercent}%` }"
          ></div>
        </div>
        <span>{{ formatTime(duration) }}</span>
      </div>
    </div>

    <!-- ── RIGHT: Volume & Utilities ── -->
    <div class="flex items-center justify-end space-x-3 w-1/4 max-w-[280px]">
      <!-- Lyrics Modal Toggle -->
      <button
        @click="toggleFullScreen(true)"
        class="p-1.5 text-white/50 hover:text-white transition-colors"
        title="Lyrics & Visualizer"
      >
        🎤
      </button>

      <!-- Sleep Timer Toggle -->
      <button
        @click="showSleepModal = true"
        :class="['relative p-1.5 transition-colors', sleepTimer.isActive ? 'text-emerald-400' : 'text-white/50 hover:text-white']"
        title="Sleep Timer"
      >
        🌙
        <span v-if="sleepTimer.isActive" class="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
      </button>

      <!-- Volume -->
      <div class="hidden md:flex items-center space-x-2 group">
        <button @click="toggleMute" class="text-white/50 hover:text-white text-xs">
          {{ isMuted || volume === 0 ? '🔇' : '🔊' }}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="isMuted ? 0 : volume"
          @input="onVolumeChange"
          class="w-20 h-1 accent-emerald-400 bg-white/20 rounded-lg cursor-pointer"
        />
      </div>

      <!-- Expand Button -->
      <button
        @click="toggleFullScreen(true)"
        class="p-1.5 text-white/50 hover:text-white transition-colors ml-1"
        title="Full Screen"
      >
        ⛶
      </button>
    </div>

    <!-- Sleep Timer Modal -->
    <SleepTimerModal v-if="showSleepModal" @close="showSleepModal = false" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useAudioPlayer } from '../composables/useAudioPlayer';
import SleepTimerModal from './SleepTimerModal.vue';

const showSleepModal = ref(false);

const {
  currentTrack,
  isPlaying,
  isLoading,
  currentTime,
  duration,
  progressPercent,
  volume,
  isMuted,
  repeatMode,
  isShuffle,
  sleepTimer,
  downloadProgressMap,
  togglePlay,
  seek,
  next,
  previous,
  setVolume,
  toggleMute,
  toggleRepeat,
  toggleShuffle,
  toggleFullScreen,
  downloadTrack,
} = useAudioPlayer();

const downloadProgress = computed(() => {
  if (!currentTrack.value) return undefined;
  return downloadProgressMap.value[currentTrack.value.id];
});

function handleSeek(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, clickX / rect.width));
  seek(pct * (duration.value || 0));
}

function onVolumeChange(e: Event) {
  const val = parseFloat((e.target as HTMLInputElement).value);
  setVolume(val);
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
