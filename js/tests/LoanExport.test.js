import { createLoan, recordPayment, refinanceLoan, writeOffLoan } from '../modules/features/loans/LoansService.js';
import { resolveExportRange, exportPreview, buildLoanExport, exportMonths, exportPeriods } from '../modules/features/loans/LoanExport.js';

const PAY = { periodStart: '2026-08-21', periodLength: 21, payDay: '2026-09-12' };
let clock = 1_000;

/** #1 $10,000 (abono de 6,600 y refinanciado el 12/09) + #2 $3,000 el 14/09 + uno anulado. */
function obra() {
    const emp = { id: 'e1', number: '012', name: 'Ana', active: true, loans: [], updatedAt: 1 };
    const mk = (principal, startDate) => { const l = createLoan(emp, { principal, interestRate: 20, startDate }); l.createdAt = (clock += 1_000); return l; };
    const a = mk(10000, '2026-08-25');
    a.number = 1;
    recordPayment(emp, a.id, { amount: 6600, date: '2026-09-12', source: 'payroll', recordedAt: (clock += 1_000) });
    refinanceLoan(emp, a.id, { interestRate: 20, basis: 'balance', date: '2026-09-12' });
    Object.assign(a.refinancings[0], { interestAmount: 1080 });
    const b = mk(3000, '2026-09-14');
    b.number = 2;
    const bad = mk(9999, '2026-09-20');
    writeOffLoan(emp, bad.id);
    return emp;
}

describe('Exportar préstamos: rango', () => {
    test('mes, periodo de nómina y personalizado', () => {
        expect(resolveExportRange({ range: 'month', month: '2026-09' }, { today: '2026-10-06' })).toMatchObject({ from: '2026-09-01', to: '2026-09-30', label: 'septiembre 2026' });
        // El mes en curso termina hoy.
        expect(resolveExportRange({ range: 'month', month: '2026-10' }, { today: '2026-10-06' }).to).toBe('2026-10-06');
        expect(resolveExportRange({ range: 'period', period: '2026-08-21|2026-09-10' }, { payPeriod: PAY, today: '2026-10-06' })).toMatchObject({ from: '2026-08-21', to: '2026-09-10', label: 'periodo 21/08/2026 – 10/09/2026' });
        // Fechas al revés se ordenan.
        expect(resolveExportRange({ range: 'custom', from: '2026-09-30', to: '2026-09-01' }, { today: '2026-10-06' })).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    });

    test('listas de meses y periodos para elegir', () => {
        const emp = obra();
        expect(exportMonths([emp], '2026-10-06')).toEqual(['2026-10', '2026-09', '2026-08']);
        expect(exportPeriods([emp], PAY, '2026-10-06').map(p => p.key)).toEqual(['2026-10-02|2026-10-22', '2026-09-11|2026-10-01', '2026-08-21|2026-09-10']);
    });
});

describe('Exportar préstamos: contenido', () => {
    test('la vista previa cuadra: empezar + nuevo + refinanciado − abonado = terminar', () => {
        const emp = obra();
        const p = exportPreview([emp], { from: '2026-09-01', to: '2026-09-30' });
        expect(p).toMatchObject({ start: 12000, newLoans: 3600, nLoans: 1, refi: 1080, nRefi: 1, paid: 6600, nPays: 1 });
        expect(p.end).toBe(p.start + p.newLoans + p.refi - p.paid - p.closed);
    });

    test('hojas: empleados, préstamos (sin anulados salvo que se pidan), movimientos del rango e historial', () => {
        const emp = obra();
        const range = resolveExportRange({ range: 'month', month: '2026-09' }, { today: '2026-10-06' });
        const out = buildLoanExport([emp], { range, today: '2026-10-06', projectName: 'Obra 1', payPeriod: PAY });
        expect(out.sheets.resumen[0]).toEqual(['Préstamos', 'Obra 1']);
        expect(out.sheets.empleados.length).toBe(2);
        expect(out.sheets.empleados[1]).toEqual(expect.arrayContaining(['012', 'Ana', 'Activo']));
        expect(out.sheets.prestamos.length).toBe(3); // encabezado + 2 (el anulado no)
        const movs = out.sheets.movimientos.slice(1).map(r => [r[0], r[4], r[5], r[8]]);
        expect(movs).toEqual(expect.arrayContaining([['12/09/2026', 'Abono', 6600, 'Nómina'], ['12/09/2026', 'Refinanciamiento', 1080, ''], ['14/09/2026', 'Préstamo', 3600, '']]));
        expect(movs.some(r => r[0] === '25/08/2026')).toBe(false); // fuera del rango
        expect(out.sheets.historial[1][0]).toBe('25/08/2026 (antes del rango)');
        expect(out.sheets.historial.at(-1)[3]).toBe(out.preview.end);
        expect(out.periods.length).toBeGreaterThan(0);
        const withVoided = buildLoanExport([emp], { range, today: '2026-10-06', includeVoided: true });
        expect(withVoided.sheets.prestamos.slice(1).some(r => r.at(-1) === 'Anulado')).toBe(true);
    });
});
