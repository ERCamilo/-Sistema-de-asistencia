import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { ProjectScopedGateError } from '../modules/config/TandaBGate.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    PAYROLL_CLOSURE_STATUS
} from '../modules/features/payroll/PayrollClosure.js';
import {
    applyPayrollClosureEffects,
    buildPayrollClosureDraft
} from '../modules/features/payroll/PayrollClosureWorkflow.js';
import {
    confirmPayrollPaid
} from '../modules/features/payroll/PayrollLoanSettlement.js';
import defaultClosureStore from '../modules/features/payroll/PayrollClosureStore.js';
import defaultClosureSync from '../modules/features/payroll/PayrollClosureSync.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import * as PayrollClosureUI from '../modules/features/payroll/PayrollClosureUI.js';
import { ProjectPayrollUIRuntime } from '../modules/features/payroll/ProjectPayrollUIRuntime.js';
import { createDefaultConfig } from '../modules/features/payroll/ProjectPayrollConfig.js';
import { Modal } from '../modules/components/Modal.js';

const PROJECT_A = 'PRJ-A-OP';
const PROJECT_B = 'PRJ-B-OP';
const DEFAULT_PROJECT = 'PRJ-DEFAULT-OP';

class InMemoryFocalDB {
    constructor() {
        this.records = new Map();
        this.outbox = [];
        this.delayMs = 0;
    }

    setRecord(closure) {
        this.records.set(String(closure.id), JSON.parse(JSON.stringify({
            ...closure,
            periodKey: `${closure.periodStart}:${closure.periodEnd}`
        })));
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
            this.setRecord(result.value);
        }
        return JSON.parse(JSON.stringify(result.value));
    }

    async atomicMutateWithBatches(_, id, mutator, batches = []) {
        const existing = await this.get(_, id);
        const result = mutator(existing);
        if (result.write) {
            this.setRecord(result.value);
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
            startDate: '2026-09-01',
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
        loans,
        active: true,
        positions: [`POS-${id}`]
    };
}

function makePreviewRow({ employee, gross = 1000, loans = 0, projectId }) {
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
            dueDate: '2026-09-01',
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
        _loanDetails: loanDetails,
        ...(projectId ? { _projectId: projectId } : {})
    };
}

function setupScopedHarness({ projectId = PROJECT_A, employees = [], extraState = {} } = {}) {
    const state = {
        employees,
        positions: employees.map(e => ({
            id: `POS-${e.id}`,
            name: 'Operario',
            projectId: e.projectId,
            hourlyRate: 100,
            workingDays: [1, 2, 3, 4, 5, 6, 0]
        })),
        attendance: employees.reduce((acc, e) => {
            acc[`${e.id}-2026-09-01`] = {
                employeeId: e.id,
                date: '2026-09-01',
                present: true,
                hoursWorked: 8,
                overtimeHours: 0,
                projectId: e.projectId
            };
            return acc;
        }, {}),
        settings: {
            companyName: 'Test Co',
            regularHoursPerDay: 8,
            overtimeFactor: 1.5,
            holidayFactor: 2,
            holidays: [],
            payPeriod: { periodStart: '2026-09-01', periodLength: 15, payDay: '2026-09-15' },
            schemaVersion: 20
        },
        exportConfig: {
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            payrollPaidConfirmation: null,
            payrollCorrectionSupersedesId: null,
            payrollLoanSelection: [],
            deductions: [],
            bonuses: []
        },
        payrollViewMode: 'generator',
        ...extraState
    };

    const configStore = {
        getConfig: jest.fn(async pid => createDefaultConfig(pid || projectId, state.settings)),
        putConfig: jest.fn(async c => c)
    };
    const events = { subscribe: () => () => {}, emit: () => {} };
    const runtime = new ProjectPayrollUIRuntime({ state, configStore, projectContext: events });

    const saveToLocalStorage = jest.fn();
    const render = jest.fn();

    PayrollUI.init({
        state,
        services: {
            payroll: {
                calculateEmployeePayroll: () => ({ brutoOriginal: 1000, neto: 1000, breakdown: [] })
            },
            payrollRuntime: runtime
        },
        render,
        saveToLocalStorage
    });

    return { state, runtime, configStore, saveToLocalStorage, render };
}

function setupLegacyHarness({ employees = [], extraState = {} } = {}) {
    const state = {
        employees,
        positions: employees.map(e => ({
            id: `POS-${e.id}`,
            name: 'Operario',
            hourlyRate: 100,
            workingDays: [1, 2, 3, 4, 5, 6, 0]
        })),
        attendance: employees.reduce((acc, e) => {
            acc[`${e.id}-2026-09-01`] = {
                employeeId: e.id,
                date: '2026-09-01',
                present: true,
                hoursWorked: 8
            };
            return acc;
        }, {}),
        settings: {
            companyName: 'Legacy Co',
            regularHoursPerDay: 8,
            overtimeFactor: 1.5,
            payPeriod: { periodStart: '2026-09-01', periodLength: 15, payDay: '2026-09-15' },
            schemaVersion: 2
        },
        exportConfig: {
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            payrollPaidConfirmation: null,
            payrollCorrectionSupersedesId: null,
            payrollLoanSelection: [],
            deductions: [],
            bonuses: []
        },
        payrollViewMode: 'generator',
        ...extraState
    };

    const saveToLocalStorage = jest.fn();
    const render = jest.fn();

    PayrollUI.init({
        state,
        services: {
            payroll: {
                calculateEmployeePayroll: () => ({ brutoOriginal: 1000, neto: 1000, breakdown: [] })
            }
        },
        render,
        saveToLocalStorage
    });

    return { state, saveToLocalStorage, render };
}

describe('Payroll Closure Operational UI — Frozen Contract for Projects ON/OFF', () => {
    let originalDb;
    let inMemoryDb;

    beforeAll(() => {
        originalDb = defaultClosureStore.db;
    });

    afterAll(() => {
        defaultClosureStore.db = originalDb;
    });

    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        document.body.innerHTML = '';
        globalThis.currentUser = { uid: 'operational-test-user' };
        globalThis.scopedView = null;
        window.showNotification = jest.fn();
        inMemoryDb = new InMemoryFocalDB();
        defaultClosureStore.db = inMemoryDb;
        jest.spyOn(defaultClosureSync, 'pullPeriod').mockResolvedValue({ closures: [], imported: 0, conflicts: [] });
        jest.spyOn(defaultClosureSync, 'pullDetail').mockImplementation(async id => inMemoryDb.get('payrollClosures', id));
        jest.spyOn(PayrollClosureUI, 'openPayrollClosureModal').mockResolvedValue(true);
        jest.spyOn(Modal, 'alert').mockResolvedValue(true);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        delete globalThis.currentUser;
        delete globalThis.scopedView;
        delete window.showNotification;
        document.body.innerHTML = '';
        jest.restoreAllMocks();
        defaultClosureStore.db = originalDb;
    });

    test('1. With Projects ON and ready active project A, paid confirmation + closing payroll is permitted through PayrollUI; closure carries projectId A and uses only A rows/employees', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana Obra A', number: '101', projectId: PROJECT_A });
        const empB = makeEmployee({ id: 'EMP-B-1', name: 'Beto Obra B', number: '102', projectId: PROJECT_B });

        const { state, runtime } = setupScopedHarness({
            projectId: PROJECT_A,
            employees: [empA, empB]
        });

        await PayrollUI.refreshScopedPayrollPreview();

        // Prime cache and confirm payment for project A preview
        PayrollUI.togglePayrollPaidConfirmation(true);
        await new Promise(r => setTimeout(r, 20));
        PayrollUI.togglePayrollPaidConfirmation(true);

        expect(state.exportConfig.payrollPaidConfirmation).not.toBeNull();
        expect(state.exportConfig.payrollPaidConfirmation.fingerprint).toContain(PROJECT_A);

        // Operational contract: closing payroll must not be blanket-blocked and must write scoped closure
        await PayrollUI.openPayrollClosure();

        const activeClosures = await defaultClosureStore.getByPeriod('2026-09-01', '2026-09-15');
        expect(activeClosures).toHaveLength(1);
        expect(activeClosures[0].projectId).toBe(PROJECT_A);
        expect(activeClosures[0].rows).toHaveLength(1);
        expect(activeClosures[0].rows[0].employeeId).toBe('EMP-A-1');

        runtime.dispose();
    });

    test('2. Undo of a closed A closure is permitted only while A is active and must never mutate B', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana Obra A', number: '101', projectId: PROJECT_A, loanAmount: 200 });
        const empB = makeEmployee({ id: 'EMP-B-1', name: 'Beto Obra B', number: '102', projectId: PROJECT_B, loanAmount: 500 });
        const initialEmpB = JSON.parse(JSON.stringify(empB));

        const rowA = makePreviewRow({ employee: empA, gross: 1000, loans: 200, projectId: PROJECT_A });
        const draftA = buildPayrollClosureDraft({
            employees: [empA],
            rows: [rowA],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            projectId: PROJECT_A,
            closedAt: 1000,
            closedBy: 'admin-a'
        });

        applyPayrollClosureEffects([empA], draftA, { now: 1000, recordedBy: 'admin-a' });
        const savedClosureA = await defaultClosureStore.saveWithEmployees(draftA.closure, [empA], { schemaVersion: 20 });
        expect(savedClosureA.id).toBeTruthy();

        const { state, runtime } = setupScopedHarness({
            projectId: PROJECT_A,
            employees: [empA, empB]
        });

        // Operational contract: undo must be permitted while A is active
        await PayrollUI.undoPayrollClosure(savedClosureA.id);

        const voidedClosureA = await defaultClosureStore.getById(savedClosureA.id);
        expect(voidedClosureA.status).toBe(PAYROLL_CLOSURE_STATUS.VOIDED);
        expect(voidedClosureA.projectId).toBe(PROJECT_A);

        const updatedA = state.employees.find(e => e.id === 'EMP-A-1');
        expect(updatedA.loans[0].payments[0].voided).toBe(true);

        const updatedB = state.employees.find(e => e.id === 'EMP-B-1');
        expect(updatedB).toEqual(initialEmpB);

        // Attempting to undo closure A while B is active must reject
        replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
        await expect(PayrollUI.undoPayrollClosure(savedClosureA.id)).rejects.toThrow();

        runtime.dispose();
    });

    test('3. A->B switch during awaited remote/history step fails closed/stale and cannot redirect A operation into B', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana Obra A', number: '101', projectId: PROJECT_A });
        const empB = makeEmployee({ id: 'EMP-B-1', name: 'Beto Obra B', number: '102', projectId: PROJECT_B });
        const initialEmpB = JSON.parse(JSON.stringify(empB));

        const { state, runtime } = setupScopedHarness({
            projectId: PROJECT_A,
            employees: [empA, empB]
        });

        await PayrollUI.refreshScopedPayrollPreview();
        PayrollUI.togglePayrollPaidConfirmation(true);
        await new Promise(r => setTimeout(r, 20));
        PayrollUI.togglePayrollPaidConfirmation(true);

        // Introduce an async gap during verification/remote step
        jest.spyOn(defaultClosureSync, 'pullPeriod').mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 40));
            return { closures: [], imported: 0, conflicts: [] };
        });

        const pendingClosure = PayrollUI.openPayrollClosure();
        // Mid-operation project switch
        replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });

        // Operational contract: in-flight operation from A must fail stale, not redirect into B
        await expect(pendingClosure).rejects.toMatchObject({
            code: 'PAYROLL_CLOSURE_STALE_READ'
        });

        const closuresInB = await inMemoryDb.query('payrollClosures', 'projectId', PROJECT_B);
        expect(closuresInB).toHaveLength(0);

        expect(state.employees.find(e => e.id === 'EMP-B-1')).toEqual(initialEmpB);

        runtime.dispose();
    });

    test('4. Missing/unscoped project, foreign closure/row, or invalid fingerprint remains rejected BEFORE mutation/write', async () => {
        setProjectsEnabled(true);
        resetEntityScope();

        // 4a. Unscoped / unready runtime throws before mutation
        await expect(PayrollUI.openPayrollClosure()).rejects.toThrow(ProjectScopedGateError);
        await expect(PayrollUI.undoPayrollClosure('ANY-CLOSURE-ID')).rejects.toThrow(ProjectScopedGateError);

        // 4b. Foreign closure cannot be undone from project A
        replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
        const empB = makeEmployee({ id: 'EMP-B-1', name: 'Beto Obra B', number: '102', projectId: PROJECT_B });
        const rowB = makePreviewRow({ employee: empB, gross: 1000, projectId: PROJECT_B });
        const draftB = buildPayrollClosureDraft({
            employees: [empB],
            rows: [rowB],
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            projectId: PROJECT_B,
            closedAt: 1000,
            closedBy: 'admin-b'
        });
        const savedB = await defaultClosureStore.saveWithEmployees(draftB.closure, [empB], { schemaVersion: 20 });

        // Switch to project A: foreign closure B must be rejected before any mutation
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana Obra A', number: '101', projectId: PROJECT_A });

        const { runtime } = setupScopedHarness({
            projectId: PROJECT_A,
            employees: [empA, empB]
        });

        const mutateSpy = jest.spyOn(inMemoryDb, 'atomicMutateWithBatches');
        await expect(PayrollUI.undoPayrollClosure(savedB.id)).rejects.toThrow();
        expect(mutateSpy).not.toHaveBeenCalled();

        runtime.dispose();
    });

    test('5. History detail is not forced read-only when a valid scoped project is ready; undo action may render for a closed owned closure', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana Obra A', number: '101', projectId: PROJECT_A });

        const closureA = {
            id: 'CLOSURE-A-HIST-1',
            projectId: PROJECT_A,
            status: 'closed',
            periodStart: '2026-09-01',
            periodEnd: '2026-09-15',
            closedAt: 1000,
            closedBy: 'admin-a',
            totals: { gross: 1000, net: 1000, bonuses: 0, deductions: 0, loans: 0 },
            employeeCount: 1,
            rows: [{
                employeeId: 'EMP-A-1',
                employeeName: 'Ana Obra A',
                employeeNumber: '101',
                gross: 1000,
                net: 1000,
                bonuses: 0,
                deductions: 0,
                loans: 0
            }]
        };
        inMemoryDb.setRecord(closureA);

        const { runtime } = setupScopedHarness({
            projectId: PROJECT_A,
            employees: [empA],
            extraState: { payrollViewMode: 'history' }
        });

        await PayrollUI.openPayrollHistoryDetail('CLOSURE-A-HIST-1');
        const html = PayrollUI.PayrollTab();

        // Operational contract: history detail is NOT forced read-only for ready active project
        expect(html).not.toContain('Consulta de solo lectura para la obra activa');
        expect(html).toContain('data-payroll-action="undo-payroll-closure"');
        expect(html).toContain('CLOSURE-A-HIST-1');

        runtime.dispose();
    });

    test('6. Projects OFF preserves existing legacy behavior for open and undo closure without projectId requirement', async () => {
        setProjectsEnabled(false);
        resetEntityScope();

        const legacyEmp = makeEmployee({ id: 'EMP-LEG-1', name: 'Legacy Emp', number: '99' });
        const { state } = setupLegacyHarness({
            employees: [legacyEmp]
        });

        // Prime legacy history cache
        PayrollUI.togglePayrollPaidConfirmation(true);
        await new Promise(r => setTimeout(r, 20));
        PayrollUI.togglePayrollPaidConfirmation(true);

        expect(state.exportConfig.payrollPaidConfirmation).not.toBeNull();

        await PayrollUI.openPayrollClosure();

        const activeClosures = await defaultClosureStore.getByPeriod('2026-09-01', '2026-09-15');
        expect(activeClosures).toHaveLength(1);
        expect(activeClosures[0].projectId).toBeUndefined();
        expect(activeClosures[0].schemaVersion).toBe(2);

        await PayrollUI.undoPayrollClosure(activeClosures[0].id);

        const voided = await defaultClosureStore.getById(activeClosures[0].id);
        expect(voided.status).toBe(PAYROLL_CLOSURE_STATUS.VOIDED);
        expect(voided.projectId).toBeUndefined();
    });

    test('7. Scoped payroll-loan selection and settlement is permitted so closure with loans is not blanket-blocked merely because Projects ON', async () => {
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });

        const empA = makeEmployee({ id: 'EMP-A-1', name: 'Ana Obra A', number: '101', projectId: PROJECT_A, loanAmount: 300 });
        const empB = makeEmployee({ id: 'EMP-B-1', name: 'Beto Obra B', number: '102', projectId: PROJECT_B, loanAmount: 600 });
        const initialEmpB = JSON.parse(JSON.stringify(empB));

        const { state, runtime } = setupScopedHarness({
            projectId: PROJECT_A,
            employees: [empA, empB]
        });

        // Select loan for employee A in exportConfig
        state.exportConfig.payrollLoanSelection = [{
            employeeId: 'EMP-A-1',
            loanId: 'LOAN-EMP-A-1',
            chargeCount: 1
        }];

        await PayrollUI.refreshScopedPayrollPreview();

        PayrollUI.togglePayrollPaidConfirmation(true);
        await new Promise(r => setTimeout(r, 20));
        PayrollUI.togglePayrollPaidConfirmation(true);

        expect(state.exportConfig.payrollPaidConfirmation).not.toBeNull();

        // Operational contract: closing payroll with loans is NOT blanket-blocked
        await PayrollUI.openPayrollClosure();

        const activeClosures = await defaultClosureStore.getByPeriod('2026-09-01', '2026-09-15');
        expect(activeClosures).toHaveLength(1);
        expect(activeClosures[0].projectId).toBe(PROJECT_A);

        // Employee B loans remain completely untouched
        expect(state.employees.find(e => e.id === 'EMP-B-1')).toEqual(initialEmpB);

        runtime.dispose();
    });
});
