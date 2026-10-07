import { Modal } from '../modules/components/Modal.js';
import { state } from '../modules/core/AppState.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import payrollClosureStore from '../modules/features/payroll/PayrollClosureStore.js';
import payrollClosureSync from '../modules/features/payroll/PayrollClosureSync.js';
import { renderPayrollHistoryView } from '../modules/features/payroll/PayrollHistoryUI.js';
import { buildClosureReview } from '../modules/features/payroll/PayrollClosureReview.js';

const PAY_PERIOD = { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' };

function closure(overrides = {}) {
    return {
        schemaVersion: 2,
        id: 'PAYROLL-CLOSURE-legacy',
        fingerprint: 'fp-legacy',
        status: 'closed',
        periodStart: '2026-07-31',
        periodEnd: '2026-08-20',
        closedAt: new Date(2026, 7, 22, 11, 55).getTime(),
        closedBy: 'operator',
        employeeCount: 1,
        totals: { gross: 100, bonuses: 0, deductions: 0, loans: 50, net: 50 },
        rows: [{ employeeId: 'e1', employeeNumber: '1', gross: 100, bonuses: 0, deductions: 0, loans: 50, net: 50 }],
        adjustments: { bonuses: [], deductions: [] },
        loanSettlementBatchId: 'PAYROLL-BATCH-legacy',
        paymentRefs: [{ employeeId: 'e1', loanId: 'l1', paymentId: 'p1' }],
        supersedesId: null,
        ...overrides
    };
}

const legacy = closure();
// La copia recuperada vive en el mismo almacén; con obras desactivadas se ve igual.
const copy = closure({ id: 'PAYROLL-CLOSURE-copy', fingerprint: 'fp-copy', recovery: { sourceId: legacy.id } });

function employees() {
    return [{
        id: 'e1',
        number: '1',
        loans: [{
            id: 'l1',
            payments: [
                {
                    id: 'p1', amount: 50, voided: false, origin: 'payroll',
                    payrollPeriodStart: '2026-07-31', payrollPeriodEnd: '2026-08-20',
                    payrollClosureId: copy.id, payrollBatchId: 'PAYROLL-BATCH-legacy'
                },
                {
                    id: 'p2', amount: 30, voided: false, origin: 'payroll',
                    payrollPeriodStart: '2026-08-21', payrollPeriodEnd: '2026-09-10'
                }
            ]
        }]
    }];
}

describe('Historial: revisión de cierres', () => {
    const review = () => buildClosureReview({
        closures: [legacy, copy],
        employees: employees(),
        payPeriod: PAY_PERIOD,
        today: '2026-10-07'
    });

    test('shows the review block, the repeated card and the period without closure', () => {
        const html = renderPayrollHistoryView({ items: [copy, legacy], review: review() });
        document.body.innerHTML = html;

        const block = document.querySelector('.payroll-history-review');
        expect(block.textContent).toContain('Revisión de cierres');
        expect(block.textContent).toContain('El cierre del 31/07 al 20/08 está guardado dos veces');
        expect(block.querySelector('[data-payroll-action="remove-duplicate-payroll-closure"]').dataset.id).toBe(legacy.id);

        const repeated = document.querySelector(`[data-id="${legacy.id}"].payroll-history-card`);
        expect(repeated.querySelector('.payroll-history-card__status').className).toContain('is-review');
        expect(repeated.textContent).toContain('Repetida');
        expect(repeated.querySelector('.payroll-history-card__flag').textContent).toContain('Copia repetida');

        const missing = [...document.querySelectorAll('.payroll-history-card.is-missing')];
        expect(missing.map(card => card.querySelector('strong').textContent)).toContain('2026-08-21 – 2026-09-10');
        const register = missing[0].querySelector('[data-payroll-action="start-payroll-registration"]');
        expect(register.textContent.trim()).toBe('Registrar cierre');
        expect(document.querySelector('option[value="missing"]').textContent).toBe('Sin cierre');
    });

    test('the «Sin cierre» filter shows only periods without closure', () => {
        document.body.innerHTML = renderPayrollHistoryView({
            items: [copy, legacy],
            filters: { status: 'missing' },
            review: review()
        });
        expect(document.querySelectorAll('button.payroll-history-card')).toHaveLength(0);
        expect(document.querySelectorAll('.payroll-history-card.is-missing').length).toBeGreaterThan(0);
    });

    test('read-only history hides the fixing actions', () => {
        document.body.innerHTML = renderPayrollHistoryView({ items: [copy, legacy], review: review(), readOnly: true });
        expect(document.querySelector('[data-payroll-action="remove-duplicate-payroll-closure"]')).toBeNull();
        expect(document.querySelector('[data-payroll-action="start-payroll-registration"]')).toBeNull();
    });
});

describe('Historial: quitar copia y deshacer', () => {
    let saveWithEmployees;
    let alert;

    beforeEach(() => {
        globalThis.currentUser = { uid: 'payroll-test-user' };
        state.employees = employees();
        state.settings = { ...(state.settings || {}), payPeriod: PAY_PERIOD, schemaVersion: 2 };
        state.exportConfig = { periodStart: '2026-07-31', periodEnd: '2026-08-20', bonuses: [], deductions: [] };
        PayrollUI.init({
            state,
            services: { payroll: { calculateEmployeePayroll: jest.fn() } },
            render: jest.fn(),
            saveToLocalStorage: jest.fn()
        });
        jest.spyOn(payrollClosureStore, 'listAll').mockResolvedValue([legacy, copy]);
        jest.spyOn(payrollClosureStore, 'getSyncStates').mockResolvedValue({});
        saveWithEmployees = jest.spyOn(payrollClosureStore, 'saveWithEmployees')
            .mockImplementation(async value => value);
        alert = jest.spyOn(Modal, 'alert').mockResolvedValue();
        window.showConfirm = options => options.onConfirm();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete globalThis.currentUser;
        delete window.showConfirm;
    });

    test('voids only the repeated record: payments and their batch stay untouched', async () => {
        const before = JSON.stringify(state.employees);

        await PayrollUI.removeDuplicatePayrollClosure(legacy.id);

        expect(alert).not.toHaveBeenCalled();
        expect(saveWithEmployees).toHaveBeenCalledTimes(1);
        const [saved, savedEmployees, options] = saveWithEmployees.mock.calls[0];
        expect(saved).toEqual(expect.objectContaining({
            id: legacy.id,
            status: 'voided',
            voidReason: 'Copia repetida',
            loanSettlementBatchId: 'PAYROLL-BATCH-legacy'
        }));
        expect(savedEmployees).toEqual([]);
        expect(options).toEqual(expect.objectContaining({ enqueueCloud: true }));
        expect(JSON.stringify(state.employees)).toBe(before);
        expect(state.employees[0].loans[0].payments[0]).toEqual(expect.objectContaining({
            voided: false, payrollClosureId: copy.id
        }));
    });

    test('does nothing when the confirmation is cancelled', async () => {
        window.showConfirm = options => options.onCancel();
        await PayrollUI.removeDuplicatePayrollClosure(legacy.id);
        expect(saveWithEmployees).not.toHaveBeenCalled();
    });

    test('undo is refused while the repeated copy shares the loan batch', async () => {
        jest.spyOn(payrollClosureStore, 'getById').mockResolvedValue(copy);
        jest.spyOn(payrollClosureStore, 'getByPeriod').mockResolvedValue([legacy, copy]);
        jest.spyOn(payrollClosureSync, 'pullPeriod').mockResolvedValue({ closures: [], imported: 0, conflicts: [] });

        await PayrollUI.undoPayrollClosure(copy.id);

        expect(saveWithEmployees).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledWith(expect.objectContaining({
            title: 'No se puede deshacer',
            message: expect.stringContaining('comparte sus abonos con otro cierre')
        }));
        expect(state.employees[0].loans[0].payments[0].voided).toBe(false);
    });
});
