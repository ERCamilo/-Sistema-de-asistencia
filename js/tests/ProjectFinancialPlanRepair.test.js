import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { stateManager } from '../modules/core/AppState.js';
import { applyOwnershipRepair, REPAIR_ACTION, REPAIR_STATUS } from '../modules/features/projects/ProjectOwnershipRepairService.js';
import { reviewFinancialPlanRepair } from '../modules/features/projects/ProjectFinancialPlanRepair.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
export const virginPlan = () => ({
    id: 'plan', recordType: 'payroll-adjustment-installment-plan', version: 1, employeeId: 'e',
    projectId: 'missing', kind: 'deductions', type: 'fixed', name: 'Descuento',
    status: 'active', totalAmount: 100, balance: 100, appliedAmount: 0, appliedInstallments: 0,
    installmentCount: 2, firstPeriodStart: '2026-09-01', updatedAt: 10, history: [],
    installments: [{ id: 'i1', amount: 50, appliedAmount: 0, status: 'pending' },
        { id: 'i2', amount: 50, appliedAmount: 0, status: 'pending' }]
});
const projects = [{ id: 'A', name: 'Obra A', status: 'active' }, { id: 'B', name: 'Obra B', status: 'active' }];
const employee = plan => ({ id: 'e', projectId: 'A', deductions: [plan], loans: [{ id: 'loan', amount: 500, payments: [{ id: 'pay', amount: 20 }] }] });
describe('financial plan ownership recovery', () => {
    let db, old;
    beforeEach(async () => {
        old = stateManager._state.employees;
        db = new IndexedDBService('financial-plan-' + Math.random()); await db.init();
        for (const project of projects) await db.update('projects', project);
        const emp = employee(virginPlan());
        await db.update('employees', emp);
        stateManager.setState({ employees: [emp] }, { silent: true });
    });
    afterEach(() => { db.db.close(); stateManager.setState({ employees: old }, { silent: true }); });
    const params = () => ({
        action: REPAIR_ACTION.MAP_FINANCIAL_PLAN, employees: [{ id: 'e' }], _db: db,
        financialPlan: { employeeId: 'e', kind: 'deductions', planId: 'plan',
            expectedProjectId: 'missing', expectedUpdatedAt: 10, targetProjectId: 'A' }
    });
    test('only ownership and timestamps change; all money, dates, ids and loans stay identical', async () => {
        expect((await applyOwnershipRepair(params())).status).toBe(REPAIR_STATUS.OK);
        const saved = (await db.getAll('employees'))[0];
        expect(saved.deductions[0]).toEqual({ ...virginPlan(), projectId: 'A', updatedAt: expect.any(Number) });
        expect(saved.loans).toEqual(employee(virginPlan()).loans);
        expect(stateManager._state.employees[0].deductions[0].projectId).toBe('A');
        expect((await applyOwnershipRepair(params())).status).toBe(REPAIR_STATUS.NO_OP);
    });
    test.each([
        { appliedAmount: 50 },
        { history: [{ action: 'applied', voided: true }] },
        { status: 'completed' },
        { projectId: 'B' },
        { balance: 80 },
        { employeeId: 'other' },
        { updatedAt: 20 }
    ])('rejects unsafe or stale plans without writes: %j', async patch => {
        const before = employee({ ...virginPlan(), ...patch });
        await db.update('employees', before);
        const result = await applyOwnershipRepair(params());
        expect(result.status).toBe(REPAIR_STATUS.CONFLICT);
        expect((await db.getAll('employees'))[0]).toEqual(before);
    });
    test('a changed employee destination invalidates an earlier confirmation', async () => {
        const before = { ...employee(virginPlan()), projectId: 'B' };
        await db.update('employees', before);
        expect((await applyOwnershipRepair(params())).status).toBe(REPAIR_STATUS.CONFLICT);
        expect((await db.getAll('employees'))[0]).toEqual(before);
    });
    test('preview rejects absent or duplicate installments', () => {
        const plan = virginPlan(); plan.installments[1].id = 'i1';
        expect(reviewFinancialPlanRepair(employee(plan), 'deductions', 'plan', projects).ok).toBe(false);
    });
});
