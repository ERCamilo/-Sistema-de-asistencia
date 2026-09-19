const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'modules');
const APP = path.join(__dirname, '..', 'app.js');
const read = rel => fs.readFileSync(path.join(JS, rel), 'utf8');
const slice = (src, start, end) => {
    const a = src.indexOf(start);
    if (a < 0) return '';
    const b = src.indexOf(end, a + start.length);
    return b < 0 ? src.slice(a) : src.slice(a, b);
};

describe('F1 R02 — gates discovered by real puppet workflow', () => {
    test('onboarding publishes active-project change so Header initializes immediately', () => {
        const src = read('ui/onboarding/OnboardingApply.js');
        const body = slice(src, 'export async function applySetup', 'markCompleted(d.storage)');
        expect(body).toMatch(/projects:setup-changed|notifyProjectChanged|refreshHeaderActiveProjectName/);
    });

    test('employee position picker receives only active-project positions', () => {
        const src = read('features/employees/EmployeePositionEditor.js');
        const body = slice(src, "editor.querySelector('[data-open-position-picker]')", 'return () =>');
        expect(src).toMatch(/entityInScope/);
        expect(body).toMatch(/state\.positions\.filter|positions:\s*state\.positions\.filter/);
    });

    test('Loans ledger remains reachable with Projects ON even if payroll config is unavailable', () => {
        const src = read('features/payroll/PayrollUI.js');
        const body = slice(src, 'export function PayrollTab()', 'function ScopedPayrollTab');
        const ledgerIndex = body.indexOf("mode === 'ledger'");
        const scopedIndex = body.indexOf('if (scopedView?.enabled)');
        expect(ledgerIndex).toBeGreaterThanOrEqual(0);
        expect(scopedIndex).toBeGreaterThanOrEqual(0);
        expect(ledgerIndex).toBeLessThan(scopedIndex);
    });

    test('loan employee picker never lists employees from another project', () => {
        const src = read('features/loans/LoansLedger.js');
        const body = slice(src, 'function EmployeePickerOverlay()', 'function NewLoanForm');
        expect(src).toMatch(/entityInScope/);
        expect(body).toMatch(/entityInScope/);
        expect(body).toMatch(/state\.employees[^;]*filter|filter\([^)]*entityInScope/);
    });
});
