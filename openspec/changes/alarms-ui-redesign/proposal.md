# Proposal — Alarms UI Redesign (clean minimalism)

## Why
User: «у нас ужасный интерфейс». The Alarms tab is a wall of forms: sound section, 7 sound buttons, volume, presets, NEW ALARM form, list — all at once.

## What
- Alarms tab becomes a clean alarm LIST (hero): large time, label, repeat summary, on/off toggle per row.
- Creation/editing moves into a modal sheet (time, label, repeat incl. interval, days, sound, note).
- Sound selection moves into the alarm editor (per-alarm), global volume/enabled stays in a compact settings row.
- AlarmCenter ringing screen gets the same visual language (tokens from src/index.css, src/constants/themes.ts, src/constants/design.ts).
- DashboardView next-alarm pill stays, restyled to match.

## Non-goals
- Other tabs (Tasks, Calendar, Notes, Stats, STT, Settings) untouched.
- No changes to scheduler.rs, alarm data model, or repeat logic (R08).
