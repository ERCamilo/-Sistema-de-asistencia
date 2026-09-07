/**
 * 🔗 PettyCashOfficialLink (F1.7) — vínculo aditivo 1 official Project → N
 * PettyCashProjects vía `officialProjectId` (DEP-SA-001, frozen contract).
 *
 * Contrato congelado:
 * - `officialProjectId` es NULLABLE y ADITIVO sobre PettyCashProject. Nunca
 *   se reescribe el layout de repositorios/queries, ni Supabase, ni el schema
 *   de IndexedDB, ni nómina, ni la identidad canónica de Project, ni las
 *   listas del entity store de adopción/M2, ni se borra/recálcula historial.
 * - Projects OFF ⇒ byte-stable: los nacimientos OMITEN la key por completo
 *   (ni siquiera `officialProjectId: null`). El backfill es inerte bajo OFF.
 * - Projects ON ⇒ los nacimientos SIEMPRE traen own-key (id válido o null
 *   explícito = huérfano visible); el backfill sella UNA vez con el default.
 * - Los `projectId` internos de periods/movements NO son canónicos y jamás
 *   se tocan aquí.
 * - Un vínculo ausente/inválido es un diagnóstico VISIBLE (huérfano), nunca
 *   un filtro silencioso ni un borrado. No se filtran filas huérfanas ni de
 *   historial. Sin reescritura de lanes de sync ni de colecciones.
 *
 * Este módulo es puro salvo `backfillMissingOfficialLinks`, que sólo toca
 * `pettyCashProjects` en local (vía el IDB inyectado, por defecto el
 * singleton) en chunks con yield, sin encolar petty outbox ni escribir nube.
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { indexedDBService } from '../../services/IndexedDBService.js';

export const OFFICIAL_LINK_KEY = 'officialProjectId';
export const PETTY_PROJECTS_STORE = 'pettyCashProjects';
export const PETTY_OFFICIAL_BACKFILL_CHUNK_SIZE = 50;

/** Normaliza a id oficial válido (string no vacío recortado) o null. */
export function normalizeOfficialProjectId(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

/** ¿Es un id oficial válido (no-null, no-vacío)? */
export function isValidOfficialProjectId(value) {
    return normalizeOfficialProjectId(value) !== null;
}

/** ¿El proyecto trae own-key `officialProjectId` (aunque sea null)? */
export function hasOwnOfficialLink(project) {
    if (!project || typeof project !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(project, OFFICIAL_LINK_KEY);
}

/** Id oficial del proyecto petty o null (ausente/inválido ⇒ null). */
export function getOfficialProjectId(project) {
    if (!project || typeof project !== 'object') return null;
    return normalizeOfficialProjectId(project[OFFICIAL_LINK_KEY]);
}

/**
 * Estado del vínculo para diagnóstico visible:
 * - 'linked' ⇒ tiene id válido (y, si se dan conocidos, existe entre ellos).
 * - 'orphan-missing' ⇒ sin id válido (ausente, null, vacío).
 * - 'orphan-invalid' ⇒ id válido pero fuera de la lista conocida.
 * Sin `knownOfficialIds` no se puede juzgar invalidez: válido ⇒ 'linked'.
 */
export function getLinkStatus(project, knownOfficialIds = null) {
    const link = getOfficialProjectId(project);
    if (!link) return 'orphan-missing';
    if (knownOfficialIds == null) return 'linked';
    const known = Array.isArray(knownOfficialIds)
        ? knownOfficialIds
        : [...knownOfficialIds];
    const normalized = known
        .map(normalizeOfficialProjectId)
        .filter((id) => id !== null);
    return normalized.includes(link) ? 'linked' : 'orphan-invalid';
}

/** ¿Debe mostrarse como huérfano (missing o inválido)? Nunca filtra. */
export function isOrphan(project, knownOfficialIds = null) {
    return getLinkStatus(project, knownOfficialIds) !== 'linked';
}

/** Selector 1:N — petty projects vinculados a un official id (puro). */
export function selectPettyByOfficial(projects, officialId) {
    const target = normalizeOfficialProjectId(officialId);
    if (!target || !Array.isArray(projects)) return [];
    return projects.filter(
        (project) => getOfficialProjectId(project) === target
    );
}

/** Agrupa por official id (`__orphan__` para ausentes/inválidos). Puro. */
export function groupPettyByOfficial(projects) {
    const groups = new Map();
    for (const project of Array.isArray(projects) ? projects : []) {
        if (!project || project.id == null) continue;
        const link = getOfficialProjectId(project);
        const key = link || '__orphan__';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(project);
    }
    return groups;
}

/**
 * Resuelve el id de nacimiento bajo semántica de contexto existente:
 * active vigente, fallback al default canónico sólo si active no disponible.
 * Puro — el caller resuelve active/default con ProjectContext/DefaultProject.
 */
export function resolveBirthOfficialId({ activeProjectId = null, defaultProjectId = null } = {}) {
    return (
        normalizeOfficialProjectId(activeProjectId) ||
        normalizeOfficialProjectId(defaultProjectId) ||
        null
    );
}

/**
 * Estampa un nacimiento petty (no muta la entrada):
 * - enabled false ⇒ CLON SIN own-key (byte-stable legacy).
 * - enabled true ⇒ CLON CON own-key (`officialProjectId: id | null`).
 */
export function stampBirthLink(baseProject, { enabled = false, activeProjectId = null, defaultProjectId = null } = {}) {
    const clone = { ...(baseProject || {}) };
    if (!enabled) {
        delete clone[OFFICIAL_LINK_KEY];
        return clone;
    }
    clone[OFFICIAL_LINK_KEY] = resolveBirthOfficialId({ activeProjectId, defaultProjectId });
    return clone;
}

/** ¿Necesita backfill? Tiene identidad pero sin vínculo válido. */
export function needsBackfill(project) {
    if (!project || typeof project !== 'object') return false;
    if (project.id == null) return false;
    return !isValidOfficialProjectId(project[OFFICIAL_LINK_KEY]);
}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Backfill idempotente UNA vez con el default oficial:
 * - Flag OFF ⇒ { skipped:true } SIN tocar storage.
 * - Sin default resoluble ⇒ { skipped:false, stamped:0 } sin escribir.
 * - Sólo añade `officialProjectId` a proyectos que lo necesitan; preserva
 *   todos los demás campos; jamás toca periods/movements (sólo lee/escribe
 *   `pettyCashProjects` en local). No encola outbox ni escribe nube: usa el
 *   IDB local directo (batchUpdate por chunks con yield).
 */
export async function backfillMissingOfficialLinks({
    defaultOfficialProjectId = null,
    idb = indexedDBService,
    chunkSize = PETTY_OFFICIAL_BACKFILL_CHUNK_SIZE,
    yieldFn = yieldToUi
} = {}) {
    if (!isProjectsEnabled()) {
        return { skipped: true, scanned: 0, stamped: 0 };
    }
    const defaultId = normalizeOfficialProjectId(defaultOfficialProjectId);
    if (!defaultId) {
        console.warn('⚠️ PettyCashOfficialLink: sin proyecto oficial default resoluble; no se sella nada en esta corrida.');
        return { skipped: false, scanned: 0, stamped: 0 };
    }
    const records = (await idb.getAll(PETTY_PROJECTS_STORE)) || [];
    const scanned = records.length;
    const pending = records.filter(needsBackfill);
    const size = Number(chunkSize) > 0 ? Number(chunkSize) : PETTY_OFFICIAL_BACKFILL_CHUNK_SIZE;
    for (let i = 0; i < pending.length; i += size) {
        const chunk = pending
            .slice(i, i + size)
            .map((record) => ({ ...record, [OFFICIAL_LINK_KEY]: defaultId }));
        await idb.batchUpdate(PETTY_PROJECTS_STORE, chunk);
        await yieldFn();
    }
    return { skipped: false, scanned, stamped: pending.length };
}

export default {
    OFFICIAL_LINK_KEY,
    normalizeOfficialProjectId,
    isValidOfficialProjectId,
    hasOwnOfficialLink,
    getOfficialProjectId,
    getLinkStatus,
    isOrphan,
    selectPettyByOfficial,
    groupPettyByOfficial,
    resolveBirthOfficialId,
    stampBirthLink,
    needsBackfill,
    backfillMissingOfficialLinks
};
