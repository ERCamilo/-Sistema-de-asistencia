import { createLoan, recordPayment, refinanceLoan } from '../modules/features/loans/LoansService.js';
import { buildAiReport, earningReading } from '../modules/features/loans/LoanAiReport.js';
import { computePortfolioSummary } from '../modules/features/loans/LoanPortfolio.js';

const PAY = { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' };
let clock = 1_000;

function obra() {
    const emp = { id: 'emp-interno-77', number: '012', name: 'Ana Pérez', active: true, loans: [], updatedAt: 1 };
    const a = createLoan(emp, { principal: 10000, interestRate: 20, startDate: '2026-08-25', concept: 'Préstamo para Ana Pérez' });
    a.createdAt = (clock += 1_000);
    Object.assign(a, { number: 1, dueDate: '2026-09-12' });
    recordPayment(emp, a.id, { amount: 6600, date: '2026-09-12', source: 'payroll', note: 'pagó Ana Pérez', recordedAt: (clock += 1_000) });
    refinanceLoan(emp, a.id, { interestRate: 20, basis: 'balance', date: '2026-09-12' });
    Object.assign(a.refinancings[0], { interestAmount: 1080, note: 'Ana pidió más tiempo' });
    const other = { id: 'emp-interno-88', number: '300', name: 'Carlos Ruiz', active: false, loans: [], updatedAt: 1 };
    const b = createLoan(other, { principal: 2000, interestRate: 10, startDate: '2026-08-01' });
    Object.assign(b, { number: 2, dueDate: '2026-08-15' });
    return [emp, other];
}

describe('Informe para IA', () => {
    test('lectura de lo ganado frente a lo normal', () => {
        expect(earningReading({ gross: 7000, expected: 10000 })).toBe('trabajó menos de lo normal (faltas o días incompletos)');
        expect(earningReading({ gross: 10000, expected: 10000 })).toBe('normal');
        expect(earningReading({ gross: 11500, expected: 10000, overtimeHours: 6 })).toBe('normal con horas extra');
        expect(earningReading({ gross: 0, expected: 10000 })).toBe('no trabajó (sin asistencia)');
        expect(earningReading({ gross: 0, expected: 10000, partial: true })).toBe('aún sin asistencia en el periodo');
        expect(earningReading({ gross: 5000, expected: 0 })).toBe('sin sueldo normal configurado');
    });

    test('lleva contexto, cifras y detalle por número de empleado, sin nombres, notas ni ids', () => {
        const employees = obra();
        const earnings = new Map([['emp-interno-77', [
            { label: '21/08–10/09', start: '2026-08-21', end: '2026-09-10', gross: 9000, expected: 12000, days: 15, regularHours: 120, overtimeHours: 0, deducted: 6600 },
            { label: '11/09–01/10', start: '2026-09-11', end: '2026-10-01', gross: 13500, expected: 12000, days: 18, regularHours: 144, overtimeHours: 10, deducted: 0 }
        ]]]);
        const md = buildAiReport({
            today: '2026-10-06', payPeriod: PAY, employees, summary: computePortfolioSummary(employees),
            risk: [{ emp: employees[1], lvl: 3, bal: 2200, why: ['Está inactivo y debe $2,200.'], ctx: [], salary: null }],
            earnings, notes: { duplicates: { total: 2 }, review: 1, virtual: true }
        });
        for (const secret of ['Ana', 'Pérez', 'Carlos', 'Ruiz', 'emp-interno', 'pidió más tiempo', 'Préstamo para']) expect(md).not.toContain(secret);
        expect(md).toContain('## 1. Contexto: cómo funcionan los préstamos y los cobros');
        expect(md).toContain('primero cubre el interés pendiente y después el capital');
        expect(md).toContain('periodos de 21 días; el pago se hace 2 día(s) después');
        expect(md).toContain('### Empleado #012 (activo)');
        expect(md).toContain('### Empleado #300 (inactivo)');
        expect(md).toContain('trabajó menos de lo normal');
        expect(md).toContain('normal con horas extra');
        expect(md).toContain('12/09/2026 $6,600 nómina a #1');
        expect(md).toContain('2 posibles registros repetidos');
        expect(md).toContain('| #300 | Muy alto | $2,200 |');
        expect(md).toContain('### Por periodo de nómina');
        expect(md).toContain('## 8. Qué pedirle a la IA');
        // La nómina del 03/10 ya pasó sin descuentos registrados.
        expect(md).not.toContain('La nómina del 12/09/2026 (periodo');
    });

    test('periodos sin asistencia de nadie se marcan como falta de datos, y avisa la nómina sin descuentos', () => {
        const employees = obra();
        employees[0].loans.push(Object.assign(createLoan(employees[0], { principal: 1000, interestRate: 20, startDate: '2026-09-20' }), { number: 3, dueDate: '2026-10-03' }));
        const earnings = new Map([['emp-interno-77', [
            { label: '31/07–20/08', start: '2026-07-31', end: '2026-08-20', gross: 0, expected: 12000, days: 0, regularHours: 0, overtimeHours: 0, deducted: 0 },
            { label: '21/08–10/09', start: '2026-08-21', end: '2026-09-10', gross: 9000, expected: 12000, days: 15, regularHours: 120, overtimeHours: 0, deducted: 6600 }
        ]]]);
        const md = buildAiReport({ today: '2026-10-06', payPeriod: PAY, employees, summary: computePortfolioSummary(employees), earnings });
        expect(md).toContain('No hay asistencia guardada en la app antes del 21/08/2026');
        expect(md).toContain('sin datos de asistencia en la app');
        expect(md).toContain('La nómina del 03/10/2026 (periodo 11/09/2026 – 01/10/2026) ya pasó y no tiene ningún descuento');
    });
});
