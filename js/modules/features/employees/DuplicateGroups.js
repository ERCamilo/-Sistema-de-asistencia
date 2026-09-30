/**
 * 🧩 DuplicateGroups — qué empleados parecen ser la misma persona.
 *
 * Pura (sin estado global ni DOM) para que la pantalla «Duplicados», las
 * pruebas y la maqueta usen exactamente la misma regla.
 *
 * Dos empleados quedan en el mismo grupo si:
 *   - comparten número de ficha dentro de la misma obra, o
 *   - tienen el mismo nombre (sin importar acentos, mayúsculas u orden), aunque
 *     tengan otra ficha u otra obra: es el caso de las copias que llegan de la
 *     nube o de un respaldo viejo con otro número.
 * Las relaciones se encadenan (A=B por ficha y B=C por nombre ⇒ un grupo).
 *
 * «Seguro» solo cuando todos tienen la misma ficha, la misma obra y el nombre
 * idéntico carácter por carácter (misma regla que el asistente anterior).
 * Lo demás se revisa, aunque llega con una propuesta ya marcada.
 */
import { employeeNumberIdentityKey, sameEmployeeNumber } from './EmployeeNumberIdentity.js';
import { normalizePersonName } from '../projects/ProjectDuplicateCandidates.js';
import { idFormatRank } from '../../services/IdFormat.js';
import { canDeleteDuplicateEmployee } from '../../services/EmployeeDeletionGuard.js';

export const DUPLICATE_ROLES = Object.freeze({
    KEEP: 'keep',       // se conserva (perfil principal)
    MERGE: 'merge',     // misma persona: se une al principal
    OTHER: 'other',     // otra persona: se queda, con otra ficha si hace falta
    DELETE: 'delete'    // registro de más: se elimina
});

const idOf = value => String(value ?? '').trim();
const sortedName = name => normalizePersonName(name).split(' ').filter(Boolean).sort().join(' ');

export function groupSignature(memberIds) {
    return [...memberIds].map(idOf).sort().join('|');
}

function projectKey(employee, defaultProjectId) {
    return idOf(employee?.projectId) || idOf(defaultProjectId) || '';
}


/** Une local + nube por id (gana el más reciente) y descarta borrados. */
export function unionEmployees(localEmployees = [], cloudEmployees = []) {
    const byId = new Map();
    for (const employee of localEmployees) {
        const id = idOf(employee?.id);
        if (!id || employee?.deletedAt != null) continue;
        byId.set(id, { employee, source: 'local' });
    }
    for (const employee of cloudEmployees) {
        const id = idOf(employee?.id);
        if (!id) continue;
        const existing = byId.get(id);
        if (employee?.deletedAt != null) continue;
        if (!existing) { byId.set(id, { employee, source: 'cloud' }); continue; }
        const newer = (Number(employee.updatedAt) || 0) > (Number(existing.employee.updatedAt) || 0);
        byId.set(id, { employee: newer ? employee : existing.employee, source: 'both' });
    }
    return byId;
}

/** Asistencia viva por empleado: cantidad y última fecha. */
export function attendanceStats(attendance = {}) {
    const stats = new Map();
    for (const record of Object.values(attendance || {})) {
        if (!record || record.deletedAt != null) continue;
        const id = idOf(record.employeeId);
        if (!id) continue;
        const entry = stats.get(id) || { count: 0, last: '' };
        entry.count++;
        if (record.date && record.date > entry.last) entry.last = record.date;
        stats.set(id, entry);
    }
    return stats;
}

function pickKeeper(members) {
    return [...members].sort((a, b) =>
        (b.attendanceCount - a.attendanceCount)
        || (b.updatedAt - a.updatedAt)
        || (b.loansCount - a.loansCount)
        || (idFormatRank(b.id) - idFormatRank(a.id)))[0];
}

/**
 * @returns {Array<{
 *   id: string, reason: 'number'|'name'|'both', safe: boolean,
 *   members: Array, proposedKeeperId: string, decisions: Object<string,{role,number?}>
 * }>}
 */
export function buildDuplicateGroups({
    employees = [],
    cloudEmployees = [],
    attendance = {},
    defaultProjectId = null,
    projectNames = {},
    dismissed = new Set()
} = {}) {
    const byId = unionEmployees(employees, cloudEmployees);
    const stats = attendanceStats(attendance);
    const ids = [...byId.keys()];
    const parent = new Map(ids.map(id => [id, id]));
    const find = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    const links = new Map(); // id → Set(reasons)
    const link = (a, b, reason) => {
        union(a, b);
        for (const id of [a, b]) {
            if (!links.has(id)) links.set(id, new Set());
            links.get(id).add(reason);
        }
    };

    const byNumber = new Map();
    const byName = new Map();
    for (const id of ids) {
        const { employee } = byId.get(id);
        const numberKey = employeeNumberIdentityKey(employee.number);
        if (numberKey) {
            const key = `${projectKey(employee, defaultProjectId)}::${numberKey}`;
            if (byNumber.has(key)) link(byNumber.get(key), id, 'number'); else byNumber.set(key, id);
        }
        const nameKey = sortedName(employee.name);
        if (nameKey && nameKey.includes(' ')) { // un solo nombre («Juan») es demasiado común
            if (byName.has(nameKey)) link(byName.get(nameKey), id, 'name'); else byName.set(nameKey, id);
        }
    }

    const clusters = new Map();
    for (const id of links.keys()) {
        const root = find(id);
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root).push(id);
    }

    const groups = [];
    for (const memberIds of clusters.values()) {
        if (memberIds.length < 2) continue;
        const signature = groupSignature(memberIds);
        if (dismissed.has(signature)) continue;
        const reasons = new Set(memberIds.flatMap(id => [...(links.get(id) || [])]));
        const members = memberIds.map(id => {
            const { employee, source } = byId.get(id);
            const projectId = projectKey(employee, defaultProjectId);
            const stat = stats.get(id) || { count: 0, last: '' };
            return {
                id,
                name: employee.name || '',
                number: employee.number ?? '',
                projectId,
                projectName: projectNames[projectId] || '',
                source,
                attendanceCount: stat.count,
                lastAttendance: stat.last,
                loansCount: (employee.loans || []).filter(loan => loan && loan.deletedAt == null).length,
                hasOpenBalance: !canDeleteDuplicateEmployee(employee).ok,
                updatedAt: Number(employee.updatedAt) || 0,
                record: employee
            };
        });
        const keeper = pickKeeper(members);
        // El perfil que se conserva va primero; luego, el de más asistencia.
        members.sort((a, b) => (b.id === keeper.id) - (a.id === keeper.id) || b.attendanceCount - a.attendanceCount);
        const sameNumber = members.every(m => sameEmployeeNumber(m.number, keeper.number));
        const sameProject = members.every(m => m.projectId === keeper.projectId);
        const identicalName = members.every(m => m.name === keeper.name);
        const reason = reasons.size > 1 ? 'both' : reasons.has('number') ? 'number' : 'name';
        const safe = sameNumber && sameProject && identicalName;
        const keeperName = sortedName(keeper.name);
        const decisions = {};
        for (const member of members) {
            if (member.id === keeper.id) decisions[member.id] = { role: DUPLICATE_ROLES.KEEP };
            // Propuesta: el mismo nombre se une; con otro nombre, decide la persona.
            else if (sortedName(member.name) === keeperName) decisions[member.id] = { role: DUPLICATE_ROLES.MERGE };
            else decisions[member.id] = { role: null };
        }
        groups.push({ id: signature, reason, safe, members, proposedKeeperId: keeper.id, decisions });
    }
    return groups.sort((a, b) => (b.safe - a.safe)
        || String(a.members[0].number).localeCompare(String(b.members[0].number), 'es', { numeric: true }));
}

/**
 * Ficha sugerida: la siguiente a la más alta de la obra (no rellena huecos,
 * para no reutilizar el número de un empleado anterior).
 */
export function suggestFreeNumber(employees = [], projectId = '', defaultProjectId = null, reserved = []) {
    const inProject = employees.filter(e => e && e.deletedAt == null && projectKey(e, defaultProjectId) === projectId);
    const numeric = [...inProject.map(e => e.number), ...reserved]
        .map(n => parseInt(String(n ?? '').replace(/\D/g, ''), 10)).filter(Number.isFinite);
    const width = Math.max(3, ...inProject.map(e => String(e?.number ?? '').length).filter(n => n <= 6));
    return String((numeric.length ? Math.max(...numeric) : 0) + 1).padStart(width, '0');
}

/**
 * Valida las decisiones de un grupo y devuelve el plan a ejecutar.
 * `hint` es la razón exacta por la que todavía no se puede aplicar.
 */
export function planGroupDecisions(group, decisions = {}, { employees = [], defaultProjectId = null } = {}) {
    const plan = { ok: false, hint: '', keeperId: null, mergeIds: [], deleteIds: [], renumber: [], blocked: [] };
    const members = group?.members || [];
    const roleOf = member => decisions[member.id]?.role || null;
    const undecided = members.filter(m => !roleOf(m));
    if (undecided.length) { plan.hint = `Elige qué hacer con ${undecided.length === 1 ? undecided[0].name || 'un registro' : `${undecided.length} registros`}`; return plan; }
    const keepers = members.filter(m => roleOf(m) === DUPLICATE_ROLES.KEEP);
    const merges = members.filter(m => roleOf(m) === DUPLICATE_ROLES.MERGE);
    if (keepers.length > 1) { plan.hint = 'Conserva solo un perfil; une o separa los demás'; return plan; }
    if (merges.length && !keepers.length) { plan.hint = 'Marca cuál perfil se conserva'; return plan; }
    const keeper = keepers[0] || null;

    // Quienes quedan vivos no pueden compartir ficha dentro de su obra.
    const staying = members.filter(m => [DUPLICATE_ROLES.KEEP, DUPLICATE_ROLES.OTHER].includes(roleOf(m)));
    const outsiders = employees.filter(e => e && e.deletedAt == null && !members.some(m => m.id === idOf(e.id)));
    const used = [];
    for (const member of staying) {
        const wanted = String(decisions[member.id]?.number ?? member.number ?? '').trim();
        if (!wanted) { plan.hint = `Escribe la ficha nueva de ${member.name}`; return plan; }
        const clash = used.find(u => u.projectId === member.projectId && sameEmployeeNumber(u.number, wanted))
            || outsiders.find(e => projectKey(e, defaultProjectId) === member.projectId && sameEmployeeNumber(e.number, wanted));
        if (clash) {
            const who = clash.name || 'otro empleado';
            plan.hint = sameEmployeeNumber(wanted, member.number)
                ? `${member.name} comparte la ficha ${wanted} con ${who}: dale otra ficha`
                : `La ficha ${wanted} ya es de ${who}`;
            return plan;
        }
        used.push({ projectId: member.projectId, number: wanted, name: member.name });
        if (!sameEmployeeNumber(wanted, member.number)) plan.renumber.push({ id: member.id, number: wanted });
    }

    for (const member of members.filter(m => roleOf(m) === DUPLICATE_ROLES.DELETE)) {
        if (member.hasOpenBalance) plan.blocked.push(member.id);
    }
    if (plan.blocked.length) { plan.hint = 'Un registro a eliminar tiene préstamos con saldo: únelo en vez de eliminarlo'; return plan; }

    plan.ok = true;
    plan.keeperId = keeper?.id || null;
    plan.mergeIds = merges.map(m => m.id);
    plan.deleteIds = members.filter(m => roleOf(m) === DUPLICATE_ROLES.DELETE).map(m => m.id);
    return plan;
}

export default { buildDuplicateGroups, planGroupDecisions, suggestFreeNumber, groupSignature, DUPLICATE_ROLES };
