import { hydrateRememberedAdjustments, normalizePayrollDefaults, summarizeGlobalAdjustments, updateRememberedDefault } from '../modules/features/payroll/PayrollAdjustments.js';

testRunner.addSuite('PayrollAdjustments — globales recordados', {
    'normaliza solo ajustes globales'() {
        const result = normalizePayrollDefaults({ payrollDefaults: { deductions: [
            { id: 'g', value: 10, name: 'Global' },
            { id: 'i', value: 20, employeeId: 'e1' }
        ] } });
        testRunner.assertEquals(result.deductions.length, 1, 'Nunca debe persistir ajustes individuales');
        testRunner.assertEquals(result.deductions[0].id, 'g', 'Conserva el global');
    },

    'hidrata en forma idempotente sin duplicar ids'() {
        const settings = { payrollDefaults: { bonuses: [{ id: 'b1', value: 5, name: 'Bono' }] } };
        const first = hydrateRememberedAdjustments({}, settings);
        const second = hydrateRememberedAdjustments(first, settings);
        testRunner.assertEquals(second.bonuses.length, 1, 'Dos hidrataciones no duplican');
        testRunner.assert(second.bonuses[0].remembered, 'Marca el ajuste como recordado');
    },

    'desmarcar elimina el default sin borrar la fila actual'() {
        const row = { id: 'd1', value: 12, name: 'AFP', remembered: true };
        const defaults = updateRememberedDefault({ payrollDefaults: { deductions: [row] } }, 'deductions', row, false);
        testRunner.assertEquals(defaults.deductions.length, 0, 'El default se elimina');
        testRunner.assertEquals(row.name, 'AFP', 'La fila de sesión no se muta ni elimina');
    },

    'resume máximo tres globales con signo y omite individuales'() {
        const items = [1, 2, 3, 4].map(value => ({ value, type: value === 2 ? 'percentage' : 'fixed' }));
        items.push({ value: 99, employeeId: 'e1' });
        const result = summarizeGlobalAdjustments(items, '-', value => `$${value}`);
        testRunner.assertEquals(result, '-$1 -2% -$3 +1 más', 'Resumen plegado exacto');
    }
});
