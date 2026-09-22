/**
 * PayrollScopedGeneratorFocal.test.js
 *
 * Focal test suite for multi-project payroll generator (Tanda A / Scoped Generator):
 * 1. A/B Project Isolation (#12 Juan vs Beto with distinct rates, factors, and attendance)
 * 2. Period Selector & Presets (date updates, thisMonth/lastMonth/payPeriod, delegation)
 * 3. Guided Steps & Non-Empty UI (period, deductions, bonuses, loans, review)
 * 4. Read-Only Calculation Breakdown (details tag, positions, hours, summary sidebar)
 * 5. Economic Mutation Safety (ready scoped runtime for closures; gates on unsafe legacy/unscoped mutations)
 * 6. Legacy-Default Parity (Projects OFF exact legacy generator preservation)
 */
import 'fake-indexeddb/auto';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from 'actual/features/payroll/ProjectPayrollUIRuntime.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';
import { stateManager } from 'actual/core/AppState.js';
import { ProjectScopedGateError } from 'actual/config/TandaBGate.js';

const PROJECT_A = 'PRJ-ALPHA-FOCAL';
const PROJECT_B = 'PRJ-BETA-FOCAL';
const DEFAULT_PROJECT = 'PRJ-DEFAULT-FOCAL';

function makeConfig(projectId, overrides = {}) {
    const base = createDefaultConfig(projectId);
    return {
        ...base,
        payPeriod: { periodStart: '2026-03-01', periodLength: 15, payDay: '2026-03-15' },
        regularHoursPerDay: 8,
        overtimeFactor: projectId === PROJECT_A ? 1.5 : 3.0,
        holidayFactor: 2.0,
        holidays: [],
        ...overrides,
        projectId
    };
}

function makeInitialState() {
    return {
        employees: [
            {
                id: 'EMP-A-12',
                number: '12',
                name: 'Juan Perez',
                projectId: PROJECT_A,
                active: true,
                positions: ['POS-A'],
                bonuses: [],
                deductions: []
            },
            {
                id: 'EMP-B-12',
                number: '12',
                name: 'Beto Rodriguez',
                projectId: PROJECT_B,
                active: true,
                positions: ['POS-B'],
                bonuses: [],
                deductions: []
            }
        ],
        positions: [
            { id: 'POS-A', name: 'Albañil Obra A', projectId: PROJECT_A, hourlyRate: 100, workingDays: [1, 2, 3, 4, 5, 6, 0] },
            { id: 'POS-B', name: 'Albañil Obra B', projectId: PROJECT_B, hourlyRate: 200, workingDays: [1, 2, 3, 4, 5, 6, 0] }
        ],
        leaders: [],
        attendance: {
            // Project A: Juan works 8 regular + 2 overtime on 2026-03-05
            'EMP-A-12-2026-03-05': {
                employeeId: 'EMP-A-12',
                date: '2026-03-05',
                present: true,
                hoursWorked: 8,
                overtimeHours: 2,
                projectId: PROJECT_A
            },
            // Project B: Beto works 8 regular + 2 overtime on 2026-03-05
            'EMP-B-12-2026-03-05': {
                employeeId: 'EMP-B-12',
                date: '2026-03-05',
                present: true,
                hoursWorked: 8,
                overtimeHours: 2,
                projectId: PROJECT_B
            }
        },
        settings: {
            companyName: 'Constructora SA',
            regularHoursPerDay: 8,
            overtimeFactor: 1.5,
            holidayFactor: 2.0,
            restDayFactor: 1.75,
            holidays: [],
            payPeriod: { periodStart: '2026-03-01', periodLength: 15, payDay: '2026-03-15' },
            defaultDeductionPercentage: 0
        },
        exportConfig: {
            leaderFilter: 'all',
            deductions: [],
            bonuses: [],
            periodStart: '2026-03-01',
            periodEnd: '2026-03-15'
        },
        payrollViewMode: 'generator',
        settingsCalendarMonth: new Date('2026-03-01T12:00:00'),
        settingsCalendarMode: 'holiday'
    };
}

function makeProjectEventEmitter() {
    const listeners = new Set();
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        emit(previousProjectId, projectId) {
            for (const listener of [...listeners]) {
                listener({ previousProjectId, projectId });
            }
        }
    };
}

function makeConfigStore(configMap) {
    return {
        getConfig: jest.fn(async id => configMap.get(id) || null),
        putConfig: jest.fn(async item => {
            configMap.set(item.projectId, item);
            return item;
        })
    };
}

describe('PayrollScopedGeneratorFocal — Multi-project Generator Parity & Safety', () => {
    let currentState;
    let configMap;
    let configStore;
    let projectEvents;
    let runtime;
    let renderMock;

    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        window.PayrollUI = PayrollUI;

        currentState = makeInitialState();
        stateManager.setState(currentState);

        configMap = new Map([
            [PROJECT_A, makeConfig(PROJECT_A)],
            [PROJECT_B, makeConfig(PROJECT_B)]
        ]);
        configStore = makeConfigStore(configMap);
        projectEvents = makeProjectEventEmitter();

        runtime = new ProjectPayrollUIRuntime({
            state: currentState,
            configStore,
            projectContext: projectEvents
        });

        renderMock = jest.fn();
        PayrollUI.init({
            state: currentState,
            services: {
                payroll: {
                    calculateEmployeePayroll: jest.fn(() => ({
                        brutoOriginal: 0,
                        bruto: 0,
                        bonuses: 0,
                        deductions: 0,
                        neto: 0,
                        breakdown: []
                    }))
                },
                payrollRuntime: runtime
            },
            render: renderMock
        });
    });

    afterEach(() => {
        runtime?.dispose?.();
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        jest.restoreAllMocks();
    });

    describe('1. A/B Project Isolation', () => {
        test('Project A and Project B with same employee #12 calculate completely isolated payrolls', async () => {
            // Activate Project A
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            const previewA = await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            expect(previewA.projectId).toBe(PROJECT_A);
            expect(previewA.rows).toHaveLength(1);
            const juan = previewA.rows[0];
            expect(juan._number).toBe('12');
            expect(juan._employeeName).toBe('Juan Perez');
            expect(juan._employeeId).toBe('EMP-A-12');
            // Juan: 8h reg @100 = 800; 2h ot @150 (factor 1.5) = 300; total = 1100
            expect(juan._regularHours).toBe(8);
            expect(juan._overtimeHours).toBe(2);
            expect(juan._totalHours).toBe(10);
            expect(juan._brutoOriginal).toBe(1100);
            expect(juan.monto).toBe(1100);

            // Switch to Project B
            replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(PROJECT_A, PROJECT_B);

            const previewB = await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            expect(previewB.projectId).toBe(PROJECT_B);
            expect(previewB.rows).toHaveLength(1);
            const beto = previewB.rows[0];
            expect(beto._number).toBe('12');
            expect(beto._employeeName).toBe('Beto Rodriguez');
            expect(beto._employeeId).toBe('EMP-B-12');
            // Beto: 8h reg @200 = 1600; 2h ot @600 (factor 3.0) = 1200; total = 2800
            expect(beto._regularHours).toBe(8);
            expect(beto._overtimeHours).toBe(2);
            expect(beto._totalHours).toBe(10);
            expect(beto._brutoOriginal).toBe(2800);
            expect(beto.monto).toBe(2800);

            // Verify no cross contamination
            expect(juan.monto).not.toBe(beto.monto);
            expect(juan._employeeId).not.toBe(beto._employeeId);
        });

        test('switching project A to B invalidates visual wizard state and prevents state inheritance', async () => {
            // Activate Project A
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            // Set wizard in Project A to step 'review' and collapse step3
            PayrollUI.setPayrollGuideStep('review');
            PayrollUI.toggleStep('step3');
            PayrollUI.togglePayrollSummaryDetail('bonuses');

            expect(currentState.exportConfig.payrollGuideStep).toBe('review');
            expect(currentState.exportConfig.collapsedSteps).toContain('step3');
            expect(currentState.exportConfig.payrollSummaryExpanded?.bonuses).toBe(true);

            const htmlA = PayrollUI.PayrollTab();
            expect(htmlA).toContain('payroll-guide-step is-active  payroll-guide-step--review');
            expect(htmlA).toContain('payroll-review-table');
            expect(htmlA).toContain('Juan Perez');

            // Switch to Project B
            replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(PROJECT_A, PROJECT_B);

            // Verify transient visual states are synchronously purged (explicit reset to period is acceptable)
            expect(['period', undefined]).toContain(currentState.exportConfig.payrollGuideStep);
            expect(currentState.exportConfig.collapsedSteps || []).toEqual([]);
            expect(currentState.exportConfig.payrollSummaryExpanded).toBeFalsy();

            await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            const htmlB = PayrollUI.PayrollTab();
            // Project B must be back at step 1 ('period'), NOT inheriting 'review'
            expect(htmlB).toContain('payroll-guide-step is-active  payroll-guide-step--period');
            expect(htmlB).not.toContain('payroll-guide-step is-active  payroll-guide-step--review');
            // Step 1 in Project B must not be collapsed
            expect(htmlB).toContain('payroll-scoped-period-start');
            expect(htmlB).toContain('Paso 1: Período de Pago');
            expect(htmlB).toContain('payroll-guide-panel--review" hidden');
            expect(htmlB).not.toContain('payroll-guide-panel--period" hidden');
        });
    });

    describe('2. Period Selector & Presets', () => {
        test('updateScopedPeriod updates custom start and end dates and recalculates preview', async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            await PayrollUI.refreshScopedPayrollPreview();

            // Update start date
            const resultStart = await PayrollUI.updateScopedPeriod('start', '2026-03-05');
            expect(resultStart.period.periodStart).toBe('2026-03-05');
            expect(resultStart.rows).toHaveLength(1);
            expect(resultStart.rows[0]._totalHours).toBe(10);
            expect(resultStart.rows[0].monto).toBe(1100);

            // Update end date to before attendance date (2026-03-05) -> should recalculate to 0 hours
            const resultEnd = await PayrollUI.updateScopedPeriod('end', '2026-03-04');
            expect(resultEnd.period.periodEnd).toBe('2026-03-04');
            expect(resultEnd.rows[0]._totalHours).toBe(0);
            expect(resultEnd.rows[0].monto).toBe(0);
        });

        test('setScopedPreset calculates correct date ranges for presets', async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            await PayrollUI.refreshScopedPayrollPreview();

            // 'payPeriod' preset restores configured project pay period
            const payPeriodRes = await PayrollUI.setScopedPreset('payPeriod');
            expect(payPeriodRes.preset).toBe('payPeriod');
            expect(payPeriodRes.period.periodStart).toBe('2026-03-01');
            expect(payPeriodRes.period.periodEnd).toBe('2026-03-15');

            // 'thisMonth' preset sets 1st of month to today
            const thisMonthRes = await PayrollUI.setScopedPreset('thisMonth');
            expect(thisMonthRes.preset).toBe('thisMonth');
            expect(thisMonthRes.period.periodStart).toMatch(/^\d{4}-\d{2}-01$/);

            // 'lastMonth' preset sets start to 1st of last month and end to last day of last month
            const lastMonthRes = await PayrollUI.setScopedPreset('lastMonth');
            expect(lastMonthRes.preset).toBe('lastMonth');
            expect(lastMonthRes.period.periodStart).toMatch(/^\d{4}-\d{2}-01$/);
            expect(lastMonthRes.period.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        test('updateExportPeriod and setExportPreset transparently delegate when scoped view is active', async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            await PayrollUI.refreshScopedPayrollPreview();

            const resDelegatedPreset = await PayrollUI.setExportPreset('payPeriod');
            expect(resDelegatedPreset.preset).toBe('payPeriod');
            expect(resDelegatedPreset.period.periodStart).toBe('2026-03-01');

            const resDelegatedPeriod = await PayrollUI.updateExportPeriod('start', '2026-03-02');
            expect(resDelegatedPeriod.period.periodStart).toBe('2026-03-02');
        });
    });

    describe('3. Guided Steps & Non-Empty UI Panels', () => {
        beforeEach(async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);
            await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });
        });

        test('renders 5 guide navigation step tabs with accessible attributes', () => {
            const html = PayrollUI.PayrollTab();

            // Verify the 5 steps exist in the navigation
            expect(html).toContain('data-payroll-action="set-payroll-guide-step"');
            expect(html).toContain('data-value="period"');
            expect(html).toContain('data-value="deductions"');
            expect(html).toContain('data-value="bonuses"');
            expect(html).toContain('data-value="loans"');
            expect(html).toContain('data-value="review"');

            // Default active step is 'period'
            expect(html).toContain('payroll-guide-step is-active  payroll-guide-step--period');
            expect(html).toContain('aria-current="step"');
        });

        test('switching step to deductions renders scoped deductions panel without blank panel', () => {
            PayrollUI.setPayrollGuideStep('deductions');
            const html = PayrollUI.PayrollTab();

            expect(html).toContain('Deducciones de nómina');
            expect(html).toContain('Ajustes y descuentos para la obra activa');
            expect(html).toContain('$0.00');
            expect(html).not.toContain('<section class="payroll-guide-panel" hidden></section>');
        });

        test('switching step to bonuses renders scoped bonuses panel without blank panel', () => {
            PayrollUI.setPayrollGuideStep('bonuses');
            const html = PayrollUI.PayrollTab();

            expect(html).toContain('Bonificaciones de nómina');
            expect(html).toContain('Abonos adicionales para la obra activa');
            expect(html).toContain('$0.00');
        });

        test('switching step to loans renders operational scoped loan selection', () => {
            PayrollUI.setPayrollGuideStep('loans');
            const html = PayrollUI.PayrollTab();

            expect(html).toContain('Préstamos del período');
            expect(html).toContain('data-payroll-action="add-payroll-loans"');
            expect(html).toContain('Aplicar próximos cargos');
            expect(html).not.toContain('Descuento automático de préstamos en preparación');
            expect(html).not.toContain('Solo lectura');
        });

        test('switching step to review renders preview plus operational close controls', () => {
            PayrollUI.setPayrollGuideStep('review');
            const html = PayrollUI.PayrollTab();

            expect(html).toContain('payroll-review-table');
            expect(html).toContain('Juan Perez');
            expect(html).toContain('10h');
            expect(html).toContain('(8h reg + 2h extra)');
            expect(html).toContain('$1,100.00');
            expect(html).toContain('payroll-breakdown-details');
            expect(html).toContain('data-payroll-action="toggle-payroll-paid"');
            expect(html).toContain('data-payroll-action="open-payroll-closure"');
            expect(html).not.toContain('Cierre bloqueado (Tanda B)');
            expect(html).not.toContain('$0.00 (Tanda B)');
        });
    });

    describe('4. Read-Only Calculation Breakdown & Summary Sidebar', () => {
        test('renders employee breakdown details and summary sidebar with project totals', async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);
            await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });
            PayrollUI.setPayrollGuideStep('review');

            const html = PayrollUI.PayrollTab();

            // Summary sidebar
            expect(html).toContain('payroll-guide-summary');
            expect(html).toContain('Empleados de obra');
            expect(html).toContain('Salario bruto');
            expect(html).toContain('$1,100.00');
            expect(html).toContain('Total neto');
            expect(html).toContain('Obra: PRJ-ALPHA-FOCAL · Cálculo listo');

            // Breakdown details
            expect(html).toContain('Albañil Obra A');
            expect(html).toContain('Tarifa: $100.00/h');
            expect(html).toContain('Reg: 8h ($800.00)');
            expect(html).toContain('Extra (x1.5): 2h');
            expect(html).toContain('$300.00');
        });
    });

    describe('5. Economic Mutation Safety (Tanda B Gate)', () => {
        beforeEach(async () => {
            if (!global.URL.createObjectURL) {
                global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
            }
            if (!global.URL.revokeObjectURL) {
                global.URL.revokeObjectURL = jest.fn();
            }
            const mockDoc = {
                internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
                setFillColor: jest.fn(), rect: jest.fn(), setFontSize: jest.fn(),
                setFont: jest.fn(), setTextColor: jest.fn(), text: jest.fn(),
                autoTable: jest.fn(), lastAutoTable: { finalY: 60 }, save: jest.fn()
            };
            window.jspdf = { jsPDF: jest.fn(() => mockDoc) };
            window.jspdf.jsPDF.API = { autoTable: jest.fn() };
            window.open = jest.fn(() => ({ postMessage: jest.fn() }));
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);
            await PayrollUI.refreshScopedPayrollPreview();
        });

        test('ready scoped runtime enables closure workflow while unsafe legacy/unscoped mutations remain gated', async () => {
            // Closure/undo readiness is covered by PayrollClosureOperationalUI +
            // PayrollClosureReadyScopeContract. Here we assert this generator
            // has a canonical READY scoped runtime before exposing economic actions.
            const readyView = runtime.getCurrentView();
            expect(readyView.enabled).toBe(true);
            expect(readyView.status).toBe('ready');
            expect(readyView.projectId).toBe(PROJECT_A);

            // Scoped loan selection/export is operational in Tanda B when the project is READY.
            expect(() => PayrollUI.addPayrollLoansToExport()).not.toThrow();

            // Scoped exports are allowed and operate without gate
            expect(() => PayrollUI.copyExportJSON()).not.toThrow();
            expect(() => PayrollUI.downloadExportJSON()).not.toThrow();
            await expect(PayrollUI.exportPayrollPDF()).resolves.not.toThrow();
            expect(() => PayrollUI.sendToSplitX()).not.toThrow();

            // Scoped adjustments are allowed and isolated
            await expect(PayrollUI.addDesktopAdjustment('bonus', {})).resolves.not.toThrow();
            expect(() => PayrollUI.removeDesktopAdjustment('bonus', {})).not.toThrow();

            // Scoped payment allowed without gate error when scoped; throws gate when unscoped
            expect(() => PayrollUI.togglePayrollPaidConfirmation(true)).not.toThrow(ProjectScopedGateError);
            PayrollUI.togglePayrollPaidConfirmation(false);

            replaceEntityScope({ enabled: true, projectId: null, defaultProjectId: DEFAULT_PROJECT });
            expect(() => PayrollUI.togglePayrollPaidConfirmation(true)).toThrow(ProjectScopedGateError);
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
        });

        test('scoped loan selection recalculates only the active-project preview', async () => {
            const juan = currentState.employees.find(e => e.id === 'EMP-A-12');
            const beto = currentState.employees.find(e => e.id === 'EMP-B-12');
            juan.loans = [{
                id: 'LOAN-A-12', concept: 'Adelanto A', principal: 300, total: 300, amount: 300,
                status: 'active', installmentMode: 'lump', installments: 1, payments: [],
                startDate: '2026-03-01', createdAt: 1
            }];
            beto.loans = [{
                id: 'LOAN-B-12', concept: 'Adelanto B', principal: 600, total: 600, amount: 600,
                status: 'active', installmentMode: 'lump', installments: 1, payments: [],
                startDate: '2026-03-01', createdAt: 1
            }];

            PayrollUI.addPayrollLoansToExport();
            expect(currentState.exportConfig.payrollLoanSelection).toHaveLength(1);
            expect(currentState.exportConfig.payrollLoanSelection[0].employeeId).toBe('EMP-A-12');

            const refreshed = await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01', periodEnd: '2026-03-15'
            });
            expect(refreshed.rows).toHaveLength(1);
            expect(refreshed.rows[0]._employeeId).toBe('EMP-A-12');
            expect(refreshed.rows[0]._loans).toBe(300);
            expect(refreshed.rows[0].monto).toBe(800);
        });

        test('preview generation does not alter employee adjustments or global settings', async () => {
            const rawJuan = currentState.employees.find(e => e.id === 'EMP-A-12');
            expect(rawJuan.bonuses).toEqual([]);
            expect(rawJuan.deductions).toEqual([]);

            // Global settings should remain unchanged
            expect(currentState.settings.regularHoursPerDay).toBe(8);
            expect(currentState.settings.overtimeFactor).toBe(1.5);
        });
    });

    describe('6. Legacy-Default Parity (Projects OFF)', () => {
        beforeEach(() => {
            setProjectsEnabled(false);
            resetEntityScope();
        });

        test('renders legacy generator tab when projects flag is OFF', () => {
            const legacyHtml = PayrollUI.PayrollTab();

            // When OFF, the tab renders legacy generator with standard controls
            expect(legacyHtml).not.toContain('payroll-project-preview');
            // Legacy tab has export buttons container
            expect(legacyHtml).toContain('data-payroll-action="export-payroll-pdf"');
            expect(legacyHtml).toContain('data-payroll-action="send-to-splitx"');
        });

        test('updateExportPeriod and setExportPreset operate on legacy exportConfig directly', () => {
            PayrollUI.updateExportPeriod('start', '2026-02-01');
            PayrollUI.updateExportPeriod('end', '2026-02-15');

            expect(currentState.exportConfig.periodStart).toBe('2026-02-01');
            expect(currentState.exportConfig.periodEnd).toBe('2026-02-15');

            PayrollUI.setExportPreset('lastMonth');
            expect(currentState.exportConfig.activePreset).toBe('lastMonth');
        });
    });
});
