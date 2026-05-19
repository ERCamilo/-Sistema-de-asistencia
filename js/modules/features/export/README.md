# Export feature

Owns everything related to the export popover (Share/Download/Import) that
appears after generating an Excel or PDF report.

## Files

| File | Role |
|---|---|
| `ExportMenuService.js` | Pure state ops (openExportMenu, closeExportMenu, canShareFiles probe). Testable in isolation. |
| `ExportController.js` | Side-effectful handlers. Touches `navigator.share`, `navigator.clipboard`, `URL.createObjectURL`, `FileReader`. Also owns the FULL-import flow that ends with `location.reload()`. |
| `ExportMenu.js` | Template for the bottom-anchored popover with three options: Share (FULL/MINI sub-menu), Import FULL, Download. |
| `ImportFullModal.js` | Template for the "paste your FULL backup JSON" modal. |
| `index.js` | Public exports. |

## How it wires into app.js

```js
import {
    ExportMenu,
    ImportFullModal,
    registerLegacyGlobals as registerExportGlobals
} from './modules/features/export/index.js';

// Once at boot:
registerExportGlobals();

// Inside the root template:
return `... ${ExportMenu()}${ImportFullModal()} ...`;
```

## State shape owned here

```
state.showExportMenu       : boolean
state.showShareOptions     : boolean
state.showImportFullModal  : boolean
state.importFullText       : string
state.isExporting          : boolean
state.exportMenuData       : { x, y, filename, blob, title, text }
```

`closeExportMenuHandler()` also clears sibling popover state (Notes Center,
note editor modal) because they share screen real estate — matches the
behavior of the legacy `window.closeExportMenu`.

## Out of scope (for now)

The blob-generating functions `window.exportExcel` and `window.exportPDF`
still live in app.js. They produce the Blob that this module then displays
options for. They can be extracted in a future sprint if needed; they
don't touch the popover state.

## Testing

State ops are covered by `js/tests/ExportMenuServiceTests.js` (6 tests).
The share/download flows depend on browser APIs that jsdom doesn't fully
implement — those paths are verified by manual smoke test in a real
browser when needed.
