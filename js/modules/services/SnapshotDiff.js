/**
 * 📊 SnapshotDiff.js
 * Función pura que describe qué cambia si el usuario restaurara un snapshot
 * encima de su estado actual. Usado por el modal de comparación pre-restore
 * (Snapshot UX B).
 *
 * No muta nada. No tiene dependencias externas. Trivialmente testeable.
 */

function safeArr(x) { return Array.isArray(x) ? x : []; }
function safeObj(x) { return x && typeof x === 'object' ? x : {}; }

/**
 * Agrega todos los préstamos de todos los empleados a un Map por id.
 * Mapa: loanId → { id, amount, employeeId, employeeName, ...rest }
 */
function indexLoans(state) {
    const result = new Map();
    safeArr(state?.employees).forEach(e => {
        safeArr(e?.loans).forEach(l => {
            if (l && l.id) {
                result.set(l.id, { ...l, employeeId: e.id, employeeName: e.name });
            }
        });
    });
    return result;
}

function indexById(arr) {
    const m = new Map();
    safeArr(arr).forEach(item => {
        if (item && item.id) m.set(item.id, item);
    });
    return m;
}

/**
 * @param {object|null} snapshotState - El estado del snapshot a restaurar
 * @param {object|null} currentState  - El estado vivo de la app
 * @returns {object} diff con counts, deltas, listas de elementos perdidos
 *   y flags `noChange` / `willLoseData`.
 */
export function computeSnapshotDiff(snapshotState, currentState) {
    const snap = safeObj(snapshotState);
    const curr = safeObj(currentState);

    // ─── Empleados ──────────────────────────────────────────────────────
    const snapEmpById = indexById(snap.employees);
    const currEmpById = indexById(curr.employees);
    const lostEmployees = [];
    currEmpById.forEach((emp, id) => {
        if (!snapEmpById.has(id)) {
            lostEmployees.push({ id, name: emp.name || '(sin nombre)' });
        }
    });

    // ─── Posiciones ─────────────────────────────────────────────────────
    const snapPosById = indexById(snap.positions);
    const currPosById = indexById(curr.positions);
    const lostPositions = [];
    currPosById.forEach((p, id) => {
        if (!snapPosById.has(id)) {
            lostPositions.push({ id, name: p.name || '(sin nombre)' });
        }
    });

    // ─── Préstamos (cross-employee) ─────────────────────────────────────
    const snapLoans = indexLoans(snap);
    const currLoans = indexLoans(curr);
    const lostLoans = [];
    currLoans.forEach((l, id) => {
        if (!snapLoans.has(id)) {
            lostLoans.push({
                id,
                amount: l.amount,
                employeeId: l.employeeId,
                employeeName: l.employeeName || '(sin nombre)'
            });
        }
    });

    // ─── Asistencia (solo conteo de claves) ─────────────────────────────
    const snapAttKeys = Object.keys(safeObj(snap.attendance));
    const currAttKeys = Object.keys(safeObj(curr.attendance));

    // ─── Counts y deltas ────────────────────────────────────────────────
    const employees  = { snapshot: snapEmpById.size,  current: currEmpById.size,  delta: snapEmpById.size  - currEmpById.size };
    const positions  = { snapshot: snapPosById.size,  current: currPosById.size,  delta: snapPosById.size  - currPosById.size };
    const loans      = { snapshot: snapLoans.size,    current: currLoans.size,    delta: snapLoans.size    - currLoans.size };
    const attendance = { snapshot: snapAttKeys.length,current: currAttKeys.length,delta: snapAttKeys.length- currAttKeys.length };

    // willLoseData: si CUALQUIER categoría pierde datos al restaurar (delta negativo)
    const willLoseData =
        employees.delta < 0 || positions.delta < 0 ||
        loans.delta < 0 || attendance.delta < 0;

    const noChange =
        employees.delta === 0 && positions.delta === 0 &&
        loans.delta === 0 && attendance.delta === 0 &&
        lostEmployees.length === 0 && lostPositions.length === 0 && lostLoans.length === 0;

    return {
        employees,
        positions,
        loans,
        attendance,
        lostEmployees,
        lostPositions,
        lostLoans,
        willLoseData,
        noChange
    };
}
