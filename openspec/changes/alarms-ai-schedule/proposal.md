# Proposal — AI Schedule Intake in Alarms

## Why
User: «я кидаю ему свою программу тренировок на день и он ставит будильник на каждую задачу, если нужно ставить повторение каждый час или любое заданное время». The capability exists in the AI chat (aiCompiler + AIChatDrawer drafts) but is not reachable from the Alarms tab.

## What
- New `AIScheduleIntake` component surfaced in the Alarms tab: paste a day schedule (free text, RU/EN) → AI (BYOK OpenAI-compatible; offline deterministic parser without key) produces draft alarms, one per task.
- Draft preview card: editable time/label/repeat (incl. interval minutes, e.g. hourly) per draft; confirm applies the batch; cancel discards.
- Reuse `aiCompiler.ts` action contracts (`create_alarms`); extend only if interval-per-task is not already expressible.

## Non-goals
- No new AI provider; no changes to chat drawer UX; no scheduler.rs changes (R07, R08).
