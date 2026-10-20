import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { stateManager } from '../modules/core/AppState.js';
import { createLoan } from '../modules/features/loans/LoansService.js';
import { buildPayrollLoanSelection, setPayrollLoanMode } from '../modules/features/payroll/PayrollLoans.js';

describe('Payroll SplitX postMessage Integration', () => {
    let originalOpen;
    let originalShowNotification;
    let mockWindow;
    let state;
    let notifications;
    let calculatePayroll;

    beforeEach(() => {
        jest.useFakeTimers();
        originalOpen = window.open;
        originalShowNotification = window.showNotification;
        state = {
            employees: [
                { id: 'emp-1', number: '1', name: 'Ana Perez', hourlyRate: 200, active: true }
            ],
            attendance: {
                'emp-1-2026-08-01': { employeeId: 'emp-1', date: '2026-08-01', totalHours: 8, status: 'present' }
            },
            exportConfig: {
                periodStart: '2026-08-01',
                periodEnd: '2026-08-15',
                payrollLoanSelection: [],
                payrollLoanExpandedEmployees: [],
                payrollPreviewInclusion: { active: true, inactive: false, zeroHours: false }
            },
            settings: {
                currency: 'DOP'
            }
        };

        stateManager.getState = () => state;
        notifications = [];
        window.showNotification = (msg, type) => {
            notifications.push({ msg, type });
        };

        mockWindow = {
            postMessage: jest.fn(),
            closed: false
        };

        window.open = jest.fn(() => mockWindow);
        window.PayrollUI = PayrollUI;

        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: calculatePayroll = jest.fn(() => ({
                        brutoOriginal: 1600,
                        bruto: 1600,
                        bonuses: 0,
                        deductions: 0,
                        neto: 1600
                    }))
                }
            },
            render: jest.fn()
        });
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        window.open = originalOpen;
        window.showNotification = originalShowNotification;
        jest.clearAllMocks();
    });

    test('manual JSON and postMessage export the same period, concepts, totals and proportional days', async () => {
        state.settings.regularHoursPerDay = 8;
        state.settings.companyName = 'Constructora Ejemplo';
        createLoan(state.employees[0], { principal: 3000, interestRate: 0, startDate: '2026-08-01', concept: 'Adelanto de ejemplo' });
        state.exportConfig.payrollLoanSelection = setPayrollLoanMode(buildPayrollLoanSelection(state.employees), 'emp-1', 'custom', 100);
        calculatePayroll.mockReturnValue({
            brutoOriginal: 1000, bruto: 1000, bonuses: 0, deductions: 530, neto: 470,
            breakdown: [{ positionId: 'P1', positionName: 'Albañil', hourlyRate: 250, regularHours: 4 }],
            deductionBreakdown: [
                { id: 'law', name: 'Descuento de ley', type: 'percentage', value: 3, appliedTo: 1000, amount: 30 },
                { id: 'repair', name: 'Reparación equipo', type: 'fixed', value: 500, amount: 500 }
            ]
        });
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn(() => Promise.resolve()) } });
        PayrollUI.copyExportJSON();
        const copied = JSON.parse(navigator.clipboard.writeText.mock.calls[0][0]);
        PayrollUI.sendToSplitX();
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'SPLITX_READY' }, origin: 'https://splitx.erlin.do', source: mockWindow }));
        const payload = mockWindow.postMessage.mock.calls.find(c => c[0].type === 'SPLITX_IMPORT_PAYROLL')[0];
        expect(payload.employees).toEqual(copied);
        expect(payload.period).toEqual({ start: '2026-08-01', end: '2026-08-15' });
        expect(payload.companyName).toBe('Constructora Ejemplo');
        expect(payload.payrollName).toBe('Nómina período 01/08/2026 - 15/08/2026');
        expect(copied[0].exportContext.companyName).toBe(payload.companyName);
        expect(copied[0].exportContext.payrollName).toBe(payload.payrollName);
        expect(payload.totals).toMatchObject({ employeeCount: 1, gross: 1000, deductions: 530, loans: 100, net: 370 });
        expect(copied[0]).toMatchObject({ sourceEmployeeId: 'emp-1', employeeNumber: '1', workDays: { regular: 0.5, total: 0.5 } });
        expect(copied[0].deductionDetails.map(d => [d.concept, d.signedAmount])).toEqual([['Descuento de ley', -30], ['Reparación equipo', -500]]);
        expect(copied[0].exportContext.period).toEqual(payload.period);
        expect(copied[0].positions[0].dailyRate).toBe(2000);
        expect(copied[0].loanSummary).toMatchObject({ balanceBefore: 3000, deductionAmount: 100, projectedBalanceAfter: 2900, projectionAvailable: true });
        expect(state.employees[0].loans[0].payments).toEqual([]);
        expect(payload).not.toHaveProperty('payrollId');
    });

    test('downloaded JSON preserves the array and includes the same context as clipboard JSON', () => {
        state.settings.companyName = 'Empresa de archivo';
        createLoan(state.employees[0], { principal: 3000, interestRate: 0, startDate: '2026-08-01', concept: 'Abono parcial' });
        state.exportConfig.payrollLoanSelection = setPayrollLoanMode(buildPayrollLoanSelection(state.employees), 'emp-1', 'custom', 500);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn(() => Promise.resolve()) } });
        const originalBlob = window.Blob;
        const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
        const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        let file;
        window.Blob = jest.fn(parts => { file = parts.join(''); return {}; });
        URL.createObjectURL = jest.fn(() => 'blob:synthetic');
        URL.revokeObjectURL = jest.fn();
        try {
            PayrollUI.copyExportJSON();
            PayrollUI.downloadExportJSON();
            expect(JSON.parse(file)).toEqual(JSON.parse(navigator.clipboard.writeText.mock.calls[0][0]));
            expect(JSON.parse(file)[0].exportContext).toMatchObject({ period: { start: '2026-08-01', end: '2026-08-15' }, currency: 'DOP', companyName: 'Empresa de archivo', payrollName: 'Nómina período 01/08/2026 - 15/08/2026' });
            expect(JSON.parse(file)[0].loanSummary).toMatchObject({ balanceBefore: 3000, deductionAmount: 500, projectedBalanceAfter: 2500 });
            expect(click).toHaveBeenCalledTimes(1);
        } finally {
            window.Blob = originalBlob;
            URL.createObjectURL = originalCreate;
            URL.revokeObjectURL = originalRevoke;
            click.mockRestore();
        }
    });

    test('sendToSplitX opens splitx.erlin.do, sends initial SPLITX_PING and initiates listener', () => {
        const target = PayrollUI.sendToSplitX();

        expect(window.open).toHaveBeenCalledWith('https://splitx.erlin.do', '_blank');
        expect(target).toBe(mockWindow);
        expect(notifications.some(n => n.msg.includes('Abriendo SplitX'))).toBe(true);
        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SPLITX_PING',
                source: 'Sistema-de-Asistencia',
                version: '1.0',
                transferId: expect.any(String)
            }),
            'https://splitx.erlin.do'
        );
    });

    test('sendToSplitX sends payload with targetOrigin and transferId upon receiving SPLITX_READY event', () => {
        PayrollUI.sendToSplitX('https://splitx.erlin.do');
        mockWindow.postMessage.mockClear();

        // Simulate SPLITX_READY message event from the expected window and origin
        const readyEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_READY', version: '1.0' },
            origin: 'https://splitx.erlin.do',
            source: mockWindow
        });
        window.dispatchEvent(readyEvent);

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SPLITX_IMPORT_PAYROLL',
                source: 'Sistema-de-Asistencia',
                version: '1.0',
                transferId: expect.any(String),
                currency: 'DOP',
                period: { start: '2026-08-01', end: '2026-08-15' },
                employees: expect.arrayContaining([
                    expect.objectContaining({
                        nombre: expect.stringContaining('Ana Perez'),
                        monto: 1600
                    })
                ])
            }),
            'https://splitx.erlin.do'
        );
        expect(notifications.some(n => n.msg.includes('Transfiriendo'))).toBe(true);
    });

    test('sendToSplitX ignores events from mismatched origin or window source', () => {
        PayrollUI.sendToSplitX('https://splitx.erlin.do');
        mockWindow.postMessage.mockClear();

        // Event from wrong origin
        const badOriginEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_READY', version: '1.0' },
            origin: 'https://evil-site.com',
            source: mockWindow
        });
        window.dispatchEvent(badOriginEvent);
        expect(mockWindow.postMessage).not.toHaveBeenCalled();

        // Event from wrong source window
        const badSourceEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_READY', version: '1.0' },
            origin: 'https://splitx.erlin.do',
            source: {}
        });
        window.dispatchEvent(badSourceEvent);
        expect(mockWindow.postMessage).not.toHaveBeenCalled();
    });

    test('sendToSplitX is idempotent and only sends the payroll payload once even on multiple SPLITX_READY events', () => {
        PayrollUI.sendToSplitX('https://splitx.erlin.do');
        mockWindow.postMessage.mockClear();

        const readyEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_READY', version: '1.0' },
            origin: 'https://splitx.erlin.do',
            source: mockWindow
        });

        window.dispatchEvent(readyEvent);
        window.dispatchEvent(readyEvent);
        window.dispatchEvent(readyEvent);

        expect(mockWindow.postMessage).toHaveBeenCalledTimes(1);
    });

    test('sendToSplitX notifies success when SPLITX_IMPORT_SUCCESS is received with matching transferId', () => {
        PayrollUI.sendToSplitX('https://splitx.erlin.do');
        const pingCall = mockWindow.postMessage.mock.calls.find(c => c[0].type === 'SPLITX_PING');
        const transferId = pingCall[0].transferId;

        // Message with mismatched transferId should be ignored
        const wrongTxEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_IMPORT_SUCCESS', count: 1, transferId: 'wrong_id' },
            origin: 'https://splitx.erlin.do',
            source: mockWindow
        });
        window.dispatchEvent(wrongTxEvent);
        expect(notifications.some(n => n.type === 'success')).toBe(false);

        // Message with matching transferId succeeds
        const successEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_IMPORT_SUCCESS', count: 1, transferId },
            origin: 'https://splitx.erlin.do',
            source: mockWindow
        });
        window.dispatchEvent(successEvent);

        expect(notifications.some(n => n.type === 'success' && n.msg.includes('1 colaboradores cargados en SplitX'))).toBe(true);
    });

    test('sendToSplitX handles error response from SplitX with matching transferId', () => {
        PayrollUI.sendToSplitX('https://splitx.erlin.do');
        const pingCall = mockWindow.postMessage.mock.calls.find(c => c[0].type === 'SPLITX_PING');
        const transferId = pingCall[0].transferId;

        const errorEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_IMPORT_ERROR', error: 'Formato no soportado', transferId },
            origin: 'https://splitx.erlin.do',
            source: mockWindow
        });
        window.dispatchEvent(errorEvent);

        expect(notifications.some(n => n.type === 'error' && n.msg.includes('Formato no soportado'))).toBe(true);
    });

    test('sendToSplitX uses custom URL with matching targetOrigin when configured', () => {
        state.settings.splitxUrl = 'http://127.0.0.1:8081';

        const target = PayrollUI.sendToSplitX();

        expect(window.open).toHaveBeenCalledWith('http://127.0.0.1:8081', '_blank');
        expect(target).toBe(mockWindow);

        mockWindow.postMessage.mockClear();

        const readyEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_READY', version: '1.0' },
            origin: 'http://127.0.0.1:8081',
            source: mockWindow
        });
        window.dispatchEvent(readyEvent);

        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SPLITX_IMPORT_PAYROLL' }),
            'http://127.0.0.1:8081'
        );
    });

    test('sendToSplitX handles popup blocker by notifying user and returning null', () => {
        window.open = jest.fn(() => null);

        const target = PayrollUI.sendToSplitX();

        expect(target).toBeNull();
        expect(notifications.some(n => n.type === 'error' && n.msg.includes('bloqueó la ventana emergente'))).toBe(true);
    });
});
