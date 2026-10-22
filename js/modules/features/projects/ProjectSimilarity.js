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
 *     Un mismo número con otro nombre son personas distintas.
 *   - El parecido es el índice de Jaccard del personal (coincidentes / unión).
 *   - Se exige evidencia mínima: 2 personas en común, o todo el personal de la
 *     obra más pequeña con un nombre de obra parecido.
 */

export const SIMILARITY_LEVEL = Object.freeze({ IDENTICAL: 'identical', SIMILAR: 'similar' });
const IDENTICAL_AT = 0.9;
const SIMILAR_AT = 0.6;
const MIN_NAME_SCORE = 0.5;
const MIN_MATCHED = 2;

const trimId = value => String(value ?? '').trim();
const round = value => Math.round(value * 1000) / 1000;

function isComparableProject(project) {
    const id = trimId(project?.id);
    return Boolean(id) && !id.startsWith('legacy-unresolved:')
        && project.deletedAt == null && (project.status == null || project.status === 'active');
}

function nameKeyOf(name) {
    return normalizePersonName(name).split(' ').filter(Boolean).sort().join(' ');
}

/** Identidad de un empleado, sin repetidos dentro de la misma obra. */
function identitiesOf(employees) {
    const seen = new Map();
    for (const employee of employees) {
        const nameKey = nameKeyOf(employee?.name);
        const numberKey = employeeNumberIdentityKey(employee?.number);
        if (!nameKey && !numberKey) continue;
        const key = `${nameKey}|${numberKey ?? ''}`;
        if (!seen.has(key)) seen.set(key, { nameKey, numberKey });
    }
    return [...seen.values()];
}

function samePerson(left, right) {
    if (!left.nameKey || left.nameKey !== right.nameKey) return false;
    if (left.numberKey && right.numberKey && left.numberKey === right.numberKey) return true;
    return left.nameKey.includes(' ');
}

function countMatches(left, right) {
    const used = new Set();
    let matched = 0;
    for (const person of left) {
        const index = right.findIndex((other, i) => !used.has(i) && samePerson(person, other));
        if (index < 0) continue;
        used.add(index);
        matched++;
    }
    return matched;
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

function compareStaff(a, b, staffA, staffB) {
    const identitiesA = identitiesOf(staffA);
    const identitiesB = identitiesOf(staffB);
    const matched = countMatches(identitiesA, identitiesB);
    const union = identitiesA.length + identitiesB.length - matched;
    const score = union ? round(matched / union) : 0;
    const nameScore = nameScoreOf(a, b);
    const smallest = Math.min(identitiesA.length, identitiesB.length);
    const enough = matched >= MIN_MATCHED || (matched >= 1 && matched === smallest && nameScore >= MIN_NAME_SCORE);
    let level = null;
    if (enough && score >= IDENTICAL_AT) level = SIMILARITY_LEVEL.IDENTICAL;
    else if (enough && score >= SIMILAR_AT) level = SIMILARITY_LEVEL.SIMILAR;
    return { a, b, score, level, matched, sizeA: identitiesA.length, sizeB: identitiesB.length, nameScore };
}

/** Compara dos obras. Simétrico: el orden de los argumentos no cambia el resultado. */
export function compareProjects(a, b, employees = [], { defaultProjectId = '' } = {}) {
    const list = Array.isArray(employees) ? employees : [];
    return compareStaff(a, b, staffOf(trimId(a?.id), list, defaultProjectId), staffOf(trimId(b?.id), list, defaultProjectId));
}

/** Pares de obras activas que parecen la misma, de más a menos parecidas. */
export function findSimilarProjects(projects = [], employees = [], { defaultProjectId = '' } = {}) {
    const list = Array.isArray(employees) ? employees : [];
    const candidates = (Array.isArray(projects) ? projects : []).filter(isComparableProject)
        .sort((x, y) => trimId(x.id).localeCompare(trimId(y.id)));
    const staff = new Map(candidates.map(project => [trimId(project.id), staffOf(trimId(project.id), list, defaultProjectId)]));
    const pairs = [];
    for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
            const result = compareStaff(candidates[i], candidates[j], staff.get(trimId(candidates[i].id)), staff.get(trimId(candidates[j].id)));
            if (result.level) pairs.push(result);
        }
    }
    return pairs.sort((x, y) => y.score - x.score
        || trimId(x.a.id).localeCompare(trimId(y.a.id)) || trimId(x.b.id).localeCompare(trimId(y.b.id)));
}

export default { compareProjects, findSimilarProjects, SIMILARITY_LEVEL };
