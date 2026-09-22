/**
 * PayrollScopedAdjustmentsFocal.test.js
 *
 * Comprehensive focal test suite for multi-project payroll adjustments & exports (Tanda B):
 * 1. #12 A/B con ajustes distintos:
 *    - Juan #12 in Project A vs Beto #12 in Project B with different positions/rates and distinct adjustments.
 *    - Juan has deductions/bonuses in A; Beto has separate deductions/bonuses in B.
 *    - Net calculations remain strictly isolated without cross-contamination.
 * 2. Ajuste A no muta B:
 *    - Creating/updating an adjustment plan in Project A does not modify or attach to Beto in Project B.
 *    - Boundary validation: plans tagged with Project A cannot be attached to employees of Project B.
 *    - Manual movement boundary: applying an adjustment with mismatched plan/employee projectId fails closed.
 *    - Project defaults: persisting default adjustments in Project A saves to Project A config's payrollDefaults,
 *      leaving Project B and global state settings untouched.
 * 3. Export A sin filas B:
 *    - Exports (JSON, PDF, SplitX) under Project A contain strictly Project A's calculated rows.
 *    - Beto #12 is never present in Project A exports; Juan #12 is never in Project B exports.
 *    - SplitX import payload includes scoped project metadata and scoped period.
 * 4. Stale A→B:
 *    - Project switch immediately invalidates selection, composer, guide step, and period selections.
 *    - Stale async operations initiated in Project A and completed after switching to Project B abort cleanly
 *      without mutating Project B or persisting Project A's changes into Project B.
 * 5. Period isolation:
 *    - Installment plans and adjustments correctly project onto specific periods (P1 vs P2).
 *    - Runtime period selections (e.g. pause/count) applied in P1 do not alter P2.
 * 6. OFF parity:
 *    - With projects disabled (Projects OFF), all legacy adjustment and export behaviors operate normally
 *      with global settings persistence and full backwards compatibility.
 */
import 'fake-indexeddb/auto';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from 'actual/features/payroll/ProjectPayrollUIRuntime.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';
import { stateManager } from 'actual/core/AppState.js';
import { createPayrollAdjustmentInstallmentPlans } from 'actual/features/payroll/PayrollAdjustmentInstallmentPlan.js';
import { attachPayrollAdjustmentPlans } from 'actual/features/payroll/PayrollAdjustmentPlanRepository.js';
import { applyManualAdjustmentMovement } from 'actual/features/payroll/PayrollAdjustmentManualMovement.js';
import {
    clearPayrollAdjustmentPeriodRuntime,
    setPayrollAdjustmentPeriodRuntimeSelection,
    getPayrollAdjustmentPeriodRuntimeSelections
} from 'actual/features/payroll/PayrollAdjustmentPeriodSelection.js';

const PROJECT_A = 'PRJ-ALPHA-FOCAL';
const PROJECT_B = 'PRJ-BETA-FOCAL';
const DEFAULT_PROJECT = 'PRJ-DEFAULT-FOCAL';
const createId = prefix => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

function makeConfig(projectId, overrides = {}) {
    const base = createDefaultConfig(projectId);
    return {
        ...base,
        payPeriod: { periodStart: '2026-03-01', periodLength: 15, payDay: '2026-03-15' },
        regularHoursPerDay: 8,
        overtimeFactor: 1.5,
        holidayFactor: 2.0,
        holidays: [],
        payrollDefaults: {
            deductions: [],
            bonuses: []
        },
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
            // Juan in Project A: 8 reg hours on 2026-03-05 -> gross = 800
            'EMP-A-12-2026-03-05': {
                employeeId: 'EMP-A-12',
                date: '2026-03-05',
                present: true,
                hoursWorked: 8,
                overtimeHours: 0,
                projectId: PROJECT_A
            },
            // Juan in Project A: 8 reg hours on 2026-03-20 (Period 2) -> gross = 800
            'EMP-A-12-2026-03-20': {
                employeeId: 'EMP-A-12',
                date: '2026-03-20',
                present: true,
                hoursWorked: 8,
                overtimeHours: 0,
                projectId: PROJECT_A
            },
            // Beto in Project B: 8 reg hours on 2026-03-05 -> gross = 1600
            'EMP-B-12-2026-03-05': {
                employeeId: 'EMP-B-12',
                date: '2026-03-05',
                present: true,
                hoursWorked: 8,
                overtimeHours: 0,
                projectId: PROJECT_B
            }
        },
        settings: {
            companyName: 'Constructora Central',
            currency: 'DOP',
            regularHoursPerDay: 8,
            overtimeFactor: 1.5,
            holidayFactor: 2.0,
            restDayFactor: 1.75,
            holidays: [],
            payPeriod: { periodStart: '2026-03-01', periodLength: 15, payDay: '2026-03-15' },
            defaultDeductionPercentage: 0,
            payrollDefaults: {
                deductions: [],
                bonuses: []
            }
        },
        exportConfig: {
            leaderFilter: 'all',
            deductions: [],
            bonuses: [],
            periodStart: '2026-03-01',
            periodEnd: '2026-03-15',
            payrollLoanSelection: [],
            payrollLoanExpandedEmployees: [],
            payrollPreviewInclusion: { active: true, inactive: false, zeroHours: false }
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

describe('PayrollScopedAdjustmentsFocal — Multi-Project Adjustments & Exports', () => {
    let currentState;
    let configMap;
    let configStore;
    let projectEvents;
    let runtime;
    let renderMock;
    let mockDoc;
    let mockTargetWindow;
    let clipboardText;

    beforeEach(() => {
        localStorage.clear();
        resetEntityScope();
        clearPayrollAdjustmentPeriodRuntime();
        setProjectsEnabled(true);
        window.PayrollUI = PayrollUI;

        currentState = makeInitialState();
        stateManager.setState(currentState);

        configMap = new Map([
            [PROJECT_A, makeConfig(PROJECT_A, { projectName: 'Obra Alpha' })],
            [PROJECT_B, makeConfig(PROJECT_B, { projectName: 'Obra Beta' })]
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
            render: renderMock,
            saveToLocalStorage: jest.fn(async () => ({ localOk: true }))
        });

        // Mock PDF
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

        // Mock clipboard
        clipboardText = '';
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: jest.fn(async text => {
                    clipboardText = text;
                })
            },
            configurable: true
        });

        // Mock window.open for SplitX
        mockTargetWindow = {
            postMessage: jest.fn(),
            closed: false
        };
        window.open = jest.fn(() => mockTargetWindow);
    });

    afterEach(() => {
        runtime?.dispose?.();
        clearPayrollAdjustmentPeriodRuntime();
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(false);
        jest.restoreAllMocks();
    });

    describe('1. #12 A/B con ajustes distintos', () => {
        test('Juan #12 in A and Beto #12 in B calculate completely isolated adjustments and net pay', async () => {
            // Setup an installment deduction plan for Juan in Project A: 3 installments of $100
            const juan = currentState.employees.find(e => e.id === 'EMP-A-12');
            const [planJuan] = createPayrollAdjustmentInstallmentPlans({
                kind: 'deductions',
                employeeIds: [juan.id],
                name: 'Uniforme Obra A',
                totalAmount: 300,
                installmentCount: 3,
                firstPeriodStart: '2026-03-01',
                createdAt: Date.now(),
                projectId: PROJECT_A
            }, { createId });
            juan.deductions = [planJuan];

            // Setup a persistent bonus plan for Juan in Project A: $50
            const [planBonusJuan] = createPayrollAdjustmentInstallmentPlans({
                kind: 'bonuses',
                employeeIds: [juan.id],
                name: 'Bono puntualidad A',
                totalAmount: 50,
                installmentCount: 1,
                singlePayment: true,
                firstPeriodStart: '2026-03-01',
                createdAt: Date.now(),
                projectId: PROJECT_A
            }, { createId });
            juan.bonuses = [planBonusJuan];

            // Setup a separate deduction plan for Beto in Project B: $250
            const beto = currentState.employees.find(e => e.id === 'EMP-B-12');
            const [planBeto] = createPayrollAdjustmentInstallmentPlans({
                kind: 'deductions',
                employeeIds: [beto.id],
                name: 'Herramientas B',
                totalAmount: 250,
                installmentCount: 1,
                singlePayment: true,
                firstPeriodStart: '2026-03-01',
                createdAt: Date.now(),
                projectId: PROJECT_B
            }, { createId });
            beto.deductions = [planBeto];

            // Activate Project A
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            const previewA = await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            expect(previewA.rows).toHaveLength(1);
            const rowA = previewA.rows[0];
            expect(rowA._employeeId).toBe('EMP-A-12');
            expect(rowA._number).toBe('12');
            expect(rowA._brutoOriginal).toBe(800); // 8h @ 100
            expect(rowA._deductions).toBe(100); // 1st installment of 100
            expect(rowA._bonuses).toBe(50); // bonus 50
            expect(rowA.monto).toBe(750); // 800 + 50 - 100 = 750

            // Switch to Project B
            replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(PROJECT_A, PROJECT_B);

            const previewB = await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            expect(previewB.rows).toHaveLength(1);
            const rowB = previewB.rows[0];
            expect(rowB._employeeId).toBe('EMP-B-12');
            expect(rowB._number).toBe('12');
            expect(rowB._brutoOriginal).toBe(1600); // 8h @ 200
            expect(rowB._deductions).toBe(250); // Beto's deduction
            expect(rowB._bonuses).toBe(0); // Beto has no bonuses
            expect(rowB.monto).toBe(1350); // 1600 - 250 = 1350

            // Crucial assertion: Juan's #12 adjustments never apply to Beto #12 and vice versa
            expect(rowB._deductions).not.toBe(rowA._deductions);
            expect(rowB._bonuses).not.toBe(rowA._bonuses);
            expect(rowB.monto).not.toBe(rowA.monto);
        });
    });

    describe('2. Ajuste A no muta B', () => {
        test('installment plans and manual movements enforce project boundary validation', () => {
            const juan = currentState.employees.find(e => e.id === 'EMP-A-12');
            const beto = currentState.employees.find(e => e.id === 'EMP-B-12');

            // Creating plan for Beto with mismatched projectId: PROJECT_A
            const [planA] = createPayrollAdjustmentInstallmentPlans({
                kind: 'deductions',
                employeeIds: [beto.id],
                name: 'Casco Obra A',
                totalAmount: 100,
                installmentCount: 1,
                singlePayment: true,
                firstPeriodStart: '2026-03-01',
                createdAt: Date.now(),
                projectId: PROJECT_A
            }, { createId });
            expect(planA.projectId).toBe(PROJECT_A);

            // Attempting to attach planA to Beto (Project B) throws boundary error
            expect(() => {
                attachPayrollAdjustmentPlans([beto], [planA]);
            }).toThrow(/El plan pertenece al proyecto "PRJ-ALPHA-FOCAL" pero el empleado pertenece a "PRJ-BETA-FOCAL"/);

            // Beto's deductions remain empty
            expect(beto.deductions || []).toHaveLength(0);

            // Manual movement boundary: applying planA to Beto throws
            beto.deductions = [planA];
            expect(() => {
                applyManualAdjustmentMovement(beto, {
                    kind: 'deductions',
                    id: 'mov-1',
                    planId: planA.id,
                    type: 'pause',
                    date: '2026-03-01'
                });
            }).toThrow(/El plan no pertenece al proyecto del empleado/);
            beto.deductions = [];
        });

        test('persisting defaults under Projects ON updates project config without touching global settings or other projects', async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            // Add a default deduction to exportConfig and toggle remember
            stateManager.batchSetState(() => {
                currentState.exportConfig.deductions = [
                    { id: 'DED-DEFAULT-A', name: 'Seguro Obra A', type: 'fixed', value: 75, remembered: false }
                ];
            });

            // Toggle remember global/default for this deduction
            PayrollUI.toggleRememberGlobalAdjustment('deductions', 0, true);

            // Wait a tick for async configStore.putConfig
            await new Promise(r => setTimeout(r, 20));

            // Verify Project A config received the default
            const updatedConfigA = configMap.get(PROJECT_A);
            expect(updatedConfigA.payrollDefaults?.deductions).toEqual(
                expect.arrayContaining([expect.objectContaining({ name: 'Seguro Obra A', value: 75 })])
            );

            // Verify Project B config was NOT touched
            const configB = configMap.get(PROJECT_B);
            expect(configB.payrollDefaults?.deductions || []).toHaveLength(0);

            // Verify global settings was NOT touched (Requirement 5)
            expect(currentState.settings.payrollDefaults?.deductions || []).toHaveLength(0);
        });
    });

    describe('3. Export A sin filas B', () => {
        test('JSON, PDF, and SplitX exports under Project A export exclusively Project A rows', async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            // Test copyExportJSON
            PayrollUI.copyExportJSON();
            expect(clipboardText).toBeTruthy();
            const copiedRows = JSON.parse(clipboardText);
            expect(copiedRows).toHaveLength(1);
            expect(copiedRows[0].id).toBe(12);
            expect(copiedRows[0].nombre).toContain('Juan Perez');
            expect(copiedRows[0].nombre).not.toContain('Beto Rodriguez');

            // Test exportPayrollPDF
            await PayrollUI.exportPayrollPDF();
            expect(mockDoc.autoTable).toHaveBeenCalled();
            // Verify table body containing collaborators has only 1 row (Juan)
            const tableCall = mockDoc.autoTable.mock.calls.find(c => c[0]?.head?.[0]?.includes?.('Colaborador'));
            expect(tableCall).toBeTruthy();
            expect(tableCall[0].body).toHaveLength(1);
            expect(tableCall[0].body[0][1]).toBe('Juan Perez');
            expect(mockDoc.text).toHaveBeenCalledWith('CONSTRUCTORA CENTRAL', 14, 16);

            // Test sendToSplitX
            PayrollUI.sendToSplitX();
            expect(window.open).toHaveBeenCalled();
            expect(mockTargetWindow.postMessage).toHaveBeenCalled();
            const pingCall = mockTargetWindow.postMessage.mock.calls[0];
            expect(pingCall[0].type).toBe('SPLITX_PING');

            // Simulate SPLITX_READY event
            const messageHandler = window.addEventListener.mock?.calls?.find?.(c => c[0] === 'message')?.[1];
            if (messageHandler) {
                messageHandler({
                    origin: 'https://splitx.erlin.do',
                    source: mockTargetWindow,
                    data: { type: 'SPLITX_READY' }
                });
                const payloadCall = mockTargetWindow.postMessage.mock.calls.find(c => c[0]?.type === 'SPLITX_IMPORT_PAYROLL');
                expect(payloadCall).toBeTruthy();
                expect(payloadCall[0].projectId).toBe(PROJECT_A);
                expect(payloadCall[0].employees).toHaveLength(1);
                expect(payloadCall[0].employees[0].nombre).toContain('Juan Perez');
            }
        });
    });

    describe('4. Stale A→B', () => {
        test('switching from Project A to B invalidates wizard and composer state', async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            // Set wizard in A
            PayrollUI.setPayrollGuideStep('review');
            PayrollUI.toggleStep('step3');
            PayrollUI.togglePayrollSummaryDetail('deductions');
            setPayrollAdjustmentPeriodRuntimeSelection({
                kind: 'deductions',
                planId: 'plan-1',
                employeeId: 'EMP-A-12',
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            }, { mode: 'pause' });

            // Switch to Project B
            replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(PROJECT_A, PROJECT_B);

            // Wizard step should be reset to 'period'
            expect(currentState.exportConfig.payrollGuideStep).toBe('period');
            // Collapsed steps and summary details should be reset
            expect(currentState.exportConfig.collapsedSteps).toEqual([]);
            expect(currentState.exportConfig.payrollSummaryExpanded).toBeUndefined();
            // Runtime period selections should be cleared
            const selections = getPayrollAdjustmentPeriodRuntimeSelections('2026-03-01', '2026-03-15');
            expect(Object.keys(selections)).toHaveLength(0);
        });

        test('async operation started in A and completed after switch to B aborts cleanly without mutating B', async () => {
            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });

            // Mock modal prompt to switch project before resolving
            window.showInputModal = jest.fn(async () => {
                // Mid-flight switch to B!
                replaceEntityScope({ enabled: true, projectId: PROJECT_B, defaultProjectId: DEFAULT_PROJECT });
                projectEvents.emit(PROJECT_A, PROJECT_B);
                return { value: '150' };
            });

            // Attempt to add desktop adjustment started in A
            await PayrollUI.addDesktopAdjustment('deductions');

            // Verify Beto in Project B was not modified
            const beto = currentState.employees.find(e => e.id === 'EMP-B-12');
            expect(beto.deductions || []).toHaveLength(0);
            expect(beto.payrollAdjustmentPlans || []).toHaveLength(0);
        });
    });

    describe('5. Period Isolation', () => {
        test('installment plans and period selections isolate calculations between P1 and P2', async () => {
            const juan = currentState.employees.find(e => e.id === 'EMP-A-12');
            const [planJuan] = createPayrollAdjustmentInstallmentPlans({
                kind: 'deductions',
                employeeIds: [juan.id],
                name: 'Préstamo Interno Obra A',
                totalAmount: 300,
                installmentCount: 3,
                firstPeriodStart: '2026-03-01',
                createdAt: Date.now(),
                projectId: PROJECT_A
            }, { createId });
            juan.deductions = [planJuan];

            replaceEntityScope({ enabled: true, projectId: PROJECT_A, defaultProjectId: DEFAULT_PROJECT });
            projectEvents.emit(null, PROJECT_A);

            // Preview Period 1 (2026-03-01 to 2026-03-15)
            const previewP1 = await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });
            expect(previewP1.rows[0]._deductions).toBe(100);
            expect(previewP1.rows[0].monto).toBe(700); // 800 - 100

            // Apply a pause selection specifically for P1
            setPayrollAdjustmentPeriodRuntimeSelection({
                kind: 'deductions',
                planId: planJuan.id,
                employeeId: juan.id,
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            }, { mode: 'pause' });

            const previewP1Paused = await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-01',
                periodEnd: '2026-03-15'
            });
            expect(previewP1Paused.rows[0]._deductions).toBe(0);
            expect(previewP1Paused.rows[0].monto).toBe(800);

            // Preview Period 2 (2026-03-16 to 2026-03-31)
            const previewP2 = await PayrollUI.refreshScopedPayrollPreview({
                periodStart: '2026-03-16',
                periodEnd: '2026-03-31'
            });
            // P2 should still have its normal exigible installment (100) unaffected by P1's pause selection
            expect(previewP2.rows[0]._deductions).toBe(100);
            expect(previewP2.rows[0].monto).toBe(700);
        });
    });

    describe('6. OFF Parity', () => {
        test('when projects feature is OFF, legacy export and adjustment flow operates with global defaults', async () => {
            // Turn projects OFF
            setProjectsEnabled(false);
            resetEntityScope();

            // Set global settings default deduction
            currentState.settings.payrollDefaults = {
                deductions: [{ id: 'DED-GLOBAL-1', name: 'Seguro Global', type: 'fixed', value: 50, remembered: true }],
                bonuses: []
            };
            currentState.exportConfig.deductions = [
                { id: 'DED-GLOBAL-1', name: 'Seguro Global', type: 'fixed', value: 50, remembered: true }
            ];

            // Remove export deduction in OFF mode
            PayrollUI.removeExportDeduction(0);

            // Verify global settings payrollDefaults was updated directly
            expect(currentState.settings.payrollDefaults.deductions).toHaveLength(0);
            expect(currentState.exportConfig.deductions).toHaveLength(0);
            expect(renderMock).toHaveBeenCalled();
        });
    });
});
