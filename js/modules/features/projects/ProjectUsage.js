import indexedDBService from '../../services/IndexedDBService.js';
import { peekEntityScope } from './EntityProjectScope.js';

const id = value => String(value ?? '').trim();
const SKIP_STORES = new Set(['projects', 'projectPayrollConfigs', 'syncLocks', 'employeePhotos', 'pettyCashReceipts']);
const FALLBACK_STORES = ['employees', 'positions', 'leaders', 'attendance', 'payrollClosures', 'pettyCashProjects', 'pettyCashPeriods', 'pettyCashMovements', 'settings', 'mainSyncOutbox', 'pettyCashOutbox', 'sync_queue'];
const PROJECT_KEYS = new Set(['projectId', 'officialProjectId', 'payrollProjectId', 'sourceProjectId', 'targetProjectId']);
const ARRAY = value => Array.isArray(value) ? value : Object.values(value || {});

export function protectedProjectIds() {
    const scope = peekEntityScope();
    let active = scope.projectId, initial = scope.defaultProjectId;
    try { active = localStorage.getItem('asistencia_active_project_id') || active; } catch (_) {}
    try { initial = localStorage.getItem('asistencia_default_project_id') || initial; } catch (_) {}
    return { activeProjectId: id(active), defaultProjectId: id(initial) };
}

function usageStores(idb) {
    return idb.db?.objectStoreNames
        ? [...idb.db.objectStoreNames].filter(name => !SKIP_STORES.has(name)) : FALLBACK_STORES;
}

/** Una sola vista consistente; un fallo de lectura nunca equivale a cero. */
export async function readProjectUsageData({ idb = indexedDBService } = {}) {
    await idb.init?.();
    const stores = usageStores(idb);
    if (!idb.db?.transaction) {
        const pairs = await Promise.all(stores.map(async name => [name, await idb.getAll(name) || []]));
        return Object.fromEntries(pairs);
    }
    return new Promise((resolve, reject) => {
        const tx = idb.db.transaction(stores, 'readonly'), data = {};
        tx.oncomplete = () => resolve(data);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('No se pudieron verificar los datos de las obras.'));
        for (const name of stores) tx.objectStore(name).getAll().onsuccess = event => { data[name] = event.target.result; };
    });
}

/** Incluye registros inactivos/borrados: su historial aún referencia la obra. */
export function summarizeProjectUsage(projects, data, { liveState = {}, defaultProjectId = protectedProjectIds().defaultProjectId } = {}) {
    const result = Object.fromEntries(projects.map(project => [project.id, {
        verified: true, employees: 0, positions: 0, loans: 0, attendance: 0,
        leaders: 0, payrollClosures: 0, pettyCash: 0, other: 0, pending: 0
    }]));
    const seen = new Map();
    const add = (projectId, kind, key) => {
        const pid = id(projectId);
        if (!result[pid]) return;
        const token = `${pid}:${kind}:${key}`;
        if (seen.has(token)) return;
        seen.set(token, true);
        result[pid][kind]++;
    };
    const records = { ...data };
    for (const name of ['employees', 'positions', 'leaders', 'attendance', 'tempAssignments']) {
        records[name] = [...ARRAY(data[name]), ...ARRAY(liveState[name])];
    }
    const owner = row => id(row?.projectId) || id(defaultProjectId);
    const entityOwners = new Map();
    for (const name of ['employees', 'positions', 'leaders']) {
        for (const row of records[name] || []) {
            if (!row?.id) continue;
            const key = id(row.id);
            if (!entityOwners.has(key)) entityOwners.set(key, new Set());
            entityOwners.get(key).add(owner(row));
        }
    }
    const cashOwners = new Map(ARRAY(data.pettyCashProjects).map(row => [id(row.id), id(row.officialProjectId)]));
    const refs = (value, found = new Set(), visited = new Set(), cash = false) => {
        if (!value || typeof value !== 'object' || visited.has(value)) return found;
        visited.add(value);
        for (const [key, item] of Object.entries(value)) {
            if (PROJECT_KEYS.has(key) && !(cash && key === 'projectId') && typeof item === 'string') found.add(id(item));
            if (['employeeId', 'positionId', 'leaderId'].includes(key)) {
                for (const pid of entityOwners.get(id(item)) || []) found.add(pid);
            }
            if (item && typeof item === 'object') refs(item, found, visited, cash);
        }
        return found;
    };
    const primary = new Set(['employees', 'positions', 'leaders', 'attendance', 'payrollClosures']);
    for (const [name, rows] of Object.entries(records)) {
        if (SKIP_STORES.has(name)) continue;
        ARRAY(rows).forEach((row, index) => {
            if (!row || typeof row !== 'object') return;
            const key = id(row.id || row.key) || String(index);
            const cash = name.startsWith('pettyCash');
            const pid = primary.has(name) ? owner(row)
                : name === 'pettyCashProjects' ? id(row.officialProjectId)
                    : ['pettyCashPeriods', 'pettyCashMovements'].includes(name) ? cashOwners.get(id(row.projectId)) : '';
            if (pid) add(pid, primary.has(name) ? name : 'pettyCash', `${name}:${key}`);
            if (name === 'employees') {
                ARRAY(row.loans).forEach((loan, n) => add(id(loan?.projectId) || pid, 'loans', `${key}:${loan?.id || n}`));
            }
            for (const linked of refs(row, new Set(), new Set(), cash)) {
                if (linked !== pid) add(linked, /outbox|sync_queue/i.test(name) ? 'pending' : 'other', `${name}:${key}`);
            }
        });
    }
    for (const usage of Object.values(result)) {
        usage.empty = ['employees', 'positions', 'loans', 'attendance', 'leaders', 'payrollClosures', 'pettyCash', 'other', 'pending'].every(key => usage[key] === 0);
    }
    return result;
}

export async function deleteEmptyProject(projectId, { idb = indexedDBService, getLiveState = () => ({}), getProtectedIds = protectedProjectIds } = {}) {
    await idb.init?.();
    if (!idb.db?.transaction) throw new Error('No se pudo verificar el almacenamiento. Reintenta antes de borrar.');
    const stores = [...new Set(['projects', ...usageStores(idb)])];
    return new Promise((resolve, reject) => {
        const tx = idb.db.transaction(stores, 'readwrite');
        const data = {}; let remaining = stores.length, saved, failure;
        tx.oncomplete = () => resolve(saved);
        tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('No se pudo borrar la obra.'));
        for (const name of stores) tx.objectStore(name).getAll().onsuccess = event => {
            data[name] = event.target.result;
            if (--remaining) return;
            try {
                const row = data.projects.find(project => project.id === projectId);
                if (!row) throw new Error('La obra ya no está disponible. Actualiza la lista.');
                const protectedIds = getProtectedIds();
                if (projectId === protectedIds.activeProjectId) throw new Error('Cambia a otra obra antes de borrarla.');
                if (projectId === protectedIds.defaultProjectId) throw new Error('La obra inicial se conserva como referencia del sistema.');
                const usage = summarizeProjectUsage([row], data, { liveState: getLiveState(), defaultProjectId: protectedIds.defaultProjectId })[projectId];
                if (!usage.empty) throw new Error('La obra contiene datos o sincronizaciones pendientes. No se borró. Actualiza la lista.');
                const now = Math.max(Date.now(), (Number(row.updatedAt) || 0) + 1);
                saved = { ...row, deletedAt: row.deletedAt || now, updatedAt: now };
                tx.objectStore('projects').put(saved);
            } catch (error) { failure = error; tx.abort(); }
        };
    });
}

/** Un borrado remoto nunca oculta una obra que aquí aún tiene datos o está en uso. */
export function protectDeletedProjects(projects, usage, protectedIds = protectedProjectIds()) {
    return projects.map(row => {
        if (row.deletedAt == null || (usage[row.id]?.empty === true
            && row.id !== protectedIds.activeProjectId && row.id !== protectedIds.defaultProjectId)) return row;
        const kept = { ...row, metadata: { ...row.metadata, deletionConflict: { deletedAt: row.deletedAt } } };
        delete kept.deletedAt;
        return kept;
    });
}
