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
import { fingerprintId } from './RecordKey.js';
import { mergeTombstoneMaps, tombstoneSetFor, TOMBSTONE_FIELDS } from './NestedTombstones.js';

const ARRAY_FIELDS_BY_ID = ['loans', 'advances', 'bonuses', 'deductions'];
const LOAN_NESTED_BY_ID  = ['payments', 'installments', 'refinancings'];

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
 * 🫆 Asigna ids sintéticos DETERMINISTAS a los items sin id de un arreglo.
 * (Hallazgo P3) Antes se usaba un UUID aleatorio por lado: el MISMO item
 * legacy presente en server y local recibía dos ids distintos y el merge
 * lo duplicaba. Con la huella de contenido, mismo contenido → mismo id en
 * ambos lados → la unión por id los fusiona naturalmente.
 *
 * Dos items idénticos dentro del MISMO arreglo (p. ej. dos adelantos
 * iguales el mismo día) se distinguen con un sufijo de ocurrencia, que es
 * estable entre dispositivos porque el orden del arreglo viene del mismo
 * documento.
 */
function withDeterministicIds(arr, idKey) {
    const occurrences = new Map();
    return (Array.isArray(arr) ? arr : [])
        .filter(item => item && typeof item === 'object')
        .map(item => {
            if (hasUsableId(item, idKey)) return item;
            const base = fingerprintId(item) || generateUUID();
            const n = (occurrences.get(base) || 0) + 1;
            occurrences.set(base, n);
            return { ...item, [idKey]: n === 1 ? base : `${base}-${n}` };
        });
}

/**
 * Une dos arreglos de objetos por id. En colisión gana el de mayor
 * updatedAt; en empate o ambos sin updatedAt, gana local. Items sin id
 * usable reciben un id sintético DETERMINISTA (huella de contenido) y se
 * preservan — perder datos silenciosamente cuesta más que un duplicado
 * eventual, y la huella evita duplicar el mismo item entre dispositivos.
 */
export function unionById(serverArr, localArr, idKey = 'id', recurse = null) {
    const map = new Map();

    withDeterministicIds(serverArr, idKey).forEach(item => {
        map.set(String(item[idKey]), { side: 'server', item });
    });
    withDeterministicIds(localArr, idKey).forEach(item => {
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

    return [...map.values()].map(v => v.item);
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

    // 2.b 🪦 Tombstones (hallazgo P1): la unión por id RESUCITABA los items
    // borrados (el lado que aún los tenía los re-aportaba). Los borrados se
    // registran en deletedItemIds; aquí se unen los de ambos lados, se
    // excluyen del resultado y se propagan para proteger futuros merges.
    const tombstones = mergeTombstoneMaps(server.deletedItemIds, local.deletedItemIds);
    for (const field of TOMBSTONE_FIELDS) {
        const dead = tombstoneSetFor(tombstones, field);
        if (dead.size === 0) continue;
        if (Array.isArray(out[field])) {
            out[field] = out[field].filter(item => !dead.has(String(item?.id)));
        }
    }
    if (Object.keys(tombstones).length > 0) {
        out.deletedItemIds = tombstones;
    }

    // 3. statusHistory por timestamp.
    out.statusHistory = mergeStatusHistory(server.statusHistory, local.statusHistory);

    // 4 y 5. positions (lista de strings) y positionSalaries (mapa).
    // 🔁 Fix del bucle de sanitización (test de campo 2026-07-06): la UNIÓN
    // incondicional resucitaba las REMOCIONES — un huérfano corregido (o un
    // puesto desasignado a propósito) volvía desde la copia vieja del otro
    // lado en CADA merge, incluso en la SUBIDA (saveOne mergeRemote fusiona
    // con el doc remoto antes de escribir), así que la nube nunca convergía.
    // Si un lado es ESTRICTAMENTE más nuevo por updatedAt, su lista/mapa
    // ganan COMPLETOS (post-Fase-1 toda mutación legítima estampa updatedAt,
    // así que "más nuevo" = "esta es la verdad actual"). La unión queda SOLO
    // para el empate o cuando falta updatedAt: sin información de frescura,
    // no perder nada sigue siendo lo seguro.
    const sTs = ts(server);
    const lTs = ts(local);
    const strictWinner = (sTs !== null && lTs !== null && sTs !== lTs)
        ? (sTs > lTs ? server : local)
        : null;

    if (strictWinner) {
        out.positions = Array.isArray(strictWinner.positions) ? [...strictWinner.positions] : [];
        out.positionSalaries = (strictWinner.positionSalaries && typeof strictWinner.positionSalaries === 'object')
            ? { ...strictWinner.positionSalaries }
            : {};
    } else {
        out.positions = mergePositions(server.positions, local.positions);
        out.positionSalaries = mergePositionSalaries(
            server.positionSalaries,
            local.positionSalaries,
            winnerSide === 'server'
        );
    }

    // 6. updatedAt: el mayor.
    const sT = ts(server) ?? -Infinity;
    const lT = ts(local)  ?? -Infinity;
    const max = Math.max(sT, lT);
    if (max > -Infinity) out.updatedAt = max;

    return out;
}

export default mergeEmployees;
