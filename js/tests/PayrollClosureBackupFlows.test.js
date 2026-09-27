import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import mockedDB from '../modules/services/IndexedDBService.js';
import { state, stateManager } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';
import { readPayrollClosuresForBackup, payrollClosureRestoreOptions } from '../modules/features/payroll/PayrollClosureBackup.js';
import { buildPayrollClosure, buildPayrollClosureSnapshot } from '../modules/features/payroll/PayrollClosure.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
function fixture(projectId) {
    const options = { ...(projectId ? {projectId} : {}), periodStart: '2026-09-01', periodEnd: '2026-09-15', closedAt: 100,
        rows: [{ _employeeId: 'e', _number: '1', _employeeName: 'Ana', _brutoOriginal: 1000, _loans: 100, monto: 900 }] };
    return buildPayrollClosure({ ...options, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(options)) });
}
describe('backup closure export and public FULL import', () => {
    let db, previous;
    beforeEach(async () => {
        jest.useFakeTimers(); setProjectsEnabled(false);
        previous = JSON.parse(JSON.stringify(stateManager.getState()));
        db = new IndexedDBService('backup-flow-' + Math.random()); await db.init();
        mockedDB.saveState.mockImplementation((s, o) => db.saveState(s, o));
        Object.assign(stateManager.getState(), { employees: [{id:'old',number:'9',name:'Anterior',positions:[]}],
            positions:[], leaders:[],attendance:{},settings:{companyName:'Antes'},isDataLoaded:true,useIndexedDB:true });
        await db.update('employees', state.employees[0]);
        delete window.location; window.location = { reload: jest.fn(), href: 'http://localhost/' };
        window.showAlert = jest.fn();
    });
    afterEach(() => {
        jest.restoreAllMocks(); mockedDB.saveState.mockReset(); db.db.close();
        Object.assign(stateManager.getState(), previous);
        delete window.showConfirm; delete window.showAlert;
        jest.clearAllTimers(); jest.useRealTimers();
    });
    const payload = c => ({ data: { settings: { companyName: 'Después' }, employees: [
        {id:'e',number:'1',name:'Ana',positions:[],loans:[{id:'loan',amount:1000,payments:[{id:'p',amount:100,payrollClosureId:c.id}]}]}
    ],positions:[],leaders:[],attendance:{},payrollClosures:[c]} });
    async function apply(data) {
        let confirm;
        window.showConfirm = opts => { confirm = opts.onConfirm; };
        setImportFullText(JSON.stringify(data)); confirmImportFull();
        expect(confirm).toEqual(expect.any(Function));
        return confirm();
    }
    test.each([undefined, 'deleted-project'])('exports exact durable closure details, including legacy/orphan ownership (%s)', async pid => {
        const c = fixture(pid); await db.update('payrollClosures', c);
        expect(await readPayrollClosuresForBackup(db)).toEqual([c]);
        expect(payrollClosureRestoreOptions({payrollClosures:[c]})).toEqual({payrollClosures:[c]});
    });
    test('export read failure is visible rather than replaced by an empty backup', async () => {
        jest.spyOn(db, 'getAll').mockRejectedValue(new Error('read failed'));
        await expect(readPayrollClosuresForBackup(db)).rejects.toThrow('read failed');
    });
    test('FULL paste restores the payment and closure together', async () => {
        const c = fixture(); expect(await apply(payload(c))).toBe(true);
        expect(await db.getAll('payrollClosures')).toEqual([c]);
        expect((await db.getAll('employees'))[0].loans[0].payments[0].payrollClosureId).toBe(c.id);
    });
    test('FULL paste failure restores old in-memory and durable employees', async () => {
        const c = fixture(); await db.update('payrollClosures', { ...c, fingerprint:'conflicting-content' });
        expect(await apply(payload(c))).toBe(false);
        expect(state.employees[0].id).toBe('old');
        expect((await db.getAll('employees'))[0].id).toBe('old');
        expect((await db.get('payrollClosures', c.id)).fingerprint).toBe('conflicting-content');
    });
    test('a real FULL backup imports petty cash and closure details in the same commit', async () => {
        const c = fixture(), data = payload(c);
        data.data.pettyCash = { projects: [{id:'cash',name:'Gastos'}], periods: [{id:'period',projectId:'cash'}],
            movements: [{id:'movement',projectId:'cash',periodId:'period',amount:25}] };
        expect(await apply(data)).toBe(true);
        expect(await db.getAll('payrollClosures')).toEqual([c]);
        expect((await db.getAll('pettyCashProjects'))[0].id).toBe('cash');
        expect((await db.getAll('pettyCashMovements'))[0].amount).toBe(25);
    });
    test('duplicate closure IDs are rejected before a restore', () => {
        const c = fixture();
        expect(() => payrollClosureRestoreOptions({payrollClosures:[c,c]})).toThrow('duplicado');
    });
    test.each(['closed', 'voided'])('FULL restores and exports schema 1 history verbatim (%s)', async status => {
        const c = { ...fixture(), schemaVersion: 1, status,
            migrationSource: 'legacy-payroll-loan-batch', loanSettlementBatchId: 'legacy-batch',
            paymentRefs: [{ employeeId: 'e', loanId: 'loan', paymentId: 'p' }],
            ...(status === 'voided' ? { voidedAt: 120, voidedBy: 'original-actor', voidReason: 'Cierre anulado' } : {}) };
        expect(await apply(payload(c))).toBe(true);
        expect(await readPayrollClosuresForBackup(db)).toEqual([c]);
        expect((await db.getAll('employees'))[0].loans[0].payments[0].payrollClosureId).toBe(c.id);
        const retry = { ...c, status: 'closed' };
        expect(await apply(payload(retry))).toBe(true);
        expect(await db.getAll('payrollClosures')).toEqual([c]);
    });
    test.each([0, 4, '1'])('unsupported closure version %s fails before replacing data', async schemaVersion => {
        const c = { ...fixture(), schemaVersion };
        expect(await apply(payload(c))).toBe(false);
        expect((await db.getAll('employees'))[0].id).toBe('old');
        expect(await db.getAll('payrollClosures')).toEqual([]);
    });
    test('incomplete schema 1 still fails before replacing data', async () => {
        const c = { ...fixture(), schemaVersion: 1 };
        delete c.rows;
        expect(await apply(payload(c))).toBe(false);
        expect((await db.getAll('employees'))[0].id).toBe('old');
    });

});
