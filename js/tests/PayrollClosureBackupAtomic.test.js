import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { buildPayrollClosure, buildPayrollClosureSnapshot, voidPayrollClosure } from '../modules/features/payroll/PayrollClosure.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const closure = (employee = 'e') => {
    const options = { periodStart: '2026-09-01', periodEnd: '2026-09-15', closedAt: 100,
        rows: [{ _employeeId: employee, _number: '1', _employeeName: 'Prueba', _brutoOriginal: 1000, _loans: 100, monto: 900 }] };
    return buildPayrollClosure({ ...options, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(options)) });
};
const state = () => ({ employees: [{ id: 'new', number: '1', name: 'Nuevo', positions: [], loans: [] }],
    positions: [], leaders: [], attendance: {}, settings: { companyName: 'Backup' } });
describe('closure restore is atomic with the FULL dataset', () => {
    let db;
    beforeEach(async () => { db = new IndexedDBService('closure-backup-' + Math.random()); await db.init();
        await db.update('employees', { id: 'old', number: '2', name: 'Anterior' }); });
    afterEach(() => { jest.restoreAllMocks(); db.db.close(); });
    const options = closures => ({ clearFirst: true, entityScope: { enabled: false }, payrollClosures: closures });
    test('restores exact identities, rows, totals and payment references together, including after reload', async () => {
        const c = closure(), data = state();
        data.employees[0].loans = [{ id: 'loan', amount: 1000, payments: [{ id: 'payment', amount: 100, payrollClosureId: c.id }] }];
        await db.saveState(data, options([c]));
        expect(await db.getAll('payrollClosures')).toEqual([c]);
        expect((await db.getAll('employees'))[0].loans).toEqual(data.employees[0].loans);
        db.db.close(); db.db = null; db.isInitialized = false; await db.init();
        expect(await db.getAll('payrollClosures')).toEqual([c]);
    });
    test.each([undefined, []])('legacy/empty backup preserves existing closures (%s)', async incoming => {
        const c = closure(); await db.update('payrollClosures', c);
        await db.saveState(state(), options(incoming));
        expect(await db.getAll('payrollClosures')).toEqual([c]);
    });
    test('keeps unrelated closures and never revives an annulled closure', async () => {
        const c = closure(), other = closure('other'), voided = voidPayrollClosure(c, { now: 110 });
        await db.update('payrollClosures', voided); await db.update('payrollClosures', other);
        await db.saveState(state(), options([c]));
        expect(await db.get('payrollClosures', c.id)).toEqual(voided);
        expect(await db.get('payrollClosures', other.id)).toEqual(other);
    });
    test('conflicting identity aborts employees and closures together', async () => {
        const c = closure(); await db.update('payrollClosures', { ...c, fingerprint: 'different-original' });
        await expect(db.saveState(state(), options([c]))).rejects.toThrow();
        expect((await db.getAll('employees'))[0].id).toBe('old');
        expect((await db.get('payrollClosures', c.id)).fingerprint).toBe('different-original');
    });
    test('closure write failure rolls back the FULL replacement', async () => {
        const transaction = db.db.transaction.bind(db.db);
        jest.spyOn(db.db, 'transaction').mockImplementation((stores, mode) => {
            const tx = transaction(stores, mode);
            if (mode === 'readwrite' && [...stores].includes('payrollClosures')) {
                const objectStore = tx.objectStore.bind(tx);
                tx.objectStore = name => {
                    const store = objectStore(name);
                    if (name === 'payrollClosures') store.put = () => { throw new Error('disk failure'); };
                    return store;
                };
            }
            return tx;
        });
        await expect(db.saveState(state(), options([closure()]))).rejects.toThrow('disk failure');
        expect((await db.getAll('employees'))[0].id).toBe('old');
        expect(await db.getAll('payrollClosures')).toEqual([]);
    });
    test.each([null, {}, [{ id: 'summary-only' }]])('invalid closure payload fails before writes (%s)', async value => {
        await expect(db.saveState(state(), options(value))).rejects.toThrow();
        expect((await db.getAll('employees'))[0].id).toBe('old');
    });
});
