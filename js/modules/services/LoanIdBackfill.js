/**
 * 🔑 LoanIdBackfill.js (Task #5)
 *
 * Defence-in-depth: walks every employee on load and assigns a UUID to
 * any nested item (loan, advance, bonus, deduction, and their nested
 * payments / installments) that is missing an 'id' field.
 *
 * Why here and not only in unionById?
 *   unionById runs at merge-time and already handles the "item without id"
 *   case by assigning a synthetic UUID. But legacy data that was never
 *   passed through a merge step could reach the UI without ids, breaking
 *   the payment ledger, LoansService lookups, and the cloud merge cycle.
 *
 * This function is:
 *   - Pure side-effect on the input array (mutates in-place for perf).
 *   - Called once by validateDataIntegrity() at load time.
 *   - Safe to call multiple times (idempotent: existing ids are untouched).
 *   - Returns the count of newly assigned ids (> 0 → caller should persist).
 */

import { generateUUID } from '../utils/Helpers.js';
import { fingerprintId } from './RecordKey.js';

// Top-level array fields in an employee object that hold id-keyed items.
const TOP_LEVEL_FIELDS = ['loans', 'advances', 'bonuses', 'deductions'];

// Fields nested inside a loan that also hold id-keyed items.
const LOAN_NESTED_FIELDS = ['payments', 'installments'];

function hasUsableId(item) {
    const k = item?.id;
    return k !== undefined && k !== null && k !== '';
}

/**
 * Ensure every item in `arr` has an 'id'. Returns the number of ids
 * that were assigned (0 if all items already had one).
 * Skips null / non-object items silently.
 *
 * 🫆 P3 (Auditoría 2026-06-10): el id asignado es DETERMINISTA (huella de
 * contenido), no un UUID aleatorio. Antes, dos dispositivos que cargaban el
 * mismo doc legacy asignaban UUIDs distintos al MISMO préstamo y el merge
 * lo duplicaba. Con la huella, mismo contenido → mismo id en ambos lados.
 * Items idénticos dentro del mismo arreglo se distinguen con un sufijo de
 * ocurrencia (estable: el orden viene del mismo documento).
 */
function ensureIds(arr) {
    if (!Array.isArray(arr)) return 0;
    let count = 0;
    const occurrences = new Map();
    for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        if (hasUsableId(item)) continue;
        const base = fingerprintId(item) || generateUUID();
        const n = (occurrences.get(base) || 0) + 1;
        occurrences.set(base, n);
        item.id = n === 1 ? base : `${base}-${n}`;
        count++;
    }
    return count;
}

/**
 * Walk all employees and assign UUIDs to any items missing an 'id'.
 *
 * @param {Array|null|undefined} employees - Array of employee objects (mutated in-place).
 * @returns {number} Total count of ids that were assigned across all employees.
 */
export function backfillNestedIds(employees) {
    if (!Array.isArray(employees)) return 0;

    let total = 0;

    for (const emp of employees) {
        if (!emp || typeof emp !== 'object') continue;

        // 1. Top-level arrays (loans, advances, bonuses, deductions).
        for (const field of TOP_LEVEL_FIELDS) {
            const arr = emp[field];
            if (!Array.isArray(arr)) continue;
            total += ensureIds(arr);
        }

        // 2. Nested arrays inside each loan (payments, installments).
        if (Array.isArray(emp.loans)) {
            for (const loan of emp.loans) {
                if (!loan || typeof loan !== 'object') continue;
                for (const nested of LOAN_NESTED_FIELDS) {
                    total += ensureIds(loan[nested]);
                }
            }
        }
    }

    return total;
}

export default backfillNestedIds;
