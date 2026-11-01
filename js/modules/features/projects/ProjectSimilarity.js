import { employeeNumberIdentityKey } from '../employees/EmployeeNumberIdentity.js';
import { normalizePersonName } from './ProjectDuplicateCandidates.js';

/**
 * 🔎 ProjectSimilarity — ¿estas dos obras son en realidad la misma?
 *
 * Dos dispositivos que crean «la misma obra» sin conexión generan ids distintos
 * (y, a veces, nombres distintos, así que el aviso de nombre repetido no salta).
 * Este módulo es puro: compara el personal de cada obra y sugiere pares. Solo
 * sugiere; la fusión siempre la confirma el usuario.
 *
 *   - Una persona es «la misma» si coincide el nombre (sin acentos, mayúsculas
 *     ni orden de palabras) y, con un solo nombre, también el número de ficha.
 *     Un mismo número con otro nombre son personas distintas. Se empareja
 *     primero nombre y ficha iguales y después solo el nombre, para que dos
 *     homónimos no se crucen.
 *   - El parecido es el índice de Jaccard del personal (coincidentes / unión).
 *   - Se exige evidencia mínima: 2 personas en común, o todo el personal de la
 *     obra más pequeña con un nombre de obra parecido.
 *   - La asistencia es evidencia, no veredicto. Las mismas personas en los
 *     mismos días (shared) o con fechas intercaladas apuntan a una copia; fechas
 *     seguidas (adjacent) son lo normal con un dispositivo atrasado. Solo una
 *     separación de más de 30 días (separated) indica etapas distintas de una
 *     misma cuadrilla, y baja un nivel la sugerencia.
 *   - «No son la misma» (`notSameAs` en la obra) silencia ese par.
 */

export const SIMILARITY_LEVEL = Object.freeze({ IDENTICAL: 'identical', SIMILAR: 'similar' });
export const ATTENDANCE_STATE = Object.freeze({
    UNKNOWN: 'unknown', SHARED: 'shared', INTERLEAVED: 'interleaved', ADJACENT: 'adjacent', SEPARATED: 'separated'
});
const IDENTICAL_AT = 0.9;
const SIMILAR_AT = 0.6;
const MIN_NAME_SCORE = 0.5;
const MIN_MATCHED = 2;
const SEPARATED_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const trimId = value => String(value ?? '').trim();
const round = value => Math.round(value * 1000) / 1000;

function isComparableProject(project) {
    const id = trimId(project?.id);
    return Boolean(id) && !id.startsWith('legacy-unresolved:')
        && project.deletedAt == null && (project.status == null || project.status === 'active');
}

/** «No son la misma»: el descarte vive en cualquiera de las dos obras del par. */
export function isDismissedPair(a, b) {
    const listed = (project, other) => Array.isArray(project?.notSameAs) && project.notSameAs.map(trimId).includes(trimId(other?.id));
    return listed(a, b) || listed(b, a);
}

function nameKeyOf(name) {
    return normalizePersonName(name).split(' ').filter(Boolean).sort().join(' ');
}

function dayNumber(value) {
    const text = trimId(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const time = Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? Math.round(time / DAY_MS) : null;
}

/** employeeId → días con asistencia vigente. Acepta lista o mapa por clave. */
function attendanceDaysByEmployee(attendance) {
    const records = Array.isArray(attendance) ? attendance : Object.values(attendance || {});
    const days = new Map();
    for (const record of records) {
        const day = record && record.deletedAt == null ? dayNumber(record.date) : null;
        const employeeId = trimId(record?.employeeId);
        if (day === null || !employeeId) continue;
        if (!days.has(employeeId)) days.set(employeeId, new Set());
        days.get(employeeId).add(day);
    }
    return days;
}

/** Identidad de un empleado, sin repetidos dentro de la misma obra. */
function identitiesOf(employees, daysByEmployee) {
    const seen = new Map();
    for (const employee of employees) {
        const nameKey = nameKeyOf(employee?.name);
        const numberKey = employeeNumberIdentityKey(employee?.number);
        if (!nameKey && !numberKey) continue;
        const key = `${nameKey}|${numberKey ?? ''}`;
        if (!seen.has(key)) seen.set(key, { nameKey, numberKey, name: String(employee?.name ?? '').trim(), number: String(employee?.number ?? '').trim(), employeeIds: new Set(), days: new Set() });
        const identity = seen.get(key);
        if (trimId(employee?.id)) identity.employeeIds.add(trimId(employee.id));
        for (const day of daysByEmployee.get(trimId(employee?.id)) || []) identity.days.add(day);
    }
    return [...seen.values()];
}

function samePerson(left, right) {
    if (!left.nameKey || left.nameKey !== right.nameKey) return false;
    if (left.numberKey && right.numberKey && left.numberKey === right.numberKey) return true;
    return left.nameKey.includes(' ');
}

/** Pares [i, j] uno a uno: primero nombre y ficha iguales, luego solo el nombre. */
function pairPeople(left, right) {
    const pairs = [];
    const usedLeft = new Set();
    const usedRight = new Set();
    const take = test => left.forEach((person, i) => {
        if (usedLeft.has(i)) return;
        const j = right.findIndex((other, k) => !usedRight.has(k) && test(person, other));
        if (j < 0) return;
        usedLeft.add(i);
        usedRight.add(j);
        pairs.push([i, j]);
    });
    take((person, other) => Boolean(person.nameKey) && person.nameKey === other.nameKey
        && Boolean(person.numberKey) && person.numberKey === other.numberKey);
    take(samePerson);
    return pairs;
}

function nameScoreOf(left, right) {
    const tokens = name => new Set(normalizePersonName(name).split(' ').filter(Boolean));
    const a = tokens(left?.name);
    const b = tokens(right?.name);
    if (!a.size || !b.size) return 0;
    const shared = [...a].filter(token => b.has(token)).length;
    return round(shared / (a.size + b.size - shared));
}

function staffOf(projectId, employees, defaultProjectId) {
    const fallback = trimId(defaultProjectId);
    return employees.filter(employee => employee && employee.deletedAt == null
        && (trimId(employee.projectId) || fallback) === projectId);
}

function rangeOf(identities) {
    let from = Infinity;
    let to = -Infinity;
    for (const person of identities) for (const day of person.days) { from = Math.min(from, day); to = Math.max(to, day); }
    return Number.isFinite(from) ? { from, to } : null;
}

const isoDay = day => new Date(day * DAY_MS).toISOString().slice(0, 10);

function attendanceEvidence(identitiesA, identitiesB, pairs) {
    const rangeA = rangeOf(identitiesA);
    const rangeB = rangeOf(identitiesB);
    const view = range => (range ? { from: isoDay(range.from), to: isoDay(range.to) } : null);
    const result = { state: ATTENDANCE_STATE.UNKNOWN, sharedDays: 0, rangeA: view(rangeA), rangeB: view(rangeB) };
    if (!rangeA || !rangeB) return result;
    for (const [i, j] of pairs) for (const day of identitiesA[i].days) if (identitiesB[j].days.has(day)) result.sharedDays++;
    if (result.sharedDays > 0) result.state = ATTENDANCE_STATE.SHARED;
    else if (rangeA.from <= rangeB.to && rangeB.from <= rangeA.to) result.state = ATTENDANCE_STATE.INTERLEAVED;
    else {
        const gap = rangeA.to < rangeB.from ? rangeB.from - rangeA.to : rangeA.from - rangeB.to;
        result.state = gap > SEPARATED_AFTER_DAYS ? ATTENDANCE_STATE.SEPARATED : ATTENDANCE_STATE.ADJACENT;
    }
    return result;
}

function levelOf(enough, score) {
    if (enough && score >= IDENTICAL_AT) return SIMILARITY_LEVEL.IDENTICAL;
    if (enough && score >= SIMILAR_AT) return SIMILARITY_LEVEL.SIMILAR;
    return null;
}

function demote(level) {
    return level === SIMILARITY_LEVEL.IDENTICAL ? SIMILARITY_LEVEL.SIMILAR : null;
}

function compareStaff(a, b, staffA, staffB, daysByEmployee) {
    const identitiesA = identitiesOf(staffA, daysByEmployee);
    const identitiesB = identitiesOf(staffB, daysByEmployee);
    const pairs = pairPeople(identitiesA, identitiesB);
    const matched = pairs.length;
    const union = identitiesA.length + identitiesB.length - matched;
    const score = union ? round(matched / union) : 0;
    const nameScore = nameScoreOf(a, b);
    const smallest = Math.min(identitiesA.length, identitiesB.length);
    const enough = matched >= MIN_MATCHED || (matched >= 1 && matched === smallest && nameScore >= MIN_NAME_SCORE);
    const attendance = attendanceEvidence(identitiesA, identitiesB, pairs);
    let level = levelOf(enough, score);
    if (level && attendance.state === ATTENDANCE_STATE.SEPARATED) level = demote(level);
    return { a, b, score, level, matched, sizeA: identitiesA.length, sizeB: identitiesB.length, nameScore, attendance };
}

function personView(person) {
    return {
        name: person.name, number: person.number, employeeIds: [...person.employeeIds],
        days: [...person.days].sort((x, y) => x - y).map(isoDay)
    };
}

/**
 * Quién está en las dos obras y quién solo en una. Usa el mismo emparejamiento
 * que la comparación, así la vista previa de una fusión coincide con lo sugerido.
 */
export function matchProjectStaff(a, b, employees = [], { defaultProjectId = '', attendance = [] } = {}) {
    const list = Array.isArray(employees) ? employees : [];
    const days = attendanceDaysByEmployee(attendance);
    const identitiesA = identitiesOf(staffOf(trimId(a?.id), list, defaultProjectId), days);
    const identitiesB = identitiesOf(staffOf(trimId(b?.id), list, defaultProjectId), days);
    const pairs = pairPeople(identitiesA, identitiesB);
    const matchedA = new Set(pairs.map(([i]) => i));
    const matchedB = new Set(pairs.map(([, j]) => j));
    return {
        pairs: pairs.map(([i, j]) => ({ a: personView(identitiesA[i]), b: personView(identitiesB[j]) })),
        onlyA: identitiesA.filter((_, i) => !matchedA.has(i)).map(personView),
        onlyB: identitiesB.filter((_, j) => !matchedB.has(j)).map(personView),
        peopleA: identitiesA.length,
        peopleB: identitiesB.length
    };
}

/** Compara dos obras. Simétrico: el orden de los argumentos no cambia el resultado. */
export function compareProjects(a, b, employees = [], { defaultProjectId = '', attendance = [] } = {}) {
    const list = Array.isArray(employees) ? employees : [];
    return compareStaff(a, b, staffOf(trimId(a?.id), list, defaultProjectId), staffOf(trimId(b?.id), list, defaultProjectId),
        attendanceDaysByEmployee(attendance));
}

/** Pares de obras activas que parecen la misma, de más a menos parecidas. */
export function findSimilarProjects(projects = [], employees = [], { defaultProjectId = '', attendance = [] } = {}) {
    const list = Array.isArray(employees) ? employees : [];
    const days = attendanceDaysByEmployee(attendance);
    const candidates = (Array.isArray(projects) ? projects : []).filter(isComparableProject)
        .sort((x, y) => trimId(x.id).localeCompare(trimId(y.id)));
    const staff = new Map(candidates.map(project => [trimId(project.id), staffOf(trimId(project.id), list, defaultProjectId)]));
    const pairs = [];
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            if (isDismissedPair(candidates[i], candidates[j])) continue;
            const result = compareStaff(candidates[i], candidates[j], staff.get(trimId(candidates[i].id)), staff.get(trimId(candidates[j].id)), days);
            if (result.level) pairs.push(result);
        }
    }
    return pairs.sort((x, y) => y.score - x.score
        || trimId(x.a.id).localeCompare(trimId(y.a.id)) || trimId(x.b.id).localeCompare(trimId(y.b.id)));
}

export default { compareProjects, findSimilarProjects, matchProjectStaff, isDismissedPair, SIMILARITY_LEVEL, ATTENDANCE_STATE };
