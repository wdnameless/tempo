## ADDED Requirements

### Requirement: Schedule-to-alarms intake in Alarms tab
The Alarms tab MUST offer an intake where the user pastes a free-text day schedule (e.g. a workout plan) and receives one draft alarm per task, produced by the existing AI compiler (BYOK OpenAI-compatible; deterministic offline parser when no key is configured) (R02, R06, R07).

#### Scenario: User pastes a workout plan
- **WHEN** user pastes «09:00 зарядка, 10:00 завтрак, 18:00 тренировка» and activates the intake
- **THEN** three draft alarms appear (09:00, 10:00, 18:00) with matching labels, shown as an editable preview before anything is saved.

#### Scenario: No API key configured
- **WHEN** no BYOK key is stored
- **THEN** the intake still works via the offline parser and shows a notice that results come from the local parser.

### Requirement: Interval repetition from natural language
A task phrased with repetition («пить воду каждый час», «stretch every 45 minutes») MUST produce a draft with repeat mode `interval` and the corresponding `intervalMinutes` (R03).

#### Scenario: Hourly reminder in schedule
- **WHEN** the pasted schedule contains «пить воду каждый час с 9 до 18»
- **THEN** the draft has repeat=interval, intervalMinutes=60, and window 09:00–18:00 if expressible in the existing model.

### Requirement: Confirmation before creation
No alarm MUST be persisted until the user confirms the draft card; the user MAY edit time, label and repeat per draft before applying (R02, R06).

#### Scenario: User edits and applies
- **WHEN** user adjusts one draft's time and presses Apply
- **THEN** exactly the confirmed set of alarms is created via the existing alarms service and appears in the alarm list; Cancel creates nothing.

### Requirement: No regression
Existing aiCompiler and alarms tests MUST pass without weakening assertions; `bun run check` MUST be green (R08).

#### Scenario: Suite runs
- **WHEN** `bun run check` executes
- **THEN** tsc, eslint and the full vitest suite pass.
