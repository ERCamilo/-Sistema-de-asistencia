# Reconciliation linked-relation blocker — 2026-09-27

Base: `194c0289381a4dbe712fa6ae9b06298c608cdf51`.
Branch: `fix/reconciliation-commit-20260927`.

## Reproduction and change

A leader can be shared by a selected position and an additional unscoped position with no selected employees. The manual wizard then blocks correctly, but the message does not identify the additional position and the footer exposes an English service reason. Quick assignment selects the additional catalog entries and does not reproduce this particular blocker.

The UI now names the related position, leader or employee and offers explicit inclusion when the referenced record is still unscoped or belongs to a missing project. It recomputes the current conflict on click, changes the selection only, and requires the normal final confirmation. Records belonging to a valid project cannot be included with this action. The durable service checks remain in place.

Failures returned during commit and catalog assignment now display the structured relationship details. The catalog service reason and footer are in Spanish.

## Validation

- Full Jest: **487 suites, 4723 tests passed**.
- Wizard: **18 tests passed**, including five added cases for unscoped/deleted-project relations, valid foreign ownership, stale buttons, escaping and detailed commit errors.
- Private user-supplied backup reproduced the English blocker through the manual workflow on the original source.
- Isolated Chromium at 390px width: explicit inclusion unlocked final confirmation, save and reload passed.
- 54 employees assigned to the chosen destination; all 3110 attendance records retained.
- Existing salary overrides, employee position selections, loans and deductions preserved.
- Attendance presence and total regular/overtime hours preserved. Existing position breakdowns retained; only previously unclassified hours assigned to the resulting primary position.
- 163 attendance records referencing employees absent from the backup's employee list remained unchanged.
- All three local payroll closure records remained unchanged across save and reload.
- Preview/selection caused no durable writes; mobile viewport had no horizontal overflow and footer stayed within the viewport.
- `git diff --check` passed.

The private backup and reproduction script are not committed. Tests used an isolated browser with Firebase endpoints blocked and financial recovery disabled. No production records were changed.

## Separate outstanding issues

- Legacy closure recovery/deduplication findings from the post-merge Claude review are not addressed here.
- Production reported a missing Firestore payroll closure index. Its definition already exists in `firestore.indexes.json`; availability in the Firebase project has not been verified or changed.
- No authenticated cloud or multi-device validation is claimed.
