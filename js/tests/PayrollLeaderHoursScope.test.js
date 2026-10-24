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
import { applyPayrollLoanDeductions } from 'actual/features/payroll/PayrollLoans.js';
import { buildPayrollLoansDesktopModel } from 'actual/features/payroll/PayrollLoansDesktop.js';
import { filterPayrollRowsByLeader, limitPayrollRowToPositions } from 'actual/features/payroll/PayrollPreview.js';
import { formatCurrency } from 'actual/utils/Formatters.js';

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

    test('recalcular con un líder seleccionado conserva las filas de toda la obra para cambiar de equipo', async () => {
        PayrollUI.setLeaderFilter('L1');
        await PayrollUI.refreshScopedPayrollPreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
        expect(runtime.getCurrentView().previewRows.map(row => row._employeeId)).toEqual(['E1', 'E2']);
        expect(await exported()).toHaveLength(1);
        PayrollUI.setLeaderFilter('L2');
        const rows = await exported();
        expect(rows).toHaveLength(2);
        expect(net(rows)).toBeCloseTo(2400);
        PayrollUI.setLeaderHoursScope('leader');
        expect(net(await exported())).toBeCloseTo(1600);
    });

    test('quitar el filtro después de recalcular recupera todo el personal sin volver a calcular', async () => {
        PayrollUI.setLeaderFilter('L1');
        await PayrollUI.refreshScopedPayrollPreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
        PayrollUI.setLeaderFilter('all');
        expect(await exported()).toHaveLength(2);
    });

    test('activar préstamos después de cambiar líder conserva el sueldo del otro equipo', async () => {
        stateManager.batchSetState(raw => {
            raw.employees[1].loans = [{ id: 'loan-team-2', number: 1, principal: 100, interestRate: 0,
                startDate: '2026-03-01', dueDate: '2026-03-15', status: 'active', payments: [], refinancings: [] }];
        });
        PayrollUI.setLeaderFilter('L1');
        await PayrollUI.refreshScopedPayrollPreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
        PayrollUI.setLeaderFilter('all');
        PayrollUI.addPayrollLoansToExport();
        const selection = appState.exportConfig.payrollLoanSelection;
        const rows = applyPayrollLoanDeductions(runtime.getCurrentView().previewRows, appState.employees, selection, '2026-03-15');
        const model = buildPayrollLoansDesktopModel(appState.employees, selection, rows, '2026-03-15');
        expect(model.groups.find(group => group.employeeId === 'E2').netRemaining).toBe(700);
        expect(model.zeroCount).toBe(0);
        const output = await exported();
        expect(output).toHaveLength(2);
        expect(net(output)).toBeCloseTo(2300);
    });

    test('al quitar el líder vuelven todos con todas sus horas', async () => {
        PayrollUI.setLeaderFilter('L1');
        PayrollUI.setLeaderHoursScope('leader');
        PayrollUI.setLeaderFilter('all');
        expect(await exported()).toHaveLength(2);
    });

    test.each([
        ['jornada repartida', false, 1200, 600, 800, 1200],
        ['medias jornadas separadas', false, 1200, 600, 800, 1200],
        ['jornada repartida', true, 1320, 700, 880, 1400],
        ['medias jornadas separadas', true, 1320, 700, 880, 1400]
    ])(
        'Juan: reparte sueldos y días con %s, tarifa personal: %s', async (distribution, personalRates, gringoPay, julitoPay, gringoDaily, julitoDaily) => {
            stateManager.batchSetState(raw => {
                raw.employees[0].name = 'Juan';
                raw.employees[1].name = 'Solo albañil';
                raw.leaders[0].name = 'Gringo';
                raw.leaders[1].name = 'Julito';
                raw.positions[0].name = 'Varillero';
                raw.positions[1].name = 'Albañil';
                raw.positions[1].hourlyRate = 150;
                if (personalRates) raw.employees[0].positionSalaries = { 'POS-1': 110, 'POS-2': 175 };
                const record = (date, position, hours) => ({ employeeId: 'E1', date, projectId: P,
                    present: true, selectedPosition: position, hoursWorked: hours, overtimeHours: 0 });
                raw.attendance = {
                    'E1-2026-03-05': record('2026-03-05', 'POS-1', 8),
                    'E1-2026-03-06': distribution === 'jornada repartida'
                        ? { ...record('2026-03-06', 'POS-1', 8), positionHours: [
                            { positionId: 'POS-1', hours: 4, overtimeHours: 0 },
                            { positionId: 'POS-2', hours: 4, overtimeHours: 0 }
                        ] }
                        : record('2026-03-06', 'POS-1', 4),
                    ...(distribution === 'medias jornadas separadas'
                        ? { 'E1-2026-03-07': record('2026-03-07', 'POS-2', 4) } : {}),
                    'E2-2026-03-05': { ...record('2026-03-05', 'POS-2', 8), employeeId: 'E2' }
                };
                // Being assigned to Gringo is insufficient if all worked hours belong to Julito.
                raw.employees[1].positions = ['POS-1', 'POS-2'];
            });
            await PayrollUI.refreshScopedPayrollPreview({ periodStart: '2026-03-01', periodEnd: '2026-03-15' });
            const source = JSON.stringify(runtime.getCurrentView().previewRows);
            PayrollUI.setPayrollGuideStep('review');
            PayrollUI.setLeaderHoursScope('leader');
            const byTeam = {};
            for (const [id, position, hours, days, gross, dailyRate] of [
                ['L1', 'POS-1', 12, 1.5, gringoPay, gringoDaily], ['L2', 'POS-2', 4, 0.5, julitoPay, julitoDaily]
            ]) {
                PayrollUI.setLeaderFilter(id);
                const output = await exported();
                const juan = output.find(employee => employee.sourceEmployeeId === 'E1');
                byTeam[id] = juan;
                expect(juan).toMatchObject({ employeeName: 'Juan', bruto: gross, monto: gross,
                    workDays: { regular: days, total: days } });
                expect(juan.positions).toHaveLength(1);
                expect(juan.positions[0]).toMatchObject({ id: position, leaderId: id, dailyRate, workDays: { total: days } });
                expect(juan.leaders.map(leader => leader.id)).toEqual([id]);
                expect(output.map(employee => employee.sourceEmployeeId)).toEqual(id === 'L1' ? ['E1'] : ['E1', 'E2']);
                const host = document.createElement('div');
                host.innerHTML = PayrollUI.PayrollTab();
                const row = [...host.querySelectorAll('.payroll-review-table__row')]
                    .find(element => element.querySelector('.payroll-review-table__employee').textContent.includes('Juan'));
                expect(row.querySelector('.payroll-review-table__amount').textContent.trim()).toBe(`${hours}h`);
                expect(row.querySelectorAll('.payroll-review-table__amount')[1].textContent.trim()).toBe(formatCurrency(gross));
                expect(row.querySelector('.payroll-review-table__amount.is-net').textContent.trim()).toBe(formatCurrency(gross));
                expect(row.querySelectorAll('.payroll-breakdown-details__item')).toHaveLength(1);
                expect(row.querySelector('.payroll-breakdown-details__item strong').textContent)
                    .toBe(id === 'L1' ? 'Varillero' : 'Albañil');
            }
            expect(byTeam.L1.workDays.total + byTeam.L2.workDays.total).toBe(2);
            expect(byTeam.L1.bruto + byTeam.L2.bruto).toBe(gringoPay + julitoPay);
            PayrollUI.setLeaderFilter('all');
            const full = (await exported()).find(employee => employee.sourceEmployeeId === 'E1');
            expect(full).toMatchObject({ bruto: gringoPay + julitoPay, monto: gringoPay + julitoPay, workDays: { total: 2 } });
            expect(full.positions).toHaveLength(2);
            expect(JSON.stringify(runtime.getCurrentView().previewRows)).toBe(source);
        }
    );
});
