import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { ProjectScopedGateError } from 'actual/config/TandaBGate.js';
import { resetEntityScope, replaceEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { PayrollClosureStore } from 'actual/features/payroll/PayrollClosureStore.js';
import { PayrollClosureRepository } from 'actual/features/payroll/PayrollClosureRepository.js';
import { buildPayrollClosureDraft } from 'actual/features/payroll/PayrollClosureWorkflow.js';
import { createLoan, recordPayment } from 'actual/features/loans/LoansService.js';
import { attachPayrollAdjustmentPlans } from 'actual/features/payroll/PayrollAdjustmentPlanRepository.js';
import { applyManualAdjustmentMovement } from 'actual/features/payroll/PayrollAdjustmentManualMovement.js';
import { buildPayrollLoanSettlementBatch, confirmPayrollPaid } from 'actual/features/payroll/PayrollLoanSettlement.js';
import { applyPayrollAdjustmentInstallmentsForClosure } from 'actual/features/payroll/PayrollAdjustmentInstallmentSettlement.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';
import * as ProfileController from 'actual/features/profile/ProfileController.js';

const A = 'PRJ-A-GATE';
const B = 'PRJ-B-GATE';
const DEFAULT = 'PRJ-DEFAULT-GATE';

function fakeDb() {
    return {
        atomicMutate: jest.fn(async () => ({ id: 'x' })),
        atomicMutateWithBatches: jest.fn(async () => ({ id: 'x' })),
        get: jest.fn(async () => null),
        query: jest.fn(async () => []),
        getPageByIndex: jest.fn(async () => []),
        getAll: jest.fn(async () => [])
    };
}

function closureDraftRows() {
    return [{
        id: 12, nombre: 'Ana (Ref #12)', monto: 1000,
        _brutoOriginal: 1000, _bonuses: 0, _deductions: 0, _loans: 0,
        _employeeId: 'E-A', _employeeName: 'Ana', _number: '12', _positionBreakdown: []
    }];
}

function expectGateError(fn) {
    let err;
    try { fn(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ProjectScopedGateError);
    expect(err.message).toMatch(/^Tanda B blocked:/);
    expect(err.code).toBe('TANDA_B_BLOCKED_WHEN_SCOPED');
}

async function expectGateErrorAsync(fn) {
    let err;
    try { await fn(); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ProjectScopedGateError);
    expect(err.message).toMatch(/^Tanda B blocked:/);
    expect(err.code).toBe('TANDA_B_BLOCKED_WHEN_SCOPED');
}

describe('Tanda B gates — with projects ON all B operations blocked before mutation', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: DEFAULT });
    });
    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('PayrollClosureStore.save blocked before IDB write', async () => {
        const db = fakeDb();
        const store = new PayrollClosureStore({ db });
        const before = db.atomicMutate.mock.calls.length;
        await expectGateErrorAsync(() => store.save({ id: 'PAYROLL-CLOSURE-x', fingerprint: 'fp', status: 'closed', periodStart: '2026-01-01', periodEnd: '2026-01-15', rows: closureDraftRows(), totals: {}, employeeCount: 1, closedAt: Date.now() }));
        expect(db.atomicMutate).toHaveBeenCalledTimes(before);
    });

    test('PayrollClosureStore.saveWithEmployees blocked without partial batches', async () => {
        const db = fakeDb();
        const store = new PayrollClosureStore({ db });
        await expectGateErrorAsync(() => store.saveWithEmployees({ id: 'PAYROLL-CLOSURE-x2', fingerprint: 'fp2', status: 'closed', periodStart: '2026-01-01', periodEnd: '2026-01-15', rows: closureDraftRows(), totals: {}, employeeCount: 1, closedAt: Date.now() }, [{ id: 'E-A' }]));
        expect(db.atomicMutateWithBatches).not.toHaveBeenCalled();
    });

    test('PayrollClosureStore history scoped via project-aware indexes (B2.2) — not blocked', async () => {
        const db = fakeDb();
        const store = new PayrollClosureStore({ db });
        await store.listPage({});
        await store.getByPeriod('2026-01-01', '2026-01-15');
        expect(db.getPageByIndex).toHaveBeenCalled();
        expect(db.getPageByIndex.mock.calls[0][1]).toMatch(/project/);
        expect(db.query).toHaveBeenCalledWith('payrollClosures', 'projectId', A);
    });

    test('PayrollClosureStore.getById scoped (B from A returns null) — B2.2 not blocked', async () => {
        const db = fakeDb();
        db.get.mockResolvedValue({ id: 'some-id', projectId: B, status: 'closed', periodStart: '2026-01-01', periodEnd: '2026-01-15' });
        const store = new PayrollClosureStore({ db });
        await expect(store.getById('some-id')).resolves.toBeNull();
        expect(db.get).toHaveBeenCalledWith('payrollClosures', 'some-id');
        db.get.mockResolvedValue({ id: 'some-id', projectId: A, status: 'closed', periodStart: '2026-01-01', periodEnd: '2026-01-15' });
        await expect(store.getById('some-id')).resolves.toMatchObject({ projectId: A });
    });

    test('PayrollClosureStore.getSyncStates scoped via owned lookup (B2.2) — not blocked', async () => {
        const db = fakeDb();
        db.query.mockResolvedValue([{ id: 'id1', projectId: A }]);
        db.getAll.mockResolvedValue([{ closureId: 'id1', kind: 'payrollClosureBundle', status: 'pending' }, { closureId: 'id2', kind: 'payrollClosureBundle', status: 'pending' }]);
        const store = new PayrollClosureStore({ db });
        const states = await store.getSyncStates(['id1', 'id2']);
        expect(db.query).toHaveBeenCalledWith('payrollClosures', 'projectId', A);
        expect(db.getAll).toHaveBeenCalled();
        expect(states['id1']).toBe('pending');
        expect(states['id2']).toBe('synced');
    });

    test('PayrollClosureRepository.subscribeRecent remains blocked until B3.5', async () => {
        await expectGateErrorAsync(() => PayrollClosureRepository.subscribeRecent(() => {}));
    });

    test('PayrollClosureWorkflow buildPayrollClosureDraft blocked without mutation', async () => {
        const employees = [{ id: 'E-A', name: 'Ana', number: '12' }];
        await expectGateErrorAsync(() => buildPayrollClosureDraft({ employees, rows: closureDraftRows(), periodStart: '2026-01-01', periodEnd: '2026-01-15' }));
    });

    test('persisted adjustments blocked (attachPayrollAdjustmentPlans)', () => {
        expectGateError(() => attachPayrollAdjustmentPlans([{ id: 'E-A', bonuses: [], deductions: [] }], [{ id: 'plan1', kind: 'bonuses', employeeId: 'E-A', type: 'fixed', groupId: 'g1', firstPeriodStart: '2026-01-01', installmentCount: 1, totalAmount: 100, status: 'active', installments: [], history: [] }]));
    });

    test('scheduled adjustments blocked (applyManualAdjustmentMovement)', () => {
        const emp = { id: 'E-A', bonuses: [{ id: 'plan1', kind: 'bonuses', employeeId: 'E-A', type: 'fixed', groupId: 'g1', status: 'active', balance: 100, installments: [{ id: 'inst1', sequence: 1, status: 'pending', appliedAmount: 0, scheduledAmount: 100 }], history: [] }], deductions: [] };
        expectGateError(() => applyManualAdjustmentMovement(emp, { kind: 'bonuses', planId: 'plan1', id: 'mov1', amount: 10, date: '2026-01-01', recordedBy: 'tester' }));
    });

    test('scheduled installment settlement blocked', () => {
        const emp = { id: 'E-A', bonuses: [], deductions: [] };
        const closure = { id: 'PAYROLL-CLOSURE-sched', periodStart: '2026-01-01', periodEnd: '2026-01-15', rows: [] };
        expectGateError(() => applyPayrollAdjustmentInstallmentsForClosure([emp], closure));
    });

    test('loan ops blocked (createLoan, recordPayment)', () => {
        const emp = { id: 'E-A', name: 'Ana', number: '12', loans: [] };
        expectGateError(() => createLoan(emp, { principal: 1000, startDate: '2026-01-01', concept: 'Test' }));
        expect(emp.loans.length).toBe(0);
        const emp2 = { id: 'E-A', loans: [{ id: 'L1', principal: 1000, interestRate: 0, status: 'active', payments: [], createdAt: Date.now(), updatedAt: Date.now(), seq: 1, startDate: '2026-01-01' }] };
        expectGateError(() => recordPayment(emp2, 'L1', { amount: 100, date: '2026-01-02' }));
        expect(emp2.loans[0].payments.length).toBe(0);
    });

    test('PayrollLoanSettlement build/apply blocked', () => {
        expectGateError(() => buildPayrollLoanSettlementBatch({ employees: [], rows: [], periodStart: '2026-01-01', periodEnd: '2026-01-15' }));
        expectGateError(() => confirmPayrollPaid('fp-preview'));
    });

    test('definitive payment blocked (ProfileController.markAsPaid)', () => {
        // Direct call without flag bypass: should throw when ON
        expectGateError(() => ProfileController.markAsPaid());
    });

    test('final exports blocked (PayrollUI)', () => {
        expectGateError(() => PayrollUI.copyExportJSON());
        expectGateError(() => PayrollUI.downloadExportJSON());
        expectGateError(() => PayrollUI.sendToSplitX());
        // async PDF must reject with gate
        return expectGateErrorAsync(() => PayrollUI.exportPayrollPDF());
    });

    test('economic history blocked (PayrollUI.loadPayrollHistory / openPayrollHistoryDetail)', async () => {
        await expectGateErrorAsync(() => PayrollUI.loadPayrollHistory());
        await expectGateErrorAsync(() => PayrollUI.openPayrollHistoryDetail('some-id'));
    });

    test('definitive payment blocked (PayrollUI.togglePayrollPaidConfirmation)', () => {
        expectGateError(() => PayrollUI.togglePayrollPaidConfirmation(true));
    });

    test('ON gate does not perform partial write — state snapshot unchanged', () => {
        const emp = { id: 'E-A', name: 'Ana', loans: [] };
        const before = JSON.stringify(emp);
        try { createLoan(emp, { principal: 500, startDate: '2026-01-01' }); } catch (_) {}
        expect(JSON.stringify(emp)).toBe(before);
        expect(emp.loans.length).toBe(0);
    });

    test('UI remains hidden: ScopedPayrollTab does not expose B surfaces', async () => {
        // Init scoped UI with runtime ON
        const { ProjectPayrollUIRuntime } = await import('actual/features/payroll/ProjectPayrollUIRuntime.js');
        const { createDefaultConfig } = await import('actual/features/payroll/ProjectPayrollConfig.js');
        const state = {
            employees: [{ id: 'E-A', number: '12', name: 'Ana', projectId: A, active: true, positions: ['P-A'] }],
            positions: [{ id: 'P-A', name: 'Role', projectId: A, hourlyRate: 100, workingDays: [1,2,3,4,5,6,0] }],
            leaders: [], attendance: { 'E-A-2026-01-01': { employeeId: 'E-A', date: '2026-01-01', present: true, hoursWorked: 8, projectId: A } },
            settings: { companyName: 'Co', regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, holidays: [], payPeriod: { periodStart: '2026-01-01', periodLength: 15, payDay: '2026-01-01' }, defaultDeductionPercentage: 2 },
            exportConfig: { leaderFilter: 'all', deductions: [], bonuses: [] }, payrollViewMode: 'generator', settingsCalendarMonth: new Date('2026-01-01T12:00:00'), settingsCalendarMode: 'holiday'
        };
        const configs = new Map([[A, createDefaultConfig(A, state.settings)]]);
        // align periods
        configs.get(A).payPeriod = { periodStart: '2026-01-01', periodLength: 15, payDay: '2026-01-01' };
        const store = { getConfig: async id => configs.get(id) || null, putConfig: async c => { configs.set(c.projectId, c); return c; } };
        const events = { subscribe: () => () => {} };
        const runtime = new ProjectPayrollUIRuntime({ state, configStore: store, projectContext: events });
        // mock PayrollUI init
        PayrollUI.init({ state, services: { payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 800, neto: 800, breakdown: [] }) }, payrollRuntime: runtime }, render: () => {} });
        await PayrollUI.refreshScopedPayrollPreview();
        const html = PayrollUI.PayrollTab();
        for (const forbidden of ['copy-export-json','download-export-json','export-payroll-pdf','send-to-splitx','open-payroll-closure','toggle-payroll-paid','add-export-deduction','add-export-bonus','Préstamos / Adelantos','Historial','change-payroll-view-mode']) {
            expect(html).not.toContain(forbidden);
        }
        runtime.dispose();
    });
});

describe('Tanda B gates — with flag OFF legacy behavior preserved', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });
    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('OFF: LoansService.createLoan succeeds', () => {
        const emp = { id: 'E-OFF', name: 'Off', number: '99', loans: [] };
        const loan = createLoan(emp, { principal: 500, startDate: '2026-01-01', concept: 'OFF loan' });
        expect(loan.principal).toBe(500);
        expect(emp.loans.length).toBe(1);
    });

    test('OFF: PayrollClosureStore.save passes through (mocked DB)', async () => {
        const db = fakeDb();
        db.atomicMutate.mockResolvedValue({ id: 'PAYROLL-CLOSURE-off', fingerprint: 'fp-off', status: 'closed' });
        const store = new PayrollClosureStore({ db });
        const saved = await store.save({ id: 'PAYROLL-CLOSURE-off', fingerprint: 'fp-off', status: 'closed', periodStart: '2026-01-01', periodEnd: '2026-01-15', rows: closureDraftRows(), totals: {}, employeeCount: 1, closedAt: Date.now() });
        expect(saved.id).toBe('PAYROLL-CLOSURE-off');
        expect(db.atomicMutate).toHaveBeenCalled();
    });

    test('OFF: PayrollClosureStore.getById pass-through (mock db.get returns closure)', async () => {
        const db = fakeDb();
        const fakeClosure = { id: 'C-OFF', fingerprint: 'fp-off-b', status: 'closed', periodStart: '2026-01-01', periodEnd: '2026-01-15', closedAt: Date.now() };
        db.get.mockResolvedValue(fakeClosure);
        const store = new PayrollClosureStore({ db });
        const result = await store.getById('C-OFF');
        expect(result).toEqual(fakeClosure);
        expect(db.get).toHaveBeenCalledWith('payrollClosures', 'C-OFF');
        expect(db.get).toHaveBeenCalledTimes(1);
    });

    test('OFF: PayrollClosureStore.getSyncStates pass-through (mock db.getAll returns states)', async () => {
        const db = fakeDb();
        db.getAll.mockResolvedValue([
            { closureId: 'pending-id', kind: 'payrollClosureBundle', status: 'pending' },
            { closureId: 'dead-id', kind: 'payrollClosure', status: 'dead' }
        ]);
        const store = new PayrollClosureStore({ db });
        const states = await store.getSyncStates(['pending-id', 'dead-id', 'synced-id']);
        expect(states).toEqual({ 'pending-id': 'pending', 'dead-id': 'dead', 'synced-id': 'synced' });
        expect(db.getAll).toHaveBeenCalledWith('mainSyncOutbox');
        expect(db.getAll).toHaveBeenCalledTimes(1);
    });

    test('OFF: attachPayrollAdjustmentPlans not gated (validation runs)', () => {
        // With OFF, gate is disabled so next error is validation, not Tanda B blocked
        expect(() => attachPayrollAdjustmentPlans([], [])).toThrow(/Debes proporcionar al menos un plan/);
        expect(() => attachPayrollAdjustmentPlans(null, [])).toThrow(/lista de empleados/i);
    });

    test('OFF: confirmPayrollPaid not gated', () => {
        const fp = JSON.stringify({ periodStart: '2026-01-01', periodEnd: '2026-01-15', rows: [] });
        const c = confirmPayrollPaid(fp);
        expect(c.fingerprint).toBe(fp);
    });
});
