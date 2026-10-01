/**
 * Filtro por líder en la nómina por obra: cada empleado puede entrar con las
 * horas de todos sus puestos o solo con las de los puestos de ese líder.
 */
import 'fake-indexeddb/auto';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from 'actual/features/payroll/ProjectPayrollUIRuntime.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';
import { stateManager, state as appState } from 'actual/core/AppState.js';
import { filterPayrollRowsByLeader, limitPayrollRowToPositions } from 'actual/features/payroll/PayrollPreview.js';

const P = 'PRJ-LEADER-HOURS';

describe('limitPayrollRowToPositions', () => {
    const row = {
        _employeeId: 'E1', monto: 1250, _montoBeforeLoans: 1350, _loans: 100, _brutoOriginal: 1000, _bruto: 1000,
        _bonuses: 300, _deductions: 50,
        _bonusDetails: [{ name: 'Bono fijo', type: 'fixed', value: 200, amount: 200 }, { name: 'Bono 10%', type: 'percentage', value: 10, appliedTo: 1000, amount: 100 }],
        _deductionDetails: [{ name: 'Seguro', type: 'fixed', value: 50, amount: 50 }],
        _positionBreakdown: [
            { positionId: 'A', positionName: 'Albañil', days: 3, regularHours: 24, overtimeHours: 2, holidayHours: 0, restDayHours: 0, subtotal: 600 },
            { positionId: 'B', positionName: 'Plomero', days: 2, regularHours: 16, overtimeHours: 0, holidayHours: 0, restDayHours: 0, subtotal: 400 }
        ]
    };

    test('solo deja horas y bruto del puesto; el % se recalcula y lo fijo queda', () => {
        const out = limitPayrollRowToPositions(row, new Set(['A']));
        expect(out).toMatchObject({ _brutoOriginal: 600, _bonuses: 260, _deductions: 50, _loans: 100, _totalHours: 26, _regularHours: 24, _overtimeHours: 2 });
        expect(out._bonusDetails[1]).toMatchObject({ amount: 60, appliedTo: 600 });
        expect(out.monto).toBe(1250 - 400 - 40); // −400 de bruto, −40 del bono porcentual
        expect(out._leaderExcludedPositions).toEqual([{ positionId: 'B', positionName: 'Plomero', days: 2, hours: 16, subtotal: 400 }]);
    });

    test('todos sus puestos del líder: la fila no cambia; ninguno: queda fuera', () => {
        expect(limitPayrollRowToPositions(row, new Set(['A', 'B']))).toBe(row);
        expect(limitPayrollRowToPositions(row, new Set(['C']))).toBeNull();
    });

    test('sin horas en el período va con el líder de su puesto asignado', () => {
        const positions = [{ id: 'A', leaderId: 'L1' }, { id: 'B', leaderId: 'L2' }];
        const employees = [{ id: 'Z', positions: ['B'] }];
        const rows = [{ _employeeId: 'Z', _positionBreakdown: [], _loans: 300 }];
        expect(filterPayrollRowsByLeader(rows, { leaderId: 'L1', positions, employees, hoursScope: 'leader' })).toHaveLength(0);
        expect(filterPayrollRowsByLeader(rows, { leaderId: 'L2', positions, employees, hoursScope: 'leader' })).toHaveLength(1);
    });
});

describe('nómina por obra: horas de todos los puestos o solo los del líder', () => {
    let runtime;
    let clipboard;

    beforeEach(async () => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        window.PayrollUI = PayrollUI;
        const day = (employeeId, date, positionId) => ({
            employeeId, date, present: true, hoursWorked: 8, overtimeHours: 0, projectId: P, selectedPosition: positionId, positionId
        });
        stateManager.setState({
            employees: [
                { id: 'E1', number: '001', name: 'Ana Uno', projectId: P, active: true, positions: ['POS-1', 'POS-2'], bonuses: [], deductions: [] },
                { id: 'E2', number: '002', name: 'Beto Dos', projectId: P, active: true, positions: ['POS-2'], bonuses: [], deductions: [] }
            ],
            positions: [
                { id: 'POS-1', name: 'Albañil', projectId: P, hourlyRate: 100, leaderId: 'L1', workingDays: [0, 1, 2, 3, 4, 5, 6] },
                { id: 'POS-2', name: 'Plomero', projectId: P, hourlyRate: 100, leaderId: 'L2', workingDays: [0, 1, 2, 3, 4, 5, 6] }
            ],
            leaders: [
                { id: 'L1', name: 'Líder Uno', active: true, projectId: P },
                { id: 'L2', name: 'Líder Dos', active: true, projectId: P }
            ],
            attendance: {
                'E1-2026-03-05': day('E1', '2026-03-05', 'POS-1'),
                'E1-2026-03-06': day('E1', '2026-03-06', 'POS-2'),
                'E2-2026-03-05': day('E2', '2026-03-05', 'POS-2')
            },
            settings: {
                companyName: 'SA', regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, restDayFactor: 1.75,
                holidays: [], payPeriod: { periodStart: '2026-03-01', periodLength: 15, payDay: '2026-03-15' }, defaultDeductionPercentage: 0
            },
            exportConfig: { leaderFilter: 'all', rememberedGlobalsHydrated: true, bonuses: [], deductions: [], periodStart: '2026-03-01', periodEnd: '2026-03-15' },
            payrollViewMode: 'generator'
        });
        const state = appState;
        const listeners = new Set();
        const projectContext = { subscribe: l => { listeners.add(l); return () => listeners.delete(l); } };
        const configs = new Map([[P, { ...createDefaultConfig(P), payPeriod: state.settings.payPeriod, regularHoursPerDay: 8, projectId: P }]]);
        runtime = new ProjectPayrollUIRuntime({
            state,
            configStore: { getConfig: jest.fn(async id => configs.get(id)), putConfig: jest.fn(async c => c) },
            projectContext
        });
        PayrollUI.init({ state, services: { payroll: {}, payrollRuntime: runtime }, render: jest.fn() });
        replaceEntityScope({ enabled: true, projectId: P, defaultProjectId: P });
        for (const l of listeners) l({ previousProjectId: null, projectId: P });
        await PayrollUI.refreshScopedPayrollPreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
        clipboard = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { clipboard.push(JSON.parse(t)); } } });
    });

    afterEach(() => {
        runtime?.dispose?.();
        resetEntityScope();
        setProjectsEnabled(false);
    });

    const exported = async () => { PayrollUI.copyExportJSON(); await Promise.resolve(); return clipboard.at(-1); };
    const net = rows => rows.reduce((sum, row) => sum + Number(row.monto ?? row.amount ?? row.neto ?? 0), 0);

    test('con el líder, "todos sus puestos" paga ambos días y "solo sus puestos" uno', async () => {
        PayrollUI.setLeaderFilter('L1');
        const all = await exported();
        expect(all).toHaveLength(1);
        PayrollUI.setLeaderHoursScope('leader');
        const onlyLeader = await exported();
        expect(onlyLeader).toHaveLength(1);
        expect(net(all) - net(onlyLeader)).toBeCloseTo(800); // el día de Plomero (8h × 100)
    });

    test('la vista muestra el selector y lo que quedó fuera', () => {
        PayrollUI.setPayrollGuideStep('review');
        PayrollUI.setLeaderFilter('L1');
        expect(PayrollUI.PayrollTab()).toContain('Solo puestos de Líder Uno');
        PayrollUI.setLeaderHoursScope('leader');
        const html = PayrollUI.PayrollTab();
        expect(html).toMatch(/aria-pressed="true"[^>]*>\s*Solo puestos de Líder Uno/);
        expect(html).toContain('Sin Plomero 8h');
    });

    test('al quitar el líder vuelven todos con todas sus horas', async () => {
        PayrollUI.setLeaderFilter('L1');
        PayrollUI.setLeaderHoursScope('leader');
        PayrollUI.setLeaderFilter('all');
        expect(await exported()).toHaveLength(2);
    });
});
