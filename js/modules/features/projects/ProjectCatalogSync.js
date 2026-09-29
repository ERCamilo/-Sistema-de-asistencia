/**
 * 🔄 ProjectCatalogSync — la lista de obras se comparte entre dispositivos.
 *
 * Hasta ahora el catálogo de obras vivía solo en IndexedDB de cada dispositivo
 * (ProjectStore: "local-first"). Los empleados, puestos, líderes y asistencia
 * sí viajan por la nube con su projectId, así que un dispositivo podía recibir
 * datos de una obra que no conocía y mostrarlos como huérfanos; si alguien los
 * «reparaba» ahí, se reasignaban a otra obra y el otro dispositivo los perdía
 * de vista (ping-pong).
 *
 * Contrato:
 *   - users/{uid}/projectsV1/{id} guarda la identidad de cada obra (id, nombre,
 *     estado, fechas). La colección y sus reglas ya existían (ProjectRegistry).
 *   - Unión por id y LWW por updatedAt. Nunca se borra una obra por sincronizar.
 *   - Una obra recibida nace con configuración de nómina: copia de la obra por
 *     defecto (misma regla que la reconciliación). La configuración sigue
 *     siendo local; nunca se pisa una existente.
 *   - Las obras «Mi obra» que la adopción canónica deja vacías en cada
 *     dispositivo no se publican: si están vacías se retiran localmente.
 *   - Dos obras con el mismo nombre se informan (getCatalogNameDuplicates);
 *     unirlas es una decisión explícita del usuario.
 *
 * Nunca lanza hacia afuera: sin red o sin sesión, el catálogo local sigue
 * funcionando como antes.
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { auth, db, doc, setDoc, collection, getDocs, onSnapshot } from '../../data/firebase.js';
import { indexedDBService } from '../../services/IndexedDBService.js';
import { PROJECTS_V1_COLLECTION } from './ProjectRegistry.js';
import { ADOPTION_MARKER_KEY } from './ProjectAdoption.js';
import { DEFAULT_PROJECT_LS_KEY, peekEntityScope } from './EntityProjectScope.js';
import { ACTIVE_PROJECT_LS_KEY } from './ProjectContext.js';
import { projectNameKey } from './ProjectNames.js';
import { createDefaultConfig, cloneConfig } from '../payroll/ProjectPayrollConfig.js';

const CATALOG_FIELDS = ['id', 'name', 'status', 'createdAt', 'updatedAt', 'closedAt', 'archivedAt', 'schemaVersion'];
const PAYROLL_CONFIG_STORE = 'projectPayrollConfigs';

let _lastDuplicates = [];
let _liveUnsub = null;
let _liveUid = null;
let _publishTimer = null;
let _inFlight = null;

const trimId = value => String(value ?? '').trim();
const isValidProjectId = id => {
    const value = trimId(id);
    return Boolean(value) && !value.startsWith('legacy-unresolved:');
};

/** Solo la identidad de la obra viaja a la nube. */
export function toCatalogDoc(project) {
    const out = {};
    for (const field of CATALOG_FIELDS) {
        if (project?.[field] !== undefined && project?.[field] !== null) out[field] = project[field];
    }
    out.id = trimId(project?.id);
    return out;
}

function isCatalogProject(project) {
    return Boolean(project) && isValidProjectId(project.id) && typeof project.name === 'string' && project.name.trim() !== '';
}

/**
 * Plan puro: qué guardar localmente (lo remoto más nuevo o desconocido) y qué
 * publicar (lo local más nuevo o ausente en la nube).
 */
export function planCatalogMerge(localList = [], remoteList = [], { excludeIds = [] } = {}) {
    const excluded = new Set(excludeIds.map(trimId));
    const local = new Map();
    const remote = new Map();
    for (const project of localList) if (isCatalogProject(project)) local.set(trimId(project.id), project);
    for (const project of remoteList) if (isCatalogProject(project)) remote.set(trimId(project.id), project);
    const storeLocal = [];
    const publish = [];
    for (const id of new Set([...local.keys(), ...remote.keys()])) {
        if (excluded.has(id)) continue;
        const mine = local.get(id);
        const theirs = remote.get(id);
        if (!theirs) { publish.push(toCatalogDoc(mine)); continue; }
        if (!mine) { storeLocal.push({ ...toCatalogDoc(theirs) }); continue; }
        const mineAt = Number(mine.updatedAt) || 0;
        const theirsAt = Number(theirs.updatedAt) || 0;
        if (theirsAt > mineAt) storeLocal.push({ ...mine, ...toCatalogDoc(theirs) });
        else if (mineAt > theirsAt) publish.push(toCatalogDoc(mine));
    }
    return { storeLocal, publish };
}

/** Grupos de obras con el mismo nombre normalizado (ignora mayúsculas y espacios). */
export function findCatalogNameDuplicates(projects = []) {
    const groups = new Map();
    for (const project of projects) {
        if (!isCatalogProject(project)) continue;
        const key = projectNameKey(project.name);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ id: trimId(project.id), name: project.name, createdAt: project.createdAt ?? null });
    }
    return [...groups.values()].filter(group => group.length > 1)
        .map(group => group.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || a.id.localeCompare(b.id)));
}

export function getCatalogNameDuplicates() {
    return _lastDuplicates.map(group => group.map(item => ({ ...item })));
}

function readLocalStorage(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
}

function adoptionLegacyIds() {
    try {
        const marker = JSON.parse(readLocalStorage(ADOPTION_MARKER_KEY) || 'null');
        return Object.keys(marker?.done || {})
            .map(key => key.split('->'))
            .filter(([legacy, canonical]) => legacy && canonical && legacy !== canonical)
            .map(([legacy]) => trimId(legacy));
    } catch (_) {
        return [];
    }
}

/** ¿Algún dato local (o puntero del dispositivo) usa esta obra? */
export async function projectHasLocalData(projectId, { idb = indexedDBService } = {}) {
    const id = trimId(projectId);
    if (!id) return false;
    if (readLocalStorage(DEFAULT_PROJECT_LS_KEY) === id || readLocalStorage(ACTIVE_PROJECT_LS_KEY) === id) return true;
    const owned = record => trimId(record?.projectId) === id || trimId(record?.officialProjectId) === id;
    for (const store of ['employees', 'positions', 'leaders', 'payrollClosures', 'pettyCashProjects', 'attendance']) {
        let records;
        try { records = await idb.getAll(store); } catch (_) { return true; } // sin lectura: se asume que sí
        if ((records || []).some(owned)) return true;
    }
    return false;
}

/**
 * Retira las obras vacías que la adopción canónica dejó en este dispositivo.
 * Solo toca ids registrados como «legacy» en el marcador de adopción.
 */
export async function removeEmptyAdoptionLeftovers({ idb = indexedDBService } = {}) {
    const removed = [];
    for (const id of adoptionLegacyIds()) {
        let project = null;
        try { project = await idb.get('projects', id); } catch (_) { continue; }
        if (!project) continue;
        if (await projectHasLocalData(id, { idb })) continue;
        try {
            await idb.delete('projects', id);
            await idb.delete(PAYROLL_CONFIG_STORE, id).catch(() => {});
            removed.push(id);
        } catch (_) { /* se reintenta en la próxima sincronización */ }
    }
    return removed;
}

/** Una obra recibida nace con la configuración de nómina de la obra por defecto. */
async function seedPayrollConfig(projectId, { idb = indexedDBService } = {}) {
    try {
        if (await idb.get(PAYROLL_CONFIG_STORE, projectId)) return false;
        const seedId = trimId(peekEntityScope()?.defaultProjectId || readLocalStorage(DEFAULT_PROJECT_LS_KEY));
        const seed = seedId && seedId !== projectId ? await idb.get(PAYROLL_CONFIG_STORE, seedId) : null;
        const config = seed ? { ...cloneConfig(seed), projectId } : createDefaultConfig(projectId, {});
        await idb.update(PAYROLL_CONFIG_STORE, { ...config, updatedAt: Date.now() });
        return true;
    } catch (_) {
        return false;
    }
}

function catalogCollection(uid) {
    return collection(db, 'users', String(uid), PROJECTS_V1_COLLECTION);
}

function catalogDoc(uid, id) {
    return doc(db, 'users', String(uid), PROJECTS_V1_COLLECTION, String(id));
}

function currentUid() {
    return auth?.currentUser?.uid ? String(auth.currentUser.uid) : null;
}

function announceChange(detail) {
    try {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { source: 'catalog-sync', ...detail } }));
        }
    } catch (_) { /* sin UI */ }
}

async function applyRemoteCatalog(uid, remoteList, { idb = indexedDBService, writeDoc = setDoc } = {}) {
    await idb.init?.();
    const removed = await removeEmptyAdoptionLeftovers({ idb });
    const leftovers = new Set(adoptionLegacyIds());
    const localList = await idb.getAll('projects');
    // Una obra «legacy» vacía que no esté en la nube nunca se publica.
    const excludeIds = [];
    for (const project of localList || []) {
        const id = trimId(project?.id);
        if (leftovers.has(id) && !remoteList.some(remote => trimId(remote?.id) === id)
            && !(await projectHasLocalData(id, { idb }))) excludeIds.push(id);
    }
    const plan = planCatalogMerge(localList || [], remoteList, { excludeIds });
    for (const project of plan.storeLocal) {
        await idb.update('projects', project);
        await seedPayrollConfig(trimId(project.id), { idb });
    }
    let published = 0;
    for (const project of plan.publish) {
        try {
            await writeDoc(catalogDoc(uid, project.id), project);
            published++;
        } catch (error) {
            console.warn(`⚠️ Obras: no se pudo publicar «${project.name}» en la nube:`, error?.message || error);
        }
    }
    const finalList = await idb.getAll('projects');
    _lastDuplicates = findCatalogNameDuplicates(finalList || []);
    if (_lastDuplicates.length) {
        console.warn('⚠️ Obras con el mismo nombre:', _lastDuplicates.map(group => group.map(item => `${item.name} (${item.id})`).join(' = ')).join('; '));
    }
    if (plan.storeLocal.length || removed.length) {
        announceChange({ received: plan.storeLocal.map(project => project.id), removed });
    }
    return { received: plan.storeLocal.length, published, removed, duplicates: getCatalogNameDuplicates() };
}

/**
 * Descarga el catálogo de la nube, lo une con el local y publica lo que falte.
 * Devuelve null si no aplica (flag OFF, sin sesión o sin red).
 */
export async function syncProjectCatalog({ uid = currentUid(), idb = indexedDBService, readDocs = getDocs, writeDoc = setDoc } = {}) {
    if (!isProjectsEnabled() || !uid) return null;
    if (_inFlight) return _inFlight;
    _inFlight = (async () => {
        try {
            const snapshot = await readDocs(catalogCollection(uid));
            const remoteList = [];
            snapshot.forEach(item => remoteList.push({ ...item.data(), id: item.id }));
            return await applyRemoteCatalog(uid, remoteList, { idb, writeDoc });
        } catch (error) {
            console.warn('⚠️ Obras: sincronización del catálogo no disponible:', error?.message || error);
            return null;
        } finally {
            _inFlight = null;
        }
    })();
    return _inFlight;
}

/** Espera la sincronización como mucho `timeoutMs` (para no bloquear la UI sin red). */
export async function syncProjectCatalogWithin(timeoutMs = 4000, options = {}) {
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); });
    try {
        return await Promise.race([syncProjectCatalog(options), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/** Publica cambios locales del catálogo (crear/renombrar/cerrar obra) con debounce. */
export function scheduleProjectCatalogPublish(delayMs = 1500) {
    if (!isProjectsEnabled()) return;
    clearTimeout(_publishTimer);
    _publishTimer = setTimeout(() => { syncProjectCatalog().catch(() => {}); }, delayMs);
}

/** Escucha la colección para recibir obras nuevas o renombradas en vivo. */
export function startProjectCatalogLiveSync(uid = currentUid()) {
    if (!isProjectsEnabled() || !uid) return false;
    if (_liveUnsub && _liveUid === String(uid)) return true;
    stopProjectCatalogLiveSync();
    try {
        _liveUid = String(uid);
        _liveUnsub = onSnapshot(catalogCollection(uid), snapshot => {
            if (snapshot?.metadata?.hasPendingWrites) return;
            const remoteList = [];
            snapshot.forEach(item => remoteList.push({ ...item.data(), id: item.id }));
            applyRemoteCatalog(_liveUid, remoteList).catch(error =>
                console.warn('⚠️ Obras: no se pudo aplicar el catálogo recibido:', error?.message || error));
        }, error => console.warn('⚠️ Obras: escucha del catálogo interrumpida:', error?.message || error));
        return true;
    } catch (error) {
        console.warn('⚠️ Obras: no se pudo escuchar el catálogo:', error?.message || error);
        _liveUnsub = null;
        _liveUid = null;
        return false;
    }
}

export function stopProjectCatalogLiveSync() {
    try { if (typeof _liveUnsub === 'function') _liveUnsub(); } catch (_) { /* noop */ }
    _liveUnsub = null;
    _liveUid = null;
    clearTimeout(_publishTimer);
}

if (typeof window !== 'undefined') {
    for (const eventName of ['projects:created', 'projects:setup-changed']) {
        window.addEventListener(eventName, event => {
            if (event?.detail?.source === 'catalog-sync') return;
            scheduleProjectCatalogPublish();
        });
    }
}

export default {
    syncProjectCatalog, syncProjectCatalogWithin, scheduleProjectCatalogPublish,
    startProjectCatalogLiveSync, stopProjectCatalogLiveSync, getCatalogNameDuplicates
};
