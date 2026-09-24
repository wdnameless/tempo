## ADDED Requirements

### Requirement: List-first Alarms screen
The Alarms tab MUST present the alarm list as the primary surface. Alarm creation and editing MUST happen in a modal sheet, not an always-visible form (R01, R05).

#### Scenario: User opens Alarms tab
- **WHEN** user opens the Alarms tab
- **THEN** they see the list of alarms (time prominent, label, repeat summary, enabled toggle) and a single `+ New alarm` action; no creation form is visible by default.

#### Scenario: User creates an alarm
- **WHEN** user activates `+ New alarm`
- **THEN** a modal sheet opens with time, label, repeat mode (once/daily/days/date/interval), days-of-week, sound and note fields; saving adds the alarm to the list and closes the sheet.

### Requirement: Per-alarm sound in editor
Sound selection MUST be configurable per alarm inside the editor sheet; the tab-level sound wall (7 built-in sound buttons) MUST be removed from the main screen (R04, R05).

#### Scenario: User picks a sound
- **WHEN** user edits an alarm and opens the sound control
- **THEN** they can preview and select a built-in sound or their own file without leaving the sheet.

### Requirement: Ringing screen visual parity
The AlarmCenter ringing takeover and the Dashboard next-alarm pill MUST use the same design tokens as the redesigned list (R04).

#### Scenario: Alarm fires
- **WHEN** an alarm fires
- **THEN** the ringing screen shows time, label and snooze/dismiss actions styled with the shared tokens, with no layout regressions.

### Requirement: No regression of scheduling behavior
Repeat modes, firing, snooze and existing persistence MUST behave identically; existing alarm tests MUST pass without weakening assertions (R08).

#### Scenario: Suite runs
- **WHEN** `bun run check` executes
- **THEN** tsc, eslint and the full vitest suite pass.
