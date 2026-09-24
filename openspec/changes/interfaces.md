# Interfaces — Alarms program (slice seams)

## Slice A `alarms-ui-redesign` (owner: @designer, worktree .tmp/wt-alarms-ui)
Owns: `src/components/Alarms.tsx`, `AlarmAudio.tsx`, `AlarmCenter.tsx`, `DashboardView.tsx` (next-alarm pill only), new `AlarmEditorSheet` component, related `__tests__`.

Public surface:
- `Alarms` (existing export) — same props as today; internal layout changes freely.
- MUST NOT touch: `src/services/aiCompiler.ts`, any new AI intake UI. Reserves a slot in the redesigned screen where `<AIScheduleIntake />` will mount (section above the list, collapsible).

## Slice B `alarms-ai-schedule` (owner: @fixer, worktree .tmp/wt-alarms-ai)
Owns: `src/services/aiCompiler.ts`, new `src/components/AIScheduleIntake.tsx`, new/extended tests. MUST NOT edit `Alarms.tsx` or any Slice-A file.

Public surface (the seam — consumer side is Slice A):
```ts
// src/components/AIScheduleIntake.tsx
export interface AlarmDraft {
  label: string;
  time: string;            // "HH:MM"
  repeat: 'once'|'daily'|'days'|'date'|'interval';
  days?: number[];         // 0-6
  date?: string;           // YYYY-MM-DD
  intervalMinutes?: number;
  windowStart?: string;    // "HH:MM"
  windowEnd?: string;      // "HH:MM"
  sound?: string;
  note?: string;
}
export function AIScheduleIntake(props: {
  onApplied?: (created: number) => void;
}): JSX.Element;
```
- Persistence: component applies confirmed drafts via existing `src/services/alarms.ts` API (no new persistence path).
- Parsing: via existing `src/services/aiCompiler.ts` `create_alarms` contract; offline parser when no BYOK key.

## Integration (orchestrator, after both slices land)
Mount `<AIScheduleIntake />` inside redesigned `Alarms.tsx` at the reserved slot; run full suite; oracle per slice + integration.
