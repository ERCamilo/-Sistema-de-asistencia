import { buildSplitXExport } from '../modules/features/payroll/PayrollSplitXExport.js';
import { toSplitXRows } from '../modules/features/payroll/PayrollLoans.js';
import { applyPayrollPreviewInclusion, limitPayrollRowToPositions } from '../modules/features/payroll/PayrollPreview.js';

const options = () => ({
    period: { start: '2026-10-01', end: '2026-10-15' }, currency: 'DOP', regularHoursPerDay: 8,
    projectId: 'obra-a', projectName: 'Obra Centro',
    employees: [{ id: 'employee-a', number: '001', name: 'Ana Ejemplo', positions: ['P2'] }],
    positions: [{ id: 'P1', name: 'Albañil', leaderId: 'L1' }, { id: 'P2', name: 'Ayudante', leaderId: 'L2' }],
    leaders: [{ id: 'L1', name: 'Líder Uno', number: '10' }, { id: 'L2', name: 'Líder Dos', number: '20' }]
});
const row = () => ({
    id: 1, nombre: 'Ana Ejemplo (Ref #001)', monto: 9700,
    _employeeId: 'employee-a', _employeeName: 'Ana Ejemplo', _number: '001',
    _brutoOriginal: 10000, _bonuses: 500, _deductions: 800, _loans: 0,
    _bonusDetails: [{ id: 'B1', name: 'Bono asistencia', type: 'fixed', value: 500, amount: 500 }],
    _deductionDetails: [
        { id: 'D1', name: 'Descuento de ley', type: 'percentage', value: 3, appliedTo: 10000, amount: 300 },
        { id: 'D2', name: 'Reparación de equipo', type: 'fixed', value: 500, amount: 500 }
    ],
    _positionBreakdown: [{ positionId: 'P1', positionName: 'Albañil histórico', regularHours: 4, overtimeHours: 2, holidayHours: 8, restDayHours: 4 }]
});

describe('Contrato enriquecido de exportación SplitX', () => {
    test('conserva íntegramente el contrato original y no usa ficha como nueva identidad estable', () => {
        const source = row(), context = options();
        const before = JSON.stringify({ source, context });
        const result = buildSplitXExport([source], context);
        expect(result.employees[0]).toMatchObject(toSplitXRows([source])[0]);
        expect(result.employees[0]).toMatchObject({ sourceEmployeeId: 'employee-a', employeeNumber: '001', employeeName: 'Ana Ejemplo' });
        expect(JSON.stringify({ source, context })).toBe(before);
        source._number = '33';
        expect(buildSplitXExport([source], context).employees[0].sourceEmployeeId).toBe('employee-a');
        expect(result.context).toMatchObject({ schema: 'sa-splitx-payroll/v1', period: context.period, currency: 'DOP', projectId: 'obra-a', projectName: 'Obra Centro' });
        expect(result.context).not.toHaveProperty('payrollId');
    });

    test('convierte cada categoría en jornadas equivalentes sin usar los factores del salario', () => {
        const result = buildSplitXExport([row()], options()).employees[0];
        expect(result.workDays).toEqual({ unit: 'equivalent-day', regular: 0.5, overtime: 0.25, holiday: 1, restDay: 0.5, total: 2.25 });
        expect(result.exportContext.hoursPerDay).toBe(8);
        expect(buildSplitXExport([row()], { ...options(), regularHoursPerDay: 4 }).employees[0].workDays.total).toBe(4.5);
        expect(result.workDays).not.toHaveProperty('hours');
    });

    test('varios puestos suman las jornadas proporcionales, no duplican días de asistencia', () => {
        const source = row();
        source._positionBreakdown = [
            { positionId: 'P1', regularHours: 4 }, { positionId: 'P2', regularHours: 4 }
        ];
        const employee = buildSplitXExport([source], options()).employees[0];
        expect(employee.workDays.total).toBe(1);
        expect(employee.positions.map(p => p.workDays.total)).toEqual([0.5, 0.5]);
        expect(employee.leaders.map(l => l.id)).toEqual(['L1', 'L2']);
    });

    test('identifica el puesto trabajado antes que el puesto actualmente asignado', () => {
        const employee = buildSplitXExport([row()], options()).employees[0];
        expect(employee.positions).toHaveLength(1);
        expect(employee.positions[0]).toMatchObject({ id: 'P1', name: 'Albañil histórico', leaderId: 'L1' });
        expect(employee.leaders).toEqual([{ id: 'L1', name: 'Líder Uno', number: '10' }]);
    });

    test('exporta cada concepto con monto calculado y signo, porcentaje y base; no vuelve a calcularlo', () => {
        const employee = buildSplitXExport([row()], options()).employees[0];
        expect(employee.bonusDetails[0]).toMatchObject({ id: 'B1', concept: 'Bono asistencia', type: 'fixed', value: 500, amount: 500, signedAmount: 500 });
        expect(employee.deductionDetails).toEqual([
            { id: 'D1', concept: 'Descuento de ley', type: 'percentage', value: 3, baseAmount: 10000, amount: 300, signedAmount: -300 },
            { id: 'D2', concept: 'Reparación de equipo', type: 'fixed', value: 500, amount: 500, signedAmount: -500 }
        ]);
        expect(employee.deductionDetails.reduce((sum, d) => sum + d.amount, 0)).toBe(employee.descuentos);
    });

    test('conserva referencias de cuota sin exponer los objetos internos completos', () => {
        const source = row();
        source._deductionDetails = [{ id: 'installment-a', name: 'Equipo', type: 'fixed', value: 125, amount: 125, source: 'payroll-adjustment-installment', planId: 'plan-a', installmentId: 'installment-a', sequence: 2, installmentCount: 4, employeeId: 'employee-a', privateData: 'omit' }];
        const detail = buildSplitXExport([source], options()).employees[0].deductionDetails[0];
        expect(detail).toMatchObject({ concept: 'Equipo', amount: 125, signedAmount: -125, planId: 'plan-a', installmentId: 'installment-a', installmentSequence: 2, installmentCount: 4 });
        expect(detail).not.toHaveProperty('privateData');
        expect(detail).not.toHaveProperty('employeeId');
    });

    test('una categoría desmarcada no reaparece en detalles ni totales', () => {
        const rows = applyPayrollPreviewInclusion([row()], { deductions: false, bonuses: false });
        const result = buildSplitXExport(rows, options());
        expect(result.employees[0].deductionDetails).toEqual([]);
        expect(result.employees[0].bonusDetails).toEqual([]);
        expect(result.context.totals).toMatchObject({ employeeCount: 1, gross: 10000, bonuses: 0, deductions: 0, loans: 0, net: 10000 });
    });

    test('el filtro de posiciones del líder conserva solo sus días y conceptos ya calculados', () => {
        const source = row();
        source._positionBreakdown = [{ positionId: 'P1', regularHours: 4, subtotal: 4000 }, { positionId: 'P2', regularHours: 8, subtotal: 6000 }];
        const filtered = limitPayrollRowToPositions(source, new Set(['P1']));
        const result = buildSplitXExport([filtered], options());
        expect(result.employees[0].workDays.total).toBe(0.5);
        expect(result.employees[0].positions.map(p => p.id)).toEqual(['P1']);
        expect(result.employees[0].deductionDetails[0]).toMatchObject({ amount: 120, baseAmount: 4000 });
        expect(result.context.totals.gross).toBe(4000);
    });

    test('el arreglo manual conserva contexto y totales de exactamente sus filas sin perder precisión monetaria', () => {
        const source = { ...row(), monto: 0.123456789 };
        const result = buildSplitXExport([source], options());
        const copied = JSON.parse(JSON.stringify(result.employees));
        expect(Array.isArray(copied)).toBe(true);
        expect(copied[0].exportContext).toEqual(result.context);
        expect(copied[0].monto).toBe(0.123456789);
        expect(result.context.totals.net).toBe(0.123456789);
        expect(buildSplitXExport([], options()).context.totals.employeeCount).toBe(0);
    });

    test('un período inválido o una jornada inválida no producen datos financieros engañosos', () => {
        for (const period of [{ start: '2026-02-30', end: '2026-03-01' }, { start: '2026-10-15', end: '2026-10-01' }, { start: null, end: null }]) {
            expect(() => buildSplitXExport([row()], { ...options(), period })).toThrow(/período/i);
        }
        expect(() => buildSplitXExport([row()], { ...options(), regularHoursPerDay: 0 })).toThrow(/jornada/i);
    });
});
