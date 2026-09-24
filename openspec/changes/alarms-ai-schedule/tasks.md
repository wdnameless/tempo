# Tasks — alarms-ai-schedule

- [ ] 1. Verify `src/services/aiCompiler.ts` parses a pasted day schedule into per-task alarm drafts incl. interval repeat («каждый час» → intervalMinutes=60); extend parser/prompt contract only where coverage is missing (R02, R03)
- [ ] 2. New `src/components/AIScheduleIntake.tsx`: textarea/paste box, «Расставить будильники» action, loading/error/empty states, no-key fallback notice (offline parser) (R02, R06, R07)
- [ ] 3. Draft confirmation card: list of parsed drafts with editable time/label/repeat/interval; Apply → batch-create via existing alarms service; Cancel discards (R02, R06)
- [ ] 4. Tests: extend `aiCompiler.test.ts` for workout-schedule RU input + interval repeat; component test for intake→draft→apply flow (R08)
- [ ] 5. Hand off integration seam: export `<AIScheduleIntake onApply={...} />` — wiring into Alarms.tsx happens after slice A lands (disjoint zones)
- [ ] 6. `bun run check` green
