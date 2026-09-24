# Tasks — alarms-ui-redesign

- [ ] 1. Redesign `src/components/Alarms.tsx`: list-first layout; rows show time (large), label, repeat summary, toggle; header keeps clock badge; quick presets become compact chips; NEW ALARM form removed from page → `+ New alarm` opens modal (R01, R05)
- [ ] 2. New modal component (in Alarms.tsx or `src/components/AlarmEditorSheet.tsx`): time, label, repeat mode (once/daily/days/date/interval), days-of-week, sound, note — reusing existing form logic and ui/ kit (R05, R08)
- [ ] 3. Slim `src/components/AlarmAudio.tsx`: global enabled + volume in one compact row; built-in sound picker becomes part of alarm editor, not a standalone section (R04, R05)
- [ ] 4. Restyle `src/components/AlarmCenter.tsx` ringing screen to same tokens (R04)
- [ ] 5. Restyle next-alarm pill in `src/components/DashboardView.tsx` to match (R04)
- [ ] 6. Update/extend tests: `Alarms.test.tsx`, `AlarmEditing.test.tsx`, `AlarmCenter.test.tsx` green; add coverage for modal create + toggle flows (R08)
- [ ] 7. `bun run check` (tsc + eslint + vitest) green
