import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { ProjectScopedGateError } from 'actual/config/TandaBGate.js';
import { resetEntityScope, replaceEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { PayrollClosureStore } from 'actual/features/payroll/PayrollClosureStore.js';
import { PayrollClosureRepository } from 'actual/features/payroll/PayrollClosureRepository.js';
import { buildPayrollClosureDraft } from 'actual/features/payroll/PayrollClosureWorkflow.js';
import { createLoan, recordPayment } from 'actual/features/loans/LoansService.js';
import { attachPayrollAdjustmentPlans } from 'actual/features/payroll/PayrollAdjustmentPlanRepository.js';
import { applyManualAdjustmentMovement } from 'actual/features/payroll/PayrollAdjustmentManualMovement.js';
import { createPayrollAdjustmentInstallmentPlans } from 'actual/features/payroll/PayrollAdjustmentInstallmentPlan.js';
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

    test('PayrollClosureRepository.subscribeRecent is the protected B3.5 manual read seam', () => {
        expect(() => PayrollClosureRepository.subscribeRecent(() => {})).toThrow('sesión');
    });

    test('PayrollClosureWorkflow buildPayrollClosureDraft blocked without mutation', async () => {
        const employees = [{ id: 'E-A', name: 'Ana', number: '12' }];
        await expectGateErrorAsync(() => buildPayrollClosureDraft({ employees, rows: closureDraftRows(), periodStart: '2026-01-01', periodEnd: '2026-01-15' }));
    });

    test('scoped adjustments allowed in-scope and reject cross-project attachment', () => {
        const empA = { id: 'E-A', projectId: A, bonuses: [], deductions: [] };
        const [planA] = createPayrollAdjustmentInstallmentPlans({
            kind: 'bonuses',
            employeeIds: ['E-A'],
            name: 'Bono A',
            totalAmount: 100,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-01-01',
            createdAt: Date.now(),
            projectId: A
        }, { createId: prefix => `${prefix}-1` });
        const attached = attachPayrollAdjustmentPlans([empA], [planA]);
        expect(attached[0].bonuses).toHaveLength(1);
        expect(attached[0].bonuses[0].id).toBe(planA.id);

        // Negative assertion: cross-project plan attachment is rejected
        const empB = { id: 'E-B', projectId: B, bonuses: [], deductions: [] };
        const [planCross] = createPayrollAdjustmentInstallmentPlans({
            kind: 'bonuses',
            employeeIds: ['E-B'],
            name: 'Bono Cross',
            totalAmount: 100,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-01-01',
            createdAt: Date.now(),
            projectId: A
        }, { createId: prefix => `${prefix}-cross` });
        expect(() => attachPayrollAdjustmentPlans([empB], [planCross])).toThrow(/El plan pertenece al proyecto "PRJ-A-GATE" pero el empleado pertenece a "PRJ-B-GATE"/);
    });

    test('scheduled manual adjustment movements allowed in-scope and reject cross-project', () => {
        const [planA] = createPayrollAdjustmentInstallmentPlans({
            kind: 'bonuses',
            employeeIds: ['E-A'],
            name: 'Bono A',
            totalAmount: 100,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-01-01',
            createdAt: Date.now(),
            projectId: A
        }, { createId: prefix => `${prefix}-1` });
        const empA = { id: 'E-A', projectId: A, bonuses: [planA], deductions: [] };
        const result = applyManualAdjustmentMovement(empA, { kind: 'bonuses', planId: planA.id, id: 'mov1', amount: 10, recordedBy: 'admin', type: 'pause', date: '2026-01-01' });
        expect(result.employee.bonuses[0].history).toHaveLength(1);

        // Negative assertion: cross-project plan movement is rejected
        const [planB] = createPayrollAdjustmentInstallmentPlans({
            kind: 'bonuses',
            employeeIds: ['E-A'],
            name: 'Bono B',
            totalAmount: 100,
            installmentCount: 1,
            singlePayment: true,
            firstPeriodStart: '2026-01-01',
            createdAt: Date.now(),
            projectId: B
        }, { createId: prefix => `${prefix}-2` });
        const empCross = { id: 'E-A', projectId: A, bonuses: [planB], deductions: [] };
        expect(() => applyManualAdjustmentMovement(empCross, { kind: 'bonuses', planId: planB.id, id: 'mov2', amount: 10, type: 'pause', date: '2026-01-01' })).toThrow(/El plan no pertenece al proyecto del empleado/);
    });

    test('scheduled installment settlement blocked', () => {
        const emp = { id: 'E-A', bonuses: [], deductions: [] };
        const closure = { id: 'PAYROLL-CLOSURE-sched', periodStart: '2026-01-01', periodEnd: '2026-01-15', rows: [] };
        expectGateError(() => applyPayrollAdjustmentInstallmentsForClosure([emp], closure));
    });

    test('loan ops allowed in-scope and reject foreign employee (createLoan, recordPayment)', () => {
        const empInScope = { id: 'E-A', name: 'Ana', number: '12', projectId: A, loans: [] };
        const loan = createLoan(empInScope, { principal: 1000, startDate: '2026-01-01', concept: 'In-scope loan' });
        expect(loan.principal).toBe(1000);
        expect(empInScope.loans.length).toBe(1);

        const payment = recordPayment(empInScope, loan.id, { amount: 100, date: '2026-01-02' });
        expect(payment.amount).toBe(100);
        expect(empInScope.loans[0].payments.length).toBe(1);

        // Negative assertion: foreign employee belonging to another project is rejected
        const empForeign = { id: 'E-FOREIGN', name: 'Foreign', number: '99', projectId: B, loans: [] };
        expectGateError(() => createLoan(empForeign, { principal: 1000, startDate: '2026-01-01', concept: 'Test' }));
        expect(empForeign.loans.length).toBe(0);
    });

    test('PayrollLoanSettlement build/apply blocked', () => {
        expectGateError(() => buildPayrollLoanSettlementBatch({ employees: [], rows: [], periodStart: '2026-01-01', periodEnd: '2026-01-15' }));
        expectGateError(() => confirmPayrollPaid('fp-preview'));
    });

    test('definitive payment blocked (ProfileController.markAsPaid)', () => {
        // Direct call without flag bypass: should throw when ON
        expectGateError(() => ProfileController.markAsPaid());
    });

    test('scoped JSON/PDF/SplitX exports allowed and contain only active project rows', async () => {
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
        configs.get(A).payPeriod = { periodStart: '2026-01-01', periodLength: 15, payDay: '2026-01-01' };
        const store = { getConfig: async id => configs.get(id) || null, putConfig: async c => { configs.set(c.projectId, c); return c; } };
        const events = { subscribe: () => () => {} };
        const runtime = new ProjectPayrollUIRuntime({ state, configStore: store, projectContext: events });
        let clipboard = '';
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn(async t => { clipboard = t; }) }, configurable: true });
        global.URL.createObjectURL = jest.fn(() => 'blob:mock');
        global.URL.revokeObjectURL = jest.fn();
        window.open = jest.fn(() => ({ postMessage: jest.fn() }));
        const mockDoc = { internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } }, setFillColor: jest.fn(), rect: jest.fn(), setFontSize: jest.fn(), setFont: jest.fn(), setTextColor: jest.fn(), text: jest.fn(), autoTable: jest.fn(), lastAutoTable: { finalY: 60 }, save: jest.fn() };
        window.jspdf = { jsPDF: jest.fn(() => mockDoc) };
        window.jspdf.jsPDF.API = { autoTable: jest.fn() };

        PayrollUI.init({ state, services: { payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 800, neto: 800, breakdown: [] }) }, payrollRuntime: runtime }, render: () => {} });
        await PayrollUI.refreshScopedPayrollPreview();

        expect(() => PayrollUI.copyExportJSON()).not.toThrow();
        expect(clipboard).toContain('Ana');
        expect(() => PayrollUI.downloadExportJSON()).not.toThrow();
        expect(() => PayrollUI.sendToSplitX()).not.toThrow();
        await expect(PayrollUI.exportPayrollPDF()).resolves.not.toThrow();
        runtime.dispose();
    });

    test('economic history is readable under Projects ON while mutations remain gated', async () => {
        await expect(PayrollUI.loadPayrollHistory()).resolves.toBeUndefined();
        await expect(PayrollUI.openPayrollHistoryDetail('some-id')).resolves.toBeUndefined();
        await expectGateErrorAsync(() => PayrollUI.openPayrollClosure());
        await expectGateErrorAsync(() => PayrollUI.undoPayrollClosure('some-id'));
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

    test('scoped desktop adjustments update and isolate without touching global defaults', () => {
        const testState = {
            employees: [],
            exportConfig: {
                periodStart: '2026-01-01',
                periodEnd: '2026-01-15',
                deductions: [{ id: 'DED-A6', type: 'fixed', value: 100, name: 'AFP', employeeId: 'E-A', employeeName: 'Ana' }],
                bonuses: []
            },
            settings: { payrollDefaults: { deductions: [], bonuses: [] } }
        };
        const render = jest.fn();
        const save = jest.fn();
        PayrollUI.init({ state: testState, services: { payroll: { calculateEmployeePayroll: jest.fn() } }, render, saveToLocalStorage: save });
        window.showNotification = jest.fn();

        const target = { dataset: { index: '0' }, closest: jest.fn(() => null) };
        expect(() => PayrollUI.removeDesktopAdjustment('deductions', target)).not.toThrow();
        expect(testState.exportConfig.deductions).toHaveLength(0);
        // Negative assertion: global settings defaults are completely untouched
        expect(testState.settings.payrollDefaults.deductions).toHaveLength(0);
    });

    test('scoped export deduction operations mutate scoped state and preserve global isolation', () => {
        const testState = {
            employees: [],
            exportConfig: {
                periodStart: '2026-01-01',
                periodEnd: '2026-01-15',
                deductions: [{ id: 'DED-A6', type: 'fixed', value: 100, name: 'AFP', remembered: true }],
                bonuses: []
            },
            settings: { payrollDefaults: { deductions: [], bonuses: [] } }
        };
        const render = jest.fn();
        const save = jest.fn();
        PayrollUI.init({ state: testState, services: { payroll: { calculateEmployeePayroll: jest.fn() } }, render, saveToLocalStorage: save });
        window.showNotification = jest.fn();

        expect(() => PayrollUI.updateExportDeductionValue(0, '250')).not.toThrow();
        expect(testState.exportConfig.deductions[0].value).toBe(250);
        expect(() => PayrollUI.updateExportDeductionName(0, 'AFP-Changed')).not.toThrow();
        expect(testState.exportConfig.deductions[0].name).toBe('AFP-Changed');
        expect(() => PayrollUI.updateExportDeductionType(0, 'percentage')).not.toThrow();
        expect(testState.exportConfig.deductions[0].type).toBe('percentage');
        expect(() => PayrollUI.removeExportDeduction(0)).not.toThrow();
        expect(testState.exportConfig.deductions).toHaveLength(0);

        // Negative assertion: global settings defaults are preserved intact
        expect(testState.settings.payrollDefaults.deductions).toHaveLength(0);
    });

    test('scoped export bonus operations mutate scoped state and preserve global isolation', () => {
        const testState = {
            employees: [],
            exportConfig: {
                periodStart: '2026-01-01',
                periodEnd: '2026-01-15',
                deductions: [],
                bonuses: [{ id: 'BON-A6', type: 'fixed', value: 50, name: 'Bono', remembered: true }]
            },
            settings: { payrollDefaults: { deductions: [], bonuses: [] } }
        };
        const render = jest.fn();
        const save = jest.fn();
        PayrollUI.init({ state: testState, services: { payroll: { calculateEmployeePayroll: jest.fn() } }, render, saveToLocalStorage: save });
        window.showNotification = jest.fn();

        expect(() => PayrollUI.updateExportBonusValue(0, '75')).not.toThrow();
        expect(testState.exportConfig.bonuses[0].value).toBe(75);
        expect(() => PayrollUI.updateExportBonusName(0, 'Bono-Changed')).not.toThrow();
        expect(testState.exportConfig.bonuses[0].name).toBe('Bono-Changed');
        expect(() => PayrollUI.updateExportBonusType(0, 'percentage')).not.toThrow();
        expect(testState.exportConfig.bonuses[0].type).toBe('percentage');
        expect(() => PayrollUI.removeExportBonus(0)).not.toThrow();
        expect(testState.exportConfig.bonuses).toHaveLength(0);

        // Negative assertion: global settings defaults are preserved intact
        expect(testState.settings.payrollDefaults.bonuses).toHaveLength(0);
    });

    test('scoped UI exposes safe navigation/read surfaces but no economic mutation actions', async () => {
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
        expect(html).toContain('change-payroll-view-mode');
        expect(html).toContain('Préstamos / Adelantos');
        expect(html).toContain('Historial');
        expect(html).toContain('copy-export-json');
        expect(html).toContain('download-export-json');
        expect(html).toContain('export-payroll-pdf');
        expect(html).toContain('send-to-splitx');
        for (const forbidden of ['open-payroll-closure','toggle-payroll-paid','add-export-deduction','add-export-bonus']) {
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

    test('OFF: A6 durable export deduction paths preserve legacy mutations', () => {
        const testState = {
            employees: [],
            exportConfig: {
                periodStart: '2026-01-01',
                periodEnd: '2026-01-15',
                deductions: [
                    { id: 'DED-OFF', type: 'fixed', value: 100, name: 'AFP', remembered: true },
                    { id: 'DED-OFF-2', type: 'fixed', value: 10, name: 'Extra', remembered: false }
                ],
                bonuses: []
            },
            settings: { payrollDefaults: { deductions: [], bonuses: [] } }
        };
        const render = jest.fn();
        const save = jest.fn();
        PayrollUI.init({ state: testState, services: { payroll: { calculateEmployeePayroll: jest.fn() } }, render, saveToLocalStorage: save });
        window.showNotification = jest.fn();
        if (!window.renderOptimizer) window.renderOptimizer = { scheduleRender: () => {} };
        PayrollUI.updateExportDeductionType(0, 'percentage');
        expect(testState.exportConfig.deductions[0].type).toBe('percentage');
        PayrollUI.updateExportDeductionValue(0, '250');
        expect(testState.exportConfig.deductions[0].value).toBe(250);
        PayrollUI.updateExportDeductionName(0, 'AFP-Updated');
        expect(testState.exportConfig.deductions[0].name).toBe('AFP-Updated');
        PayrollUI.toggleRememberGlobalAdjustment('deductions', 0, false);
        expect(testState.exportConfig.deductions[0].remembered).toBe(false);
        expect(save).toHaveBeenCalled();
        const countBefore = testState.exportConfig.deductions.length;
        PayrollUI.removeExportDeduction(1);
        expect(testState.exportConfig.deductions.length).toBe(countBefore - 1);
    });

    test('OFF: A6 durable export bonus paths preserve legacy mutations', () => {
        const testState = {
            employees: [],
            exportConfig: {
                periodStart: '2026-01-01',
                periodEnd: '2026-01-15',
                deductions: [],
                bonuses: [
                    { id: 'BON-OFF', type: 'fixed', value: 50, name: 'Bono', remembered: true },
                    { id: 'BON-OFF-2', type: 'fixed', value: 20, name: 'Extra', remembered: false }
                ]
            },
            settings: { payrollDefaults: { deductions: [], bonuses: [] } }
        };
        const render = jest.fn();
        const save = jest.fn();
        PayrollUI.init({ state: testState, services: { payroll: { calculateEmployeePayroll: jest.fn() } }, render, saveToLocalStorage: save });
        window.showNotification = jest.fn();
        if (!window.renderOptimizer) window.renderOptimizer = { scheduleRender: () => {} };
        PayrollUI.updateExportBonusType(0, 'percentage');
        expect(testState.exportConfig.bonuses[0].type).toBe('percentage');
        PayrollUI.updateExportBonusValue(0, '75');
        expect(testState.exportConfig.bonuses[0].value).toBe(75);
        PayrollUI.updateExportBonusName(0, 'Bono-Updated');
        expect(testState.exportConfig.bonuses[0].name).toBe('Bono-Updated');
        const countBefore = testState.exportConfig.bonuses.length;
        PayrollUI.removeExportBonus(1);
        expect(testState.exportConfig.bonuses.length).toBe(countBefore - 1);
    });

    test('OFF: A6 desktop adjustment paths preserve legacy behavior without gate', () => {
        const testState = {
            employees: [],
            exportConfig: {
                periodStart: '2026-01-01',
                periodEnd: '2026-01-15',
                deductions: [{ id: 'DED-OFF-DESK', type: 'fixed', value: 100, name: 'AFP', employeeId: 'E-A', employeeName: 'Ana' }],
                bonuses: []
            },
            settings: { payrollDefaults: { deductions: [], bonuses: [] } }
        };
        const render = jest.fn();
        const save = jest.fn();
        PayrollUI.init({ state: testState, services: { payroll: { calculateEmployeePayroll: jest.fn() } }, render, saveToLocalStorage: save });
        window.showNotification = jest.fn();
        let gateThrown = false;
        try {
            PayrollUI.removeDesktopAdjustment('deductions', { dataset: { index: '0' } });
        } catch (e) {
            gateThrown = e && e.code === 'TANDA_B_BLOCKED_WHEN_SCOPED';
        }
        expect(gateThrown).toBe(false);
        expect(testState.exportConfig.deductions.length).toBe(0);
        expect(render).toHaveBeenCalled();
        gateThrown = false;
        try {
            PayrollUI.updateDesktopAdjustment('deductions', { dataset: { index: '0' }, closest: () => null });
        } catch (e) {
            gateThrown = e && e.code === 'TANDA_B_BLOCKED_WHEN_SCOPED';
        }
        expect(gateThrown).toBe(false);
    });
});
