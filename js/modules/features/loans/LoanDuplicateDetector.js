/**
 * 🔍 LoanDuplicateDetector.js (Fase 2, U4)
 *
 * Detector post-merge de posibles préstamos duplicados por creación
 * concurrente: dos dispositivos offline anotan "el mismo" préstamo, cada uno
 * con su UUID, y el merge por unión (EmployeeMerge.unionById) conserva los
 * dos — correcto (nunca fusionar a ciegas dos préstamos: puede perder plata
 * real), pero deja un duplicado visible que alguien tiene que resolver.
 *
 * DOBLE SEÑAL — un par (a, b) es candidato SOLO si:
 *   1. mismo `seq` (ambos finitos — legacy sin seq no genera señal), Y
 *   2. mismo monto (principal, igualdad tras round2) Y fechas de inicio
 *      dentro de `maxDaysApart` días (default 7).
 *
 * La doble señal existe porque el costo de un falso positivo es alto:
 * mismo seq solo = pudo ser creación concurrente LEGÍTIMA de dos préstamos
 * distintos ("son distintos, quedan los dos" — U5 renumera al perdedor);
 * monto+fecha solos = préstamos legítimamente parecidos en secuencia.
 *
 * Este módulo solo DETECTA. La resolución (eliminar uno / son distintos)
 * es el wizard de U5. Los anulados (written-off) no participan: ese
 * conflicto ya fue resuelto por un humano.
 */

import { round2, LOAN_STATUS } from './LoansService.js';

const DEFAULT_MAX_DAYS_APART = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDay(dateStr) {
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const t = new Date(dateStr + 'T00:00:00').getTime();
    return Number.isFinite(t) ? t : null;
}

function isCandidatePair(a, b, maxDaysApart) {
    if (!Number.isFinite(a.seq) || !Number.isFinite(b.seq) || a.seq !== b.seq) return false;
    if (round2(a.principal) !== round2(b.principal)) return false;
    const dayA = parseDay(a.startDate);
    const dayB = parseDay(b.startDate);
    if (dayA === null || dayB === null) return false;
    return Math.abs(dayA - dayB) <= maxDaysApart * MS_PER_DAY;
}

/**
 * @param {object|null} emp - empleado (se leen solo emp.loans)
 * @param {{maxDaysApart?: number}} [opts]
 * @returns {Array<{a: object, b: object, seq: number}>} pares candidatos
 */
export function detectLoanDuplicateCandidates(emp, opts = {}) {
    const maxDaysApart = Number.isFinite(opts?.maxDaysApart) ? opts.maxDaysApart : DEFAULT_MAX_DAYS_APART;
    const loans = (Array.isArray(emp?.loans) ? emp.loans : [])
        .filter(l => l && typeof l === 'object' && l.status !== LOAN_STATUS.WRITTEN_OFF);

    const candidates = [];
    for (let i = 0; i < loans.length; i++) {
        for (let j = i + 1; j < loans.length; j++) {
            if (isCandidatePair(loans[i], loans[j], maxDaysApart)) {
                candidates.push({ a: loans[i], b: loans[j], seq: loans[i].seq });
            }
        }
    }
    return candidates;
}

/**
 * Guard SUAVE al crear (Fase 2, U4): ¿ya existe un préstamo muy parecido al
 * que se está por crear? Mismo criterio que la señal 2 del detector (monto
 * igual tras round2 + fecha de inicio dentro de la ventana), sin la señal
 * del seq — el préstamo nuevo todavía no existe, no tiene seq que comparar.
 * Los anulados no cuentan. Devuelve el préstamo parecido (para armar el
 * mensaje del diálogo) o null.
 *
 * @param {object|null} emp
 * @param {{principal?: number|string, startDate?: string}|null} draft
 * @param {{maxDaysApart?: number}} [opts]
 * @returns {object|null}
 */
export function findSimilarExistingLoan(emp, draft, opts = {}) {
    if (!draft || typeof draft !== 'object') return null;
    const maxDaysApart = Number.isFinite(opts?.maxDaysApart) ? opts.maxDaysApart : DEFAULT_MAX_DAYS_APART;
    const draftAmount = round2(Number(draft.principal));
    const draftDay = parseDay(draft.startDate);
    if (!Number.isFinite(draftAmount) || draftDay === null) return null;

    const loans = (Array.isArray(emp?.loans) ? emp.loans : [])
        .filter(l => l && typeof l === 'object' && l.status !== LOAN_STATUS.WRITTEN_OFF);

    for (const loan of loans) {
        if (round2(loan.principal) !== draftAmount) continue;
        const day = parseDay(loan.startDate);
        if (day === null) continue;
        if (Math.abs(day - draftDay) <= maxDaysApart * MS_PER_DAY) return loan;
    }
    return null;
}

export default detectLoanDuplicateCandidates;
