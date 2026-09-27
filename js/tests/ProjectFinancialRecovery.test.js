import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import { planFinancialRecovery } from '../modules/features/projects/ProjectFinancialRecovery.js';
import { buildPayrollClosure, buildPayrollClosureSnapshot } from '../modules/features/payroll/PayrollClosure.js';
import { applyOwnershipRepair, REPAIR_ACTION, REPAIR_STATUS } from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { diagnoseExtendedProjectData } from '../modules/features/projects/ProjectExtendedDiagnostics.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const projects = [{ id: 'A', name: 'Obra A', status: 'active' }, { id: 'B', name: 'Obra B', status: 'archived' }];
function closure() {
    const options = { projectId: 'missing', periodStart: '2026-09-01', periodEnd: '2026-09-15',
        closedAt: 100, rows: [{ _employeeId: 'e', _number: '1', _employeeName: 'Ana',
            _brutoOriginal: 1000, _loans: 100, _deductions: 50, monto: 850 }] };
    return buildPayrollClosure({ ...options, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(options)) });
}
function fixture() {
    const c = closure();
    const employee = { id: 'e', number: '1', name: 'Ana', projectId: 'A', positions: [],
        loans: [{ id: 'l', amount: 1000, balance: 900, payments: [
            { id: 'p', amount: 100, date: '2026-09-15', source: 'payroll', payrollProjectId: 'missing', payrollClosureId: c.id }
        ] }],
        deductions: [{ id: 'd', employeeId: 'e', projectId: 'missing', recordType: 'payroll-adjustment-installment-plan',
            version: 1, kind: 'deductions', status: 'active', appliedAmount: 50, balance: 50,
            installments: [{ id: 'i', amount: 50, status: 'applied', payrollClosureId: c.id }],
            history: [{ id: 'h', source: 'payroll', amount: 50, payrollClosureId: c.id }] }] };
    return { employees: [employee], projects, payrollClosures: [c], employeeIds: ['e'], targetProjectId: 'A', timestamp: 500 };
}
test('recovers payments, applied installments and closures without changing amounts or originals', () => {
    const data = fixture(), before = JSON.stringify(data), result = planFinancialRecovery(data);
    expect(JSON.stringify(data)).toBe(before);
    const e = result.employees[0], c = result.closures[0];
    expect(e.loans[0].balance).toBe(900);
    expect(e.loans[0].payments).toHaveLength(1);
    expect(e.loans[0].payments[0]).toMatchObject({ id: 'p', amount: 100, payrollProjectId: 'A', payrollClosureId: c.id });
    expect(e.deductions[0]).toMatchObject({ appliedAmount: 50, balance: 50, projectId: 'A' });
    expect(e.deductions[0].history[0]).toMatchObject({ amount: 50, payrollClosureId: c.id });
    expect(e.deductions[0].installments[0]).toMatchObject({ status: 'applied', payrollClosureId: c.id });
    expect(c.rows).toEqual(data.payrollClosures[0].rows);
    expect(c.totals).toEqual(data.payrollClosures[0].totals);
    expect(c.paymentRefs).toEqual(data.payrollClosures[0].paymentRefs);
    expect(c.recovery.sourceId).toBe(data.payrollClosures[0].id);
    expect(diagnoseExtendedProjectData({ employees: result.employees, payrollClosures: [...data.payrollClosures, c] }, projects)).toEqual([]);
});
test('retry is a no-op and can repair late references to an already recovered closure', () => {
    const data = fixture(), first = planFinancialRecovery(data);
    const next = { ...data, employees: first.employees, payrollClosures: [...data.payrollClosures, ...first.closures], timestamp: 600 };
    expect(planFinancialRecovery(next)).toMatchObject({ employees: [], closures: [], configs: [] });
    next.employees = data.employees;
    const late = planFinancialRecovery(next);
    expect(late.closures).toHaveLength(0);
    expect(late.employees[0].loans[0].payments[0].payrollClosureId).toBe(first.closures[0].id);
});
test('unselected employees and financial records owned by existing works remain untouched', () => {
    const data = fixture();
    data.employees.push({ id: 'other', projectId: 'B', loans: [{ id: 'o', amount: 12 }] });
    data.employees[0].bonuses = [{ id: 'b', projectId: 'B', amount: 20 }];
    const result = planFinancialRecovery(data);
    expect(result.employees).toHaveLength(1);
    expect(result.employees[0].bonuses).toEqual(data.employees[0].bonuses);
});
test('valid foreign payments are preserved even inside an orphan loan', () => {
    const data = fixture();
    data.employees[0].loans[0].payments.push({ id: 'foreign', source: 'payroll', payrollProjectId: 'B', payrollClosureId: 'foreign-c', amount: 10 });
    const result = planFinancialRecovery(data);
    expect(result.employees[0].loans[0].payments[1]).toEqual(data.employees[0].loans[0].payments[1]);
});
test('missing closure preserves orphan payments and installment history with an audit warning', () => {
    const data = fixture(), originalClosureId = data.payrollClosures[0].id;
    data.payrollClosures = [];
    const before = JSON.stringify(data), result = planFinancialRecovery(data);
    expect(JSON.stringify(data)).toBe(before);
    expect(result.closures).toEqual([]);
    const employee = result.employees[0];
    expect(employee.loans[0].payments).toHaveLength(1);
    expect(employee.loans[0].payments[0]).toMatchObject({ id: 'p', amount: 100, payrollProjectId: 'A', payrollClosureId: originalClosureId });
    expect(employee.loans[0]).toMatchObject({ amount: 1000, balance: 900, projectRecovery: { missingClosureIds: [originalClosureId] } });
    expect(employee.deductions[0]).toMatchObject({ appliedAmount: 50, balance: 50,
        projectRecovery: { missingClosureIds: [originalClosureId] } });
    expect(employee.deductions[0].installments[0]).toEqual(data.employees[0].deductions[0].installments[0]);
    expect(employee.deductions[0].history).toEqual(data.employees[0].deductions[0].history);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ closureId: originalClosureId, employeeId: 'e' })]));
    const retry = planFinancialRecovery({ ...data, employees: result.employees, timestamp: 600 });
    expect(retry.employees).toEqual([]);
    expect(retry.closures).toEqual([]);
    expect(retry.warnings.length).toBeGreaterThan(0);
    const late = planFinancialRecovery({ ...data, employees: result.employees, payrollClosures: [closure()], timestamp: 700 });
    expect(late.closures).toHaveLength(1);
    expect(late.employees[0].loans[0].payments[0].payrollClosureId).toBe(late.closures[0].id);
    expect(late.employees[0].loans[0].projectRecovery.missingClosureIds).toBeUndefined();
    expect(late.warnings).toEqual([]);
});
test('an existing foreign closure still blocks an orphan payment', () => {
    const data = fixture(); data.payrollClosures[0].projectId = 'B';
    expect(() => planFinancialRecovery(data)).toThrow('pertenece a otra obra');
});
test('missing source recovered in another project cannot be claimed', () => {
    const data = fixture(), sourceId = data.payrollClosures[0].id;
    data.payrollClosures = [{ id: 'recovered-elsewhere', projectId: 'B', recovery: { sourceId } }];
    expect(() => planFinancialRecovery(data)).toThrow('otra obra');
});
test('missing closure of an already scoped record is not silently accepted', () => {
    const data = fixture(); data.payrollClosures = [];
    data.employees[0].loans[0].projectId = 'A';
    data.employees[0].loans[0].payments[0].payrollProjectId = 'A';
    expect(() => planFinancialRecovery(data)).toThrow('Falta un cierre');
});
test('a closure shared with an unselected employee cannot be partially recovered', () => {
    const data = fixture(); data.payrollClosures[0].rows.push({ ...data.payrollClosures[0].rows[0], employeeId: 'other' });
    expect(() => planFinancialRecovery(data)).toThrow('todos los empleados');
});
test('configuration recovery never replaces current destination rules', () => {
    const data = fixture();
    data.projectPayrollConfigs = [{ projectId: 'missing', hours: 8 }, { projectId: 'A', hours: 10 }];
    data.configurationSource = 'missing';
    expect(() => planFinancialRecovery(data)).toThrow('ya tiene configuración');
    data.projectPayrollConfigs.pop();
    expect(planFinancialRecovery(data).configs[0]).toMatchObject({ projectId: 'A', hours: 8 });
});
describe('atomic financial assignment', () => {
    let db, originalState, data;
    beforeEach(async () => {
        data = fixture(); data.employees[0].projectId = 'missing';
        originalState = stateManager._state.employees;
        db = new IndexedDBService('whole-financial-' + Math.random()); await db.init();
        for (const project of projects) await db.update('projects', project);
        await db.update('employees', data.employees[0]);
        await db.update('payrollClosures', data.payrollClosures[0]);
        stateManager.setState({ employees: data.employees }, { silent: true });
    });
    afterEach(() => { jest.restoreAllMocks(); db.db.close(); stateManager.setState({ employees: originalState }, { silent: true }); });
    const params = () => ({ action: REPAIR_ACTION.MAP_TO_EXISTING, targetProjectId: 'A',
        employees: [{ id: 'e' }], financialEmployeeIds: ['e'], recoverFinancial: true, _db: db });
    test('durable employee, closure, outbox and memory agree; repeat creates no duplicates', async () => {
        expect((await applyOwnershipRepair(params())).status).toBe(REPAIR_STATUS.OK);
        const employees = await db.getAll('employees'), closures = await db.getAll('payrollClosures');
        expect(closures).toHaveLength(2);
        expect(closures.find(c => c.id === data.payrollClosures[0].id)).toEqual(data.payrollClosures[0]);
        expect(employees[0].loans[0].payments[0].payrollProjectId).toBe('A');
        expect(stateManager._state.employees[0].loans).toEqual(employees[0].loans);
        expect(await db.getAll('mainSyncOutbox')).toHaveLength(1);
        expect((await applyOwnershipRepair(params())).status).toBe(REPAIR_STATUS.NO_OP);
        expect(await db.getAll('payrollClosures')).toHaveLength(2);
        expect(await db.getAll('mainSyncOutbox')).toHaveLength(1);
        db.db.close(); db.db = null; db.isInitialized = false; await db.init();
        expect((await db.getAll('employees'))[0]).toEqual(employees[0]);
    });
    test('missing closure recovery commits once and survives reload without inventing a closure', async () => {
        await db.clear('payrollClosures');
        const result = await applyOwnershipRepair(params());
        expect(result.status).toBe(REPAIR_STATUS.OK);
        expect(result.financialWarnings.length).toBeGreaterThan(0);
        const saved = (await db.getAll('employees'))[0];
        expect(saved.projectId).toBe('A');
        expect(saved.loans[0].payments).toHaveLength(1);
        expect(saved.loans[0].payments[0]).toMatchObject({ id: 'p', amount: 100,
            payrollProjectId: 'A', payrollClosureId: data.payrollClosures[0].id });
        expect(stateManager._state.employees[0]).toEqual(saved);
        expect(await db.getAll('payrollClosures')).toEqual([]);
        expect(await db.getAll('mainSyncOutbox')).toEqual([]);
        expect((await applyOwnershipRepair(params())).status).toBe(REPAIR_STATUS.NO_OP);
        db.db.close(); db.db = null; db.isInitialized = false; await db.init();
        expect((await db.getAll('employees'))[0]).toEqual(saved);
    });
    test('foreign closure conflict leaves personnel and financial stores unchanged', async () => {
        await db.update('payrollClosures', { ...data.payrollClosures[0], projectId: 'B' });
        expect((await applyOwnershipRepair(params())).status).toBe(REPAIR_STATUS.CONFLICT);
        expect((await db.getAll('employees'))[0]).toEqual(data.employees[0]);
        expect(await db.getAll('mainSyncOutbox')).toEqual([]);
    });
    test('outbox failure rolls back employee and recovered closure together', async () => {
        const transaction = db.db.transaction.bind(db.db);
        jest.spyOn(db.db, 'transaction').mockImplementation((...args) => {
            const tx = transaction(...args);
            if (args[1] === 'readwrite' && [...args[0]].includes('mainSyncOutbox')) {
                tx.objectStore('mainSyncOutbox').put = () => { throw new Error('outbox failure'); };
            }
            return tx;
        });
        await expect(applyOwnershipRepair(params())).rejects.toThrow();
        expect((await db.getAll('employees'))[0]).toEqual(data.employees[0]);
        expect(await db.getAll('payrollClosures')).toEqual(data.payrollClosures);
        expect(stateManager._state.employees[0]).toEqual(data.employees[0]);
    });
});
