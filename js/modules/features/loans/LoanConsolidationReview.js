/**
 * 🔎 LoanConsolidationReview — revisar que las consolidaciones se deshicieron
 * bien y reparar las que dejó mal la versión anterior (decisión 2026-10-06).
 *
 * Monto real: al deshacer una consolidación se guarda una copia de cómo
 * estaban sus préstamos (consolidationUndone.snapshot). Con esas copias se
 * vuelven a armar las consolidaciones sobre una copia del empleado (sin
 * guardar nada) y se suma lo que se debía. Los abonos hechos después siguen
 * contando. Ese monto debe ser igual al saldo de hoy con los préstamos
 * separados; si no, la deuda quedó contada dos veces (o hay otro problema).
 *
 * Reparar = deshacer, en el orden correcto, la consolidación de adentro que
 * quedó abierta. Solo se guarda si el saldo queda igual al monto real.
 */

import { round2 } from './LoansService.js';
import { getAccountSummary, getLoanNumbers } from './LoanAccount.js';
import {
    isUndoneConsolidation,
    isDamagedConsolidation,
    isRepairedConsolidation,
    findConsolidations,
    consolidationUndoOrder,
    undoConsolidation
} from './LoanConsolidationUndo.js';

export const REVIEW_STATUS = {
    OK: 'ok',
    DAMAGED: 'damaged',
    REPAIRED: 'repaired',
    PENDING: 'pending',
    MISMATCH: 'mismatch'
};

/** Tope de seguridad: ninguna cuenta real tiene tantas consolidaciones una dentro de otra. */
const MAX_STEPS = 50;
const TOLERANCE = 0.01;
const clone = value => JSON.parse(JSON.stringify(value));
const isConsolidation = loan => Array.isArray(loan?.consolidatedFromLoanIds) && loan.consolidatedFromLoanIds.length > 0;
const balanceOf = emp => round2(getAccountSummary(emp).balance);

/** Vuelve a armar una consolidación deshecha con su copia (muta la copia del empleado). */
function rebuildOne(emp, cons) {
    const saved = new Map(cons.consolidationUndone.snapshot.map(loan => [String(loan.id), loan]));
    for (const loan of emp.loans || []) {
        const old = saved.get(String(loan.id));
        if (!old) continue;
        for (const item of [...(loan.payments || []), ...(loan.refinancings || [])]) {
            if (String(item.convertedFrom?.loanId ?? '') === String(cons.id) && !item.voided) {
                item.voided = true;
                item.voidReason = 'consolidation-review';
            }
            if (loan.id === cons.id && item.voidReason === 'consolidation-undone') {
                item.voided = false;
                item.voidReason = null;
            }
        }
        for (const key of ['status', 'closedAt', 'consolidatedIntoLoanId']) {
            if (old[key] === undefined) delete loan[key]; else loan[key] = old[key];
        }
        loan.consolidationUndone = old.consolidationUndone ?? null;
    }
}

/**
 * Siguiente consolidación a volver a armar: la de adentro primero. Si la de
 * afuera tiene copia y la de adentro también, la de adentro se deshizo después.
 */
function nextToRebuild(emp) {
    const undone = (emp.loans || []).filter(isUndoneConsolidation);
    if (!undone.length) return null;
    const ids = new Set(undone.map(loan => String(loan.id)));
    const inner = undone.filter(loan => !loan.consolidationUndone.sourceIds.some(id => ids.has(String(id)) && String(id) !== String(loan.id)));
    const pool = inner.length ? inner : undone;
    return pool.sort((a, b) => (Number(b.consolidationUndone.at) || 0) - (Number(a.consolidationUndone.at) || 0))[0];
}

/** Copia del empleado con las consolidaciones armadas como estaban antes de deshacerlas. */
export function rebuildConsolidatedEmployee(emp) {
    const copy = clone(emp);
    for (let step = 0; step < MAX_STEPS; step++) {
        const cons = nextToRebuild(copy);
        if (!cons) return { employee: copy, complete: true };
        rebuildOne(copy, cons);
    }
    return { employee: copy, complete: false };
}

/** Deshace en el orden correcto todo lo que quedó por deshacer (muta emp). */
function undoRemaining(emp, options) {
    let rounds = 0;
    while (rounds < MAX_STEPS) {
        const order = consolidationUndoOrder(emp);
        if (!order.length) break;
        for (const item of order) undoConsolidation(emp, item.loan.id, options);
        rounds++;
    }
    return rounds;
}

/** Árbol de consolidaciones (la de afuera arriba) con números de préstamo. */
function consolidationTree(emp) {
    const loans = emp.loans || [];
    const numbers = getLoanNumbers(loans);
    const byId = new Map(loans.map(loan => [String(loan.id), loan]));
    const node = (loan, depth) => ({
        id: loan.id,
        number: numbers.get(loan.id) ?? null,
        startDate: loan.startDate || null,
        principal: round2(Number(loan.principal) || 0),
        isConsolidation: isConsolidation(loan),
        undone: isUndoneConsolidation(loan),
        damaged: isDamagedConsolidation(emp, loan),
        repaired: isRepairedConsolidation(loan),
        children: isConsolidation(loan) && depth < MAX_STEPS
            ? loan.consolidatedFromLoanIds.map(id => byId.get(String(id))).filter(Boolean).map(child => node(child, depth + 1))
            : []
    });
    const nested = new Set(loans.filter(isConsolidation).flatMap(loan => loan.consolidatedFromLoanIds.map(String)));
    return loans.filter(loan => isConsolidation(loan) && !nested.has(String(loan.id))).map(loan => node(loan, 0));
}

function depthOf(nodes) {
    return nodes.reduce((max, n) => Math.max(max, n.isConsolidation ? 1 + depthOf(n.children) : 0), 0);
}

const paidTotal = emp => round2((emp.loans || []).flatMap(loan => loan.payments || [])
    .filter(p => !p.voided).reduce((sum, p) => sum + (Number(p.amount) || 0), 0));

/** Revisión de un empleado (null si no tiene consolidaciones). No modifica nada. */
export function reviewEmployeeConsolidations(emp) {
    const loans = emp?.loans || [];
    const consolidations = loans.filter(isConsolidation);
    if (!consolidations.length) return null;
    const rebuilt = rebuildConsolidatedEmployee(emp);
    const real = balanceOf(rebuilt.employee);
    const today = balanceOf(emp);
    const damaged = consolidations.filter(loan => isDamagedConsolidation(emp, loan));
    const pending = findConsolidations(emp).filter(item => !isDamagedConsolidation(emp, item.loan));
    let afterRepair = null;
    let repairError = null;
    if (damaged.length) {
        try {
            const copy = clone(emp);
            undoRemaining(copy, { at: 0, projectScope: { enabled: false } });
            afterRepair = balanceOf(copy);
        } catch (error) {
            repairError = error.message;
        }
    }
    const diff = round2(today - real);
    const matches = Math.abs(diff) < TOLERANCE;
    let status;
    if (damaged.length) status = REVIEW_STATUS.DAMAGED;
    else if (!rebuilt.complete || !matches) status = REVIEW_STATUS.MISMATCH;
    else if (pending.length) status = REVIEW_STATUS.PENDING;
    else if (consolidations.some(isRepairedConsolidation)) status = REVIEW_STATUS.REPAIRED;
    else status = REVIEW_STATUS.OK;
    const tree = consolidationTree(emp);
    const numbers = getLoanNumbers(loans);
    // Préstamos contados dos veces: la de adentro abierta con sus préstamos ya reabiertos.
    const doubled = damaged.map(loan => ({ id: loan.id, number: numbers.get(loan.id) ?? null, balance: round2(getAccountSummary({ ...emp, loans: [loan] }).balance) }));
    return {
        employeeId: emp.id,
        number: emp.number ?? null,
        status,
        count: consolidations.length,
        levels: depthOf(tree),
        tree,
        real,
        today,
        diff,
        paid: paidTotal(emp),
        doubled,
        pending: pending.length,
        afterRepair,
        canRepair: Boolean(damaged.length) && afterRepair != null && Math.abs(afterRepair - real) < TOLERANCE,
        repairError
    };
}

/** Revisión de todos los empleados con consolidaciones. */
export function reviewConsolidations(employees = []) {
    const items = employees.map(reviewEmployeeConsolidations).filter(Boolean);
    const count = status => items.filter(item => item.status === status).length;
    return {
        items,
        stats: {
            employees: items.length,
            ok: count(REVIEW_STATUS.OK),
            damaged: count(REVIEW_STATUS.DAMAGED),
            mismatch: count(REVIEW_STATUS.MISMATCH),
            repaired: count(REVIEW_STATUS.REPAIRED),
            pending: count(REVIEW_STATUS.PENDING)
        }
    };
}

/**
 * Repara un empleado: deshace en orden lo que quedó abierto. Trabaja sobre una
 * copia y solo cambia el empleado si el saldo queda igual al monto real.
 * @returns {{ before, after, real, repaired }}
 */
export function repairEmployeeConsolidations(emp, { by = null, at = Date.now(), projectScope = null } = {}) {
    const review = reviewEmployeeConsolidations(emp);
    if (!review || review.status !== REVIEW_STATUS.DAMAGED) throw new Error('Esta cuenta no tiene consolidaciones dañadas');
    const copy = clone(emp);
    const before = balanceOf(copy);
    const damagedIds = (copy.loans || []).filter(loan => isDamagedConsolidation(copy, loan)).map(loan => loan.id);
    undoRemaining(copy, { by, at, projectScope });
    const after = balanceOf(copy);
    if (Math.abs(after - review.real) >= TOLERANCE) {
        throw new Error(`La reparación no cuadra (quedaría ${after.toFixed(2)} y el monto real es ${review.real.toFixed(2)}); no se cambió nada.`);
    }
    emp.loans = copy.loans;
    emp.updatedAt = at;
    return { before, after, real: review.real, repaired: damagedIds };
}
