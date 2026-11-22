import { findProjectNameConflict, duplicateProjectNameMessage } from './ProjectNames.js';
import { summarizeProjectUsage } from './ProjectUsage.js';

/**
 * 🧩 ProjectMergePlan — plan puro para fusionar la obra B (sobrante) en la A.
 *
 * Fusionar es un cambio de DUEÑO, no una copia: los ids de empleados, puestos,
 * líderes y asistencia no cambian, solo su obra. El plan falla cerrado:
 *   - solo reescribe `projectId`; cualquier otra referencia a la obra (traspasos,
 *     pagos enlazados a un cierre de nómina, caja chica, cambios sin sincronizar…)
 *     se informa como bloqueo en lugar de adivinar;
 *   - al final comprueba que B queda VACÍA con la misma contabilidad que usa el
 *     borrado de obras (ProjectUsage). Si algo quedara referenciándola, no es válido.
 *
 * Con `adopt: true` la obra B ya está retirada (lápida con `mergedIntoId`) y se
 * mueve lo que un dispositivo atrasado aún tenga bajo su id. No toca el catálogo.
 */

export const MERGE_BLOCKER = Object.freeze({
    SAME_PROJECT: 'SAME_PROJECT',
    SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
    TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
    SOURCE_NOT_ACTIVE: 'SOURCE_NOT_ACTIVE',
    TARGET_NOT_ACTIVE: 'TARGET_NOT_ACTIVE',
    SOURCE_IS_DEFAULT: 'SOURCE_IS_DEFAULT',
    SOURCE_NOT_MERGED: 'SOURCE_NOT_MERGED',
    NAME_TAKEN: 'NAME_TAKEN',
    NAME_INVALID: 'NAME_INVALID',
    PAYROLL_CLOSURES: 'PAYROLL_CLOSURES',
    PETTY_CASH: 'PETTY_CASH',
    UNSYNCED_CHANGES: 'UNSYNCED_CHANGES',
    PAYROLL_REFERENCE: 'PAYROLL_REFERENCE',
    NESTED_REFERENCE: 'NESTED_REFERENCE',
    OTHER_REFERENCES: 'OTHER_REFERENCES',
    REMAINING_DATA: 'REMAINING_DATA'
});

const MESSAGES = {
    SAME_PROJECT: 'Elige dos obras distintas.',
    SOURCE_UNAVAILABLE: 'La obra que se va a unir ya no está disponible. Actualiza la lista.',
    TARGET_UNAVAILABLE: 'La obra que se conserva ya no está disponible. Actualiza la lista.',
    SOURCE_NOT_ACTIVE: 'Solo se pueden unir obras activas. Reabre la obra que se va a unir.',
    TARGET_NOT_ACTIVE: 'Solo se pueden unir obras activas. Reabre la obra que se conserva.',
    SOURCE_IS_DEFAULT: 'La obra inicial se conserva como referencia del sistema. Conserva esa y une la otra en ella.',
    SOURCE_NOT_MERGED: 'La obra retirada no se unió a esta obra.',
    NAME_INVALID: 'Escribe un nombre de entre 1 y 80 caracteres.',
    PAYROLL_CLOSURES: 'La obra que se va a unir tiene cierres de nómina. No se pueden mover porque su identidad incluye la obra.',
    PETTY_CASH: 'La obra que se va a unir tiene registros de caja chica. Todavía no se pueden mover.',
    UNSYNCED_CHANGES: 'Hay cambios de la obra que se va a unir pendientes de sincronizar. Espera a que se envíen y vuelve a intentarlo.',
    PAYROLL_REFERENCE: 'Hay pagos de nómina enlazados a la obra que se va a unir. No se reetiquetan para no alterar el dinero.',
    NESTED_REFERENCE: 'Hay datos que mencionan la obra que se va a unir de una forma que no se puede mover con seguridad.',
    OTHER_REFERENCES: 'Hay otros registros que apuntan a la obra que se va a unir.',
    REMAINING_DATA: 'Después de mover los datos, la obra que se va a unir seguiría teniendo registros.'
};

const PROJECT_KEYS = new Set(['projectId', 'officialProjectId', 'payrollProjectId', 'sourceProjectId', 'targetProjectId']);
const PAYROLL_BOUND_KEYS = ['payrollClosureId', 'payrollSupersedesClosureId', 'closureId', 'supersedesClosureId', 'payrollBatchId'];
const MAX_NAME_LENGTH = 80;

const trimId = value => String(value ?? '').trim();
const list = value => (Array.isArray(value) ? value : Object.values(value || {}));
const copy = value => JSON.parse(JSON.stringify(value));
const blocker = (code, count = 0) => ({ code, message: MESSAGES[code], ...(count ? { count } : {}) });

/**
 * Copia con `projectId === source` cambiado a `target`. Solo reescribe la clave
 * `projectId`; cualquier otra referencia (o una dentro de algo enlazado a un
 * cierre de nómina) se anota en `blocked` y queda intacta.
 */
function relabel(record, source, target, { topLevelOnly = false } = {}) {
    const blocked = new Set();
    let changed = false;
    const walk = (node, depth, bound) => {
        if (Array.isArray(node)) return node.map(item => walk(item, depth + 1, bound));
        if (!node || typeof node !== 'object') return node;
        const isBound = bound || PAYROLL_BOUND_KEYS.some(key => trimId(node[key]));
        const out = {};
        for (const [key, value] of Object.entries(node)) {
            if (PROJECT_KEYS.has(key) && typeof value === 'string' && trimId(value) === source) {
                if (key === 'payrollProjectId' || isBound) blocked.add(MERGE_BLOCKER.PAYROLL_REFERENCE);
                else if (key !== 'projectId' || (topLevelOnly && depth > 0)) blocked.add(MERGE_BLOCKER.NESTED_REFERENCE);
                else { out[key] = target; changed = true; continue; }
                out[key] = value;
                continue;
            }
            out[key] = walk(value, depth + 1, isBound);
        }
        return out;
    };
    return { value: walk(record, 0, false), changed, blocked };
}

function checkProjects({ source, target, sourceRow, targetRow, adopt, protectedIds }) {
    if (!source || !target || source === target) return [blocker(MERGE_BLOCKER.SAME_PROJECT)];
    const found = [];
    if (!targetRow || targetRow.deletedAt != null) found.push(blocker(MERGE_BLOCKER.TARGET_UNAVAILABLE));
    else if (targetRow.status != null && targetRow.status !== 'active') found.push(blocker(MERGE_BLOCKER.TARGET_NOT_ACTIVE));
    if (!sourceRow) found.push(blocker(MERGE_BLOCKER.SOURCE_UNAVAILABLE));
    else if (adopt) {
        // Basta el puntero: la protección de borrados puede haber dejado la obra visible.
        if (trimId(sourceRow.mergedIntoId) !== target) found.push(blocker(MERGE_BLOCKER.SOURCE_NOT_MERGED));
    } else if (sourceRow.deletedAt != null) found.push(blocker(MERGE_BLOCKER.SOURCE_UNAVAILABLE));
    else if (sourceRow.status != null && sourceRow.status !== 'active') found.push(blocker(MERGE_BLOCKER.SOURCE_NOT_ACTIVE));
    else if (source === trimId(protectedIds.defaultProjectId)) found.push(blocker(MERGE_BLOCKER.SOURCE_IS_DEFAULT));
    return found;
}

/** Nombre final de la obra que se conserva: null = no cambia; o un blocker. */
function resolveName({ projectName, projects, source, target, targetRow }) {
    const requested = String(projectName ?? '').trim().replace(/\s+/g, ' ');
    if (!requested || requested === targetRow.name) return { name: null };
    if (requested.length > MAX_NAME_LENGTH) return { blocker: blocker(MERGE_BLOCKER.NAME_INVALID) };
    const others = projects.filter(row => trimId(row?.id) !== source && trimId(row?.id) !== target);
    const reserved = others.flatMap(row => (row.metadata?.nameConflict ? [row, { ...row, name: row.metadata.nameConflict.requestedName }] : [row]));
    const duplicate = findProjectNameConflict(requested, reserved);
    if (duplicate) return { blocker: { code: MERGE_BLOCKER.NAME_TAKEN, message: duplicateProjectNameMessage(duplicate) } };
    return { name: requested };
}

function relabelAll(records, source, target, timestamp, options) {
    const writes = [];
    const blocked = new Set();
    for (const record of records) {
        if (!record || typeof record !== 'object') continue;
        const result = relabel(record, source, target, options);
        result.blocked.forEach(code => blocked.add(code));
        if (!result.blocked.size && result.changed) writes.push({ before: record, after: { ...copy(result.value), updatedAt: timestamp } });
    }
    return { writes, blocked };
}

function topLevelPatch(before, after) {
    const patch = {};
    for (const key of Object.keys(after)) {
        if (key === 'updatedAt') continue;
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key];
    }
    return patch;
}

function usageBlockers(usage) {
    const found = [];
    if (usage.payrollClosures > 0) found.push(blocker(MERGE_BLOCKER.PAYROLL_CLOSURES, usage.payrollClosures));
    if (usage.pettyCash > 0) found.push(blocker(MERGE_BLOCKER.PETTY_CASH, usage.pettyCash));
    if (usage.pending > 0) found.push(blocker(MERGE_BLOCKER.UNSYNCED_CHANGES, usage.pending));
    if (usage.other > 0) found.push(blocker(MERGE_BLOCKER.OTHER_REFERENCES, usage.other));
    const remaining = ['employees', 'positions', 'leaders', 'attendance', 'loans'].reduce((sum, kind) => sum + usage[kind], 0);
    if (remaining > 0) found.push(blocker(MERGE_BLOCKER.REMAINING_DATA, remaining));
    return found;
}

const nextStamp = (row, timestamp) => Math.max(timestamp, (Number(row?.updatedAt) || 0) + 1);

/**
 * @param {object} input
 * @param {string} input.sourceId   Obra que se retira.
 * @param {string} input.targetId   Obra que se conserva.
 * @param {string} [input.projectName] Nombre final de la obra que se conserva.
 * @param {object} input.data       Filas actuales de cada store (projects, employees, positions, leaders, attendance, …).
 * @param {number} input.timestamp  Sello de la operación.
 * @param {{defaultProjectId?: string}} [input.protectedIds]
 * @param {boolean} [input.adopt]   La obra sobrante ya está retirada con `mergedIntoId`.
 */
export function planProjectMerge({ sourceId, targetId, projectName, data = {}, timestamp, protectedIds = {}, adopt = false } = {}) {
    const source = trimId(sourceId);
    const target = trimId(targetId);
    const projects = list(data.projects);
    const sourceRow = projects.find(row => trimId(row?.id) === source);
    const targetRow = projects.find(row => trimId(row?.id) === target);
    const blockers = checkProjects({ source, target, sourceRow, targetRow, adopt, protectedIds });
    if (blockers.length) return { ok: false, blockers };

    const naming = adopt ? { name: null } : resolveName({ projectName, projects, source, target, targetRow });
    if (naming.blocker) return { ok: false, blockers: [naming.blocker] };

    const employees = relabelAll(list(data.employees), source, target, timestamp, {});
    const positions = relabelAll(list(data.positions), source, target, timestamp, { topLevelOnly: true });
    const leaders = relabelAll(list(data.leaders), source, target, timestamp, { topLevelOnly: true });
    const attendance = relabelAll(list(data.attendance), source, target, timestamp, { topLevelOnly: true });
    const blocked = new Set([...employees.blocked, ...positions.blocked, ...leaders.blocked, ...attendance.blocked]);
    if (blocked.size) return { ok: false, blockers: [...blocked].map(code => blocker(code)) };

    const moved = (rows, writes, keyOf) => {
        const byKey = new Map(writes.map(({ before, after }) => [keyOf(before), after]));
        return list(rows).map(row => byKey.get(keyOf(row)) || row);
    };
    const idOf = row => trimId(row?.id);
    const keyOf = row => trimId(row?.key);
    const post = {
        ...data,
        employees: moved(data.employees, employees.writes, idOf),
        positions: moved(data.positions, positions.writes, idOf),
        leaders: moved(data.leaders, leaders.writes, idOf),
        attendance: moved(data.attendance, attendance.writes, keyOf)
    };
    const usage = summarizeProjectUsage([sourceRow], post, { liveState: {}, defaultProjectId: trimId(protectedIds.defaultProjectId) })[source];
    const leftovers = usageBlockers(usage);
    if (leftovers.length) return { ok: false, blockers: leftovers };

    const catalog = [];
    if (!adopt) {
        if (naming.name) catalog.push({ ...copy(targetRow), name: naming.name, updatedAt: nextStamp(targetRow, timestamp) });
        const stamp = nextStamp(sourceRow, timestamp);
        catalog.push({ ...copy(sourceRow), deletedAt: stamp, mergedIntoId: target, updatedAt: stamp });
        // Las cadenas nunca pasan de un salto: lo que apuntaba a la obra retirada apunta al destino.
        for (const row of projects) {
            if (row.deletedAt != null && trimId(row.mergedIntoId) === source) {
                catalog.push({ ...copy(row), mergedIntoId: target, updatedAt: nextStamp(row, timestamp) });
            }
        }
    }
    const writes = {
        employees: employees.writes.map(({ after }) => after),
        positions: positions.writes.map(({ after }) => after),
        leaders: leaders.writes.map(({ after }) => after),
        attendance: attendance.writes.map(({ after }) => ({ key: keyOf(after), record: after })),
        projects: catalog
    };
    const memory = {
        employeeMerges: new Map(employees.writes.map(({ before, after }) => [idOf(before), topLevelPatch(before, after)])),
        positionProjectIds: new Map(positions.writes.map(({ after }) => [idOf(after), target])),
        leaderProjectIds: new Map(leaders.writes.map(({ after }) => [idOf(after), target])),
        attendanceProjectIds: new Map(attendance.writes.map(({ after }) => [keyOf(after), target]))
    };
    const counts = { employees: writes.employees.length, positions: writes.positions.length, leaders: writes.leaders.length, attendance: writes.attendance.length };
    const empty = Object.values(counts).every(n => n === 0) && catalog.length === 0;
    return { ok: true, empty, writes, memory, counts, targetName: naming.name || targetRow.name };
}

export default { planProjectMerge, MERGE_BLOCKER };
