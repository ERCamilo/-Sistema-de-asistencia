import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { ProjectScopedGateError } from '../modules/config/TandaBGate.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    buildPayrollClosure,
    canonicalProjectId,
    PAYROLL_CLOSURE_STATUS
} from '../modules/features/payroll/PayrollClosure.js';
import {
    applyPayrollClosureEffects,
    buildPayrollClosureDraft,
    undoPayrollClosureEffects
} from '../modules/features/payroll/PayrollClosureWorkflow.js';
import {
    applyPayrollLoanSettlementBatch,
    buildPayrollLoanSettlementBatch,
    buildPayrollPreviewFingerprint,
    confirmPayrollPaid,
    undoPayrollLoanSettlementBatch
} from '../modules/features/payroll/PayrollLoanSettlement.js';
import defaultClosureStore, { PayrollClosureStore } from '../modules/features/payroll/PayrollClosureStore.js';
import defaultClosureSync from '../modules/features/payroll/PayrollClosureSync.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { ProjectPayrollUIRuntime } from '../modules/features/payroll/ProjectPayrollUIRuntime.js';
import { createDefaultConfig } from '../modules/features/payroll/ProjectPayrollConfig.js';

const PROJECT_A = 'PRJ-A-FOCAL';
const PROJECT_B = 'PRJ-B-FOCAL';
const DEFAULT_PROJECT = 'PRJ-DEFAULT-FOCAL';

class InMemoryFocalDB {
    constructor() {
        this.records = new Map();
        this.outbox = [];
        this.delayMs = 0;
    }
    async get(_, id) {
        if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
        const val = this.records.get(String(id));
        return val ? JSON.parse(JSON.stringify(val)) : undefined;
    }
    async query(_, indexName, value) {
        if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
        const matches = [...this.records.values()].filter(item => item[indexName] === value);
        return matches.map(val => JSON.parse(JSON.stringify(val)));
    }
    async getPageByIndex(_, indexName, options = {}) {
        if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
        let items = [...this.records.values()];
        if (indexName === 'projectClosedAtId') {
            const pid = options.lowerBound?.[0];
            items = items.filter(v => v.projectId === pid);
            items.sort((left, right) => (right.closedAt || 0) - (left.closedAt || 0) || right.id.localeCompare(left.id));
        } else if (indexName === 'projectStatusClosedAtId') {
            const [pid, status] = options.lowerBound || [];
            items = items.filter(v => v.projectId === pid && v.status === status);
            items.sort((left, right) => (right.closedAt || 0) - (left.closedAt || 0) || right.id.localeCompare(left.id));
        }
        return items.slice(0, options.limit || 20).map(val => JSON.parse(JSON.stringify(val)));
    }
    async getAll(storeName) {
        if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
        if (storeName === 'mainSyncOutbox') return this.outbox.map(val => JSON.parse(JSON.stringify(val)));
        return [];
    }
    async atomicMutate(_, id, mutator) {
        const existing = await this.get(_, id);
        const result = mutator(existing);
        if (result.write) {
            this.records.set(String(result.value.id), JSON.parse(JSON.stringify({
                ...result.value,
                periodKey: `${result.value.periodStart}:${result.value.periodEnd}`
            })));
        }
        return JSON.parse(JSON.stringify(result.value));
    }
    async atomicMutateWithBatches(_, id, mutator, batches = []) {
        const existing = await this.get(_, id);
        const result = mutator(existing);
        if (result.write) {
            this.records.set(String(result.value.id), JSON.parse(JSON.stringify({
                ...result.value,
                periodKey: `${result.value.periodStart}:${result.value.periodEnd}`
            })));
        }
        for (const batch of batches) {
            if (batch.storeName === 'mainSyncOutbox') {
                for (const op of batch.operations || []) {
                    this.outbox.push(op.value);
                }
            }
        }
        return JSON.parse(JSON.stringify(result.value));
    }
}

function makeEmployee({ id, name, number, projectId, loanAmount = 0 }) {
    const loans = [];
    if (loanAmount > 0) {
        loans.push({
            id: `LOAN-${id}`,
            concept: 'Adelanto',
            principal: loanAmount,
            total: loanAmount,
            amount: loanAmount,
            status: 'active',
            installmentMode: 'lump',
            installments: 1,
            payments: [],
            startDate: '2026-08-01',
            createdAt: 1
        });
    }
    return {
        id,
        nombre: name,
        numero: number,
        projectId,
        bonuses: [],
        deductions: [],
        loans
    };
}

function makePreviewRow({ employee, gross = 1000, loans = 0 }) {
    const net = gross - loans;
    const loanDetails = loans > 0 ? [{
        loanId: `LOAN-${employee.id}`,
        concept: 'Adelanto',
        installmentMode: 'single',
        balance: loans,
        selectedAmount: loans,
        selectedCharges: [{
            kind: 'lump',
            amount: loans,
            dueDate: '2026-08-01',
            installmentSeq: null,
            isInstallment: false,
            isDue: true
        }]
    }] : [];
    return {
        id: employee.id,
        nombre: employee.nombre,
        monto: net,
        _brutoOriginal: gross,
        _bonuses: 0,
        _deductions: 0,
        _loans: loans,
        _employeeId: employee.id,
        _employeeName: employee.nombre,
        _number: employee.numero,
        _positionBreakdown: [],
        _loanDetails: loanDetails
    };
}

describe('Payroll Closure & Loan Settlement — Projects ON Focal Suite', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        globalThis.currentUser = { uid: 'focal-test-user' };
        jest.spyOn(defaultClosureStore, 'getByPeriod').mockResolvedValue([]);
        jest.spyOn(defaultClosureSync, 'pullPeriod').mockResolvedValue({ closures: [], imported: 0, conflicts: [] });
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        delete globalThis.currentUser;
        jest.restoreAllMocks();
    });

    test('1. mismo #12 en A/B: isolated closures, fingerprints, and snapshots for distinct employees sharing the same visible number', () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const empA = makeEmployee({ id: 'EMP-A-12', name: 'Ana Obra A', number: '12', projectId: PROJECT_A });
        const empB = makeEmployee({ id: 'EMP-B-12', name: 'Beto Obra B', number: '12', projectId: PROJECT_B });

        const rowA = makePreviewRow({ employee: empA, gross: 1500 });
        const rowB = makePreviewRow({ employee: empB, gross: 2200 });

        const draftA = buildPayrollClosureDraft({
            employees: [empA, empB],
            rows: [rowA],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            projectId: PROJECT_A,
            closedAt: 1000,
            closedBy: 'admin-a'
        });

        replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });

        const draftB = buildPayrollClosureDraft({
            employees: [empA, empB],
            rows: [rowB],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            projectId: PROJECT_B,
            closedAt: 1000,
            closedBy: 'admin-b'
        });

        expect(draftA.closure.projectId).toBe(PROJECT_A);
        expect(draftB.closure.projectId).toBe(PROJECT_B);
        expect(draftA.closure.id).not.toBe(draftB.closure.id);
        expect(draftA.closure.fingerprint).not.toBe(draftB.closure.fingerprint);

        expect(draftA.closure.rows).toHaveLength(1);
        expect(draftA.closure.rows[0].employeeId).toBe('EMP-A-12');
        expect(draftA.closure.rows[0].employeeNumber).toBe('12');
        expect(draftA.closure.rows[0].net).toBe(1500);

        expect(draftB.closure.rows).toHaveLength(1);
        expect(draftB.closure.rows[0].employeeId).toBe('EMP-B-12');
        expect(draftB.closure.rows[0].employeeNumber).toBe('12');
        expect(draftB.closure.rows[0].net).toBe(2200);
    });

    test('2. cierre A no muta B: closing A modifies only A employees and leaves B employees and closures untouched', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const db = new InMemoryFocalDB();
        const store = new PayrollClosureStore({ db });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana A', number: '1', projectId: PROJECT_A, loanAmount: 300 });
        const empB = makeEmployee({ id: 'EMP-B-1', name: 'Beto B', number: '1', projectId: PROJECT_B, loanAmount: 500 });
        const employees = [empA, empB];

        const rowA = makePreviewRow({ employee: empA, gross: 1000, loans: 300 });

        const draftA = buildPayrollClosureDraft({
            employees,
            rows: [rowA],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            projectId: PROJECT_A,
            closedAt: 2000,
            closedBy: 'admin-a'
        });

        const empCopies = JSON.parse(JSON.stringify(employees));
        const effectsA = applyPayrollClosureEffects(empCopies, draftA, { now: 2000, recordedBy: 'admin-a' });

        expect(effectsA.affectedEmployeeIds).toEqual(['EMP-A-1']);
        expect(effectsA.affectedEmployeeIds).not.toContain('EMP-B-1');

        const mutatedA = empCopies.find(e => e.id === 'EMP-A-1');
        const untouchedB = empCopies.find(e => e.id === 'EMP-B-1');

        expect(mutatedA.loans[0].payments).toHaveLength(1);
        expect(mutatedA.loans[0].payments[0].payrollProjectId).toBe(PROJECT_A);

        expect(untouchedB.loans[0].payments).toHaveLength(0);
        expect(untouchedB).toEqual(empB);

        const affectedEmployees = empCopies.filter(e => effectsA.affectedEmployeeIds.includes(e.id));
        const savedClosure = await store.saveWithEmployees(draftA.closure, affectedEmployees, {
            enqueueCloud: true,
            schemaVersion: 20
        });

        expect(savedClosure.projectId).toBe(PROJECT_A);

        const activeA = await store.getByPeriod('2026-09-01', '2026-09-15');
        expect(activeA).toHaveLength(1);
        expect(activeA[0].id).toBe(savedClosure.id);

        replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
        const activeB = await store.getByPeriod('2026-09-01', '2026-09-15');
        expect(activeB).toHaveLength(0);
    });

    test('3. undo A no muta B: voiding closure A restores A loans and never modifies B employees or state', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const db = new InMemoryFocalDB();
        const store = new PayrollClosureStore({ db });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana A', number: '1', projectId: PROJECT_A, loanAmount: 400 });
        const empB = makeEmployee({ id: 'EMP-B-1', name: 'Beto B', number: '1', projectId: PROJECT_B, loanAmount: 600 });
        const employees = [empA, empB];

        const rowA = makePreviewRow({ employee: empA, gross: 1200, loans: 400 });
        const draftA = buildPayrollClosureDraft({
            employees,
            rows: [rowA],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            projectId: PROJECT_A,
            closedAt: 3000,
            closedBy: 'admin-a'
        });

        const empCopies = JSON.parse(JSON.stringify(employees));
        applyPayrollClosureEffects(empCopies, draftA, { now: 3000, recordedBy: 'admin-a' });
        const affectedA = empCopies.filter(e => e.id === 'EMP-A-1');
        const closedA = await store.saveWithEmployees(draftA.closure, affectedA, { schemaVersion: 20 });

        const undoResult = undoPayrollClosureEffects(empCopies, closedA, {
            now: 3500,
            voidedBy: 'admin-a',
            activeClosures: [closedA]
        });

        expect(undoResult.closure.status).toBe(PAYROLL_CLOSURE_STATUS.VOIDED);
        expect(undoResult.closure.projectId).toBe(PROJECT_A);
        expect(undoResult.voidedPaymentCount).toBe(1);

        const restoredA = empCopies.find(e => e.id === 'EMP-A-1');
        const pristineB = empCopies.find(e => e.id === 'EMP-B-1');

        expect(restoredA.loans[0].payments[0].voided).toBe(true);
        expect(pristineB.loans[0].payments).toHaveLength(0);
        expect(pristineB).toEqual(empB);

        const voidedA = await store.saveWithEmployees(undoResult.closure, [restoredA], { schemaVersion: 20 });
        expect(voidedA.status).toBe(PAYROLL_CLOSURE_STATUS.VOIDED);
        expect(voidedA.projectId).toBe(PROJECT_A);

        const activeListA = await store.getActiveByPeriod('2026-09-01', '2026-09-15');
        expect(activeListA).toHaveLength(0);

        replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
        const listB = await store.getByPeriod('2026-09-01', '2026-09-15');
        expect(listB).toHaveLength(0);
    });

    test('4. pago A no toca préstamo B: confirming payment and applying loan settlement for A settles only A and preserves B', () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana A', number: '1', projectId: PROJECT_A, loanAmount: 250 });
        const empB = makeEmployee({ id: 'EMP-B-1', name: 'Beto B', number: '1', projectId: PROJECT_B, loanAmount: 750 });
        const employees = [empA, empB];

        const rowA = makePreviewRow({ employee: empA, gross: 1000, loans: 250 });
        const rowB = makePreviewRow({ employee: empB, gross: 1000, loans: 750 });

        const fpA = buildPayrollPreviewFingerprint({
            projectId: PROJECT_A,
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            rows: [rowA]
        });

        const confirmationA = confirmPayrollPaid(fpA, 4000);
        expect(confirmationA.fingerprint).toBe(fpA);

        const batchA = buildPayrollLoanSettlementBatch({
            employees,
            rows: [rowA],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            projectId: PROJECT_A,
            createdAt: 4000,
            recordedBy: 'admin-a'
        });

        expect(batchA.projectId).toBe(PROJECT_A);
        expect(batchA.employees).toHaveLength(1);
        expect(batchA.employees[0].employeeId).toBe('EMP-A-1');

        const empCopies = JSON.parse(JSON.stringify(employees));
        const result = applyPayrollLoanSettlementBatch(empCopies, batchA, { now: 4000, recordedBy: 'admin-a' });

        expect(result.createdCount).toBe(1);

        const settledA = empCopies.find(e => e.id === 'EMP-A-1');
        const unmutatedB = empCopies.find(e => e.id === 'EMP-B-1');

        expect(settledA.loans[0].payments).toHaveLength(1);
        expect(settledA.loans[0].payments[0].amount).toBe(250);
        expect(settledA.loans[0].payments[0].payrollProjectId).toBe(PROJECT_A);

        expect(unmutatedB.loans[0].payments).toHaveLength(0);
        expect(unmutatedB).toEqual(empB);
    });

    test('5. stale A→B conserva A: in-flight switch from A to B rejects stale scoped reads/writes and preserves A closure intact', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const db = new InMemoryFocalDB();
        const store = new PayrollClosureStore({ db });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana A', number: '1', projectId: PROJECT_A });
        const rowA = makePreviewRow({ employee: empA, gross: 1000 });
        const draftA = buildPayrollClosureDraft({
            employees: [empA],
            rows: [rowA],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            projectId: PROJECT_A,
            closedAt: 5000,
            closedBy: 'admin-a'
        });

        const savedA = await store.saveWithEmployees(draftA.closure, [empA], { schemaVersion: 20 });
        expect(savedA.id).toBeTruthy();

        db.delayMs = 30;
        const pendingReadA = store.getById(savedA.id);

        replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });

        await expect(pendingReadA).rejects.toMatchObject({
            code: 'PAYROLL_CLOSURE_STALE_READ'
        });

        db.delayMs = 0;
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
        const reloadedA = await store.getById(savedA.id);
        expect(reloadedA).not.toBeNull();
        expect(reloadedA.id).toBe(savedA.id);
        expect(reloadedA.projectId).toBe(PROJECT_A);

        replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
        const listInB = await store.getByPeriod('2026-09-01', '2026-09-15');
        expect(listInB).toHaveLength(0);
        const getInB = await store.getById(savedA.id);
        expect(getInB).toBeNull();
    });

    test('6. projectId requerido en ON: all workflow, store, settlement, and gate APIs require projectId and block unscoped calls', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const db = new InMemoryFocalDB();
        const store = new PayrollClosureStore({ db });
        const emp = makeEmployee({ id: 'EMP-1', name: 'Test', number: '1', projectId: PROJECT_A });
        const row = makePreviewRow({ employee: emp, gross: 1000 });

        expect(() => buildPayrollClosureDraft({
            employees: [emp],
            rows: [row],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15'
        })).toThrow(ProjectScopedGateError);

        expect(() => applyPayrollClosureEffects([emp], { closure: { id: 'C-1' } })).toThrow(ProjectScopedGateError);

        expect(() => undoPayrollClosureEffects([emp], { id: 'C-1', status: 'closed' })).toThrow(ProjectScopedGateError);

        await expect(store.save({ id: 'C-NO-PID', periodStart: '2026-09-01', periodEnd: '2026-09-15', rows: [row], closedAt: 1000 })).rejects.toThrow(ProjectScopedGateError);

        await expect(store.saveWithEmployees({ id: 'C-NO-PID', periodStart: '2026-09-01', periodEnd: '2026-09-15', rows: [row], closedAt: 1000 }, [emp])).rejects.toThrow(ProjectScopedGateError);

        expect(() => confirmPayrollPaid('legacy-unscoped-fingerprint-string')).toThrow(ProjectScopedGateError);

        expect(() => buildPayrollLoanSettlementBatch({
            employees: [emp],
            rows: [row],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15'
        })).toThrow(ProjectScopedGateError);

        expect(() => applyPayrollLoanSettlementBatch([emp], { id: 'B-1', items: [] })).toThrow(ProjectScopedGateError);

        expect(() => undoPayrollLoanSettlementBatch([emp], 'B-1')).toThrow();
    });

    test('7. OFF parity: flag OFF preserves schema 2 without projectId requirement, without gates, and with full legacy compatibility', async () => {
        setProjectsEnabled(false);
        resetEntityScope();

        const db = new InMemoryFocalDB();
        const store = new PayrollClosureStore({ db });

        const emp = makeEmployee({ id: 'EMP-LEGACY', name: 'Legacy Emp', number: '99', loanAmount: 100 });
        const row = makePreviewRow({ employee: emp, gross: 1000, loans: 100 });

        const draft = buildPayrollClosureDraft({
            employees: [emp],
            rows: [row],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            closedAt: 6000,
            closedBy: 'legacy-admin'
        });

        expect(draft.closure.projectId).toBeUndefined();
        expect(draft.closure.schemaVersion).toBe(2);

        const confirmed = confirmPayrollPaid('simple-legacy-fingerprint');
        expect(confirmed.fingerprint).toBe('simple-legacy-fingerprint');

        const empCopies = JSON.parse(JSON.stringify([emp]));
        const effects = applyPayrollClosureEffects(empCopies, draft, { now: 6000, recordedBy: 'legacy-admin' });
        expect(effects.affectedEmployeeIds).toEqual(['EMP-LEGACY']);

        const saved = await store.saveWithEmployees(draft.closure, empCopies, { schemaVersion: 2 });
        expect(saved.projectId).toBeUndefined();
        expect(saved.schemaVersion).toBe(2);

        const retrieved = await store.getById(saved.id);
        expect(retrieved).not.toBeNull();
        expect(retrieved.id).toBe(saved.id);

        const periodList = await store.getByPeriod('2026-09-01', '2026-09-15');
        expect(periodList).toHaveLength(1);
        expect(periodList[0].id).toBe(saved.id);

        const undoResult = undoPayrollClosureEffects(empCopies, saved, {
            now: 6500,
            voidedBy: 'legacy-admin',
            activeClosures: [saved]
        });
        expect(undoResult.closure.status).toBe(PAYROLL_CLOSURE_STATUS.VOIDED);

        const savedVoid = await store.saveWithEmployees(undoResult.closure, empCopies, { schemaVersion: 2 });
        expect(savedVoid.status).toBe(PAYROLL_CLOSURE_STATUS.VOIDED);
    });

    test('8. PayrollUI scoped operations: togglePayrollPaidConfirmation produces scoped confirmation; unscoped throws gate', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        // Unscoped / unready runtime throws
        expect(() => PayrollUI.togglePayrollPaidConfirmation(true)).toThrow(ProjectScopedGateError);
        await expect(PayrollUI.openPayrollClosure()).rejects.toThrow(ProjectScopedGateError);
        await expect(PayrollUI.undoPayrollClosure('C-123')).rejects.toThrow(ProjectScopedGateError);

        // Ready scoped runtime
        const testState = {
            employees: [
                { id: 'E-A', number: '1', name: 'Ana', projectId: PROJECT_A, active: true, positions: ['P-1'], bonuses: [], deductions: [] }
            ],
            positions: [
                { id: 'P-1', name: 'Worker', projectId: PROJECT_A, hourlyRate: 100, workingDays: [1, 2, 3, 4, 5, 6, 0] }
            ],
            attendance: {
                'E-A-2026-09-01': { employeeId: 'E-A', date: '2026-09-01', present: true, hoursWorked: 8, overtimeHours: 0, projectId: PROJECT_A }
            },
            settings: {
                regularHoursPerDay: 8,
                overtimeFactor: 1.5,
                payPeriod: { periodStart: '2026-09-01', periodLength: 15, payDay: '2026-09-15' }
            },
            exportConfig: {
                periodStart: '2026-09-01',
                periodEnd: '2026-09-15',
                payrollPaidConfirmation: null,
                payrollCorrectionSupersedesId: null,
                deductions: [],
                bonuses: []
            },
            payrollViewMode: 'generator'
        };

        const configStore = {
            getConfig: jest.fn(async () => createDefaultConfig(PROJECT_A)),
            putConfig: jest.fn()
        };
        const events = { subscribe: () => () => {}, emit: () => {} };
        const runtime = new ProjectPayrollUIRuntime({ state: testState, configStore, projectContext: events });

        PayrollUI.init({
            state: testState,
            services: {
                payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 800, neto: 800, breakdown: [] }) },
                payrollRuntime: runtime
            },
            render: () => {}
        });

        await PayrollUI.refreshScopedPayrollPreview();

        // Prime cache and wait for history to resolve
        PayrollUI.togglePayrollPaidConfirmation(true);
        await new Promise(r => setTimeout(r, 10));

        // When ready, toggle payment confirmation succeeds with scoped confirmation
        PayrollUI.togglePayrollPaidConfirmation(true);
        expect(testState.exportConfig.payrollPaidConfirmation).not.toBeNull();
        expect(testState.exportConfig.payrollPaidConfirmation.fingerprint).toContain(PROJECT_A);

        // Toggling false clears confirmation
        PayrollUI.togglePayrollPaidConfirmation(false);
        expect(testState.exportConfig.payrollPaidConfirmation).toBeNull();
    });

    test('9. PayrollUI OFF parity: togglePayrollPaidConfirmation operates on legacy exportConfig without gate', async () => {
        setProjectsEnabled(false);
        resetEntityScope();

        const testState = {
            employees: [
                { id: 'E-LEG', number: '1', name: 'Legacy', active: true, positions: ['P-LEG'], bonuses: [], deductions: [] }
            ],
            positions: [
                { id: 'P-LEG', name: 'Worker', hourlyRate: 100, workingDays: [1, 2, 3, 4, 5, 6, 0] }
            ],
            attendance: {
                'E-LEG-2026-09-01': { employeeId: 'E-LEG', date: '2026-09-01', present: true, hoursWorked: 8 }
            },
            settings: {
                regularHoursPerDay: 8,
                overtimeFactor: 1.5,
                payPeriod: { periodStart: '2026-09-01', periodLength: 15, payDay: '2026-09-15' }
            },
            exportConfig: {
                periodStart: '2026-09-01',
                periodEnd: '2026-09-15',
                payrollPaidConfirmation: null,
                payrollCorrectionSupersedesId: null,
                deductions: [],
                bonuses: []
            },
            payrollViewMode: 'generator'
        };

        PayrollUI.init({
            state: testState,
            services: {
                payroll: { calculateEmployeePayroll: () => ({ brutoOriginal: 800, neto: 800, breakdown: [] }) }
            },
            render: () => {}
        });

        // Prime cache and wait for history to resolve
        PayrollUI.togglePayrollPaidConfirmation(true);
        await new Promise(r => setTimeout(r, 10));

        // Legacy confirmation sets payment confirmation without throwing
        PayrollUI.togglePayrollPaidConfirmation(true);
        expect(testState.exportConfig.payrollPaidConfirmation).not.toBeNull();

        PayrollUI.togglePayrollPaidConfirmation(false);
        expect(testState.exportConfig.payrollPaidConfirmation).toBeNull();
    });
});
