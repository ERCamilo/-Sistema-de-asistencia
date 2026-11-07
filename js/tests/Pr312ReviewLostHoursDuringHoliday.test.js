import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { putConfig, getConfig } from 'actual/features/payroll/ProjectPayrollConfigStore.js';

if (!globalThis.structuredClone) globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));

test('PR312: concurrent stale holiday update should not undo hours that just committed', async () => {
    const idb = new IndexedDBService('pr312-review-' + Math.random());
    const projectId = 'PRJ-AUDIT';
    const date = '2026-10-27';
    const original = { projectId, updatedAt: 1, regularHoursPerDay: 8, dayHours: { [date]: 8 }, holidays: [] };
    await putConfig(original, { idb });
    const beforeBoth = await getConfig(projectId, { idb });
    const originalUpdate = idb.update.bind(idb);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let reached;
    const entered = new Promise(resolve => { reached = resolve; });
    let first = true;
    idb.update = async (name, value) => {
        if (name === 'projectPayrollConfigs' && value.dayHours?.[date] === 9 && first) {
            first = false;
            reached();
            await gate;
        }
        return originalUpdate(name, value);
    };
    const firstSave = putConfig({ ...beforeBoth, dayHours: { [date]: 9 },
        __dayHoursPatch: { [date]: 9 } }, { idb });
    await entered;
    const secondSave = putConfig({ ...beforeBoth, holidays: [date] }, { idb });
    release();
    await Promise.all([firstSave, secondSave]);
    const final = await getConfig(projectId, { idb });
    expect(final.holidays).toEqual([date]);
    expect(final.dayHours[date]).toBe(9);
    idb.db.close();
});
