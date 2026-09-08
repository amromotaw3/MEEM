<template>
  <div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
    <div class="relative w-full max-w-sm bg-neutral-900/90 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center space-x-2">
          <span class="text-xl">🌙</span>
          <h3 class="text-lg font-bold text-white tracking-wide">Sleep Timer</h3>
        </div>
        <button
          @click="$emit('close')"
          class="p-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-colors"
        >
          <svg class="w-5 h-5 fill-none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Active Timer Status -->
      <div v-if="sleepTimer.isActive" class="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center space-y-1">
        <p class="text-xs uppercase font-bold tracking-widest text-emerald-400">Timer Running</p>
        <p v-if="sleepTimer.mode === 'end_of_track'" class="text-lg font-black text-white">At End of Track</p>
        <p v-else class="text-2xl font-black font-mono text-emerald-300">
          {{ formattedRemaining }}
        </p>
        <button
          @click="cancelSleepTimer"
          class="mt-2 text-xs font-semibold text-red-400 hover:text-red-300 hover:underline"
        >
          Turn Off Timer
        </button>
      </div>

      <!-- Preset Options -->
      <div class="grid grid-cols-1 gap-2.5">
        <button
          v-for="preset in presets"
          :key="preset.label"
          @click="selectPreset(preset.val)"
          class="flex items-center justify-between px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 transition-all group"
        >
          <span class="text-sm font-semibold text-white/90 group-hover:text-white">{{ preset.label }}</span>
          <span class="text-xs text-white/40 group-hover:text-emerald-400 font-bold">Set</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAudioPlayer } from '../composables/useAudioPlayer';

const emit = defineEmits(['close']);
const { sleepTimer, setSleepTimer, cancelSleepTimer } = useAudioPlayer();

const presets: Array<{ label: string; val: number | 'end_of_track' }> = [
  { label: '15 Minutes', val: 15 },
  { label: '30 Minutes', val: 30 },
  { label: '45 Minutes', val: 45 },
  { label: '60 Minutes', val: 60 },
  { label: 'End of Track', val: 'end_of_track' },
];

const formattedRemaining = computed(() => {
  const total = sleepTimer.value.remainingSeconds;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
});

function selectPreset(val: number | 'end_of_track') {
  setSleepTimer(val);
  emit('close');
}
</script>
