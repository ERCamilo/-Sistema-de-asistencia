# Profile feature

The full-screen Employee Profile modal — 4 tabs (Resumen, Nómina, Asistencia,
Documentos) plus its date pickers and handler logic.

## Files

| File | Role |
|---|---|
| `EmployeeProfileModal.js` | Modal shell + tab navigation. Dispatches to the active tab template. |
| `ProfileTabs.js` | The 4 tab templates (Resumen / Nómina / Asistencia / Documentos). |
| `ProfilePickers.js` | 3 date-picker components + `calculateMonthlyEstimate` helper. |
| `ProfileController.js` | 14 handler functions + `syncProfileToMaster` helper. |
| `index.js` | Public exports. |

## How it wires into app.js

```js
import {
    EmployeeProfileModal,
    registerLegacyGlobals as registerProfileGlobals
} from './modules/features/profile/index.js';

// Once at boot:
registerProfileGlobals();

// Inside the root template:
return `... ${EmployeeProfileModal()} ...`;
```

## Dependencies on app.js (intentional)

The Nómina tab calls three HTML generators that still live in app.js:

  - `window.generateDeductionsHTML(payroll)`
  - `window.generateBonusesHTML(payroll)`
  - `window.generateAdvancesHTML(payroll)`

They produce the editable deductions / bonuses / advances UI inside the
payroll tab. They depend on a number of other app.js-local handlers
(`addDeduction`, `removeDeduction`, `addBonus`, etc., ~30 handlers).
Pulling them into this module would balloon the extraction; a future
sprint can move them into `PayrollUI` where they conceptually belong.

The fallback is graceful: if `window.generate*HTML` is missing, the
sections render empty rather than breaking the page.

## State fields owned

```
state.showEmployeeProfile             : boolean
state.employeeProfile = {
    employeeId,
    activeTab,                          // 'resumen' | 'nomina' | 'asistencia' | 'documentos'
    periodStart, periodEnd,             // 'YYYY-MM-DD'
    showStartPicker, showEndPicker,
    startPickerMonth, endPickerMonth,   // Date
    assistanceMonth,                    // Date
    activePeriod,                       // '7days' | '15days' | 'month' | 'payPeriod' | 'lastPayment'
    deductions, bonuses, advances,      // scratch arrays (synced via syncProfileToMaster)
    expandedPositions,                  // { positionId: boolean }
    deductionType, deductionValue       // legacy single-deduction shape
}
state.showProfileHireDatePicker        : boolean
state.profileHireDatePickerMonth       : Date
```

## Testing

UI templates aren't tested directly (jsdom can't paint). The Controller's
state ops use `stateManager.batchSetState` which is covered by
`RenderBatchingTests.js`. `calculateMonthlyEstimate` is a pure function
ready for unit tests once the suite for this module is added.
