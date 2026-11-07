import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { putConfig, getConfig } from 'actual/features/payroll/ProjectPayrollConfigStore.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
}

test('two independent holiday additions and a later explicit removal preserve unrelated dates', async () => {
    const idb = new IndexedDBService('pr312-holiday-ops-' + Math.random());
    try {
        const base = await putConfig({ ...createDefaultConfig('O'), holidays: [] }, { idb });
        const saves = await Promise.all([
            putConfig({ ...base, __holidaysPatch: ['2026-11-01'],
                __holidayChanges: [{ date: '2026-11-01', isHoliday: true }] }, { idb }),
            putConfig({ ...base, __holidaysPatch: ['2026-11-02'],
                __holidayChanges: [{ date: '2026-11-02', isHoliday: true }] }, { idb }),
        ]);
        expect((await getConfig('O', { idb })).holidays.slice().sort()).toEqual(['2026-11-01', '2026-11-02']);
        expect(saves.every(x => !Object.keys(x).some(k => k.startsWith('__')))).toBe(true);

        // Even a stale form removing Nov 1 must not remove Nov 2.
        await putConfig({ ...base, __holidaysPatch: [],
            __holidayChanges: [{ date: '2026-11-01', isHoliday: false }] }, { idb });
        expect((await getConfig('O', { idb })).holidays).toEqual(['2026-11-02']);
    } finally {
        idb.db?.close();
    }
});
