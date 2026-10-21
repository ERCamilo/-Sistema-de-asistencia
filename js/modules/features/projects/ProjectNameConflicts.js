import indexedDBService from '../../services/IndexedDBService.js';
import { findProjectNameConflict, firstAvailableProjectName, duplicateProjectNameMessage } from './ProjectNames.js';

export const PROJECT_NAME_CONFLICT_EVENT = 'projects:name-conflicts';

/** Serializa lectura/validación/escritura entre pestañas en la misma transacción. */
export async function mutateProjectCatalog(idb, build) {
    await idb.init?.();
    if (!idb.db?.transaction) {
        // Adaptadores de memoria inyectados; el runtime usa la transacción IDB.
        const { writes = [], result } = build(await idb.getAll('projects') || []);
        for (const row of writes) await idb.update('projects', row);
        return result;
    }
    return new Promise((resolve, reject) => {
        const tx = idb.db.transaction('projects', 'readwrite');
        let result, failure;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('No se pudo guardar el catálogo de obras.'));
        const store = tx.objectStore('projects');
        store.getAll().onsuccess = event => {
            try {
                const plan = build(event.target.result);
                result = plan.result;
                for (const row of plan.writes || []) store.put(JSON.parse(JSON.stringify(row)));
            } catch (error) {
                failure = error;
                tx.abort();
            }
        };
    });
}

/** Conserva IDs y datos; los nombres provisionales jamás se publican. */
export function stageProjectNameConflicts(projects, { incomingIds = [], incomingSource = 'cloud' } = {}) {
    const incoming = new Set(incomingIds);
    const rows = projects.map(row => ({ ...row, metadata: row.metadata ? { ...row.metadata } : undefined }));
    const requested = row => row.metadata?.nameConflict?.requestedName || row.name;
    rows.sort((a, b) => Number(!!a.metadata?.nameConflict) - Number(!!b.metadata?.nameConflict)
        || Number(incoming.has(a.id)) - Number(incoming.has(b.id))
        || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id)));
    const reserved = rows.map(row => ({ id: row.id, name: requested(row) }));
    const used = [];
    for (const row of rows) {
        const pending = row.metadata?.nameConflict;
        const name = requested(row);
        if (findProjectNameConflict(name, used)) {
            const reusable = pending && !findProjectNameConflict(row.name, [...used, ...reserved], { excludeId: row.id });
            row.name = reusable ? row.name : firstAvailableProjectName(`${String(name).slice(0, 60)} (pendiente)`, [...used, ...reserved]);
            row.metadata = { ...row.metadata, nameConflict: pending || {
                requestedName: name, incomingUpdatedAt: Number(row.updatedAt) || 0,
                source: incoming.has(row.id) ? incomingSource : 'existing'
            } };
        } else {
            row.name = name;
            if (pending) delete row.metadata.nameConflict;
        }
        used.push(row);
    }
    return rows;
}

export async function getProjectNameConflicts({ idb = indexedDBService } = {}) {
    return (await idb.getAll('projects') || []).filter(row => row.metadata?.nameConflict);
}

export async function prepareStoredProjectNameConflicts({ idb = indexedDBService } = {}) {
    return mutateProjectCatalog(idb, rows => {
        const staged = stageProjectNameConflicts(rows);
        const before = new Map(rows.map(row => [row.id, JSON.stringify(row)]));
        return { writes: staged.filter(row => JSON.stringify(row) !== before.get(row.id)),
            result: staged.filter(row => row.metadata?.nameConflict) };
    });
}

export async function resolveProjectNameConflict(projectId, value, { idb = indexedDBService, expectedConflict = null } = {}) {
    const name = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 80) throw new Error('Escribe un nombre de entre 1 y 80 caracteres.');
    return mutateProjectCatalog(idb, rows => {
        const current = rows.find(row => row.id === projectId);
        const pending = current?.metadata?.nameConflict;
        if (!pending || (expectedConflict && JSON.stringify(pending) !== JSON.stringify(expectedConflict))) {
            throw new Error('El conflicto cambió. Vuelve a revisarlo antes de guardar.');
        }
        const duplicate = findProjectNameConflict(name, rows, { excludeId: projectId });
        if (duplicate) throw new Error(duplicateProjectNameMessage(duplicate));
        const saved = { ...current, name, metadata: { ...current.metadata },
            updatedAt: Math.max(Date.now(), (Number(current.updatedAt) || 0) + 1, (Number(pending.incomingUpdatedAt) || 0) + 1) };
        delete saved.metadata.nameConflict;
        return { writes: [saved], result: saved };
    });
}
