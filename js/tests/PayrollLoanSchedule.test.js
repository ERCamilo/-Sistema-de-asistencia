/**
 * Programar préstamos para una nómina determinada (2026-11-16).
 *
 * - Pago único: `loan.dueDate` (día de pago de la nómina elegida al
 *   registrarlo) ya existía, pero Nómina lo ignoraba y preseleccionaba todo.
 * - Cuotas: nuevo `firstDueDate` = nómina de la primera cuota; las demás
 *   siguen cada N semanas.
 * Un préstamo programado para una nómina posterior sigue visible en Nómina,
 * pero NO se marca solo; se puede marcar a mano para adelantar el cobro.
 */
import {
    createLoan,
    generateInstallmentSchedule,
    INSTALLMENT_MODE
} from '../modules/features/loans/LoansService.js';
import {
    buildPayrollLoanSelection,
    getEligiblePayrollLoans,
    getDuePayrollLoans,
    isScheduledAfterPayroll,
    resolvePayrollLoanSelection
} from '../modules/features/payroll/PayrollLoans.js';

// Nómina quincenal 2026-08-01 – 2026-08-15, se paga el 17/08.
const PERIOD = { start: '2026-08-01', end: '2026-08-15' };
const THIS_PAYDAY = '2026-08-17';
const NEXT_PAYDAY = '2026-09-01';

function employee() {
    return { id: 'emp-1', number: '1', name: 'Ana', loans: [], updatedAt: 1 };
}

function lump(emp, dueDate) {
    const loan = createLoan(emp, { principal: 300, interestRate: 0, startDate: '2026-08-05', concept: 'Botas' });
    if (dueDate) loan.dueDate = dueDate;
    return loan;
}

describe('isScheduledAfterPayroll', () => {
    test('el día de pago de esta nómina (aunque sea después del fin del período) no es posterior', () => {
        expect(isScheduledAfterPayroll(THIS_PAYDAY, PERIOD.start, PERIOD.end)).toBe(false);
        expect(isScheduledAfterPayroll('2026-08-10', PERIOD.start, PERIOD.end)).toBe(false);
    });
    test('el día de pago de la nómina siguiente sí es posterior', () => {
        expect(isScheduledAfterPayroll(NEXT_PAYDAY, PERIOD.start, PERIOD.end)).toBe(true);
        expect(isScheduledAfterPayroll('2026-08-30', PERIOD.start, PERIOD.end)).toBe(true);
    });
    test('sin fecha programada nunca es posterior', () => {
        expect(isScheduledAfterPayroll(null, PERIOD.start, PERIOD.end)).toBe(false);
    });
});

describe('Préstamos de pago único programados', () => {
    test('programado para la nómina siguiente: visible, sin preseleccionar', () => {
        const emp = employee();
        lump(emp, NEXT_PAYDAY);
        const [loan] = getEligiblePayrollLoans(emp, PERIOD.end, PERIOD.start);
        expect(loan).toMatchObject({ scheduledPayDate: NEXT_PAYDAY, scheduledLater: true, defaultChargeCount: 0 });
        expect(buildPayrollLoanSelection([emp], PERIOD.end, PERIOD.start)).toEqual([]);
        expect(getDuePayrollLoans(emp, PERIOD.end, PERIOD.start)).toEqual([]);
    });

    test('programado para esta nómina o sin programar: se preselecciona como siempre', () => {
        const emp = employee();
        const due = lump(emp, THIS_PAYDAY);
        const free = lump(emp, null);
        const selection = buildPayrollLoanSelection([emp], PERIOD.end, PERIOD.start);
        expect(selection[0].loanIds.sort()).toEqual([due.id, free.id].sort());
    });

    test('se puede adelantar a mano: marcarlo lo cobra en esta nómina', () => {
        const emp = employee();
        const loan = lump(emp, NEXT_PAYDAY);
        const resolved = resolvePayrollLoanSelection(
            [emp],
            [{ employeeId: emp.id, loans: [{ loanId: loan.id, chargeCount: 1 }], loanIds: [loan.id] }],
            PERIOD.end
        );
        expect(resolved[0].total).toBe(300);
    });

    test('al llegar su nómina se preselecciona', () => {
        const emp = employee();
        lump(emp, NEXT_PAYDAY);
        const selection = buildPayrollLoanSelection([emp], '2026-08-31', '2026-08-16');
        expect(selection).toHaveLength(1);
    });
});

describe('Préstamos en cuotas con primera cuota programada', () => {
    test('generateInstallmentSchedule arranca en firstDueDate y sigue cada N semanas', () => {
        const schedule = generateInstallmentSchedule({
            principal: 400, interestRate: 0, interestIncluded: false,
            startDate: '2026-08-05', count: 4, frequencyWeeks: 2, firstDueDate: NEXT_PAYDAY
        });
        expect(schedule.map(i => i.dueDate)).toEqual(['2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13']);
    });

    test('sin firstDueDate el calendario no cambia', () => {
        const schedule = generateInstallmentSchedule({
            principal: 400, interestRate: 0, interestIncluded: false,
            startDate: '2026-08-05', count: 2, frequencyWeeks: 2
        });
        expect(schedule.map(i => i.dueDate)).toEqual(['2026-08-19', '2026-09-02']);
    });

    test('createLoan guarda firstDueDate y Nómina no marca la primera cuota antes de tiempo', () => {
        const emp = employee();
        const loan = createLoan(emp, {
            principal: 400, interestRate: 0, startDate: '2026-08-05', concept: 'Equipo',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS, installmentCount: 4,
            installmentFrequencyWeeks: 2, firstDueDate: NEXT_PAYDAY
        });
        expect(loan.firstDueDate).toBe(NEXT_PAYDAY);
        expect(loan.installments[0].dueDate).toBe(NEXT_PAYDAY);
        const [eligible] = getEligiblePayrollLoans(emp, PERIOD.end, PERIOD.start);
        expect(eligible).toMatchObject({ scheduledLater: true, defaultChargeCount: 0, scheduledPayDate: NEXT_PAYDAY });
        // En la nómina de su primera cuota sí se marca.
        expect(buildPayrollLoanSelection([emp], '2026-08-31', '2026-08-16')).toHaveLength(1);
    });

    test('las cuotas sin primera cuota programada mantienen el comportamiento anterior', () => {
        const emp = employee();
        createLoan(emp, {
            principal: 400, interestRate: 0, startDate: '2026-08-05', concept: 'Equipo',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS, installmentCount: 4, installmentFrequencyWeeks: 4
        });
        expect(buildPayrollLoanSelection([emp], PERIOD.end, PERIOD.start)).toHaveLength(1);
    });
});

describe('Nómina muestra los préstamos programados', () => {
    test('la fila del préstamo indica la nómina programada y queda sin marcar', async () => {
        const { renderPayrollLoansDesktop } = await import('../modules/features/payroll/PayrollLoansDesktop.js');
        const emp = employee();
        lump(emp, NEXT_PAYDAY);
        const html = renderPayrollLoansDesktop({
            employees: [emp],
            selection: buildPayrollLoanSelection([emp], PERIOD.end, PERIOD.start),
            payrollRows: [],
            expandedEmployeeIds: [emp.id],
            periodEnd: PERIOD.end,
            periodStart: PERIOD.start
        });
        expect(html).toContain('payroll-loan-child__scheduled');
        expect(html).toMatch(/Programado · nómina del/);
    });
});

describe('Editar un préstamo en cuotas conserva su programación', () => {
    test('cambiar el monto recalcula las cuotas desde la primera nómina programada', async () => {
        const { editLoan } = await import('../modules/features/loans/LoanAccount.js');
        const emp = employee();
        const loan = createLoan(emp, {
            principal: 400, interestRate: 0, startDate: '2026-08-05', concept: 'Equipo',
            installmentMode: INSTALLMENT_MODE.INSTALLMENTS, installmentCount: 2,
            installmentFrequencyWeeks: 2, firstDueDate: NEXT_PAYDAY
        });
        editLoan(emp, loan.id, { principal: 600 }, { reason: 'corrección' });
        expect(loan.installments.map(i => i.dueDate)).toEqual(['2026-09-01', '2026-09-15']);
        expect(loan.installments.reduce((t, i) => t + i.scheduledAmount, 0)).toBe(600);
    });
});
