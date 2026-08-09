import { Modal } from '../modules/components/Modal.js';
import { state } from '../modules/core/AppState.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import payrollClosureStore from '../modules/features/payroll/PayrollClosureStore.js';

function closure(overrides = {}) {
    return {
        id: 'closure-1',
        fingerprint: 'closure-fingerprint',
        status: 'closed',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-15',
        paymentRefs: [],
        rows: [],
        adjustments: { bonuses: [], deductions: [] },
        ...overrides
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

describe('Payroll closure mutation UI', () => {
    let getById;
    let getByPeriod;
    let saveWithEmployees;
    let alert;
    let render;

    beforeEach(() => {
        state.employees = [];
        state.exportConfig = {
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            bonuses: [],
            deductions: []
        };
        render = jest.fn();
        PayrollUI.init({
            state,
            services: { payroll: { calculateEmployeePayroll: jest.fn() } },
            render,
            saveToLocalStorage: jest.fn()
        });
        getById = jest.spyOn(payrollClosureStore, 'getById');
        getByPeriod = jest.spyOn(payrollClosureStore, 'getByPeriod').mockResolvedValue([]);
        saveWithEmployees = jest.spyOn(payrollClosureStore, 'saveWithEmployees')
            .mockImplementation(async value => value);
        alert = jest.spyOn(Modal, 'alert').mockResolvedValue();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('ignores a second undo while one is pending and releases the guard after success', async () => {
        const pending = deferred();
        const current = closure();
        getById.mockImplementationOnce(() => pending.promise).mockResolvedValue(current);
        getByPeriod.mockResolvedValue([current]);

        const first = PayrollUI.undoPayrollClosure(current.id);
        const second = PayrollUI.undoPayrollClosure(current.id);
        expect(getById).toHaveBeenCalledTimes(1);

        pending.resolve(current);
        await Promise.all([first, second]);
        await PayrollUI.undoPayrollClosure(current.id);

        expect(getById).toHaveBeenCalledTimes(2);
        expect(saveWithEmployees).toHaveBeenCalledTimes(2);
    });

    test('ignores a close while an undo is pending', async () => {
        const pending = deferred();
        const current = closure();
        getById.mockImplementationOnce(() => pending.promise);

        const undo = PayrollUI.undoPayrollClosure(current.id);
        const close = PayrollUI.openPayrollClosure();
        await close;
        expect(render).not.toHaveBeenCalled();

        pending.resolve(current);
        await Promise.all([undo, close]);
    });

    test('ignores a second undo while one is pending and releases the guard after failure', async () => {
        const pending = deferred();
        getById.mockImplementationOnce(() => pending.promise).mockResolvedValue(closure());

        const first = PayrollUI.undoPayrollClosure('closure-1');
        const second = PayrollUI.undoPayrollClosure('closure-1');
        expect(getById).toHaveBeenCalledTimes(1);

        pending.reject(new Error('persistence failed'));
        await Promise.all([first, second]);
        await PayrollUI.undoPayrollClosure('closure-1');

        expect(getById).toHaveBeenCalledTimes(2);
        expect(alert).toHaveBeenCalledTimes(1);
    });
});
