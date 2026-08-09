import fs from 'fs';
import path from 'path';

const PAYROLL_UI_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollUI.js'),
    'utf8'
);

describe('Live payroll preview', () => {
    test('never replaces current calculations with rows reconstructed from paid loans', () => {
        expect(PAYROLL_UI_SOURCE).not.toMatch(/\bgetClosedPayrollPreviewRows\b/);
    });

    test('does not schedule an expiry rerender for a legacy undo deadline', () => {
        expect(PAYROLL_UI_SOURCE).not.toContain('schedulePayrollClosureUndoExpiry');
        expect(PAYROLL_UI_SOURCE).not.toContain('payrollClosureUndoExpiryTimer');
    });
});
