import { normalizeEmployeePhoto } from '../features/employees/Employee.js';

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
 *     UNIÓN por id. Los planes modernos de bonificación/deducción además
 *     unen cuotas e historial; los ajustes heredados conservan el LWW previo.
 *   - statusHistory: unión por timestamp (sirve de id).
 *   - positions (strings): unión deduplicada.
 *   - positionSalaries (mapa por positionId): unión por clave, en
 *     empate gana el lado con mayor updatedAt.
 *   - Dentro de un loan, payments[] e installments[] también se
 *     unen por id. Los planes modernos hacen lo mismo con history[] e
 *     installments[].
 *   - El resultado lleva max(server.updatedAt, local.updatedAt).
 *
 * No muta los inputs. Útil para read-modify-write antes de saveOne.
 */

import { generateUUID } from '../utils/Helpers.js';
import { fingerprintId } from './RecordKey.js';
import { mergeTombstoneMaps, tombstoneSetFor, TOMBSTONE_FIELDS } from './NestedTombstones.js';
import {
    ADJUSTMENT_PLAN_KIND,
    isPayrollAdjustmentInstallmentPlan
} from '../features/payroll/PayrollAdjustmentInstallmentPlan.js';

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

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
}

function deterministicWinner(serverItem, localItem, omittedKeys = []) {
    const serverTs = ts(serverItem);
    const localTs = ts(localItem);
    if (serverTs !== null && localTs !== null && serverTs !== localTs) {
        return serverTs > localTs ? serverItem : localItem;
    }
    if (serverTs !== null && localTs === null) return serverItem;
    if (serverTs === null && localTs !== null) return localItem;

    const omit = new Set(omittedKeys);
    const comparable = item => Object.fromEntries(
        Object.entries(item || {}).filter(([key]) => !omit.has(key))
    );
    const serverKey = JSON.stringify(stableValue(comparable(serverItem)));
    const localKey = JSON.stringify(stableValue(comparable(localItem)));
    return serverKey > localKey ? serverItem : localItem;
}

function mergePlanRecords(serverItems, localItems, sortRecords) {
    return unionById(serverItems, localItems, 'id', (_winner, _loser, serverItem, localItem) => ({
        ...deterministicWinner(serverItem, localItem)
    })).sort(sortRecords);
}

function mergeAdjustmentPlan(serverPlan, localPlan) {
    const winner = deterministicWinner(serverPlan, localPlan, ['history', 'installments']);
    return {
        ...winner,
        history: mergePlanRecords(
            serverPlan.history,
            localPlan.history,
            (left, right) => String(left.id).localeCompare(String(right.id), 'es', { numeric: true })
        ),
        installments: mergePlanRecords(
            serverPlan.installments,
            localPlan.installments,
            (left, right) => {
                const sequenceDifference = (Number(left.sequence) || 0) - (Number(right.sequence) || 0);
                return sequenceDifference || String(left.id).localeCompare(String(right.id), 'es', { numeric: true });
            }
        )
    };
}

function adjustmentEntriesForEmployee(entries, employeeId, kind) {
    return (Array.isArray(entries) ? entries : []).filter(entry =>
        !isPayrollAdjustmentInstallmentPlan(entry) || (
            String(entry.employeeId) === String(employeeId) &&
            entry.kind === kind
        )
    );
}

function mergeAdjustmentEntries(serverItems, localItems, employeeId, kind) {
    return unionById(
        adjustmentEntriesForEmployee(serverItems, employeeId, kind),
        adjustmentEntriesForEmployee(localItems, employeeId, kind),
        'id',
        (winner, _loser, serverItem, localItem) => (
            isPayrollAdjustmentInstallmentPlan(serverItem) &&
            isPayrollAdjustmentInstallmentPlan(localItem)
                ? mergeAdjustmentPlan(serverItem, localItem)
                : winner
        )
    );
}


function employeeWithValidAdjustmentPlans(employee) {
    const out = { ...employee };
    if (Array.isArray(employee?.bonuses)) {
        out.bonuses = adjustmentEntriesForEmployee(
            employee.bonuses,
            employee.id,
            ADJUSTMENT_PLAN_KIND.BONUS
        );
    }
    if (Array.isArray(employee?.deductions)) {
        out.deductions = adjustmentEntriesForEmployee(
            employee.deductions,
            employee.id,
            ADJUSTMENT_PLAN_KIND.DEDUCTION
        );
    }
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
    if (!server) return employeeWithValidAdjustmentPlans(local);
    if (!local) return employeeWithValidAdjustmentPlans(server);

    const winnerSide = pickNewerScalar(server, local);
    const winner = winnerSide === 'server' ? server : local;
    const loser  = winnerSide === 'server' ? local : server;

    // 1. Base: escalares del ganador.
    const out = { ...loser, ...winner };

    // Photo signals have their own LWW clock. A phone/salary edit must not
    // overwrite a newer photo signal, regardless of which side owns the newer
    // general employee updatedAt. Equal photo timestamps keep the local side.
    const serverPhoto = normalizeEmployeePhoto(server.photo);
    const localPhoto = normalizeEmployeePhoto(local.photo);
    if (serverPhoto && localPhoto) {
        out.photo = serverPhoto.updatedAt > localPhoto.updatedAt ? serverPhoto : localPhoto;
    } else if (serverPhoto || localPhoto) {
        out.photo = serverPhoto || localPhoto;
    }

    // 1.b 🪦 Tombstone de EMPLEADO (deletedAt): lo decide el ganador escalar,
    // INCLUYENDO su ausencia. El spread de arriba NO borra claves que el
    // winner no tenga, así que un empleado reactivado (winner sin deletedAt)
    // heredaría el tombstone viejo del loser y quedaría borrado para siempre.
    // Explícito: winner con deletedAt → borrado gana (aunque el loser esté
    // vivo con más datos); winner sin deletedAt → revive (edición/reactivación
    // posterior al borrado).
    if (Number.isFinite(winner.deletedAt)) {
        out.deletedAt = winner.deletedAt;
    } else {
        delete out.deletedAt;
    }

    // 2. Arrays "tipo log" por id (loans tiene merge anidado).
    out.loans = unionById(server.loans, local.loans, 'id',
        (winLoan, loseLoan, sL, lL) => mergeLoan(winLoan, loseLoan, sL, lL));
    out.advances = unionById(server.advances, local.advances);
    out.bonuses = mergeAdjustmentEntries(
        server.bonuses,
        local.bonuses,
        out.id,
        ADJUSTMENT_PLAN_KIND.BONUS
    );
    out.deductions = mergeAdjustmentEntries(
        server.deductions,
        local.deductions,
        out.id,
        ADJUSTMENT_PLAN_KIND.DEDUCTION
    );

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
    // 🔁 Fix del bucle de sanitización (2026-07-06) + Judgment Day Fase 2A:
    // la UNIÓN incondicional resucitaba las REMOCIONES (un huérfano corregido o
    // un puesto desasignado volvía desde la copia vieja del otro lado en cada
    // merge, incluso al subir). El fix inicial usaba el updatedAt GENERAL para
    // el LWW, pero eso hacía que editar un campo NO relacionado (teléfono)
    // pisara los puestos del otro dispositivo. Se usa positionsUpdatedAt, la
    // frescura ESPECÍFICA de puestos (sube sólo cuando se tocan puestos):
    //   - ambos lados con sello → LWW por positionsUpdatedAt (empate → unión);
    //   - ASIMÉTRICO (sólo un lado tiene sello) → gana el lado con sello. NO
    //     comparar su sello contra el updatedAt GENERAL del otro (Ronda 2,
    //     Juez A): ese updatedAt sube por cualquier edición y una edición ajena
    //     pisaría los puestos, reabriendo el bug;
    //   - ninguno con sello (legacy puro) → updatedAt, para que una remoción
    //     legacy no resucite (fix del bucle). Degrada al caso R1 sólo para
    //     empleados que nunca tocaron puestos post-fix; se corrige al primer
    //     cambio de puestos. La unión queda para empates y para "sin info".
    const sHasPos = typeof server.positionsUpdatedAt === 'number';
    const lHasPos = typeof local.positionsUpdatedAt === 'number';
    let strictWinner = null;
    if (sHasPos && lHasPos) {
        if (server.positionsUpdatedAt !== local.positionsUpdatedAt) {
            strictWinner = server.positionsUpdatedAt > local.positionsUpdatedAt ? server : local;
        }
    } else if (sHasPos !== lHasPos) {
        strictWinner = sHasPos ? server : local;
    } else {
        const sT2 = ts(server);
        const lT2 = ts(local);
        if (sT2 !== null && lT2 !== null && sT2 !== lT2) {
            strictWinner = sT2 > lT2 ? server : local;
        }
    }

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

    // Propagar la frescura fina de puestos (el mayor), para que futuros merges
    // sigan distinguiendo "quién tocó los puestos más tarde".
    const sPosRaw = typeof server.positionsUpdatedAt === 'number' ? server.positionsUpdatedAt : -Infinity;
    const lPosRaw = typeof local.positionsUpdatedAt === 'number' ? local.positionsUpdatedAt : -Infinity;
    const maxPos = Math.max(sPosRaw, lPosRaw);
    if (maxPos > -Infinity) out.positionsUpdatedAt = maxPos;
    else delete out.positionsUpdatedAt;

    // 6. updatedAt: el mayor.
    const sT = ts(server) ?? -Infinity;
    const lT = ts(local)  ?? -Infinity;
    const max = Math.max(sT, lT);
    if (max > -Infinity) out.updatedAt = max;

    return out;
}

export default mergeEmployees;
