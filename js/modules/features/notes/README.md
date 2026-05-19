# Notes feature

Self-contained module for everything related to employee notes.

Notes live inside attendance records — `state.attendance[empId-date].notes` —
so deleting a note keeps the rest of the attendance row intact.

## Files

| File | Role |
|---|---|
| `NotesService.js` | Pure data layer. `upsertNote`, `clearNote`, `listNotes`. No DOM, no globals. Easy to test. |
| `NotesController.js` | Side-effectful handlers. Mutates `state`, calls `render()` and `saveApplicationData()`. Exposes `registerLegacyGlobals()` to bridge with the data-app-fn dispatcher in app.js. |
| `NotesCenter.js` | Template for the full-screen notes browser (employee list + per-employee timeline). |
| `NoteEditorModal.js` | Template for the single-note edit modal. |
| `index.js` | Public exports. Importers should pull from here only. |

## How it wires into app.js

```js
import {
    NotesCenter,
    NoteEditorModal,
    registerLegacyGlobals as registerNotesGlobals
} from './modules/features/notes/index.js';

// Once at boot:
registerNotesGlobals();

// Inside the root template:
return `... ${NotesCenter()}${NoteEditorModal()} ...`;
```

The `registerLegacyGlobals()` step is what makes the existing
`data-app-fn="saveNoteModal"` buttons keep working — the dispatcher in
`app.js` resolves those names against `window.*`.

## Reusing the pattern for other features

This is the template Sprints 4 (Export Menu), 6 (Employee Profile Modal),
and 7 (split EmployeesUI) follow:

1. **Pure data layer first** (XxxService.js) — testable in isolation
2. **Controller** (XxxController.js) — orchestrates state + side effects
3. **Templates** (one file per visible surface)
4. **`index.js`** — single import surface
5. **`registerLegacyGlobals()`** — bridge to the data-app-fn dispatcher
   until app.js itself is restructured

## Testing

All four pieces are exercised by `js/tests/NotesServiceTests.js`
(10 tests). UI-level behavior is covered by Modal/HelpTooltip tests at
a generic level — feature-specific UI tests can be added as the need
appears.
