/**
 * Nómina por obra: filtro por líder y casillas de bonificaciones /
 * deducciones / préstamos. Afectan la tabla, el total y lo que se exporta
 * (JSON / SplitX); el cierre siempre es de la obra completa.
 */
import 'fake-indexeddb/auto';
import { setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from 'actual/features/projects/EntityProjectScope.js';
import { createDefaultConfig } from 'actual/features/payroll/ProjectPayrollConfig.js';
import { ProjectPayrollUIRuntime } from 'actual/features/payroll/ProjectPayrollUIRuntime.js';
import * as PayrollUI from 'actual/features/payroll/PayrollUI.js';
import { stateManager, state as appState } from 'actual/core/AppState.js';
import { filterPayrollRowsByLeader } from 'actual/features/payroll/PayrollPreview.js';
import { renderPayrollReviewTable } from 'actual/features/payroll/PayrollReviewTable.js';

const P = 'PRJ-LEADER-FILTER';

function makeState() {
    const day = (employeeId, positionId) => ({
        employeeId, date: '2026-03-05', present: true, hoursWorked: 8, overtimeHours: 0, projectId: P, positionId
    });
    return {
        employees: [
            { id: 'E1', number: '001', name: 'Ana Uno', projectId: P, active: true, positions: ['POS-1'], bonuses: [], deductions: [] },
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
        attendance: { 'E1-2026-03-05': day('E1', 'POS-1'), 'E2-2026-03-05': day('E2', 'POS-2') },
        settings: {
            companyName: 'SA', regularHoursPerDay: 8, overtimeFactor: 1.5, holidayFactor: 2, restDayFactor: 1.75,
            holidays: [], payPeriod: { periodStart: '2026-03-01', periodLength: 15, payDay: '2026-03-15' }, defaultDeductionPercentage: 0
        },
        exportConfig: {
            leaderFilter: 'all',
            rememberedGlobalsHydrated: true,
            bonuses: [{ id: 'B1', name: 'Bono asistencia', type: 'fixed', value: 200, scope: 'global', projectId: P }],
            deductions: [{ id: 'D1', name: 'Seguro', type: 'fixed', value: 50, scope: 'global', projectId: P }],
            periodStart: '2026-03-01', periodEnd: '2026-03-15'
        },
        payrollViewMode: 'generator'
    };
}

describe('filterPayrollRowsByLeader', () => {
    const positions = [{ id: 'A', leaderId: 'L1' }, { id: 'B', leaderId: 'L2' }];
    const rows = [
        { _employeeId: 'x', _positionBreakdown: [{ positionId: 'A' }] },
        { _employeeId: 'y', _positionBreakdown: [{ positionId: 'B' }] },
        { _employeeId: 'z', _positionBreakdown: [] }
    ];
    test('todos, por posición trabajada y por posición actual', () => {
        expect(filterPayrollRowsByLeader(rows, { leaderId: 'all', positions })).toHaveLength(3);
        expect(filterPayrollRowsByLeader(rows, { leaderId: 'L1', positions }).map(r => r._employeeId)).toEqual(['x']);
        expect(filterPayrollRowsByLeader(rows, {
            leaderId: 'L2', positions, employees: [{ id: 'z', positions: ['B'] }]
        }).map(r => r._employeeId)).toEqual(['y', 'z']);
        expect(filterPayrollRowsByLeader(rows, { leaderId: 'L9', positions })).toEqual([]);
    });
});

describe('renderPayrollReviewTable', () => {
    const row = {
        _employeeId: 'E1', _number: '001', _employeeName: 'Ana', _totalHours: 8, _brutoOriginal: 800, monto: 950,
        _bonuses: 200, _bonusDetails: [{ name: 'Bono A', type: 'fixed', value: 120, amount: 120, scope: 'global' }, { name: 'Bono B', type: 'fixed', value: 80, amount: 80, scope: 'employee' }],
        _deductions: 50, _deductionDetails: [{ name: 'Seguro', type: 'fixed', value: 50, amount: 50, scope: 'global' }],
        _loans: 0, _loanDetails: []
    };
    test('colores por categoría, casillas y detalle desplegado', () => {
        const html = renderPayrollReviewTable({ rows: [row], sourceRows: [row], expanded: new Set(['E1|bonuses']) });
        expect(html).toContain('th class="is-bonus payroll-review-table__toggle-heading"');
        expect(html).toContain('data-value="deductions"');
        expect(html).not.toContain('data-value="loans"'); // sin préstamos no hay columna
        expect(html).toContain('payroll-review-detail__group is-bonus');
        expect(html).toContain('Bono A');
        expect(html).toContain('Bono B');
        expect(html).not.toContain('payroll-review-detail__group is-deduction');
    });
    test('una categoría desmarcada se muestra tachada y no suma', () => {
        const paid = { ...row, _bonuses: 0, _bonusDetails: [], monto: 750 };
        const html = renderPayrollReviewTable({ rows: [paid], sourceRows: [row], inclusion: { bonuses: false } });
        expect(html).toMatch(/is-bonus is-excluded[\s\S]*<s>\+\$200\.00<\/s>/);
        expect(html).toContain('$750.00');
        expect(html).toMatch(/data-value="bonuses"\s*\n\s*aria-label/);
    });
});

describe('Nómina por obra con filtro de líder', () => {
    let state;
    let runtime;
    let clipboard;

    beforeEach(async () => {
        localStorage.clear();
        resetEntityScope();
        setProjectsEnabled(true);
        window.PayrollUI = PayrollUI;
        stateManager.setState(makeState());
        state = appState; // la app usa el mismo objeto de estado en todos lados
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
        // Cambiar de obra limpia los ajustes de nómina: se configuran después.
        stateManager.batchSetState(() => {
            state.exportConfig.bonuses = [{ id: 'B1', name: 'Bono asistencia', type: 'fixed', value: 200, scope: 'global', projectId: P }];
            state.exportConfig.deductions = [{ id: 'D1', name: 'Seguro', type: 'fixed', value: 50, scope: 'global', projectId: P }];
            state.exportConfig.rememberedGlobalsHydrated = true;
        });
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

    test('sin filtro exporta a los dos; con líder solo a su gente', async () => {
        expect(await exported()).toHaveLength(2);
        PayrollUI.setLeaderFilter('L2');
        const rows = await exported();
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows)).toContain('Beto Dos');
        expect(JSON.stringify(rows)).not.toContain('Ana Uno');
    });

    test('la vista muestra el filtro y el cierre pide quitarlo', () => {
        PayrollUI.setPayrollGuideStep('review');
        PayrollUI.setLeaderFilter('L1');
        const html = PayrollUI.PayrollTab();
        expect(html).toContain('id="payroll-scoped-leader-filter"');
        expect(html).toContain('1 de 2 empleados');
        expect(html).toContain('Líder: Líder Uno');
        expect(html).toContain('Quita el filtro de líder para cerrar la nómina completa de la obra.');
        expect(html).not.toContain('Beto Dos');
    });

    test('desmarcar bonificaciones las saca del neto exportado', async () => {
        const before = await exported();
        PayrollUI.togglePayrollPreviewCategory('bonuses', false);
        const after = await exported();
        const net = rows => rows.reduce((sum, row) => sum + Number(row.monto ?? row.amount ?? row.neto ?? 0), 0);
        expect(net(before) - net(after)).toBeCloseTo(400);
    });

    test('el detalle de un empleado se despliega y se pliega', () => {
        PayrollUI.setPayrollGuideStep('review');
        PayrollUI.togglePayrollReviewDetail('E1|bonuses');
        expect(PayrollUI.PayrollTab()).toContain('payroll-review-detail__group is-bonus');
        PayrollUI.togglePayrollReviewDetail('E1|bonuses');
        expect(PayrollUI.PayrollTab()).not.toContain('payroll-review-detail__group is-bonus');
    });
});
