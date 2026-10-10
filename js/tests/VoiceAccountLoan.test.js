import { state } from '../modules/core/AppState.js';
import { resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { registerNewAccountLoan, laUseClassicView, laSetTab } from '../modules/features/loans/LoanAccountController.js';
import { selectLoansEmployee } from '../modules/features/loans/LoansController.js';
import { getTotalDue } from '../modules/features/loans/LoansService.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
jest.mock('../modules/services/PersistenceService.js', () => ({ saveApplicationData: jest.fn() }));

const draft = () => ({ principal: 1000, interestRate: 20, interestIncluded: false, installmentMode: 'lump', startDate: '2026-10-03', concept: 'voice - prueba' });
beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-03T12:00:00'), doNotFake: ['requestAnimationFrame', 'setTimeout', 'clearTimeout', 'queueMicrotask'] });
    resetEntityScope(); localStorage.clear(); window.currentUser = { uid: 'voice-test' };
    state.employees = [{ id: 'a', name: 'Prueba', loans: [] }, { id: 'b', name: 'Otra', loans: [] }];
    state.settings = { payPeriod: { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' } };
    state.loansLedger = { selectedEmployeeId: 'a', account: { tab: 'loans', modal: null } };
    saveApplicationData.mockClear();
});
afterEach(() => { jest.useRealTimers(); delete window.currentUser; delete window.showConfirm; });
test('confirmed voice uses existing calculations, numbering and persistence and registers once', async () => {
    const options = { period: '2026-10-24', voiceRequestId: 'r-1' };
    const loan = await registerNewAccountLoan('a', draft(), options);
    expect(loan).toMatchObject({ principal: 1000, interestRate: 20, dueDate: '2026-10-24', voiceRequestId: 'r-1' });
    expect(getTotalDue(loan)).toBe(1200);
    const repeated = await registerNewAccountLoan('a', draft(), options);
    expect(repeated.id).toBe(loan.id); expect(state.employees[0].loans).toHaveLength(1);
    expect(saveApplicationData).toHaveBeenCalledTimes(1);
    await expect(registerNewAccountLoan('b', draft(), options)).rejects.toThrow('otro empleado');
});
test('missing or same-day payroll cannot create a voice loan', async () => {
    await expect(registerNewAccountLoan('a', draft(), { period: '2026-10-03', voiceRequestId: 'r-1' })).rejects.toThrow('futura');
    state.settings.payPeriod = null;
    await expect(registerNewAccountLoan('a', draft(), { period: '2026-10-24', voiceRequestId: 'r-1' })).rejects.toThrow('futura');
    expect(state.employees[0].loans).toHaveLength(0);
});
test('first voice loan opens its account even before visiting the loans screen', async () => {
    state.loansLedger = undefined;
    const options = { period: '2026-10-24', voiceRequestId: 'first-voice' };
    const loan = await registerNewAccountLoan('a', draft(), options);
    expect(state.loansLedger).toBeUndefined();
    selectLoansEmployee('a');
    expect(state.loansLedger.account).toBeUndefined();
    laUseClassicView(false);
    expect(() => laSetTab('loans')).not.toThrow();
    expect(state.loansLedger).toMatchObject({ selectedEmployeeId: 'a', showAddForm: false, account: { tab: 'loans', modal: null } });
    const retried = await registerNewAccountLoan('a', draft(), options);
    expect(retried.id).toBe(loan.id);
    expect(state.employees[0].loans).toHaveLength(1);
    expect(saveApplicationData).toHaveBeenCalledTimes(1);
});
test('duplicate cancellation and an account change during confirmation preserve business data', async () => {
    await registerNewAccountLoan('a', draft(), { period: '2026-10-24', voiceRequestId: 'r-1' });
    const cancel = jest.fn().mockResolvedValue(false);
    expect(await registerNewAccountLoan('a', draft(), { period: '2026-10-24', voiceRequestId: 'r-2', confirmDuplicate: cancel })).toBeNull();
    expect(cancel).toHaveBeenCalled();
    await expect(registerNewAccountLoan('a', draft(), { period: '2026-10-24', voiceRequestId: 'r-2', confirmDuplicate: async () => { window.currentUser = { uid: 'other' }; return true; } })).rejects.toThrow('Cambió');
    expect(state.employees[0].loans).toHaveLength(1);
});
