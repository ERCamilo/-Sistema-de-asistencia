import { state } from '../modules/core/AppState.js';
import * as PayrollUI from '../modules/features/payroll/PayrollUI.js';
import { LoansLedger } from '../modules/features/loans/LoansLedger.js';
import fs from 'fs';
import path from 'path';

const PAYROLL_REDESIGN_CSS = fs.readFileSync(
    path.resolve(__dirname, '../../css/payroll-redesign.css'),
    'utf8'
);

function resetFinancialState() {
    state.employees = [];
    state.positions = [];
    state.leaders = [];
    state.attendance = {};
    state.attendanceByDate = {};
    state.payrollViewMode = 'generator';
    state.loansLedger = null;
    state.settings.payPeriod = {
        periodStart: '2026-07-01',
        periodLength: 15,
        payDay: '2026-07-16'
    };
    state.exportConfig = {
        periodStart: '2026-07-01',
        periodEnd: '2026-07-15',
        activePreset: 'payPeriod',
        periodSource: 'configured',
        leaderFilter: 'all',
        deductions: [],
        bonuses: [],
        employeeDeductionsAdded: false,
        employeeBonusesAdded: false,
        rememberedGlobalsHydrated: true,
        payrollGuideStep: 'period',
        collapsedSteps: ['step2', 'step2b', 'step2c', 'step3']
    };
}

describe('Financial desktop layouts', () => {
    const render = jest.fn();

    beforeAll(() => {
        window.PayrollUI = PayrollUI;
    });

    beforeEach(() => {
        render.mockClear();
        resetFinancialState();
        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
                        brutoOriginal: 1200,
                        bruto: 1200,
                        bonuses: 100,
                        deductions: 300,
                        neto: 1000
                    }))
                }
            },
            render
        });
    });

    test('payroll renders the horizontal five-step guide and export summary', () => {
        const html = PayrollUI.PayrollTab();

        expect(html).toContain('class="date-controls payroll-view-switcher"');
        expect(PAYROLL_REDESIGN_CSS).toMatch(
            /\.payroll-view-switcher\s*\{[^}]*position:\s*sticky;[^}]*top:\s*60px;/
        );
        expect(html).toContain('class="payroll-guided-layout"');
        expect(html).toContain('aria-label="Pasos de nómina"');
        expect(html).toContain('data-value="period"');
        expect(html).toContain('data-value="deductions"');
        expect(html).toContain('data-value="bonuses"');
        expect(html).toContain('data-value="loans"');
        expect(html).toContain('data-value="review"');
        expect(html).toContain('aria-label="Resumen de nómina"');
        expect(html).toContain('Total neto');
        expect(html).toContain('data-payroll-action="send-to-splitx"');
        expect(html).toContain('data-payroll-action="copy-export-json"');
        expect(html).toContain('data-payroll-action="download-export-json"');
    });

    test('summary renders zero amounts and net total in white', () => {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const summary = host.querySelector('.payroll-guide-summary');
        const bonus = summary.querySelector('[data-value="bonuses"]')
            .closest('.payroll-guide-summary__expandable')
            .querySelector('dd');
        const deduction = summary.querySelector('[data-value="deductions"]')
            .closest('.payroll-guide-summary__expandable')
            .querySelector('dd');
        const loans = summary.querySelector('.payroll-guide-summary__loan-row');

        expect(bonus.classList).toContain('is-zero');
        expect(deduction.classList).toContain('is-zero');
        expect(loans.querySelector('span').classList).toContain('is-zero');
        expect(loans.querySelector('dd').classList).toContain('is-zero');
        expect(PAYROLL_REDESIGN_CSS).toMatch(
            /\.payroll-guide-summary\s+\.is-zero\s*\{[^}]*color:\s*#fff\s*!important;/
        );
        expect(PAYROLL_REDESIGN_CSS).toMatch(
            /\.payroll-guide-summary__values\s+\.is-total dd\s*\{[^}]*color:\s*#fff;/
        );
        expect(PAYROLL_REDESIGN_CSS).toContain(
            '--payroll-summary-positive: rgb(16, 185, 115);'
        );
        expect(PAYROLL_REDESIGN_CSS).toContain('--payroll-summary-negative: #ef4444;');
        expect(PAYROLL_REDESIGN_CSS).toContain('--payroll-summary-loan: #f59e0b;');
    });

    test('period presets share one responsive alignment row', () => {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const presets = host.querySelector('.payroll-period-presets');

        expect(presets).not.toBeNull();
        expect(presets.querySelectorAll('.payroll-period-preset')).toHaveLength(3);
        expect(presets.textContent).toContain('Este mes');
        expect(presets.textContent).toContain('Mes anterior');
        expect(presets.textContent).toContain('Período Actual');
    });

    test('mobile summary starts compact and exposes the current payroll totals first', () => {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const toggle = host.querySelector('.payroll-guide-summary__mobile-toggle');

        expect(toggle).not.toBeNull();
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.textContent).toContain('1 jul 2026');
        expect(toggle.textContent).toContain('15 jul 2026');
        expect(toggle.textContent).toContain('0 empleados');
        expect(toggle.textContent).toContain('Total neto');
        expect(toggle.textContent).toContain('$0.00');
        expect(toggle.textContent).toContain('Listo');
    });

    test('mobile summary expands without changing payroll values', () => {
        const deductions = state.exportConfig.deductions;
        const bonuses = state.exportConfig.bonuses;

        PayrollUI.togglePayrollMobileSummary();
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();

        expect(state.exportConfig.payrollMobileSummaryExpanded).toBe(true);
        expect(host.querySelector('.payroll-guide-summary').classList).toContain('is-mobile-expanded');
        expect(host.querySelector('.payroll-guide-summary__mobile-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(host.querySelector('.payroll-guide-summary__mobile-toggle').textContent).toContain('Ocultar');
        expect(state.exportConfig.deductions).toBe(deductions);
        expect(state.exportConfig.bonuses).toBe(bonuses);
    });

    test('period shortcuts omit rolling and last-payment presets', () => {
        const html = PayrollUI.PayrollTab();

        expect(html).not.toContain('data-value="last15"');
        expect(html).not.toContain('data-value="sinceLastPay"');
        expect(html).toContain('data-value="thisMonth"');
        expect(html).toContain('data-value="lastMonth"');
        expect(html).toContain('data-value="payPeriod"');
    });

    test('changing the guide step exposes its panel without changing financial data', () => {
        const deductions = state.exportConfig.deductions;
        const bonuses = state.exportConfig.bonuses;

        PayrollUI.setPayrollGuideStep('deductions');

        expect(state.exportConfig.payrollGuideStep).toBe('deductions');
        expect(state.exportConfig.collapsedSteps).not.toContain('step2');
        expect(state.exportConfig.collapsedSteps).toContain('step2c');
        expect(state.exportConfig.deductions).toBe(deductions);
        expect(state.exportConfig.bonuses).toBe(bonuses);
        expect(PayrollUI.PayrollTab()).toMatch(
            /class="payroll-guide-step is-active [^"]*"[\s\S]{0,180}data-value="deductions"/
        );
    });

    test('loans use one responsive workspace as the dedicated fourth step', () => {
        PayrollUI.setPayrollGuideStep('loans');

        expect(state.exportConfig.payrollGuideStep).toBe('loans');
        expect(state.exportConfig.collapsedSteps).not.toContain('step2c');
        const html = PayrollUI.PayrollTab();
        expect(html).toMatch(
            /class="payroll-guide-step is-active [^"]*"[\s\S]{0,180}data-value="loans"/
        );
        expect(html).toContain('class="payroll-loans-desktop"');
        expect(html).not.toContain('payroll-loans-legacy');
        expect(html).not.toContain('export-loans-section');
    });

    test('tri-state loan selection toggles all, partial, and none without changing loans', () => {
        state.employees = [{
            id: 'e1',
            number: '001',
            name: 'Juan Pérez',
            active: true,
            loans: [
                {
                    id: 'loan-1', principal: 100, interestRate: 0,
                    interestIncluded: false, status: 'active', payments: [], refinancings: []
                },
                {
                    id: 'loan-2', principal: 50, interestRate: 0,
                    interestIncluded: false, status: 'active', payments: [], refinancings: []
                }
            ]
        }];
        const before = JSON.stringify(state.employees[0].loans);

        PayrollUI.toggleEmployeePayrollLoans('e1');
        expect(state.exportConfig.payrollLoanSelection[0].loanIds).toHaveLength(2);

        PayrollUI.togglePayrollLoanSelection('e1', 'loan-2');
        expect(state.exportConfig.payrollLoanSelection[0].loanIds).toEqual(['loan-1']);

        PayrollUI.toggleEmployeePayrollLoans('e1');
        expect(state.exportConfig.payrollLoanSelection[0].loanIds).toHaveLength(2);

        PayrollUI.toggleEmployeePayrollLoans('e1');
        expect(state.exportConfig.payrollLoanSelection).toEqual([]);
        expect(JSON.stringify(state.employees[0].loans)).toBe(before);
    });

    test('manual bulk actions activate one upcoming installment before its due date', () => {
        state.exportConfig.periodEnd = '2026-05-10';
        state.employees = [{
            id: 'e1',
            number: '001',
            name: 'Juan Pérez',
            active: true,
            loans: [{
                id: 'loan-installments', principal: 400, interestRate: 0,
                interestIncluded: false, startDate: '2026-05-01', status: 'active',
                installmentMode: 'installments', payments: [], refinancings: [],
                installments: [
                    { id: 'i1', seq: 1, dueDate: '2026-05-15', scheduledAmount: 100 },
                    { id: 'i2', seq: 2, dueDate: '2026-05-29', scheduledAmount: 100 },
                    { id: 'i3', seq: 3, dueDate: '2026-06-12', scheduledAmount: 100 },
                    { id: 'i4', seq: 4, dueDate: '2026-06-26', scheduledAmount: 100 }
                ]
            }]
        }];

        PayrollUI.addPayrollLoansToExport();
        expect(state.exportConfig.payrollLoanSelection[0].loans[0].chargeCount).toBe(1);

        state.exportConfig.payrollLoanSelection = [];
        PayrollUI.toggleEmployeePayrollLoans('e1');
        expect(state.exportConfig.payrollLoanSelection[0].loans[0].chargeCount).toBe(1);
    });

    test('installment controls select consecutive charges without exceeding the schedule', () => {
        state.exportConfig.periodEnd = '2026-05-20';
        state.employees = [{
            id: 'e1',
            number: '001',
            name: 'Juan Pérez',
            active: true,
            loans: [{
                id: 'loan-installments', principal: 400, interestRate: 0,
                interestIncluded: false, startDate: '2026-05-01', status: 'active',
                installmentMode: 'installments', payments: [], refinancings: [],
                installments: [
                    { id: 'i1', seq: 1, dueDate: '2026-05-15', scheduledAmount: 100 },
                    { id: 'i2', seq: 2, dueDate: '2026-05-29', scheduledAmount: 100 },
                    { id: 'i3', seq: 3, dueDate: '2026-06-12', scheduledAmount: 100 },
                    { id: 'i4', seq: 4, dueDate: '2026-06-26', scheduledAmount: 100 }
                ]
            }]
        }];
        const before = JSON.stringify(state.employees[0].loans);

        PayrollUI.togglePayrollLoanSelection('e1', 'loan-installments');
        PayrollUI.adjustPayrollLoanChargeCount('e1', 'loan-installments', 1);
        expect(state.exportConfig.payrollLoanSelection[0].loans[0].chargeCount).toBe(2);

        PayrollUI.selectAllPayrollLoanCharges('e1', 'loan-installments');
        expect(state.exportConfig.payrollLoanSelection[0].loans[0].chargeCount).toBe(4);

        PayrollUI.adjustPayrollLoanChargeCount('e1', 'loan-installments', 1);
        expect(state.exportConfig.payrollLoanSelection[0].loans[0].chargeCount).toBe(4);
        expect(JSON.stringify(state.employees[0].loans)).toBe(before);
    });

    test('the dedicated disclosure button expands and collapses employee loans', () => {
        state.employees = [{
            id: 'e1',
            number: '001',
            name: 'Juan Pérez',
            active: true,
            loans: [{
                id: 'loan-1', principal: 100, interestRate: 0,
                interestIncluded: false, status: 'active', payments: [], refinancings: []
            }]
        }];
        document.body.innerHTML = PayrollUI.PayrollTab();
        const group = document.querySelector('.payroll-loan-group');
        const disclosure = group.querySelector('.payroll-loan-disclosure');

        expect(group.open).toBe(false);
        disclosure.click();
        expect(group.open).toBe(true);
        expect(disclosure.getAttribute('aria-expanded')).toBe('true');
        disclosure.click();
        expect(group.open).toBe(false);
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    });

    test('desktop adjustments expose four scopes while retaining the legacy mobile panel', () => {
        PayrollUI.setPayrollGuideStep('deductions');
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();

        expect(host.querySelector('.payroll-adjustment-desktop.is-deduction')).not.toBeNull();
        expect(host.querySelector('#export-deductions-section.payroll-adjustment-legacy')).not.toBeNull();
        expect(
            [...host.querySelectorAll('.payroll-adjustment-desktop.is-deduction .payroll-adjustment-composer input[name="scope"]')]
                .map(input => input.value)
        ).toEqual(['global', 'leader', 'position', 'employee']);
    });

    test('desktop adjustment form adds a position-scoped deduction', () => {
        state.positions = [{ id: 'position-1', name: 'Albañil', active: true }];
        PayrollUI.setPayrollGuideStep('deductions');
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const form = host.querySelector('.payroll-adjustment-composer .payroll-adjustment-form');

        form.querySelector('input[value="position"]').checked = true;
        form.querySelector('[name="positionTarget"]').value = 'position-1';
        form.querySelector('[name="name"]').value = 'Herramientas';
        form.querySelector('input[name="type"][value="percentage"]').checked = true;
        form.querySelector('[name="value"]').value = '3';
        PayrollUI.addDesktopAdjustment(
            'deductions',
            form.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.exportConfig.deductions).toHaveLength(1);
        expect(state.exportConfig.deductions[0]).toMatchObject({
            name: 'Herramientas',
            type: 'percentage',
            value: 3,
            scope: 'position',
            targetId: 'position-1'
        });
        expect(state.exportConfig.payrollAdjustmentComposerScopes.deductions).toBe('position');
        const rerendered = document.createElement('div');
        rerendered.innerHTML = PayrollUI.PayrollTab();
        const nextForm = rerendered.querySelector(
            '.payroll-adjustment-desktop.is-deduction .payroll-adjustment-composer .payroll-adjustment-form'
        );
        expect(nextForm.dataset.adjustmentScope).toBe('position');
        expect(nextForm.querySelector('input[name="scope"][value="position"]').checked).toBe(true);
        expect(nextForm.querySelector('[name="name"]').value).toBe('');
        expect(nextForm.querySelector('[name="value"]').value).toBe('');
        expect(render).toHaveBeenCalled();
    });

    test('desktop adjustments use a default name when concept is empty', () => {
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const deductionForm = host.querySelector(
            '.payroll-adjustment-desktop.is-deduction .payroll-adjustment-composer .payroll-adjustment-form'
        );
        const bonusForm = host.querySelector(
            '.payroll-adjustment-desktop.is-bonus .payroll-adjustment-composer .payroll-adjustment-form'
        );

        deductionForm.querySelector('[name="value"]').value = '25';
        bonusForm.querySelector('[name="value"]').value = '50';
        PayrollUI.addDesktopAdjustment(
            'deductions',
            deductionForm.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );
        PayrollUI.addDesktopAdjustment(
            'bonuses',
            bonusForm.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.exportConfig.deductions[0].name).toBe('Descuento');
        expect(state.exportConfig.bonuses[0].name).toBe('Bono');
    });

    test('employee picker adds active and inactive employees to one adjustment rule', async () => {
        state.positions = [
            { id: 'bricklayer', name: 'Albañil', active: true },
            { id: 'helper', name: 'Ayudante', active: true }
        ];
        state.employees = [
            {
                id: 'active-1', number: '001', name: 'Ada Activa', active: true,
                positions: ['bricklayer'], loans: []
            },
            {
                id: 'inactive-1', number: '099', name: 'Grace Inactiva', active: false,
                positions: ['helper'], loans: []
            }
        ];
        PayrollUI.setPayrollGuideStep('bonuses');
        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();

        const bonusForm = host.querySelector(
            '.payroll-adjustment-desktop.is-bonus .payroll-adjustment-composer .payroll-adjustment-form'
        );
        bonusForm.querySelector('input[value="employee"]').checked = true;
        const pickerPromise = PayrollUI.openAdjustmentEmployeePicker(
            bonusForm.querySelector('[data-payroll-action="open-adjustment-employee-picker"]')
        );
        const modal = document.querySelector('.payroll-adjustment-picker');
        const inactiveRow = modal.querySelector('[data-adjustment-picker-employee="inactive-1"]');

        expect(modal).not.toBeNull();
        expect(inactiveRow.textContent).toContain('Grace Inactiva');
        expect(inactiveRow.textContent).toContain('Ayudante');
        expect(inactiveRow.textContent).toContain('Inactivo');
        modal.querySelector('[data-adjustment-picker-employee="active-1"]').click();
        modal.querySelector('[data-adjustment-picker-employee="inactive-1"]').click();
        document.querySelector('.modal-footer [data-button-index="1"]').click();
        await pickerPromise;

        expect(bonusForm.querySelectorAll('[data-adjustment-employee-chip]')).toHaveLength(2);
        const activeChipRemove = [...bonusForm.querySelectorAll('[data-adjustment-employee-chip]')]
            .find(chip => chip.textContent.includes('Ada Activa'))
            .querySelector('[data-payroll-action="remove-adjustment-employee"]');
        PayrollUI.removeAdjustmentEmployee('active-1', activeChipRemove);
        expect(bonusForm.querySelectorAll('[data-adjustment-employee-chip]')).toHaveLength(1);

        const reopenPromise = PayrollUI.openAdjustmentEmployeePicker(
            bonusForm.querySelector('[data-payroll-action="open-adjustment-employee-picker"]')
        );
        const reopenedModal = [...document.querySelectorAll('.payroll-adjustment-picker')].at(-1);
        expect(reopenedModal.querySelector('[data-adjustment-picker-employee="active-1"]')
            .getAttribute('aria-pressed')).toBe('false');
        expect(reopenedModal.querySelector('[data-adjustment-picker-employee="inactive-1"]')
            .getAttribute('aria-pressed')).toBe('true');
        reopenedModal.querySelector('[data-adjustment-picker-employee="active-1"]').click();
        reopenedModal.closest('[data-modal-overlay]')
            .querySelector('.modal-footer [data-button-index="1"]').click();
        await reopenPromise;

        bonusForm.querySelector('[name="value"]').value = '125';
        PayrollUI.addDesktopAdjustment(
            'bonuses',
            bonusForm.querySelector('[data-payroll-action="add-desktop-adjustment"]')
        );

        expect(state.exportConfig.bonuses[0]).toMatchObject({
            employeeId: 'active-1',
            scope: 'employee',
            targetId: 'active-1',
            targetIds: ['active-1', 'inactive-1'],
            value: 125
        });
        expect(state.exportConfig.payrollAdjustmentComposerScopes.bonuses).toBe('employee');
    });

    test('bonus and deduction detail rows expand independently', () => {
        PayrollUI.togglePayrollSummaryDetail('bonuses');
        const html = PayrollUI.PayrollTab();

        expect(state.exportConfig.payrollSummaryExpanded.bonuses).toBe(true);
        expect(html).toContain('aria-label="Ocultar detalle de bonificaciones"');
        expect(html).toContain('payroll-summary-detail--bonuses');
        expect(html).toContain('Interés $0.00');
    });

    test('review table omits optional charge columns when the preview has no amounts', () => {
        state.employees = [{
            id: 'e1',
            number: '12',
            name: 'Ada Lovelace',
            active: true,
            loans: []
        }];
        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
                        brutoOriginal: 1200,
                        bruto: 1200,
                        bonuses: 0,
                        deductions: 0,
                        neto: 1200
                    }))
                }
            },
            render
        });
        PayrollUI.setPayrollGuideStep('review');
        const host = document.createElement('div');
        const html = PayrollUI.PayrollTab();
        host.innerHTML = html;

        const headers = [...host.querySelectorAll('.payroll-guide-panel--review th')]
            .map(cell => cell.textContent.trim());

        expect(headers).toEqual(['#', 'EMPLEADO', 'BRUTO', 'NETO']);
        expect(host.querySelector('th.payroll-review-table__number')).not.toBeNull();
        expect(host.querySelector('th.payroll-review-table__employee')).not.toBeNull();
        expect(host.querySelector('th.is-bonus')).toBeNull();
        expect(host.querySelector('th.is-deduction')).toBeNull();
        expect(host.querySelector('th.is-loan')).toBeNull();
        expect(host.querySelector('tbody tr').children).toHaveLength(4);
    });

    test('review table keeps a configured bonus toggle visible when it applies zero in the current payroll', () => {
        state.employees = [{
            id: 'active-1',
            number: '12',
            name: 'Ada Activa',
            active: true,
            loans: []
        }, {
            id: 'inactive-1',
            number: '501',
            name: 'Hector Inactivo',
            active: false,
            loans: []
        }];
        state.exportConfig.bonuses = [{
            id: 'BON-INACTIVE',
            name: 'Bono',
            type: 'fixed',
            value: 20000,
            scope: 'employee',
            targetId: 'inactive-1',
            targetIds: ['inactive-1'],
            employeeId: 'inactive-1',
            employeeIds: ['inactive-1']
        }];
        state.exportConfig.deductions = [];
        state.exportConfig.payrollLoanSelection = [];
        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
                        brutoOriginal: 1200,
                        bruto: 1200,
                        bonuses: 0,
                        deductions: 0,
                        neto: 1200
                    }))
                }
            },
            render
        });
        PayrollUI.setPayrollGuideStep('review');

        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const headers = [...host.querySelectorAll('.payroll-guide-panel--review th')]
            .map(cell => cell.textContent.trim());

        expect(headers).toEqual(['#', 'EMPLEADO', 'BRUTO', 'BONIFIC.1/1', 'NETO']);
        expect(host.querySelector('th.is-bonus input[type="checkbox"]')?.checked).toBe(true);
        expect(host.querySelector('th.is-deduction')).toBeNull();
        expect(host.querySelector('th.is-loan')).toBeNull();
    });

    test('review table includes an inactive employee selected by an individual bonus', () => {
        state.employees = [{
            id: 'active-1',
            number: '12',
            name: 'Ada Activa',
            active: true,
            loans: []
        }, {
            id: 'inactive-1',
            number: '501',
            name: 'Hector Inactivo',
            active: false,
            loans: []
        }];
        state.exportConfig.bonuses = [{
            id: 'BON-INACTIVE',
            name: 'Bono',
            type: 'fixed',
            value: 2000,
            scope: 'employee',
            targetId: 'inactive-1',
            targetIds: ['inactive-1']
        }];
        state.exportConfig.deductions = [];
        state.exportConfig.payrollLoanSelection = [];
        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(employeeId => employeeId === 'inactive-1'
                        ? {
                            brutoOriginal: 0,
                            bruto: 2000,
                            bonuses: 2000,
                            deductions: 0,
                            neto: 2000,
                            bonusBreakdown: [{ id: 'BON-INACTIVE', name: 'Bono', amount: 2000 }]
                        }
                        : {
                            brutoOriginal: 1200,
                            bruto: 1200,
                            bonuses: 0,
                            deductions: 0,
                            neto: 1200
                        })
                }
            },
            render
        });
        PayrollUI.setPayrollGuideStep('review');

        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const inactiveRow = [...host.querySelectorAll('.payroll-guide-panel--review tbody tr')]
            .find(row => row.querySelector('.payroll-review-table__employee')?.textContent.includes('Hector Inactivo'));

        expect(inactiveRow).toBeDefined();
        expect(inactiveRow.querySelector('.is-bonus').textContent.trim()).toBe('+$2,000.00');
        expect(inactiveRow.querySelector('.is-net').textContent.trim()).toBe('$2,000.00');
    });

    test('review table keeps an inactive deduction conflict visible and blocks export', () => {
        state.employees = [{
            id: 'inactive-1',
            number: '501',
            name: 'Hector Inactivo',
            active: false,
            loans: []
        }];
        state.exportConfig.bonuses = [];
        state.exportConfig.deductions = [{
            id: 'DED-INACTIVE',
            name: 'Descuento',
            type: 'fixed',
            value: 500,
            scope: 'employee',
            targetId: 'inactive-1',
            targetIds: ['inactive-1']
        }];
        state.exportConfig.payrollLoanSelection = [];
        PayrollUI.init({
            state,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
                        brutoOriginal: 0,
                        bruto: 0,
                        bonuses: 0,
                        deductions: 500,
                        neto: -500,
                        deductionBreakdown: [{ id: 'DED-INACTIVE', name: 'Descuento', amount: 500 }]
                    }))
                }
            },
            render
        });
        PayrollUI.setPayrollGuideStep('review');

        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const row = host.querySelector('.payroll-guide-panel--review tbody tr');

        expect(row.querySelector('.payroll-review-table__employee').textContent).toContain('Hector Inactivo');
        expect(row.classList.contains('is-invalid')).toBe(true);
        expect(host.querySelector('[role="alert"]').textContent).toContain('queda negativo');
        expect(host.querySelector('[data-payroll-action="send-to-splitx"]').disabled).toBe(true);
        expect(host.querySelector('[data-payroll-action="copy-export-json"]').disabled).toBe(true);
    });

    test('review table shows non-empty optional columns and highlights loans in yellow', () => {
        state.employees = [{
            id: 'e1',
            number: '12',
            name: 'Ada Lovelace',
            active: true,
            loans: [{
                id: 'loan-1',
                principal: 250,
                interestRate: 10,
                interestIncluded: false,
                status: 'active',
                payments: [],
                refinancings: []
            }]
        }];
        state.exportConfig.bonuses = [{
            id: 'BON-1',
            name: 'Bono',
            type: 'fixed',
            value: 100,
            scope: 'global'
        }];
        state.exportConfig.deductions = [{
            id: 'DED-1',
            name: 'Descuento',
            type: 'fixed',
            value: 300,
            scope: 'global'
        }];
        state.exportConfig.payrollLoanSelection = [{ employeeId: 'e1', loanIds: ['loan-1'] }];
        PayrollUI.setPayrollGuideStep('review');

        const host = document.createElement('div');
        host.innerHTML = PayrollUI.PayrollTab();
        const row = host.querySelector('tbody tr');
        const headers = [...host.querySelectorAll('.payroll-guide-panel--review th')]
            .map(cell => cell.querySelector('span')?.textContent.trim() || cell.textContent.trim());
        const categoryCounts = [...host.querySelectorAll('.payroll-review-table__toggle-heading small')]
            .map(counter => counter.textContent.trim());

        expect(headers).toEqual(['#', 'EMPLEADO', 'BRUTO', 'BONIFIC.', 'DEDUCCIONES', 'PRÉSTAMOS', 'NETO']);
        expect(categoryCounts).toEqual(['1/1', '1/1', '1/1']);
        expect(row.querySelector('.payroll-review-table__number').textContent.trim()).toBe('12');
        expect(row.querySelector('.payroll-review-table__employee').textContent.trim()).toBe('Ada Lovelace');
        expect(row.querySelector('.is-bonus').textContent.trim()).toBe('+$100.00');
        expect(row.querySelector('.is-deduction').textContent.trim()).toBe('−$300.00');
        expect(row.querySelector('.is-loan').textContent.trim()).toBe('−$275.00');
        expect(row.children).toHaveLength(7);
        expect(host.querySelector('th.is-loan')).not.toBeNull();
        expect(PAYROLL_REDESIGN_CSS).toMatch(
            /\.payroll-review-table[^}]*\.is-loan\s*\{[^}]*color:\s*#f59e0b;/
        );
    });

    test('receivables renders a desktop table and keeps compact mobile indicators', () => {
        const html = LoansLedger();

        expect(html).toContain('class="loans-overview"');
        expect(html).toContain('class="loans-overview__summary"');
        expect(html).toContain('<table>');
        expect(html).toContain('class="loans-overview__mobile-kpis"');
        expect(html).toContain('Saldo pendiente');
        expect(html).toContain('Préstamos activos');
    });
});
