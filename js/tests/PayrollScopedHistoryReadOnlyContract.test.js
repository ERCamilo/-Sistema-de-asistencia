import fs from 'fs';
import path from 'path';
import { renderPayrollHistoryDetail } from 'actual/features/payroll/PayrollHistoryUI.js';

const payrollUISource = fs.readFileSync(path.join(process.cwd(), 'js/modules/features/payroll/PayrollUI.js'), 'utf8');

function closure() {
    return { id: 'C-1', status: 'closed', projectId: 'PRJ-A', periodStart: '2026-09-01', periodEnd: '2026-09-15', rows: [] };
}

describe('Scoped payroll history read-only contract', () => {
    test('read-only detail never exposes undo and labels the historical view', () => {
        const html = renderPayrollHistoryDetail(closure(), { readOnly: true });
        expect(html).toContain('Consulta de solo lectura');
        expect(html).not.toContain('data-payroll-action="undo-payroll-closure"');
    });

    test('scoped history reads are allowed while economic closure mutations stay gated', () => {
        expect(payrollUISource).not.toContain("assertTandaBBlockedWhenScoped('PayrollUI.loadPayrollHistory')");
        expect(payrollUISource).not.toContain("assertTandaBBlockedWhenScoped('PayrollUI.openPayrollHistoryDetail')");
        expect(payrollUISource).toContain("assertTandaBBlockedWhenScoped('PayrollUI.openPayrollClosure')");
        expect(payrollUISource).toContain("assertTandaBBlockedWhenScoped('PayrollUI.undoPayrollClosure')");
        expect(payrollUISource).toContain('readOnly: isTandaBBlocked()');
        expect(payrollUISource).toContain("mode === 'history' ? PayrollHistoryTab()");
    });
});