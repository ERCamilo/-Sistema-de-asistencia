/**
 * 🔀 EmployeeMerge.js (Fase 2.2)
 *
 * Función pura que fusiona dos versiones del MISMO empleado (server +
 * local) sin perder datos cuando ambos lados editaron offline.
 *
 * Reglas:
 *   - Escalares (name, phone, ...): gana el de mayor updatedAt; en
 *     empate gana local.
 *   - Arreglos tipo "log" (loans, advances, bonuses, deductions):
 *     UNIÓN por id. Items sin id se omiten (no podemos fusionarlos).
 *     Si el mismo id está en ambos, gana el de mayor updatedAt.
 *   - statusHistory: unión por timestamp (sirve de id).
 *   - positions (strings): unión deduplicada.
 *   - positionSalaries (mapa por positionId): unión por clave, en
 *     empate gana el lado con mayor updatedAt.
 *   - Dentro de un loan, payments[] e installments[] también se
 *     unen por id.
 *   - El resultado lleva max(server.updatedAt, local.updatedAt).
 *
 * No muta los inputs. Útil para read-modify-write antes de saveOne.
 */

import { generateUUID } from '../utils/Helpers.js';

const ARRAY_FIELDS_BY_ID = ['loans', 'advances', 'bonuses', 'deductions'];
const LOAN_NESTED_BY_ID  = ['payments', 'installments'];

function hasUsableId(item, idKey) {
    const k = item?.[idKey];
    return k !== undefined && k !== null && k !== '';
}

function ts(x) {
    return typeof x?.updatedAt === 'number' ? x.updatedAt : null;
}

function pickNewerScalar(server, local) {
    // Devuelve el lado "ganador" para escalares según updatedAt.
    const s = ts(server);
    const l = ts(local);
    if (s !== null && l !== null) return s > l ? 'server' : 'local';
    if (s !== null && l === null) return 'server';
    return 'local';
}

/**
 * Une dos arreglos de objetos por id. En colisión gana el de mayor
 * updatedAt; en empate o ambos sin updatedAt, gana local. Items sin id
 * usable reciben un id sintético (UUID) y se preservan — perder datos
 * silenciosamente cuesta más que un duplicado eventual.
 */
function unionById(serverArr, localArr, idKey = 'id', recurse = null) {
    const map = new Map();
    const orphans = []; // items sin id de ambos lados; se incluyen tal cual con id sintético

    (Array.isArray(serverArr) ? serverArr : []).forEach(item => {
        if (!item || typeof item !== 'object') return;
        if (!hasUsableId(item, idKey)) {
            orphans.push({ ...item, [idKey]: generateUUID() });
            return;
        }
        map.set(String(item[idKey]), { side: 'server', item });
    });
    (Array.isArray(localArr) ? localArr : []).forEach(item => {
        if (!item || typeof item !== 'object') return;
        if (!hasUsableId(item, idKey)) {
            orphans.push({ ...item, [idKey]: generateUUID() });
            return;
        }
        const k = String(item[idKey]);
        const existing = map.get(k);
        if (!existing) {
            map.set(k, { side: 'local', item });
            return;
        }
        // Colisión: decidir ganador y fusionar profundidad si aplica.
        const winner = pickNewerScalar(existing.item, item);
        const winnerObj = winner === 'server' ? existing.item : item;
        const loserObj  = winner === 'server' ? item : existing.item;
        let merged = { ...winnerObj };
        if (typeof recurse === 'function') {
            merged = recurse(merged, loserObj, existing.item, item);
        }
        map.set(k, { side: winner, item: merged });
    });

    return [...[...map.values()].map(v => v.item), ...orphans];
}

/**
 * Fusión específica para loans: tras escoger ganador, además unifica
 * payments[] e installments[] de AMBOS lados por id.
 */
function mergeLoan(winnerLoan, loserLoan, serverLoan, localLoan) {
    const out = { ...winnerLoan };
    LOAN_NESTED_BY_ID.forEach(field => {
        const s = serverLoan?.[field];
        const l = localLoan?.[field];
        out[field] = unionById(s, l);
    });
    return out;
}

function mergeStatusHistory(server, local) {
    // Tratamos timestamp como id.
    const seen = new Set();
    const out = [];
    [...(Array.isArray(server) ? server : []), ...(Array.isArray(local) ? local : [])]
        .forEach(entry => {
            const key = String(entry?.timestamp ?? '');
            if (!key) return;
            if (seen.has(key)) return;
            seen.add(key);
            out.push(entry);
        });
    return out;
}

function mergePositions(server, local) {
    const set = new Set();
    (Array.isArray(server) ? server : []).forEach(p => { if (p) set.add(p); });
    (Array.isArray(local)  ? local  : []).forEach(p => { if (p) set.add(p); });
    return [...set];
}

function mergePositionSalaries(server, local, serverNewer) {
    const s = (server && typeof server === 'object') ? server : {};
    const l = (local  && typeof local  === 'object') ? local  : {};
    const out = { ...s, ...l };
    if (serverNewer) {
        // Server gana en colisiones de clave.
        Object.keys(s).forEach(k => { out[k] = s[k]; });
        // Pero las claves que solo existen en local siguen en out (ya las puso el spread inicial).
        Object.keys(l).forEach(k => { if (!(k in s)) out[k] = l[k]; });
    }
    return out;
}

/**
 * Fusiona dos versiones del mismo empleado.
 * @param {object|null} server
 * @param {object|null} local
 * @returns {object}
 */
export function mergeEmployees(server, local) {
    if (!server && !local) return {};
    if (!server) return { ...local };
    if (!local)  return { ...server };

    const winnerSide = pickNewerScalar(server, local);
    const winner = winnerSide === 'server' ? server : local;
    const loser  = winnerSide === 'server' ? local : server;

    // 1. Base: escalares del ganador.
    const out = { ...loser, ...winner };

    // 2. Arrays "tipo log" por id (loans tiene merge anidado).
    out.loans = unionById(server.loans, local.loans, 'id',
        (winLoan, loseLoan, sL, lL) => mergeLoan(winLoan, loseLoan, sL, lL));
    out.advances    = unionById(server.advances,    local.advances);
    out.bonuses     = unionById(server.bonuses,     local.bonuses);
    out.deductions  = unionById(server.deductions,  local.deductions);

    // 3. statusHistory por timestamp.
    out.statusHistory = mergeStatusHistory(server.statusHistory, local.statusHistory);

    // 4. positions (lista de strings) → unión.
    out.positions = mergePositions(server.positions, local.positions);

    // 5. positionSalaries (mapa) → unión, ganador escalar decide colisiones.
    out.positionSalaries = mergePositionSalaries(
        server.positionSalaries,
        local.positionSalaries,
        winnerSide === 'server'
    );

    // 6. updatedAt: el mayor.
    const sT = ts(server) ?? -Infinity;
    const lT = ts(local)  ?? -Infinity;
    const max = Math.max(sT, lT);
    if (max > -Infinity) out.updatedAt = max;

    return out;
}

export default mergeEmployees;
