# Import Mini attendance as a reviewed SA draft

SA will accept a pasted daily WhatsApp report from Mini, parse it into a non-mutating draft, require the supervisor to resolve uncertainties, and merge only explicitly approved attendance. Mini, Firebase, pairing, NFC, and payroll behavior remain unchanged.

## Delivery decision

| Item | Decision |
|---|---|
| Branch | `codex/import-mini-attendance-latest` |
| Worktree | `.codex-mini-attendance-import-latest-20260728` |
| Baseline | `origin/main` at `be878638` |
| Estimated change | 1,050–1,400 lines |
| Review risk | High; use four reviewable work units |
| Data migration | None |
| Migration status | Slice A ported; tracked integration remains in slice B |

## Scope

### Included

- Parse one Mini daily report, including text with lost line breaks.
- Preserve raw rows and expose any unparsed remainder.
- Require confirmation of a complete ISO date because Mini omits the year.
- Match employees by normalized number; use names only to disambiguate or suggest.
- Detect invalid hours, duplicate rows, ambiguous employees, and existing attendance.
- After date confirmation, choose how imported totals map to normal and overtime hours.
- Show editable hour proposals and explicitly review every existing SA attendance record.
- Preserve existing multi-position allocations or replace them with one explicitly selected position.
- Apply resolved rows through SA's existing attendance coherence and persistence path.

### Deferred

- Changes to Mini's export format.
- Firebase, QR pairing, authentication, NFC, or automatic transfer.
- Employee creation, fuzzy automatic identity matching, and multi-day reports.
- Manual distribution of imported hours across multiple positions (V2).

## Data flow

```text
Pasted WhatsApp report
        |
        v
Pure parser ----> visible unparsed remainder
        |
        v
Confirm full date
        |
        v
Choose hour allocation mode (default: all normal)
        |
        v
Employee/hour/position reconciliation
        |
        v
Editable review draft (no official mutation)
        |
        v
Immutable approved apply plan
        |
        v
One batched state change + one dated save
```

## Core rules

### Parsing

- Recognize repeated `number. name *Nh*` records independently of line breaks.
- Preserve source order, raw number, raw name, raw hours, and raw fragment.
- Accept variable-width numbers such as `001` and `23`.
- Block non-finite hours, values `<= 0`, and values `> 24`.
- Never invent a missing year or discard unknown text silently.

### Employee reconciliation

1. Compare digit-only employee numbers numerically, so `001` and `1` are equivalent candidates.
2. Propose a unique number match.
3. Use case/diacritic-insensitive exact names only to disambiguate equal-number candidates.
4. Allow a unique name-only match as a suggestion requiring confirmation.
5. Never auto-approve fuzzy name similarity or create an employee.

### Duplicate handling

- Equivalent number/name and equal hours: consolidate into one visibly flagged proposal.
- Equivalent identity and different hours: block until the supervisor chooses or edits.
- Same number with materially different names: keep separate and require identity resolution.
- Never write two records for the same canonical employee and date.

### Date and hours

- SA's selected date is only a proposal.
- Parsed day, month, and weekday must agree with the proposed date.
- The supervisor must confirm the full date before continuing setup.
- Setup then offers two allocation modes:
  - `all_normal` is selected by default: all imported hours are normal and overtime is zero.
  - `split_at_regular_limit` divides the imported total at SA's configured regular limit.
- Changing the allocation mode recomputes every proposal and clears previous row reviews.
- Normal and overtime values remain editable after the mode calculation.

```text
all_normal:
  regularHours  = sourceTotal
  overtimeHours = 0

split_at_regular_limit:
  regularHours  = min(sourceTotal, configuredRegularLimit)
  overtimeHours = max(0, sourceTotal - configuredRegularLimit)
```

### Position selection and existing attendance

- New attendance for an employee with one valid position may select it automatically.
- A new record for an employee with multiple positions requires one target position in V1.
- Every existing SA attendance record requires explicit review, even when its hours appear identical.
- `keep_existing` is the default, but the supervisor must acknowledge it.
- `use_imported` requires an explicit target position owned by the employee.
- Existing multi-position attendance is shown with its complete per-position normal/overtime breakdown.
- Replacing multi-position attendance warns that V1 will collapse it into one selected position.
- `keep_existing` preserves the complete existing record unchanged.
- V2 may allow the supervisor to distribute imported normal/overtime hours manually across several positions.

### Merge

- Missing SA attendance: propose creation.
- Existing attendance: require acknowledged `keep_existing` or explicit `use_imported`.
- Imported replacement: create one position allocation using the reviewed normal/overtime values.
- Preserve unrelated notes and metadata on an explicitly approved simple correction.
- Apply only when the date and every included row are resolved.

## Planned file changes

| File | Action |
|---|---|
| `js/modules/features/attendance/MiniAttendanceParser.js` | Create pure parser |
| `js/modules/features/attendance/MiniAttendanceDraft.js` | Create reconciliation and plan builder |
| `js/modules/features/attendance/MiniAttendanceImportService.js` | Create validated batch apply service |
| `js/modules/ui/modals/MiniAttendanceImportModal.js` | Create paste and review workflow |
| `js/modules/ui/AttendanceUI.js` | Add day-view import entry |
| `js/app.js` | Wire controller and existing attendance dependencies |
| `css/attendance_ui.css` | Add responsive review states |
| `js/tests/MiniAttendance*Tests.js` | Add focused parser, draft, service, and UI suites |

## Implementation plan

### Step 0 — Isolation

- [x] Create `codex/import-mini-attendance-draft` from `main`.
- [x] Use an independent worktree to avoid the unfinished payroll branch.

### Work unit 1 — Parser

- [x] RED: test collapsed text, exact WhatsApp wrappers, headers, decimals, malformed fragments, source spans, and remainder.
- [x] GREEN: implement the pure parser without inferring a year.
- [x] REFACTOR: centralize normalization and freeze parser output.
- [x] Verify: `npm test -- --runInBand js/tests/MiniAttendanceParserTests.test.js` — 14/14 passed.

Rollback boundary: parser module and its paired tests.

### Work unit 2 — Draft setup and reconciliation

- [x] RED: test date confirmation, `001=1`, ambiguity, manual roster assignment, duplicate `501`, and hour validation.
- [x] RED: test `all_normal` as the default, opt-in regular-limit splitting, editable proposals, and mode changes clearing reviews.
- [x] GREEN: implement draft revisions, number-first matching, validated manual assignment, blockers, and recomputed hour proposals.
- [x] REFACTOR: centralize matching/allocation rules and freeze reviewed revisions.
- [x] Verify: `npm test -- --runInBand js/tests/MiniAttendanceDraftTests.test.js` — 13/13 passed; parser + draft 27/27.

Rollback boundary: draft module and its paired tests.

### Work unit 3A — Conflict planning

- [x] RED: require reviewed keep/replace decisions for every existing record, including equal hours.
- [x] RED: test actual multi-position projection, keep acknowledgement, target-position validation, and collapse acknowledgement.
- [x] RED: require explicit source-row review; consolidate only truly equivalent duplicates.
- [x] GREEN: implement immutable conflict planning and an approved apply-plan builder.
- [x] Verify: `npm test -- --runInBand js/tests/MiniAttendanceConflictPlanTests.test.js` — 6/6 passed; all pure suites 33/33.

Rollback boundary: conflict-planning exports in the draft module and their paired tests.

### Work unit 3B — Atomic application

- [x] RED: prove no pre-approval mutation, stamped writes, one batch, one index rebuild, and one dated save.
- [x] RED: prove `keep_existing` performs no write and approved replacement preserves unrelated metadata.
- [x] GREEN: implement the apply service through existing SA attendance contracts.
- [x] Verify: `npm test -- --runInBand js/tests/MiniAttendanceImportServiceTests.test.js` — 8/8 passed; all core import suites 41/41.

Rollback boundary: apply service and its paired tests.

### Work unit 4A — Paste and setup UI

- [x] RED: test safe paste rendering, parsed summary, visible source blockers, explicit date confirmation, and allocation-mode setup.
- [x] GREEN: implement the accessible paste→date→allocation modal controller with immutable draft transitions.
- [x] Verify: `npm test -- --runInBand js/tests/MiniAttendanceImportModalTests.test.js` — 6/6 passed; all import suites 47/47.

Rollback boundary: setup modal/controller and its paired tests.

### Work unit 4B1 — Employee and conflict review UI

- [x] RED: test editable employee/hour review, existing-position comparison, keep/replace decisions, target selector, collapse warning, and disabled approval.
- [x] GREEN: extend the modal through conflict planning and final confirmation.
- [x] Verify: `npm test -- --runInBand --forceExit js/tests/MiniAttendanceImportReviewTests.test.js` — 4/4 passed; all import suites through 4B1 51/51.

Rollback boundary: review/conflict-stage additions in the modal and `MiniAttendanceImportReviewTests.test.js`.

### Work unit 4B2 — Async apply and result UI

- [x] RED: test success counts, pending double-submit protection, failure/retry, unresolved blockers, and stale-draft rejection.
- [x] GREEN: rebuild the apply plan at click time, apply it asynchronously, lock pending controls, and keep success or failure visible.
- [x] Verify: focused apply UI 4/4; all modal UI 14/14; all import suites 55/55; `npm run lint:state` passes at baseline 391.

Rollback boundary: async apply/result additions in the modal and `MiniAttendanceImportApplyUITests.test.js`; the completed 4B1 review stage remains intact.

### Work unit 4C — Day-view wiring and styling

- [x] RED: test day-view-only entry, delegated action wiring, app bridge, responsive controls, and offline shell.
- [x] GREEN: wire `AttendanceUI.js` and `app.js`; add responsive styles in `attendance_ui.css`; precache all four Mini modules without changing `CACHE_VERSION`.
- [x] Browser: Chrome/Puppeteer at 390×844 parsed the flattened report as 28 rows with no remainder and preserved both `501` source rows as 27 reviewed conflicts.
- [x] Browser: all-normal + keep produced 21/0 hours and 26 applied/1 kept; split + replace produced 8/13 hours, 27 applied/0 kept, and selected `p2` after collapse acknowledgement.
- [x] Verify: focused wiring 5/5; Mini + AttendanceUI 68/68; mobile radio/checkbox widths 13 px; `lint:state` baseline 391.

Rollback boundary: remove the DayView launcher/action map entry, app bridge/import, Mini CSS block, four service-worker shell entries, and `MiniAttendanceWiringTests.test.js`.

### Final verification

- [x] Old implementation verification (`8cf56a5`): `npm test -- --runInBand` exited 0; 216 suites / 2323 tests passed in 243.6s.
- [x] Run `npm run lint:state`.
- [x] Record focused and runtime results for each work unit.
- [x] Inspect WU4C authored changes; 263 authored additions/deletions remain below the 400-line budget.

## Acceptance checklist

- [x] The supplied report parses even when flattened to one line.
- [x] Duplicate `501` entries are visible and never silently double-written.
- [x] A missing or inconsistent full date blocks approval.
- [x] Setup defaults imported totals to normal hours with zero overtime.
- [x] Opt-in split mode uses the configured limit and invalidates earlier reviews when changed.
- [x] Ambiguous, invalid, and unresolved rows cannot be applied.
- [x] Official attendance remains unchanged throughout parsing and editing.
- [x] Every existing attendance record requires an acknowledged keep/replace decision.
- [x] Keeping a two-position record preserves its full allocation unchanged.
- [x] Replacing it requires one valid target position and an explicit collapse warning.
- [x] Approved changes are stamped, indexed, and persisted exactly once for the date.

## Resolved delivery strategy

- Delivery strategy: auto-chain.
- Review chain: stacked-to-main.
- Each work unit remains independently testable and within its documented rollback boundary.

## Latest-main migration

- [x] Slice A: core modules, modal, paired Mini tests, and plan.
- [x] Slice B: current bulk-action launcher, app bridge, scoped CSS, offline shell, and integration verification.
- Slice A verification: 7 suites / 56 tests passed with `--forceExit`; `lint:state` reports no new debt.
- Root independent focused verification on latest main: exit 0; 9 suites / 80 tests passed; `lint:state` reports 382 direct writes against baseline 387 with no new debt.
- Chrome 390×844: DayView-only launcher visible at full container width; 28 rows parsed with no remainder; duplicate `501` preserved as 27 conflicts; all-normal/keep applied 26 and kept 1; split/replace applied 27 and selected `p2`.
- [ ] Latest-main global `npm test -- --runInBand`: timed out after 424s; no failure result was reported, and the run is not recorded as passed.

## Five-phase first-integration completion

### Phase 1 — One attendance-source decision

- [x] Replace the existing-attendance decision dropdown and repeated confirmations with a
  visual SA/Mini choice and one `Aceptar` action per person.
- [x] Preserve accepted decisions while later people are reviewed.

### Phase 2 — Visual position selection

- [x] Render owned positions as a segmented visual selector.
- [x] Refresh the available positions when the supervisor changes the SA employee.
- [x] Treat acceptance of Mini over a multi-position SA record as the explicit collapse
  acknowledgement for the selected destination position.

### Phase 3 — Remember employee matches

- [x] Load active scoped aliases from IndexedDB before opening the importer.
- [x] Allow the supervisor to persist a manually reviewed Mini-to-SA identity.
- [x] Reuse remembered identities offline and include them in safe bulk confirmation.

### Phase 4 — Exclude missing employees

- [x] Show a confirmation explaining that the Mini identity does not exist in SA.
- [x] Exclude the source row from the conflict/apply plans without creating an employee or
  mutating official attendance.
- [x] Show ignored counts in review and apply results.

### Phase 5 — Clear remembered matches

- [x] Add `Borrar coincidencias de Mini` under Settings → General → Maintenance.
- [x] Tombstone every active scoped alias while preserving audit history.
- [x] State clearly that employees and attendance are not deleted.

### Verification

- [x] Mini integration: 12 suites / 92 tests passed.
- [x] IndexedDB upgrade and Settings: 2 suites / 15 tests passed.
- [x] `npm run lint:state`: no new direct-state-write debt.
- [x] Edge 390×844 runtime: existing SA/Mini conflict selected Mini + `p2`, later reviews
  preserved that choice, one alias was recorded, one unknown person was ignored, apply
  completed with 2 applied / 0 kept / 1 ignored, no horizontal overflow, empty buttons,
  or console errors.
