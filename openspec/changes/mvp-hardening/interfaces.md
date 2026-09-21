# Interfaces: MVP Hardening & End-to-End Polish

## 1. Dashboard & Floating Player (Wave 1)

```ts
// src/services/timer.ts
export const TIMER_PRESETS = [15, 25, 45, 60] as const;
export async function setTimerDuration(minutes: number): Promise<void>;
export async function setTimerPhase(phase: 'focus' | 'short_rest' | 'long_rest'): Promise<void>;

// src/services/focusAudio.ts
export type SoundscapeId = 'rain' | 'waves' | 'whitenoise' | 'fire' | 'off';
export function setSoundscape(id: SoundscapeId, volume?: number): void;
export function currentSoundscape(): { id: SoundscapeId; volume: number };
```

## 2. Drawing Canvas Drag & History (Wave 3)

```ts
// src/services/canvas.ts
export interface CanvasHistory {
  undo(): Scene | null;
  redo(): Scene | null;
  push(scene: Scene): void;
  canUndo: boolean;
  canRedo: boolean;
}

export function createDrawingStroke(
  tool: ToolId,
  start: { x: number; y: number },
  current: { x: number; y: number },
  color: string,
  width: number
): Stroke;
```

## 3. Push-to-Talk Hotkey & Dictation (Wave 4)

```ts
// Rust command surface
// stt_dictation_press() -> activates recording, emits DictationState
// stt_dictation_release() -> finishes capture, runs VAD + Whisper, injects via SendInput with clipboard restore
```
