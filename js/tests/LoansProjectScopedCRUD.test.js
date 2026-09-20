import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { ProjectScopedGateError } from '../modules/config/TandaBGate.js';
import {
    replaceEntityScope,
    resetEntityScope,
    captureEntityProjectScope,
    effectiveProjectId
} from '../modules/features/projects/EntityProjectScope.js';
import {
    createLoan,
    recordPayment,
    restorePayment,
    voidPayment,
    refinanceLoan,
    voidRefinancing,
    writeOffLoan,
    reopenLoan,
    deleteLoan,
    consolidateLoans,
    getBalance,
    LOAN_STATUS,
    INSTALLMENT_MODE,
    assertLoanEmployeeInScope
} from '../modules/features/loans/LoansService.js';
import { state } from '../modules/core/AppState.js';
import {
    submitNewLoan,
    submitPayment,
    submitRefinance,
    submitConsolidateLoans,
    settleLoanByFullPayment,
    writeOffLoanWithConfirm,
    deleteLoanWithConfirm,
    voidPaymentHandler,
    voidRefinanceHandler
} from '../modules/features/loans/LoansController.js';

const PRJ_DEFAULT = 'PRJ-DEFAULT';
const PRJ_A = 'PRJ-A';
const PRJ_B = 'PRJ-B';

const SCOPE_A = Object.freeze({ enabled: true, projectId: PRJ_A, defaultProjectId: PRJ_DEFAULT });
const SCOPE_B = Object.freeze({ enabled: true, projectId: PRJ_B, defaultProjectId: PRJ_DEFAULT });
const SCOPE_DEFAULT = Object.freeze({ enabled: true, projectId: PRJ_DEFAULT, defaultProjectId: PRJ_DEFAULT });

function makeEmployee(overrides = {}) {
    return {
        id: overrides.id || 'emp-test',
        name: overrides.name || 'Test Employee',
        number: overrides.number || '12',
        projectId: overrides.projectId,
        loans: overrides.loans ? JSON.parse(JSON.stringify(overrides.loans)) : [],
        active: true
    };
}

function expectGateError(fn) {
    let error;
    try {
        fn();
    } catch (err) {
        error = err;
    }
    expect(error).toBeInstanceOf(ProjectScopedGateError);
    expect(error.message).toMatch(/^Tanda B blocked:/);
    expect(error.code).toBe('TANDA_B_BLOCKED_WHEN_SCOPED');
}

describe('Loans Project-Scoped CRUD — Mutation Families with Projects ON', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        replaceEntityScope(SCOPE_A);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('Family 1: createLoan succeeds for in-scope employee without own projectId on loan', () => {
        const emp = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const loan = createLoan(emp, {
            principal: 1000,
            interestRate: 10,
            startDate: '2026-09-01',
            concept: 'Tool purchase'
        });

        expect(emp.loans).toHaveLength(1);
        expect(loan.principal).toBe(1000);
        expect(loan.status).toBe(LOAN_STATUS.ACTIVE);
        // Requirement: children do not receive their own projectId property
        expect(Object.prototype.hasOwnProperty.call(loan, 'projectId')).toBe(false);
    });

    test('Family 2: recordPayment, voidPayment, and restorePayment succeed in-scope without child projectId', () => {
        const emp = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const loan = createLoan(emp, { principal: 500, startDate: '2026-09-01' });

        // Record payment
        const payment = recordPayment(emp, loan.id, {
            amount: 200,
            date: '2026-09-05',
            note: 'First installment'
        });
        expect(loan.payments).toHaveLength(1);
        expect(payment.amount).toBe(200);
        expect(Object.prototype.hasOwnProperty.call(payment, 'projectId')).toBe(false);
        expect(getBalance(loan)).toBe(300);

        // Void payment
        const voided = voidPayment(emp, loan.id, payment.id, 'admin');
        expect(voided.voided).toBe(true);
        expect(getBalance(loan)).toBe(500);

        // Restore payment
        const restored = restorePayment(emp, loan.id, payment.id, 'admin');
        expect(restored.voided).toBe(false);
        expect(getBalance(loan)).toBe(300);
    });

    test('Family 3: refinanceLoan and voidRefinancing succeed in-scope without child projectId', () => {
        const emp = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const loan = createLoan(emp, { principal: 500, startDate: '2026-09-01' });

        const refin = refinanceLoan(emp, loan.id, {
            basis: 'balance',
            interestRate: 10,
            installmentCount: 2
        });

        expect(loan.refinancings).toHaveLength(1);
        expect(refin.interestAmount).toBe(50);
        expect(Object.prototype.hasOwnProperty.call(refin, 'projectId')).toBe(false);
        expect(getBalance(loan)).toBe(550);

        // Void refinancing
        const voided = voidRefinancing(emp, loan.id, refin.id, 'admin');
        expect(voided.voided).toBe(true);
        expect(getBalance(loan)).toBe(500);
    });

    test('Family 4: writeOffLoan archives the loan in-scope', () => {
        const emp = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const loan = createLoan(emp, { principal: 300, startDate: '2026-09-01' });

        const writtenOff = writeOffLoan(emp, loan.id, 'admin');
        expect(writtenOff.status).toBe(LOAN_STATUS.WRITTEN_OFF);
        expect(writtenOff.closedBy).toBe('admin');
        expect(writtenOff.closedAt).toBeTruthy();
    });

    test('Family 5: reopenLoan restores an archived loan back to active', () => {
        const emp = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const loan = createLoan(emp, { principal: 300, startDate: '2026-09-01' });
        writeOffLoan(emp, loan.id);

        const reopened = reopenLoan(emp, loan.id);
        expect(reopened.status).toBe(LOAN_STATUS.ACTIVE);
        expect(reopened.closedAt).toBeNull();
    });

    test('Family 6: deleteLoan hard-deletes written-off loan and records tombstone without projectId', () => {
        const emp = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const loan = createLoan(emp, { principal: 300, startDate: '2026-09-01' });
        writeOffLoan(emp, loan.id);

        deleteLoan(emp, loan.id);
        expect(emp.loans).toHaveLength(0);
        expect(emp.deletedItemIds.loans).toContain(loan.id);
        expect(Object.prototype.hasOwnProperty.call(emp.deletedItemIds, 'projectId')).toBe(false);
    });

    test('Family 7: consolidateLoans unifies multiple active loans in-scope without child projectId', () => {
        const emp = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const l1 = createLoan(emp, { principal: 300, startDate: '2026-09-01' });
        const l2 = createLoan(emp, { principal: 200, startDate: '2026-09-01' });

        const { consolidatedLoan, closedLoans } = consolidateLoans(emp, {
            installmentCount: 2,
            interestRate: 0
        });

        expect(closedLoans).toHaveLength(2);
        expect(l1.status).toBe(LOAN_STATUS.PAID);
        expect(l2.status).toBe(LOAN_STATUS.PAID);
        expect(consolidatedLoan.principal).toBe(500);
        expect(consolidatedLoan.status).toBe(LOAN_STATUS.ACTIVE);
        expect(Object.prototype.hasOwnProperty.call(consolidatedLoan, 'projectId')).toBe(false);
    });
});

describe('Loans Project-Scoped CRUD — Case #12 A/B Coexistence and Partition', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('same visible number #12 in A and B does not collide; mutations partition by employeeId', () => {
        const empA = makeEmployee({ id: 'emp-a-12', number: '12', name: 'Ana in A', projectId: PRJ_A });
        const empB = makeEmployee({ id: 'emp-b-12', number: '12', name: 'Bruno in B', projectId: PRJ_B });

        // Under Scope A: mutate empA
        replaceEntityScope(SCOPE_A);
        const loanA = createLoan(empA, { principal: 800, startDate: '2026-09-01', concept: 'Loan A #12' });
        recordPayment(empA, loanA.id, { amount: 100, date: '2026-09-02' });

        expect(empA.loans).toHaveLength(1);
        expect(empA.loans[0].payments).toHaveLength(1);
        expect(empB.loans).toHaveLength(0);

        // Under Scope B: mutate empB
        replaceEntityScope(SCOPE_B);
        const loanB = createLoan(empB, { principal: 400, startDate: '2026-09-01', concept: 'Loan B #12' });

        expect(empB.loans).toHaveLength(1);
        expect(empB.loans[0].payments).toHaveLength(0);
        // empA remains completely isolated
        expect(empA.loans).toHaveLength(1);
        expect(empA.loans[0].principal).toBe(800);
        expect(empB.loans[0].principal).toBe(400);

        // Attempting to mutate empA while under Scope B must fail before write
        expectGateError(() => createLoan(empA, { principal: 100, startDate: '2026-09-03' }));
        expect(empA.loans).toHaveLength(1);
    });
});

describe('Loans Project-Scoped CRUD — Case Legacy-Default Inheritance', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('legacy employee without projectId inherits default project and is operable under default scope', () => {
        const empLegacy = makeEmployee({ id: 'emp-legacy-01', number: '99', name: 'Legacy Worker' });
        expect(empLegacy.projectId).toBeUndefined();

        // When active scope is default, effectiveProjectId matches defaultProjectId
        replaceEntityScope(SCOPE_DEFAULT);
        expect(effectiveProjectId(empLegacy, SCOPE_DEFAULT)).toBe(PRJ_DEFAULT);

        const loan = createLoan(empLegacy, { principal: 600, startDate: '2026-09-01' });
        expect(empLegacy.loans).toHaveLength(1);
        expect(loan.principal).toBe(600);
        expect(Object.prototype.hasOwnProperty.call(loan, 'projectId')).toBe(false);

        const payment = recordPayment(empLegacy, loan.id, { amount: 150, date: '2026-09-02' });
        expect(loan.payments).toHaveLength(1);
        expect(payment.amount).toBe(150);
    });

    test('legacy employee is rejected when active scope is a non-default project (e.g. PRJ-A)', () => {
        const empLegacy = makeEmployee({ id: 'emp-legacy-02', number: '99', name: 'Legacy Worker' });
        expect(empLegacy.projectId).toBeUndefined();

        replaceEntityScope(SCOPE_A); // active: PRJ-A, default: PRJ-DEFAULT
        const snapshot = JSON.stringify(empLegacy);

        expectGateError(() => createLoan(empLegacy, { principal: 500, startDate: '2026-09-01' }));
        expect(JSON.stringify(empLegacy)).toBe(snapshot);
        expect(empLegacy.loans).toHaveLength(0);
    });
});

describe('Loans Project-Scoped CRUD — Case Stale A→B During Operation', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('captured scope A preserves mutation targeting empA even if global scope switches to B', () => {
        const empA = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const empB = makeEmployee({ id: 'emp-b', projectId: PRJ_B });

        // Start operation under A, capture scope
        replaceEntityScope(SCOPE_A);
        const capturedScopeA = captureEntityProjectScope();

        // Switch global context to B in-flight
        replaceEntityScope(SCOPE_B);

        // Mutation with capturedScopeA applies to empA and does not redirect to B
        const loan = createLoan(empA, { principal: 750, startDate: '2026-09-01' }, { projectScope: capturedScopeA });
        expect(empA.loans).toHaveLength(1);
        expect(empA.loans[0].principal).toBe(750);
        expect(empB.loans).toHaveLength(0);
        expect(Object.prototype.hasOwnProperty.call(loan, 'projectId')).toBe(false);
    });

    test('stale operation without captured scope override rejects empA once active scope becomes B', () => {
        const empA = makeEmployee({ id: 'emp-a', projectId: PRJ_A });
        const empB = makeEmployee({ id: 'emp-b', projectId: PRJ_B });

        replaceEntityScope(SCOPE_A);
        const initialSnapshotA = JSON.stringify(empA);

        // Switch to B
        replaceEntityScope(SCOPE_B);

        // Executing without captured scope override checks current active scope (B) and rejects empA
        expectGateError(() => createLoan(empA, { principal: 300, startDate: '2026-09-01' }));
        expect(JSON.stringify(empA)).toBe(initialSnapshotA);
        expect(empA.loans).toHaveLength(0);
        expect(empB.loans).toHaveLength(0);
    });
});

describe('Loans Project-Scoped CRUD — All 10 Mutation Functions Reject Out-of-Scope Employee Before Mutation', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        replaceEntityScope(SCOPE_A);
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('all 10 mutation functions reject foreign employee without state mutation', () => {
        // empForeign belongs to PRJ-B, active project is PRJ-A
        const empForeign = makeEmployee({
            id: 'emp-foreign-b',
            projectId: PRJ_B,
            loans: [
                {
                    id: 'loan-b-1',
                    principal: 1000,
                    interestRate: 0,
                    status: LOAN_STATUS.ACTIVE,
                    payments: [{ id: 'pay-b-1', amount: 100, date: '2026-09-01', voided: false }],
                    refinancings: [{ id: 'refin-b-1', interestAmount: 50, voided: false }],
                    installments: []
                },
                {
                    id: 'loan-b-2',
                    principal: 500,
                    interestRate: 0,
                    status: LOAN_STATUS.ACTIVE,
                    payments: [],
                    refinancings: [],
                    installments: []
                },
                {
                    id: 'loan-b-written-off',
                    principal: 200,
                    status: LOAN_STATUS.WRITTEN_OFF,
                    payments: [],
                    refinancings: []
                }
            ]
        });

        const originalState = JSON.stringify(empForeign);

        // 1. createLoan
        expectGateError(() => createLoan(empForeign, { principal: 200, startDate: '2026-09-01' }));
        expect(JSON.stringify(empForeign)).toBe(originalState);

        // 2. recordPayment
        expectGateError(() => recordPayment(empForeign, 'loan-b-1', { amount: 50, date: '2026-09-02' }));
        expect(JSON.stringify(empForeign)).toBe(originalState);

        // 3. voidPayment
        expectGateError(() => voidPayment(empForeign, 'loan-b-1', 'pay-b-1'));
        expect(JSON.stringify(empForeign)).toBe(originalState);

        // 4. restorePayment
        empForeign.loans[0].payments[0].voided = true;
        const modifiedForRestore = JSON.stringify(empForeign);
        expectGateError(() => restorePayment(empForeign, 'loan-b-1', 'pay-b-1'));
        expect(JSON.stringify(empForeign)).toBe(modifiedForRestore);
        empForeign.loans[0].payments[0].voided = false;

        // 5. refinanceLoan
        expectGateError(() => refinanceLoan(empForeign, 'loan-b-1', { interestRate: 5 }));
        expect(JSON.stringify(empForeign)).toBe(originalState);

        // 6. voidRefinancing
        expectGateError(() => voidRefinancing(empForeign, 'loan-b-1', 'refin-b-1'));
        expect(JSON.stringify(empForeign)).toBe(originalState);

        // 7. writeOffLoan
        expectGateError(() => writeOffLoan(empForeign, 'loan-b-1'));
        expect(JSON.stringify(empForeign)).toBe(originalState);

        // 8. reopenLoan
        expectGateError(() => reopenLoan(empForeign, 'loan-b-written-off'));
        expect(JSON.stringify(empForeign)).toBe(originalState);

        // 9. deleteLoan
        expectGateError(() => deleteLoan(empForeign, 'loan-b-written-off'));
        expect(JSON.stringify(empForeign)).toBe(originalState);

        // 10. consolidateLoans
        expectGateError(() => consolidateLoans(empForeign, { installmentCount: 2 }));
        expect(JSON.stringify(empForeign)).toBe(originalState);
    });
});

describe('Loans Project-Scoped CRUD — Exact OFF Parity', () => {
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

    test('with flag OFF, all operations succeed regardless of projectId or active scope', () => {
        const empNoProject = makeEmployee({ id: 'emp-off-1' });
        const empWithProject = makeEmployee({ id: 'emp-off-2', projectId: PRJ_A });

        // createLoan
        const l1 = createLoan(empNoProject, { principal: 500, startDate: '2026-09-01' });
        const l2 = createLoan(empWithProject, { principal: 400, startDate: '2026-09-01' });
        expect(empNoProject.loans).toHaveLength(1);
        expect(empWithProject.loans).toHaveLength(1);

        // recordPayment
        const p1 = recordPayment(empNoProject, l1.id, { amount: 100, date: '2026-09-02' });
        expect(p1.amount).toBe(100);

        // voidPayment
        const vp1 = voidPayment(empNoProject, l1.id, p1.id);
        expect(vp1.voided).toBe(true);

        // restorePayment
        const rp1 = restorePayment(empNoProject, l1.id, p1.id);
        expect(rp1.voided).toBe(false);

        // refinanceLoan
        const rf = refinanceLoan(empNoProject, l1.id, { interestRate: 10 });
        expect(rf.interestAmount).toBe(40);

        // voidRefinancing
        const vrf = voidRefinancing(empNoProject, l1.id, rf.id);
        expect(vrf.voided).toBe(true);

        // writeOffLoan & reopenLoan
        writeOffLoan(empNoProject, l1.id);
        expect(l1.status).toBe(LOAN_STATUS.WRITTEN_OFF);
        reopenLoan(empNoProject, l1.id);
        expect(l1.status).toBe(LOAN_STATUS.ACTIVE);

        // deleteLoan
        writeOffLoan(empNoProject, l1.id);
        deleteLoan(empNoProject, l1.id);
        expect(empNoProject.loans).toHaveLength(0);

        // consolidateLoans
        const c1 = createLoan(empWithProject, { principal: 200, startDate: '2026-09-01' });
        const { consolidatedLoan } = consolidateLoans(empWithProject, { installmentCount: 2 });
        expect(consolidatedLoan.principal).toBe(600);
        expect(consolidatedLoan.status).toBe(LOAN_STATUS.ACTIVE);
    });
});

describe('Loans Project-Scoped CRUD — LoansController Scope Rejection and Form Isolation', () => {
    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        replaceEntityScope(SCOPE_A);

        state.employees = [
            makeEmployee({ id: 'emp-a', number: '12', name: 'Ana A', projectId: PRJ_A }),
            makeEmployee({ id: 'emp-b', number: '12', name: 'Bruno B', projectId: PRJ_B })
        ];
        state.loansLedger = null;
        window.showAlert = jest.fn();
        window.showNotification = jest.fn();
        window.showConfirm = undefined;
    });

    afterEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    test('controller submitNewLoan rejects when selected employee is from foreign project', () => {
        state.loansLedger = {
            selectedEmployeeId: 'emp-b',
            newLoanDraft: {
                principal: 500,
                startDate: '2026-09-01',
                installmentMode: 'lump'
            }
        };

        submitNewLoan();
        expect(state.employees[1].loans).toHaveLength(0);
        expect(window.showAlert).toHaveBeenCalledWith('Empleado no disponible en el proyecto activo', 'error');
    });

    test('controller submitPayment rejects foreign employee in-flight project switch', () => {
        state.employees[0].loans = [{
            id: 'loan-a-1',
            principal: 500,
            interestRate: 0,
            status: 'active',
            payments: []
        }];
        state.loansLedger = {
            selectedEmployeeId: 'emp-a',
            showPaymentFormForLoan: 'loan-a-1',
            paymentDraft: { amount: 100, date: '2026-09-02' }
        };

        // Switch active project to B before submission
        replaceEntityScope(SCOPE_B);

        submitPayment('loan-a-1');
        expect(state.employees[0].loans[0].payments).toHaveLength(0);
        expect(state.employees[1].loans).toHaveLength(0);
    });

    test('controller submitRefinance rejects foreign employee in-flight project switch', () => {
        state.employees[0].loans = [{
            id: 'loan-a-1',
            principal: 500,
            interestRate: 0,
            status: 'active',
            payments: [],
            refinancings: []
        }];
        state.loansLedger = {
            selectedEmployeeId: 'emp-a',
            showRefinanceFormForLoan: 'loan-a-1',
            refinanceDraft: { basis: 'balance', interestRate: 10 }
        };

        replaceEntityScope(SCOPE_B);

        submitRefinance('loan-a-1');
        expect(state.employees[0].loans[0].refinancings).toHaveLength(0);
    });

    test('controller submitConsolidateLoans rejects foreign employee in-flight project switch', () => {
        state.employees[0].loans = [
            { id: 'l1', principal: 200, status: 'active', payments: [] },
            { id: 'l2', principal: 300, status: 'active', payments: [] }
        ];
        state.loansLedger = {
            selectedEmployeeId: 'emp-a',
            showConsolidateForm: true,
            consolidateDraft: { installmentCount: 2, interestRate: 0, startDate: '2026-09-01' }
        };

        replaceEntityScope(SCOPE_B);

        submitConsolidateLoans();
        expect(state.employees[0].loans).toHaveLength(2);
        expect(state.employees[0].loans.every(l => l.status === 'active')).toBe(true);
    });
});
