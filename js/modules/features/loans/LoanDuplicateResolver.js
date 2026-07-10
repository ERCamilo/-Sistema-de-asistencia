/**
 * ⚖️ LoanDuplicateResolver.js (Fase 2, U5)
 *
 * Resolución de los duplicados que detecta LoanDuplicateDetector (U4). La
 * decisión SIEMPRE la toma un humano — este módulo solo ejecuta la salida
 * elegida:
 *
 *   1. "Son distintos, quedan los dos" → resolveDuplicateAsDistinct: el
 *      PERDEDOR del desempate se renumera a seq = siguiente disponible.
 *      El UUID no se toca (seq es señal/cosmético, no identidad).
 *      Perdedor = createdAt más NUEVO (el más viejo conserva su número);
 *      empate o sin createdAt → pierde el de id lexicográficamente mayor.
 *      El desempate es DETERMINISTA a propósito: si dos dispositivos
 *      resolvieran el mismo par en paralelo, eligen el mismo perdedor y el
 *      merge converge en vez de renumerar a ambos.
 *
 *   2. "Eliminar uno" → resolveDuplicateByDeleting: anula (write-off) si
 *      hace falta y borra con tombstone vía deleteLoan — el guard de
 *      deleteLoan ("solo anulados") se satisface anulando primero, y el
 *      tombstone garantiza que el borrado sobreviva al sync (sin él, el
 *      merge por unión resucita el duplicado desde la copia remota).
 */

import { writeOffLoan, deleteLoan, nextLoanSeq, LOAN_STATUS } from './LoansService.js';

function findLoanOrThrow(emp, loanId) {
    const loan = (emp?.loans || []).find(l => l.id === loanId);
    if (!loan) throw new Error(`Préstamo no encontrado: ${loanId}`);
    return loan;
}

/**
 * Desempate determinista: devuelve [ganador, perdedor]. Pierde el de
 * createdAt más nuevo; empate o no-finito → pierde el de id mayor
 * (String.localeCompare estable en ambos dispositivos).
 */
function pickLoser(a, b) {
    const ca = Number.isFinite(a.createdAt) ? a.createdAt : null;
    const cb = Number.isFinite(b.createdAt) ? b.createdAt : null;
    if (ca !== null && cb !== null && ca !== cb) {
        return ca < cb ? [a, b] : [b, a];
    }
    return String(a.id) < String(b.id) ? [a, b] : [b, a];
}

/**
 * "Son distintos, quedan los dos": renumera el perdedor al siguiente seq
 * disponible y estampa updatedAt (préstamo y empleado) para que el cambio
 * gane el merge. El llamador es responsable de saveApplicationData().
 *
 * @returns {{kept: object, renumbered: object}}
 */
export function resolveDuplicateAsDistinct(emp, loanIdA, loanIdB) {
    const a = findLoanOrThrow(emp, loanIdA);
    const b = findLoanOrThrow(emp, loanIdB);

    const [kept, loser] = pickLoser(a, b);
    loser.seq = nextLoanSeq(emp.loans);
    loser.updatedAt = Date.now();
    emp.updatedAt = Date.now();
    return { kept, renumbered: loser };
}

/**
 * "Eliminar uno": anula si hace falta y borra con tombstone. El llamador
 * es responsable de saveApplicationData().
 *
 * @returns {object} el préstamo eliminado
 */
export function resolveDuplicateByDeleting(emp, loanId) {
    const loan = findLoanOrThrow(emp, loanId);
    if (loan.status !== LOAN_STATUS.WRITTEN_OFF) {
        writeOffLoan(emp, loanId);
    }
    return deleteLoan(emp, loanId);
}

export default { resolveDuplicateAsDistinct, resolveDuplicateByDeleting };
