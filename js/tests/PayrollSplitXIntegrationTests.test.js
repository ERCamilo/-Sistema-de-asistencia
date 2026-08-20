import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { stateManager } from '../modules/core/AppState.js';

describe('Payroll SplitX postMessage Integration', () => {
    let originalOpen;
    let originalShowNotification;
    let mockWindow;
    let state;
    let notifications;

    beforeEach(() => {
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

        originalOpen = window.open;
        originalShowNotification = window.showNotification;
        window.open = jest.fn(() => mockWindow);
        window.PayrollUI = PayrollUI;

        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
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
        window.open = originalOpen;
        window.showNotification = originalShowNotification;
        jest.clearAllMocks();
    });

    test('sendToSplitX opens splitx.erlin.do and initiates postMessage listener', () => {
        const target = PayrollUI.sendToSplitX();

        expect(window.open).toHaveBeenCalledWith('https://splitx.erlin.do', '_blank');
        expect(target).toBe(mockWindow);
        expect(notifications.some(n => n.msg.includes('Abriendo SplitX'))).toBe(true);
    });

    test('sendToSplitX sends payload upon receiving SPLITX_READY event', () => {
        PayrollUI.sendToSplitX('https://splitx.erlin.do');

        // Simulate SPLITX_READY message event
        const readyEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_READY', version: '1.0' },
            origin: 'https://splitx.erlin.do'
        });
        window.dispatchEvent(readyEvent);

        expect(mockWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'SPLITX_IMPORT_PAYROLL',
                source: 'Sistema-de-Asistencia',
                version: '1.0',
                currency: 'DOP',
                period: { start: '2026-08-01', end: '2026-08-15' },
                employees: expect.arrayContaining([
                    expect.objectContaining({
                        nombre: expect.stringContaining('Ana Perez'),
                        monto: 1600
                    })
                ])
            }),
            '*'
        );
        expect(notifications.some(n => n.msg.includes('Transfiriendo'))).toBe(true);
    });

    test('sendToSplitX notifies success when SPLITX_IMPORT_SUCCESS is received', () => {
        PayrollUI.sendToSplitX('https://splitx.erlin.do');

        const successEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_IMPORT_SUCCESS', count: 1 },
            origin: 'https://splitx.erlin.do'
        });
        window.dispatchEvent(successEvent);

        expect(notifications.some(n => n.type === 'success' && n.msg.includes('1 colaboradores cargados en SplitX'))).toBe(true);
    });

    test('sendToSplitX handles error response from SplitX', () => {
        PayrollUI.sendToSplitX('https://splitx.erlin.do');

        const errorEvent = new MessageEvent('message', {
            data: { type: 'SPLITX_IMPORT_ERROR', error: 'Formato no soportado' },
            origin: 'https://splitx.erlin.do'
        });
        window.dispatchEvent(errorEvent);

        expect(notifications.some(n => n.type === 'error' && n.msg.includes('Formato no soportado'))).toBe(true);
    });

    test('sendToSplitX uses custom URL from state.settings.splitxUrl when configured', () => {
        state.settings.splitxUrl = 'http://127.0.0.1:8081';

        const target = PayrollUI.sendToSplitX();

        expect(window.open).toHaveBeenCalledWith('http://127.0.0.1:8081', '_blank');
        expect(target).toBe(mockWindow);
        expect(notifications.some(n => n.msg.includes('http://127.0.0.1:8081'))).toBe(true);
    });

    test('sendToSplitX handles popup blocker by notifying user and returning null', () => {
        window.open = jest.fn(() => null);

        const target = PayrollUI.sendToSplitX();

        expect(target).toBeNull();
        expect(notifications.some(n => n.type === 'error' && n.msg.includes('bloqueó la ventana emergente'))).toBe(true);
    });
});
