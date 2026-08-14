import { Modal } from '../modules/components/Modal.js';
import { state } from '../modules/core/AppState.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import payrollClosureStore from '../modules/features/payroll/PayrollClosureStore.js';
import payrollClosureSync from '../modules/features/payroll/PayrollClosureSync.js';

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
    let pullPeriod;
    let saveWithEmployees;
    let saveToLocalStorage;
    let alert;
    let render;

    beforeEach(() => {
        globalThis.currentUser = { uid: 'payroll-test-user' };
        state.employees = [];
        state.exportConfig = {
            periodStart: '2026-08-01',
            periodEnd: '2026-08-15',
            bonuses: [],
            deductions: []
        };
        render = jest.fn();
        saveToLocalStorage = jest.fn();
        PayrollUI.init({
            state,
            services: { payroll: { calculateEmployeePayroll: jest.fn() } },
            render,
            saveToLocalStorage
        });
        getById = jest.spyOn(payrollClosureStore, 'getById');
        getByPeriod = jest.spyOn(payrollClosureStore, 'getByPeriod').mockResolvedValue([]);
        pullPeriod = jest.spyOn(payrollClosureSync, 'pullPeriod')
            .mockResolvedValue({ closures: [], imported: 0, conflicts: [] });
        saveWithEmployees = jest.spyOn(payrollClosureStore, 'saveWithEmployees')
            .mockImplementation(async value => value);
        alert = jest.spyOn(Modal, 'alert').mockResolvedValue();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete globalThis.currentUser;
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

    test('refreshes the exact period and blocks undo when a remote successor is discovered', async () => {
        const current = closure();
        const successor = closure({ id: 'closure-2', supersedesId: current.id });
        let refreshed = false;
        getById.mockResolvedValue(current);
        pullPeriod.mockImplementation(async (periodStart, periodEnd) => {
            expect([periodStart, periodEnd]).toEqual([current.periodStart, current.periodEnd]);
            refreshed = true;
            return { closures: [current, successor], imported: 2, conflicts: [] };
        });
        getByPeriod.mockImplementation(async () => refreshed ? [current, successor] : [current]);

        await PayrollUI.undoPayrollClosure(current.id);

        expect(refreshed).toBe(true);
        expect(saveWithEmployees).not.toHaveBeenCalled();
        expect(saveToLocalStorage).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledWith(expect.objectContaining({
            title: 'No se puede deshacer'
        }));
    });

    test('fails closed when the remote period refresh fails', async () => {
        const current = closure();
        getById.mockResolvedValue(current);
        pullPeriod.mockRejectedValue(new Error('remote unavailable'));

        await PayrollUI.undoPayrollClosure(current.id);

        expect(getByPeriod).not.toHaveBeenCalled();
        expect(saveWithEmployees).not.toHaveBeenCalled();
        expect(saveToLocalStorage).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledTimes(1);
    });
});
