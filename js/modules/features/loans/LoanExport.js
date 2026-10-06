/**
 * 📤 LoanExport — datos para exportar Préstamos a Excel o PDF (maqueta «Exportar»).
 *
 * Rango: un mes, un periodo de nómina o fechas a elección. Se exporta la obra
 * activa, leída igual que la pantalla principal (interés primero, sin anulados
 * salvo que se pidan, consolidaciones deshechas).
 *
 * Partes (cada una es una hoja del Excel o una sección del PDF):
 *   resumen      cómo cambió el saldo en el rango y las 4 cifras de la cartera hoy
 *   empleados    una fila por empleado con préstamos
 *   prestamos    una fila por préstamo
 *   movimientos  préstamos, abonos, refinanciamientos y cierres dentro del rango
 *   historial    saldo día por día (Excel) / saldo y movimientos por periodo (PDF)
 *
 * Funciones puras: no leen ni escriben estado global (la descarga está en LoanExportPanel).
 */

import { LOAN_STATUS, round2, getActiveLoanTerms, getPaidAmount } from './LoansService.js';
import { replayLoan, buildTimeline } from './LoanTimeline.js';
import { getAccountSummary } from './LoanAccount.js';
import { buildFlowBuckets, computeLoanFlows } from './LoanFlowChart.js';
import { buildPayPeriods } from './LoanPayPeriods.js';
import { computePortfolioSummary } from './LoanPortfolio.js';

export const EXPORT_PARTS = Object.freeze(['resumen', 'empleados', 'prestamos', 'movimientos', 'historial']);
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dmy = key => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : '');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const KIND_LABEL = { loan: 'Préstamo', payment: 'Abono', refinancing: 'Refinanciamiento', adjustment: 'Ajuste de nómina cerrada', settled: 'Cerrado con saldo', writeoff: 'Anulado' };

/** Meses con movimientos (más el actual), del más reciente al más viejo: 'YYYY-MM'. */
export function exportMonths(employees = [], today) {
    const set = new Set([today.slice(0, 7)]);
    for (const emp of employees) for (const loan of emp.loans || []) {
        if (loan.startDate) set.add(loan.startDate.slice(0, 7));
        for (const p of loan.payments || []) if (!p.voided && ISO.test(String(p.date || ''))) set.add(p.date.slice(0, 7));
    }
    return [...set].sort().reverse();
}

/** Periodos de nómina desde el primer préstamo hasta el actual, del más reciente al más viejo. */
export function exportPeriods(employees = [], payPeriod, today) {
    const first = employees.flatMap(emp => (emp.loans || []).map(l => l.startDate)).filter(d => ISO.test(String(d || ''))).sort()[0] || today;
    return buildFlowBuckets('period', { from: first, to: today, payPeriod }).reverse();
}

/**
 * Rango elegido → { from, to, label }.
 * @param {{range:'month'|'period'|'custom', month?, period?, from?, to?}} choice
 */
export function resolveExportRange(choice = {}, { payPeriod = null, today } = {}) {
    if (choice.range === 'period') {
        const periods = buildPayPeriods(payPeriod, today, { before: 30, after: 0 });
        const key = choice.period || '';
        const p = periods.find(x => `${x.start}|${x.end}` === key) || periods.find(x => x.start <= today && today <= x.end) || periods.at(-1);
        if (p) return { from: p.start, to: p.end < today ? p.end : today, label: `periodo ${dmy(p.start)} – ${dmy(p.end)}`, file: `periodo ${p.start} a ${p.end}` };
    }
    if (choice.range === 'custom') {
        let from = ISO.test(String(choice.from || '')) ? choice.from : `${today.slice(0, 7)}-01`;
        let to = ISO.test(String(choice.to || '')) ? choice.to : today;
        if (from > to) [from, to] = [to, from];
        return { from, to, label: `del ${dmy(from)} al ${dmy(to)}`, file: `${from} a ${to}` };
    }
    const ym = /^\d{4}-\d{2}$/.test(String(choice.month || '')) ? choice.month : today.slice(0, 7);
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    const end = lastDay(y, m);
    return { from: `${ym}-01`, to: end < today ? end : today, label: `${MONTHS_LONG[m - 1]} ${y}`, file: `${MONTHS_LONG[m - 1]} ${y}` };
}

const counted = (loan, includeVoided) => loan && (includeVoided || loan.status !== LOAN_STATUS.WRITTEN_OFF);

/** Cómo cambió el saldo en el rango (vista previa y primera parte del resumen). */
export function exportPreview(employees = [], { from, to }) {
    const loans = employees.flatMap(emp => emp.loans || []);
    const bucket = { key: 'r', start: from, end: to };
    const o = computeLoanFlows(loans, [bucket]).get('r');
    let nPays = 0;
    let nRefi = 0;
    for (const loan of loans) {
        if (!counted(loan, false)) continue;
        for (const s of replayLoan(loan).steps) {
            if (s.date < from || s.date > to) continue;
            if (s.kind === 'payment') nPays++;
            if (s.kind === 'refinancing') nRefi++;
        }
    }
    const paid = round2(o.payInt + o.payCap);
    return {
        start: o.open, newLoans: round2(o.newCap + o.newInt), newCapital: o.newCap, newInterest: o.newInt, nLoans: o.nNew,
        refi: round2(o.refiInt + o.adjustUp), nRefi, paid, paidInterest: o.payInt, paidCapital: o.payCap, nPays,
        closed: round2(o.gift + o.adjustDown), end: o.end, excess: o.excess,
        any: o.nNew + nPays + nRefi > 0 || o.gift + o.adjustDown + o.adjustUp > 0.004
    };
}

function paymentOrigin(loan, id) {
    const p = (loan.payments || []).find(x => x.id === id);
    if (!p) return '';
    return p.origin === 'payroll' || p.source === 'payroll' || p.payrollClosureId ? 'Nómina' : 'Directo';
}

/**
 * Todas las partes como filas (la primera fila de cada tabla es el encabezado).
 * @returns {{ range, preview, summary, sheets: Record<string, Array<Array<string|number>>> }}
 */
export function buildLoanExport(employees = [], { range, includeVoided = false, today, projectName = '', payPeriod = null } = {}) {
    const { from, to } = range;
    const preview = exportPreview(employees, range);
    const summary = computePortfolioSummary(employees);
    const sheets = {};

    sheets.resumen = [
        ['Préstamos', projectName || ''],
        ['Rango', range.label],
        ['Emitido', dmy(today)],
        [],
        ['Cómo cambió el saldo', 'Monto'],
        ['Saldo al empezar', preview.start],
        [`+ Préstamos nuevos (${preview.nLoans}) con su interés`, preview.newLoans],
        ['    capital', preview.newCapital],
        ['    interés', preview.newInterest],
        [`+ Refinanciamientos (${preview.nRefi})`, preview.refi],
        [`− Abonos aplicados a la deuda (${preview.nPays})`, preview.paid],
        ['    a interés', preview.paidInterest],
        ['    a capital', preview.paidCapital],
        ['− Cerrados o ajustes', preview.closed],
        ['Saldo al terminar', preview.end],
        ['Pagado de más en el rango (posible error)', preview.excess],
        [],
        [`Cartera al ${dmy(today)}`, 'Monto'],
        ['Por cobrar', summary.porCobrar.total],
        ['    capital', summary.porCobrar.capital],
        ['    interés', summary.porCobrar.interest],
        ['Interés ganado', summary.interesGanado.collected],
        ['Interés total (ganado + por cobrar)', summary.interesGanado.total],
        ['Cobrado', summary.cobrado.total],
        ['    descontado en nómina', summary.cobrado.payroll],
        ['    abonado directamente', summary.cobrado.direct],
        ['Prestado', summary.prestado.total],
        ['    ya devuelto', summary.prestado.returned]
    ];

    const empRows = [['Nº', 'Empleado', 'Estado', 'Préstamos abiertos', 'Capital', 'Interés', 'Saldo', 'Prestado en el rango', 'Cobrado en el rango', 'Último movimiento']];
    const loanRows = [['Nº', 'Empleado', 'Préstamo', 'Fecha', 'Capital', 'Tasa %', 'Interés inicial', 'Refinanciamientos', 'Interés por refinanciar', 'Pagado', 'Saldo', 'Nómina de cobro', 'Estado']];
    const movRows = [['Fecha', 'Nº', 'Empleado', 'Préstamo', 'Movimiento', 'Monto', 'Capital', 'Interés', 'Origen']];
    for (const emp of employees) {
        const loans = (emp.loans || []).filter(l => counted(l, includeVoided));
        if (!loans.length) continue;
        const acc = getAccountSummary(emp);
        let lentIn = 0;
        let paidIn = 0;
        let last = '';
        for (const loan of loans) {
            const voided = loan.status === LOAN_STATUS.WRITTEN_OFF;
            const terms = getActiveLoanTerms({ ...loan, refinancings: [] });
            const refis = (loan.refinancings || []).filter(r => !r.voided && !r.adjustment);
            const steps = voided ? [] : replayLoan(loan).steps;
            const lastStep = steps.at(-1);
            loanRows.push([
                emp.number ?? '', emp.name || '', loan.number ? `#${loan.number}` : (loan.concept || ''), dmy(loan.startDate),
                round2(Number(terms.principal || 0)), Number(terms.interestRate || 0),
                terms.interestIncluded ? 0 : round2(terms.principal * terms.interestRate / 100),
                refis.length, round2(refis.reduce((t, r) => t + Number(r.interestAmount || 0), 0)),
                getPaidAmount(loan), voided ? 0 : round2(lastStep ? lastStep.capitalAfter + lastStep.interestAfter : 0),
                dmy(loan.dueDate), voided ? 'Anulado' : loan.status === LOAN_STATUS.ACTIVE ? 'Abierto' : 'Saldado'
            ]);
            for (const s of steps) {
                if (s.date > last) last = s.date;
                if (s.date < from || s.date > to) continue;
                const value = round2(s.delta.capital + s.delta.interest);
                if (s.kind === 'loan') lentIn += value;
                if (s.kind === 'payment') paidIn += -value;
                const amount = s.kind === 'payment' ? round2(-value + (s.excess || 0)) : Math.abs(value);
                movRows.push([
                    dmy(s.date), emp.number ?? '', emp.name || '', loan.number ? `#${loan.number}` : '', KIND_LABEL[s.kind] || s.kind,
                    amount, round2(Math.abs(s.delta.capital)), round2(Math.abs(s.delta.interest)),
                    s.kind === 'payment' ? paymentOrigin(loan, s.id) : ''
                ]);
            }
        }
        empRows.push([emp.number ?? '', emp.name || '', emp.active === false ? 'Inactivo' : 'Activo', acc.count, acc.capital, acc.interest, acc.balance, round2(lentIn), round2(paidIn), dmy(last)]);
    }
    const dateOf = row => (row[0] ? row[0].split('/').reverse().join('-') : '');
    movRows.splice(1, movRows.length - 1, ...movRows.slice(1).sort((a, b) => dateOf(a).localeCompare(dateOf(b))));
    empRows.splice(1, empRows.length - 1, ...empRows.slice(1).sort((a, b) => b[6] - a[6]));
    sheets.empleados = empRows;
    sheets.prestamos = loanRows;
    sheets.movimientos = movRows;

    // Historial: saldo día por día (con el día anterior al rango como punto de partida).
    const timeline = buildTimeline(employees.flatMap(emp => (emp.loans || []).filter(l => counted(l, false)).map(loan => ({ employeeId: emp.id, loan }))));
    const before = timeline.days.filter(d => d.date < from).at(-1);
    sheets.historial = [['Fecha', 'Capital', 'Interés', 'Saldo'],
        ...(before ? [[`${dmy(before.date)} (antes del rango)`, before.capital, before.interest, before.result]] : []),
        ...timeline.days.filter(d => d.date >= from && d.date <= to).map(d => [dmy(d.date), d.capital, d.interest, d.result])];

    // Por periodo (PDF): lo que venía, lo nuevo, lo cobrado y el saldo al cerrar.
    let periods = [];
    if (Number(payPeriod?.periodLength) > 0) {
        const buckets = buildFlowBuckets('period', { from, to, payPeriod });
        const flows = computeLoanFlows(employees.flatMap(emp => emp.loans || []), buckets);
        periods = buckets.map(b => {
            const o = flows.get(b.key);
            return { label: b.label, open: o.open, lent: round2(o.newCap + o.newInt), refi: round2(o.refiInt + o.adjustUp), paid: round2(o.payInt + o.payCap), end: o.end };
        });
    }
    return { range, preview, summary, sheets, periods };
}
