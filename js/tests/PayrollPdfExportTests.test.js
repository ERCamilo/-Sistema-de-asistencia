import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { stateManager } from '../modules/core/AppState.js';

describe('Payroll PDF Export', () => {
    let state;
    let notifications;
    let mockDoc;

    beforeEach(() => {
        state = {
            employees: [
                {
                    id: 'emp-1',
                    number: '001',
                    name: 'Ana Perez',
                    hourlyRate: 200,
                    active: true,
                    loans: [
                        {
                            id: 'l1',
                            principal: 1000,
                            interestRate: 0,
                            interestIncluded: false,
                            status: 'active',
                            payments: [],
                            refinancings: [],
                            concept: 'Préstamo'
                        }
                    ]
                },
                {
                    id: 'emp-2',
                    number: '002',
                    name: 'Carlos Gomez',
                    hourlyRate: 250,
                    active: true,
                    loans: []
                }
            ],
            attendance: {
                'emp-1-2026-08-01': { employeeId: 'emp-1', date: '2026-08-01', totalHours: 8, status: 'present' },
                'emp-2-2026-08-01': { employeeId: 'emp-2', date: '2026-08-01', totalHours: 8, status: 'present' }
            },
            exportConfig: {
                periodStart: '2026-08-01',
                periodEnd: '2026-08-15',
                payrollLoanSelection: [],
                payrollLoanExpandedEmployees: [],
                payrollPreviewInclusion: { active: true, inactive: false, zeroHours: false }
            },
            settings: {
                companyName: 'Constructora Alfa',
                currency: 'DOP'
            }
        };

        stateManager.getState = () => state;
        notifications = [];
        window.showNotification = (msg, type) => {
            notifications.push({ msg, type });
        };

        mockDoc = {
            internal: {
                pageSize: { getWidth: () => 210, getHeight: () => 297 },
                getNumberOfPages: () => 1
            },
            setFillColor: jest.fn(),
            rect: jest.fn(),
            setFontSize: jest.fn(),
            setFont: jest.fn(),
            setTextColor: jest.fn(),
            text: jest.fn(),
            autoTable: jest.fn(),
            lastAutoTable: { finalY: 60 },
            save: jest.fn()
        };

        window.jspdf = {
            jsPDF: jest.fn(() => mockDoc)
        };
        window.jspdf.jsPDF.API = {
            autoTable: jest.fn()
        };

        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn((empId) => {
                        if (empId === 'emp-1') {
                            return {
                                brutoOriginal: 1600,
                                bruto: 1600,
                                bonuses: 200,
                                deductions: 100,
                                neto: 1700
                            };
                        }
                        return {
                            brutoOriginal: 2000,
                            bruto: 2000,
                            bonuses: 0,
                            deductions: 0,
                            neto: 2000
                        };
                    })
                }
            },
            render: jest.fn()
        });
        window.PayrollUI = PayrollUI;
    });

    test('exportPayrollPDF generates a structured PDF report with header, summary and employee table', async () => {
        await PayrollUI.exportPayrollPDF();

        expect(mockDoc.text).toHaveBeenCalledWith(
            expect.stringContaining('CONSTRUCTORA ALFA'),
            expect.any(Number),
            expect.any(Number)
        );
        expect(mockDoc.text).toHaveBeenCalledWith(
            expect.stringContaining('REPORTE DE NÓMINA'),
            expect.any(Number),
            expect.any(Number)
        );
        expect(mockDoc.autoTable).toHaveBeenCalledTimes(2); // 1 summary KPI table + 1 employee table
        expect(mockDoc.save).toHaveBeenCalledWith(expect.stringMatching(/^nomina_.*\.pdf$/));
        expect(notifications.some(n => n.msg.includes('Reporte PDF descargado'))).toBe(true);
    });

    test('exportPayrollPDF blocks export when there are negative net payments', async () => {
        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
                        brutoOriginal: 500,
                        bruto: 500,
                        bonuses: 0,
                        deductions: 0,
                        neto: 500
                    }))
                }
            },
            render: jest.fn()
        });

        // Add a loan selection of 1000 when neto before loans is 500 -> net becomes -500 (invalid)
        state.exportConfig.payrollLoanSelection = [
            {
                employeeId: 'emp-1',
                loans: [{ loanId: 'l1', chargeCount: 1 }]
            }
        ];

        await PayrollUI.exportPayrollPDF();

        expect(mockDoc.save).not.toHaveBeenCalled();
        expect(notifications.some(n => n.msg.includes('No se puede exportar'))).toBe(true);
    });
});
