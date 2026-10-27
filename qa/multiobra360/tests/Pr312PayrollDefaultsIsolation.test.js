import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { putConfig, getConfig } from 'actual/features/payroll/ProjectPayrollConfigStore.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';

if (typeof globalThis.structuredClone !== 'function')
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));

test('payroll-default-only edit preserves a more recently saved holiday and hours', async () => {
    const idb = new IndexedDBService('pr312-extra-payroll-defaults-' + Math.random());
    const initial = { ...createDefaultConfig('O'), holidays: [], dayHours: { '2026-10-27': 8 } };
    try {
        const base = await putConfig(initial, { idb });
        // An in-flight edit of the adjustment defaults captures an old snapshot.
        const newDefaults = {
            ...base.payrollDefaults,
            version: 2,
            deductions: [{ id: 'd-test', label: 'Prueba', value: 3 }],
        };
        const oldSnapshotEdit = {
            ...base,
            payrollDefaults: newDefaults,
            __payrollDefaultsPatch: newDefaults
        };
        // The holiday and the edited day-hours have been committed meanwhile.
        const updated = await putConfig({
            ...base, holidays: ['2026-10-27'],
            dayHours: { '2026-10-27': 9 }
        }, { idb });
        expect(updated.holidays).toEqual(['2026-10-27']);
        const saved = await putConfig(oldSnapshotEdit, { idb });
        expect(saved.payrollDefaults).toEqual(newDefaults);
        expect(saved.holidays).toEqual(['2026-10-27']);
        expect(saved.dayHours['2026-10-27']).toBe(9);
        expect(Object.keys(saved).filter(k => k.startsWith('__'))).toEqual([]);
        expect((await getConfig('O', { idb })).holidays).toEqual(['2026-10-27']);
    } finally {
        idb.db?.close();
    }
});
