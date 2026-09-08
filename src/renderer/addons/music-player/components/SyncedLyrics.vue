<template>
  <div class="relative w-full h-full flex flex-col items-center justify-start overflow-hidden select-none px-4 py-8">
    <!-- Loading State -->
    <div v-if="isLyricsLoading" class="flex flex-col items-center justify-center space-y-4 my-auto">
      <div class="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
      <p class="text-sm font-medium text-white/50 tracking-wider">Syncing lyrics from LRCLIB...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="!currentLyrics.length" class="flex flex-col items-center justify-center space-y-3 my-auto text-center px-6">
      <div class="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-2xl mb-2 text-white/40">
        🎵
      </div>
      <p class="text-lg font-bold text-white/80">No synchronized lyrics found</p>
      <p class="text-xs text-white/40 max-w-sm">Enjoy the music or try searching for another track.</p>
    </div>

    <!-- Lyrics Scroll Container -->
    <div
      v-else
      ref="lyricsContainer"
      class="w-full max-w-3xl h-full overflow-y-auto space-y-6 scroll-smooth px-4 py-24 no-scrollbar text-center md:text-left"
    >
      <div
        v-for="(line, index) in currentLyrics"
        :key="line.id"
        :ref="(el) => setLineRef(el, index)"
        @click="seekToLine(line.time)"
        :class="[
          'transition-all duration-500 ease-out cursor-pointer rounded-xl px-4 py-2 select-none group',
          index === activeLyricIndex
            ? 'text-white text-2xl md:text-3xl font-black scale-105 opacity-100 drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]'
            : index < activeLyricIndex
            ? 'text-white/30 text-lg md:text-xl font-semibold hover:text-white/60 hover:opacity-80'
            : 'text-white/50 text-lg md:text-xl font-semibold hover:text-white/80'
        ]"
      >
        <span class="inline-block transition-transform duration-300 group-hover:translate-x-1">
          {{ line.text }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useAudioPlayer } from '../composables/useAudioPlayer';

const { currentLyrics, isLyricsLoading, activeLyricIndex, seek } = useAudioPlayer();

const lyricsContainer = ref<HTMLElement | null>(null);
const lineRefs = ref<HTMLElement[]>([]);

function setLineRef(el: any, index: number) {
  if (el) {
    lineRefs.value[index] = el;
  }
}

function seekToLine(time: number) {
  seek(time);
}

// Automatically scroll active line to center
watch(activeLyricIndex, (newIdx) => {
  if (newIdx >= 0 && lineRefs.value[newIdx]) {
    nextTick(() => {
      lineRefs.value[newIdx].scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });
  }
});
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
