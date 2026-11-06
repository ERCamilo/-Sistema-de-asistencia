import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { putConfig, getConfig } from 'actual/features/payroll/ProjectPayrollConfigStore.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = v => JSON.parse(JSON.stringify(v));
}

test('editing day hours preserves a newer holiday change from another save', async () => {
    const idb = new IndexedDBService('concurrent-payroll-holidays-' + Math.random());
    const projectId = 'OBRA-HOURS-HOLIDAY';
    const base = { projectId, regularHoursPerDay: 8, holidays: ['2026-10-01'],
        dayHours: { '2026-10-26': 8 }, updatedAt: 1 };
    try {
        await putConfig(base, { idb });
        const staleHours = { ...base, dayHours: { '2026-10-26': 9 },
            __dayHoursPatch: { '2026-10-26': 9 } };
        await putConfig({ ...base, holidays: ['2026-10-25'], updatedAt: 2 }, { idb });
        const saved = await putConfig(staleHours, { idb });
        expect(saved.holidays).toEqual(['2026-10-25']);
        expect(saved.dayHours['2026-10-26']).toBe(9);
        const durable = await getConfig(projectId, { idb });
        expect(durable.holidays).toEqual(['2026-10-25']);
        expect(durable.dayHours['2026-10-26']).toBe(9);
        expect(Object.keys(durable).filter(key => key.startsWith('__'))).toEqual([]);
    } finally {
        idb.db?.close();
    }
});
