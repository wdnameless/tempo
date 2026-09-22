import { getPref, setPref } from './settings';
import { I18nService } from './i18n';

export type FocusSoundId = 'none' | 'brown' | 'white' | 'rain' | 'cafe';

export interface FocusSound {
  id: FocusSoundId;
  label: string;
}

/**
 * List of available focus sounds.
 * Labels are localized dynamically via getters or helper functions, but the
 * frozen interface provides `FOCUS_SOUNDS` with descriptive labels.
 */
export const FOCUS_SOUNDS: readonly FocusSound[] = [
  { id: 'none', label: 'focusSoundNone' },
  { id: 'brown', label: 'focusSoundBrown' },
  { id: 'white', label: 'focusSoundWhite' },
  { id: 'rain', label: 'focusSoundRain' },
  { id: 'cafe', label: 'focusSoundCafe' },
] as const;

/** Resolves localized label for a focus sound ID. */
export function getFocusSoundLabel(id: FocusSoundId): string {
  const t = I18nService.t();
  switch (id) {
    case 'none':
      return t.focusSoundNone;
    case 'brown':
      return t.focusSoundBrown;
    case 'white':
      return t.focusSoundWhite;
    case 'rain':
      return t.focusSoundRain;
    case 'cafe':
      return t.focusSoundCafe;
    default:
      return id;
  }
}

const PREF_KEY = 'tempo_focus_sound';
const VALID_SOUND_IDS: readonly FocusSoundId[] = ['none', 'brown', 'white', 'rain', 'cafe'];

function isValidSoundId(val: unknown): val is FocusSoundId {
  return typeof val === 'string' && VALID_SOUND_IDS.includes(val as FocusSoundId);
}

/**
 * Returns the currently configured focus sound from persistent settings.
 * Defaults to 'none' if unset or invalid.
 */
export function currentFocusSound(): FocusSoundId {
  const saved = getPref<string>(PREF_KEY, 'none');
  if (isValidSoundId(saved)) {
    return saved;
  }
  return 'none';
}

// WebAudio playback state
let audioCtx: AudioContext | null = null;
let currentPlayingId: FocusSoundId = 'none';
let activeSourceNodes: AudioNode[] = [];
let gainNode: GainNode | null = null;
let currentVolume = 0.15;

export function setFocusAudioVolume(volume: number): void {
  currentVolume = Math.max(0, Math.min(1, volume));
  if (gainNode && audioCtx && audioCtx.state !== 'closed') {
    try {
      gainNode.gain.setValueAtTime(currentVolume, audioCtx.currentTime);
    } catch {
      // Ignore audio context errors
    }
  }
}

export function getFocusAudioVolume(): number {
  return currentVolume;
}
export function _setAudioContextForTesting(ctx: AudioContext | null): void {
  stopFocusAudio();
  audioCtx = ctx;
}

export function _resetAudioContextForTesting(): void {
  stopFocusAudio();
  audioCtx = null;
}
function getAudioContext(): AudioContext | null {
  if (audioCtx && audioCtx.state !== 'closed') {
    return audioCtx;
  }
  if (typeof window === 'undefined') return null;
  // SAFETY: Window WebAudio vendor prefixes vary by browser environment
  const AudioCtx =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;

  try {
    // SAFETY: AudioCtx constructor is checked non-null above
    audioCtx = new (AudioCtx as unknown as { new (): AudioContext })();
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Stops WebAudio focus sound playback and cleans up active nodes.
 */
export function stopFocusAudio(): void {
  for (const node of activeSourceNodes) {
    try {
      if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
        (node as AudioScheduledSourceNode).stop();
      }
      node.disconnect();
    } catch {
      // Ignore errors on disconnected nodes
    }
  }
  activeSourceNodes = [];

  if (gainNode) {
    try {
      gainNode.disconnect();
    } catch {
      // Ignore
    }
    gainNode = null;
  }

  currentPlayingId = 'none';
}

/**
 * Generates a 5-second looping white noise AudioBuffer.
 */
function createWhiteNoiseBuffer(ctx: AudioContext, seconds = 5): AudioBuffer {
  const bufferSize = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Generates a 5-second looping brown (red / integrated) noise AudioBuffer.
 */
function createBrownNoiseBuffer(ctx: AudioContext, seconds = 5): AudioBuffer {
  const bufferSize = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const output = buffer.getChannelData(0);
  let lastOut = 0.0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    output[i] = lastOut * 3.5; // Gain compensation
  }
  return buffer;
}

export function startFocusAudio(id: FocusSoundId): void {
  if (!isValidSoundId(id)) {
    return;
  }

  setPref(PREF_KEY, id);

  if (id === 'none') {
    stopFocusAudio();
    return;
  }
  // Idempotent: if already playing this sound, do not recreate sources
  if (currentPlayingId === id && activeSourceNodes.length > 0) {
    return;
  }

  stopFocusAudio();

  const ctx = getAudioContext();
  if (!ctx) {
    // Degrade gracefully in environments without WebAudio (e.g. node / tests)
    currentPlayingId = id;
    return;
  }
  {
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(currentVolume, ctx.currentTime);
    masterGain.connect(ctx.destination);
    gainNode = masterGain;

    if (id === 'white') {
      const noise = ctx.createBufferSource();
      noise.buffer = createWhiteNoiseBuffer(ctx);
      noise.loop = true;

      // Low-pass slightly to remove harsh digital piercing highs
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(8000, ctx.currentTime);

      noise.connect(filter);
      filter.connect(masterGain);
      noise.start();

      activeSourceNodes.push(noise, filter);
    } else if (id === 'brown') {
      const noise = ctx.createBufferSource();
      noise.buffer = createBrownNoiseBuffer(ctx);
      noise.loop = true;

      // Gentle lowpass filter for deep smooth brown noise
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, ctx.currentTime);

      noise.connect(filter);
      filter.connect(masterGain);
      noise.start();

      activeSourceNodes.push(noise, filter);
    } else if (id === 'rain') {
      // Noise with band-pass and gentle slow amplitude wobble
      const noise = ctx.createBufferSource();
      noise.buffer = createWhiteNoiseBuffer(ctx);
      noise.loop = true;

      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.setValueAtTime(1200, ctx.currentTime);
      bandpass.Q.setValueAtTime(0.7, ctx.currentTime);

      // Slow LFO for rain droplet / intensity modulation
      const lfo = ctx.createOscillator();
      lfo.frequency.setValueAtTime(0.2, ctx.currentTime); // 0.2 Hz wobble
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(0.04, ctx.currentTime);

      lfo.connect(lfoGain.gain);

      noise.connect(bandpass);
      bandpass.connect(masterGain);

      noise.start();
      lfo.start();

      activeSourceNodes.push(noise, bandpass, lfo, lfoGain);
    } else if (id === 'cafe') {
      // Low-passed noise plus a soft rumble
      const noise = ctx.createBufferSource();
      noise.buffer = createBrownNoiseBuffer(ctx);
      noise.loop = true;

      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(350, ctx.currentTime);

      // Low frequency rumble oscillator (ambient room murmur)
      const rumble = ctx.createOscillator();
      rumble.type = 'sine';
      rumble.frequency.setValueAtTime(65, ctx.currentTime);

      const rumbleGain = ctx.createGain();
      rumbleGain.gain.setValueAtTime(0.08, ctx.currentTime);
      rumble.connect(rumbleGain);

      noise.connect(lowpass);
      lowpass.connect(masterGain);
      rumbleGain.connect(masterGain);

      noise.start();
      rumble.start();

      activeSourceNodes.push(noise, lowpass, rumble, rumbleGain);
    }

    currentPlayingId = id;
  }
}
