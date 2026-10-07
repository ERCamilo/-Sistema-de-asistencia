import { Modal } from '../modules/components/Modal.js';
import { state as appState } from '../modules/core/AppState.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import * as PayrollClosureUI from '../modules/features/payroll/PayrollClosureUI.js';
import payrollClosureStore from '../modules/features/payroll/PayrollClosureStore.js';
import payrollClosureSync from '../modules/features/payroll/PayrollClosureSync.js';
import {
    applyPayrollClosureEffects,
    buildPayrollClosureDraft,
    getEffectivePayrollClosures,
    getPayrollClosureGate,
    undoPayrollClosureEffects
} from '../modules/features/payroll/PayrollClosureWorkflow.js';
import {
    applyRegistrationLoans,
    collectRegistrationPayments,
    linkRegistrationPayments,
    PAYROLL_REGISTRATION_KIND,
    REGISTRATION_LOAN_MODE,
    summarizeRegistrationPayments
} from '../modules/features/payroll/PayrollRegistration.js';
import {
    renderPayrollRegistrationActions,
    renderPayrollRegistrationBanner,
    renderPayrollRegistrationLoans
} from '../modules/features/payroll/PayrollRegistrationUI.js';
import { getBalance } from '../modules/features/loans/LoansService.js';
import { getAccountSummary } from '../modules/features/loans/LoanAccount.js';

const START = '2026-09-11';
const END = '2026-10-01';

function payment(id, amount, overrides = {}) {
    return {
        id, amount, date: '2026-10-03', origin: 'payroll', voided: false,
        payrollPeriodStart: START, payrollPeriodEnd: END, recordedAt: 1, updatedAt: 1,
        ...overrides
    };
}

function employees() {
    return [{
        id: 'e1',
        number: '1',
        name: 'Uno',
        active: true,
        bonuses: [],
        deductions: [],
        loans: [{
            id: 'l1', principal: 500, status: 'active', startDate: '2026-08-01', createdAt: 1,
            payments: [
                payment('p1', 30),
                payment('p2', 20, { origin: 'conversion' }),
                payment('p-void', 99, { voided: true }),
                payment('p-other', 15, { payrollPeriodStart: '2026-08-21', payrollPeriodEnd: '2026-09-10' })
            ]
        }]
    }, {
        id: 'e2',
        number: '2',
        name: 'Dos',
        active: true,
        bonuses: [],
        deductions: [],
        loans: [{
            id: 'l2', principal: 300, status: 'active', startDate: '2026-08-01', createdAt: 1,
            payments: [payment('p3', 25)]
        }]
    }, {
        id: 'e3',
        number: '3',
        name: 'Tres',
        active: true,
        bonuses: [],
        deductions: [],
        loans: []
    }];
}

function baseRows(ids = ['e1', 'e2', 'e3']) {
    return ids.map(id => ({
        id: Number(id.slice(1)),
        nombre: id,
        monto: 1000,
        _montoBeforeLoans: 1000,
        _brutoOriginal: 1000,
        _bruto: 1000,
        _bonuses: 0,
        _deductions: 0,
        _loans: 0,
        _loanDetails: [],
        _bonusDetails: [],
        _deductionDetails: [],
        _employeeId: id,
        _employeeName: id,
        _employeePosition: 'Operario',
        _number: id.slice(1)
    }));
}

const earlyClosure = {
    schemaVersion: 2,
    id: 'PAYROLL-CLOSURE-early',
    fingerprint: 'fp-early',
    status: 'closed',
    periodStart: START,
    periodEnd: END,
    closedAt: new Date(2026, 8, 11, 7, 1).getTime(),
    employeeCount: 1,
    totals: { gross: 50, bonuses: 200, deductions: 0, loans: 0, net: 250 },
    rows: [{ employeeId: 'e1', employeeNumber: '1', gross: 50, bonuses: 200, deductions: 0, loans: 0, net: 250 }],
    adjustments: { bonuses: [], deductions: [] },
    loanSettlementBatchId: null,
    paymentRefs: [],
    supersedesId: null
};

function registrationRows(people, mode = REGISTRATION_LOAN_MODE.LINK, ids) {
    return applyRegistrationLoans(baseRows(ids), collectRegistrationPayments(people, START, END), mode);
}

function paymentCount(people) {
    return people.flatMap(employee => employee.loans.flatMap(loan => loan.payments)).length;
}

describe('Registro de un periodo ya pagado (puro)', () => {
    test('rows take the already-entered payments as loans; «none» closes without loans', () => {
        const rows = registrationRows(employees());
        expect(rows.map(row => [row._employeeId, row._loans, row.monto])).toEqual([
            ['e1', 50, 950], ['e2', 25, 975], ['e3', 0, 1000]
        ]);
        expect(rows[0]._loanDetails).toEqual([
            expect.objectContaining({ loanId: 'l1', paymentId: 'p1', selectedAmount: 30, linked: true }),
            expect.objectContaining({ loanId: 'l1', paymentId: 'p2', selectedAmount: 20, linked: true })
        ]);
        const none = registrationRows(employees(), REGISTRATION_LOAN_MODE.NONE);
        expect(none.every(row => row._loans === 0 && row.monto === 1000)).toBe(true);
    });

    test('summary counts per employee and leaves aside employees without a payroll row', () => {
        const summary = summarizeRegistrationPayments(
            collectRegistrationPayments(employees(), START, END),
            baseRows(['e1', 'e3'])
        );
        expect(summary).toEqual(expect.objectContaining({ count: 2, total: 50, outsideCount: 1, outsideTotal: 25 }));
        expect(summary.employees).toEqual([{ employeeId: 'e1', employeeNumber: '1', count: 2, amount: 50 }]);
    });

    test('the draft creates no loan batch and records the linked payment refs', () => {
        const draft = buildPayrollClosureDraft({
            employees: employees(),
            rows: registrationRows(employees()),
            periodStart: START,
            periodEnd: END,
            closedAt: 1000,
            registration: true
        });
        expect(draft.batch).toBeNull();
        expect(draft.closure).toEqual(expect.objectContaining({
            registrationKind: PAYROLL_REGISTRATION_KIND,
            loanSettlementBatchId: null,
            paymentRefs: []
        }));
        expect(draft.closure.totals).toEqual({ gross: 3000, bonuses: 0, deductions: 0, loans: 75, net: 2925 });
        expect(draft.closure.linkedPaymentRefs).toEqual([
            { employeeId: 'e1', loanId: 'l1', paymentId: 'p1', amount: 30 },
            { employeeId: 'e1', loanId: 'l1', paymentId: 'p2', amount: 20 },
            { employeeId: 'e2', loanId: 'l2', paymentId: 'p3', amount: 25 }
        ]);
    });

    test('closing links the payments without creating or voiding any and keeps balances', () => {
        const people = employees();
        const balancesBefore = people.map(employee => employee.loans.map(getBalance));
        const summaryBefore = people.map(employee => getAccountSummary(employee).balance);
        const countBefore = paymentCount(people);
        const draft = buildPayrollClosureDraft({
            employees: people,
            rows: registrationRows(people),
            periodStart: START,
            periodEnd: END,
            closedAt: 1000,
            registration: true
        });

        const effects = applyPayrollClosureEffects(people, draft, { now: 2000 });

        expect(effects.loanResult).toBeNull();
        expect(effects.linkedPaymentCount).toBe(3);
        expect(effects.affectedEmployeeIds).toEqual(['e1', 'e2']);
        expect(paymentCount(people)).toBe(countBefore);
        expect(people.map(employee => employee.loans.map(getBalance))).toEqual(balancesBefore);
        expect(people.map(employee => getAccountSummary(employee).balance)).toEqual(summaryBefore);
        const p1 = people[0].loans[0].payments[0];
        expect(p1).toEqual(expect.objectContaining({
            voided: false,
            payrollClosureId: draft.closure.id,
            payrollClosureLinked: true,
            payrollClosureLinkedAt: 2000,
            updatedAt: 2000
        }));
        expect(people[0].loans[0].payments.find(item => item.id === 'p-other').payrollClosureId).toBeUndefined();
        expect(people[0].loans[0].payments.find(item => item.id === 'p-void').payrollClosureId).toBeUndefined();
    });

    test('linking refuses payments that changed since the preview', () => {
        const people = employees();
        const draft = buildPayrollClosureDraft({
            employees: people,
            rows: registrationRows(people),
            periodStart: START,
            periodEnd: END,
            registration: true
        });
        people[1].loans[0].payments[0].payrollClosureId = 'PAYROLL-CLOSURE-other';
        expect(() => linkRegistrationPayments(people, draft.closure)).toThrow('Los abonos del periodo cambiaron');
        expect(people[0].loans[0].payments[0].payrollClosureId).toBeUndefined();
    });

    test('superseding the early closure makes it non-effective', () => {
        const gate = getPayrollClosureGate({
            rows: [{ monto: 1 }],
            fingerprint: 'fp-new',
            paidConfirmation: { fingerprint: 'fp-new' },
            activeClosures: [earlyClosure],
            correctionSupersedesId: earlyClosure.id
        });
        expect(gate.enabled).toBe(true);
        expect(gate.nextSupersedesId).toBe(earlyClosure.id);

        const draft = buildPayrollClosureDraft({
            employees: employees(),
            rows: registrationRows(employees()),
            periodStart: START,
            periodEnd: END,
            supersedesId: gate.nextSupersedesId,
            registration: true
        });
        expect(getEffectivePayrollClosures([earlyClosure, draft.closure]).map(item => item.id))
            .toEqual([draft.closure.id]);
    });

    test('undo only unlinks the payments and voids the registered closure', () => {
        const people = employees();
        const draft = buildPayrollClosureDraft({
            employees: people,
            rows: registrationRows(people),
            periodStart: START,
            periodEnd: END,
            closedAt: 1000,
            registration: true
        });
        applyPayrollClosureEffects(people, draft, { now: 2000 });
        const balancesBefore = people.map(employee => employee.loans.map(getBalance));

        const result = undoPayrollClosureEffects(people, draft.closure, {
            now: 3000,
            activeClosures: [draft.closure]
        });

        expect(result.closure.status).toBe('voided');
        expect(result.voidedPaymentCount).toBe(0);
        expect(result.unlinkedPaymentCount).toBe(3);
        expect(result.affectedEmployeeIds).toEqual(['e1', 'e2']);
        const p1 = people[0].loans[0].payments[0];
        expect(p1.voided).toBe(false);
        expect(p1).not.toHaveProperty('payrollClosureId');
        expect(p1).not.toHaveProperty('payrollClosureLinked');
        expect(p1).not.toHaveProperty('payrollClosureLinkedAt');
        expect(p1.updatedAt).toBe(3000);
        expect(people.map(employee => employee.loans.map(getBalance))).toEqual(balancesBefore);
    });
});

describe('Registro de un periodo ya pagado (pantallas)', () => {
    const registration = { periodStart: START, periodEnd: END, payDate: '2026-10-03', supersedesId: 'X', loanMode: 'link' };

    test('banner, loan choice and confirmation follow the approved copy', () => {
        document.body.innerHTML = renderPayrollRegistrationBanner(registration, { active: true });
        expect(document.body.textContent.replace(/\s+/g, ' ')).toContain(
            'Registrando un periodo ya pagado: 11/09 – 01/10, pago del 03/10. Reemplaza al cierre que ya tenían esas fechas.'
        );

        const summary = summarizeRegistrationPayments(collectRegistrationPayments(employees(), START, END), baseRows());
        document.body.innerHTML = renderPayrollRegistrationLoans({ registration, summary });
        expect(document.querySelector('h4').textContent).toBe('¿Qué hacer con los préstamos?');
        const options = [...document.querySelectorAll('input[data-payroll-action="set-payroll-registration-loan-mode"]')];
        expect(options.map(option => [option.dataset.value, option.checked])).toEqual([['link', true], ['none', false]]);
        expect(document.body.textContent).toContain('Usar los 3 abonos ya anotados ($75.00)');
        expect(document.querySelectorAll('.payroll-registration-table tbody tr')).toHaveLength(3);
        expect(document.body.textContent).toContain('pagó el 03/10');

        document.body.innerHTML = renderPayrollRegistrationActions({
            registration,
            gate: { enabled: false, hasRows: true, invalidCount: 0, payrollPaid: false, reason: 'payroll-not-confirmed' }
        });
        expect(document.querySelector('label').textContent).toContain('Revisé que coincide con lo que se pagó el 03/10');
        const submit = document.querySelector('[data-payroll-action="open-payroll-closure"]');
        expect(submit.textContent.trim()).toBe('Registrar cierre');
        expect(submit.disabled).toBe(true);
    });
});

describe('Registro de un periodo ya pagado (flujo completo, sin obras)', () => {
    let saveWithEmployees;

    beforeEach(() => {
        globalThis.currentUser = { uid: 'registration-test-user' };
        window.showNotification = jest.fn();
        Object.assign(appState, {
            employees: employees(),
            positions: [],
            leaders: [],
            attendance: {},
            settings: { payPeriod: { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' }, schemaVersion: 2 },
            exportConfig: {
                periodStart: '2026-08-21',
                periodEnd: '2026-09-10',
                deductions: [],
                bonuses: [],
                payrollLoanSelection: [],
                leaderFilter: 'all',
                rememberedGlobalsHydrated: true,
                collapsedSteps: [],
                payrollGuideStep: 'review'
            },
            payrollViewMode: 'history'
        });
        PayrollUI.init({
            state: appState,
            services: {
                payroll: {
                    calculateEmployeePayroll: () => ({
                        brutoOriginal: 1000, bruto: 1000, neto: 1000, bonuses: 0, deductions: 0, breakdown: []
                    })
                }
            },
            render: jest.fn(),
            saveToLocalStorage: jest.fn()
        });
        jest.spyOn(payrollClosureStore, 'getByPeriod').mockResolvedValue([earlyClosure]);
        jest.spyOn(payrollClosureStore, 'listAll').mockResolvedValue([earlyClosure]);
        jest.spyOn(payrollClosureStore, 'getSyncStates').mockResolvedValue({});
        jest.spyOn(payrollClosureStore, 'listPage').mockResolvedValue({ items: [], nextCursor: null });
        jest.spyOn(payrollClosureSync, 'pullPeriod').mockResolvedValue({ closures: [], imported: 0, conflicts: [] });
        jest.spyOn(payrollClosureSync, 'pullPage').mockResolvedValue({ items: [], nextCursor: null });
        saveWithEmployees = jest.spyOn(payrollClosureStore, 'saveWithEmployees').mockImplementation(async value => value);
        jest.spyOn(Modal, 'alert').mockResolvedValue();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete globalThis.currentUser;
        delete window.showNotification;
    });

    test('registers the period: links the payments, supersedes the early closure and goes back to the history', async () => {
        const modal = jest.spyOn(PayrollClosureUI, 'openPayrollClosureModal');
        PayrollUI.startPayrollRegistration(`${START}|${END}`, earlyClosure.id);
        expect(appState.payrollViewMode).toBe('generator');
        expect(appState.exportConfig).toEqual(expect.objectContaining({
            periodStart: START,
            periodEnd: END,
            payrollCorrectionSupersedesId: earlyClosure.id,
            payrollLoanSelection: []
        }));
        expect(appState.exportConfig.payrollRegistration).toEqual(expect.objectContaining({
            loanMode: 'link', supersedesId: earlyClosure.id, confirmed: false
        }));

        PayrollUI.togglePayrollPaidConfirmation(true); // primes the period history cache
        await new Promise(resolve => setTimeout(resolve, 0));
        PayrollUI.togglePayrollPaidConfirmation(true);
        expect(appState.exportConfig.payrollRegistration.confirmed).toBe(true);

        await PayrollUI.openPayrollClosure();

        expect(modal).not.toHaveBeenCalled();
        expect(saveWithEmployees).toHaveBeenCalledTimes(1);
        const [closure, savedEmployees] = saveWithEmployees.mock.calls[0];
        expect(closure).toEqual(expect.objectContaining({
            registrationKind: 'already-paid',
            supersedesId: earlyClosure.id,
            loanSettlementBatchId: null
        }));
        expect(closure.totals.loans).toBe(75);
        expect(savedEmployees.map(employee => employee.id).sort()).toEqual(['e1', 'e2']);
        const p1 = appState.employees[0].loans[0].payments[0];
        expect(p1).toEqual(expect.objectContaining({ payrollClosureId: closure.id, payrollClosureLinked: true, voided: false }));
        expect(paymentCount(appState.employees)).toBe(paymentCount(employees()));
        expect(appState.exportConfig.payrollRegistration).toBeNull();
        expect(appState.payrollViewMode).toBe('history');
    });

    test('changing the loan choice asks to confirm again; cancel returns to the history', () => {
        PayrollUI.startPayrollRegistration(`${START}|${END}`, null);
        PayrollUI.setPayrollRegistrationLoanMode('none');
        expect(appState.exportConfig.payrollRegistration).toEqual(expect.objectContaining({ loanMode: 'none', confirmed: false }));
        expect(appState.exportConfig.payrollPaidConfirmation).toBeNull();

        PayrollUI.cancelPayrollRegistration();
        expect(appState.exportConfig.payrollRegistration).toBeNull();
        expect(appState.exportConfig.payrollCorrectionSupersedesId).toBeNull();
        expect(appState.payrollViewMode).toBe('history');
    });
});
