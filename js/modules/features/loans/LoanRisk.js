/**
 * ⚠️ LoanRisk — empleados en riesgo (Avisos de la pantalla de Préstamos).
 *
 * Reglas acordadas (maqueta, 2026-10-04):
 *   - Se compara lo que debe con lo que gana en un periodo (la nómina de donde
 *     se descuenta).
 *   - Muy alto: inactivo con deuda, debe un sueldo o más, o le falta de
 *     periodos anteriores la mitad de su sueldo o más.
 *   - Alto: debe 60 % o más, le falta de antes 25 % o más, o no pagó nada en
 *     el periodo y lo atrasado no bajó.
 *   - Moderado: debe 35 % o más, o le queda algo de periodos anteriores.
 *   - Baja un nivel si viene pagando y lo atrasado baja (salvo que deba un
 *     sueldo o más, o esté inactivo). Refinanciamientos y préstamos pequeños
 *     solo son contexto.
 *
 * «Lo atrasado» = saldo de los préstamos cuya nómina de cobro ORIGINAL ya pasó
 * (más el margen de 3 días): un refinanciamiento mueve el cobro pero no quita
 * el atraso. Sueldo: lo que gana en el periodo actual proyectado al
 * periodo completo si ya lleva 7 días o más; si no, el promedio de los 2
 * periodos anteriores; si no hay asistencia, el sueldo configurado.
 */

import { LOAN_STATUS, round2, getEmployeePeriodSalary } from './LoansService.js';
import { replayLoan } from './LoanTimeline.js';
import { getAccountSummary, getLoanDueDate, VENCIDO_GRACE_DAYS } from './LoanAccount.js';
import { formatCurrency } from '../../utils/Formatters.js';

export const RISK_LEVELS = Object.freeze({ 3: 'Muy alto', 2: 'Alto', 1: 'Moderado' });
const DAY = 86_400_000;
const toTime = key => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const daysBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY);
const M = v => '$' + Math.round(Number(v || 0)).toLocaleString('en-US');
const PCT = v => `${Math.round(v * 100)} %`;
const dmy = key => `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
const pl = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;

/** Sueldo de referencia del empleado (ver encabezado). */
export function referenceSalary({ gCur = 0, curDays = 0, length = 21, g1 = 0, g2 = 0, configured = 0 } = {}) {
    if (gCur > 0 && curDays >= 7) return { value: gCur * length / curDays, source: 'lo que gana en este periodo, proyectado' };
    const prev = [g1, g2].filter(v => v > 0);
    if (prev.length) return { value: prev.reduce((a, b) => a + b, 0) / prev.length, source: prev.length === 2 ? 'promedio de los 2 periodos anteriores' : 'lo que ganó en el periodo anterior' };
    if (configured > 0) return { value: configured, source: 'sueldo configurado (sin asistencia reciente)' };
    return null;
}

/**
 * Datos de riesgo de un empleado.
 * @param {object} emp
 * @param {{ today, periods, grossOf(emp, start, end), state }} ctx  periods = nóminas (LoanPayPeriods)
 */
export function buildRiskInput(emp, { today, periods = [], grossOf = () => 0, state = null } = {}) {
    const summary = getAccountSummary(emp);
    if (!(summary.balance > 0.004)) return null;
    const current = periods.find(p => p.start <= today && today <= p.end) || null;
    const index = current ? periods.indexOf(current) : -1;
    const prev1 = index > 0 ? periods[index - 1] : null;
    const prev2 = index > 1 ? periods[index - 2] : null;
    // Atrasado = debía cobrarse en una nómina que ya pasó (más el margen), con la nómina
    // de cobro ORIGINAL: refinanciar mueve el cobro, pero el préstamo sigue atrasado.
    const overdue = summary.loans.filter(item => {
        const due = item.loan.dueDate || getLoanDueDate(item.loan);
        return due && daysBetween(due, today) > VENCIDO_GRACE_DAYS;
    });
    const oldDebt = round2(overdue.reduce((t, item) => t + item.balance, 0));
    const startCur = current ? current.start : today;
    const balAt = (loan, beforeDate) => {
        const steps = replayLoan(loan).steps.filter(s => s.date < beforeDate);
        return steps.length ? steps.at(-1).capitalAfter + steps.at(-1).interestAfter : 0;
    };
    // Lo que venía de periodos anteriores al empezar este (incluye préstamos que se saldaron después).
    const balStartCur = round2((emp.loans || [])
        .filter(loan => loan.status !== LOAN_STATUS.WRITTEN_OFF && loan.startDate && loan.startDate < startCur)
        .reduce((t, loan) => t + balAt(loan, startCur), 0));
    let paidCur = 0;
    let totRefi = 0;
    let refiInt = 0;
    for (const loan of emp.loans || []) {
        if (loan.status === LOAN_STATUS.WRITTEN_OFF) continue;
        for (const step of replayLoan(loan).steps) {
            if (step.kind === 'payment' && step.date >= startCur && step.date <= today) paidCur += -(step.delta.capital + step.delta.interest);
        }
        if (loan.status === LOAN_STATUS.ACTIVE) {
            for (const r of loan.refinancings || []) if (!r.voided && !r.adjustment) { totRefi++; refiInt += Number(r.interestAmount || 0); }
        }
    }
    const oldest = (overdue.length ? overdue : summary.loans).map(item => item.loan.startDate).filter(Boolean).sort()[0] || today;
    return {
        emp, active: emp.active !== false, bal: summary.balance, nOpen: summary.count, oldDebt, balStartCur,
        paidCur: round2(paidCur), totRefi, refiInt: round2(refiInt), oldest, oldestDays: daysBetween(oldest, today),
        gCur: current ? grossOf(emp, current.start, today) : 0, curDays: current ? daysBetween(current.start, today) + 1 : 0,
        length: current ? daysBetween(current.start, current.end) + 1 : 21,
        g1: prev1 ? grossOf(emp, prev1.start, prev1.end) : 0, g2: prev2 ? grossOf(emp, prev2.start, prev2.end) : 0,
        configured: state ? getEmployeePeriodSalary(emp, null, state) : 0
    };
}

/** Clasifica (puerto de la maqueta). Devuelve null si no hay riesgo. */
export function classifyRisk(r) {
    if (!r) return null;
    const s = referenceSalary(r);
    const why = [];
    const ctx = [];
    const reducing = r.oldDebt > 0.004 && r.oldDebt < r.balStartCur - 0.01;
    const paying = r.paidCur > 0.004;
    let lvl = 0;
    const up = (level, text) => { lvl = Math.max(lvl, level); why.push([level, text]); };
    if (!r.active) up(3, `Está inactivo y debe ${M(r.bal)}: ya no cobra nómina, así que no hay de dónde descontarle.`);
    if (s) {
        const carga = r.bal / s.value;
        const atraso = r.oldDebt / s.value;
        if (r.active) {
            if (carga >= 1) up(3, `Debe ${M(r.bal)}, más de lo que gana en un periodo (≈${M(s.value)}): el ${PCT(carga)}.`);
            else if (carga >= 0.6) up(2, `Debe ${M(r.bal)}, el ${PCT(carga)} de lo que gana en un periodo (≈${M(s.value)}).`);
            else if (carga >= 0.35) up(1, `Debe ${M(r.bal)}, el ${PCT(carga)} de lo que gana en un periodo (≈${M(s.value)}).`);
        }
        if (r.oldDebt > 0.004) {
            const text = `Le faltan ${M(r.oldDebt)} de nóminas anteriores (${PCT(atraso)} de su sueldo); su préstamo vencido más viejo es del ${dmy(r.oldest)}.`;
            up(atraso >= 0.5 ? 3 : atraso >= 0.25 ? 2 : 1, text);
        }
    } else if (r.active) {
        ctx.push('No tiene asistencia ni sueldo configurado, así que no se puede medir su deuda contra lo que gana.');
        if (r.oldDebt > 0.004) up(r.oldestDays >= 63 ? 2 : 1, `Le faltan ${M(r.oldDebt)} de nóminas anteriores; su préstamo vencido más viejo es del ${dmy(r.oldest)} (${r.oldestDays} días).`);
    }
    if (r.oldDebt > 0.004 && !reducing && !paying && r.active) up(Math.max(2, lvl), 'No pagó nada en este periodo y lo que debía de antes no bajó.');
    const carga = s ? r.bal / s.value : 0;
    if (lvl > 0 && r.active && reducing && paying && carga < 1) {
        lvl -= 1;
        ctx.push(`Baja un nivel: viene pagando (${M(r.paidCur)} en este periodo) y lo que debía de antes bajó de ${M(r.balStartCur)} a ${M(r.oldDebt)}.`);
    }
    if (r.totRefi) ctx.push(`${pl(r.totRefi, 'refinanciamiento')} (${M(r.refiInt)} de interés extra). Solo pesa si además la deuda no baja.`);
    if (r.nOpen >= 3 && s && carga < 0.35) ctx.push(`Tiene ${pl(r.nOpen, 'préstamo')} abiertos, pero suman poco frente a su sueldo.`);
    if (!lvl) return null;
    const cuota = s ? Math.round(s.value * 0.3 / 100) * 100 : null;
    const n = cuota ? Math.ceil(r.bal / cuota) : null;
    const advice = !r.active
        ? ['Como ya no cobra nómina: contactarlo, acordar fechas de pago y registrar cada abono a mano.', 'Si no se va a cobrar, cerrar el préstamo como «Perdonado» o con una nota, para que deje de contar como «Por cobrar».']
        : lvl === 3 ? ['No darle préstamos nuevos hasta que la deuda baje de la mitad de su sueldo.', cuota ? `Acordar un descuento fijo de ≈${M(cuota)} por nómina (30 % de su sueldo) con «Acuerdo»: saldaría en ${pl(n, 'nómina')}, en vez de refinanciar.` : 'Acordar un descuento fijo por nómina con «Acuerdo» en vez de refinanciar.']
        : lvl === 2 ? [cuota ? `Descontar en la próxima nómina lo que se pueda sin pasar de ≈${M(cuota)} (30 % de su sueldo); el resto con un acuerdo.` : 'Descontar en la próxima nómina y acordar el resto.', 'Antes de otro préstamo, que salde lo que viene de nóminas anteriores.']
        : ['Confirmar que se descuente en la próxima nómina.', 'Si pide más, que el total no pase del 35 % de lo que gana por periodo.'];
    return { ...r, lvl, why: why.sort((a, b) => b[0] - a[0]).map(([, t]) => t), ctx, advice, salary: s };
}

/** Lista ordenada (nivel, saldo) de empleados en riesgo. */
export function computeRiskList(employees = [], ctx = {}) {
    return employees.map(emp => classifyRisk(buildRiskInput(emp, ctx))).filter(Boolean)
        .sort((a, b) => b.lvl - a.lvl || b.bal - a.bal);
}

export { formatCurrency };
