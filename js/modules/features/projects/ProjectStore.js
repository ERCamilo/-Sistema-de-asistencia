import { rememberProjectWriteStates } from './ProjectWriteGuard.js';
import indexedDBService from '../../services/IndexedDBService.js';
import { mutateProjectCatalog, stageProjectNameConflicts } from './ProjectNameConflicts.js';
import { findProjectNameConflict, duplicateProjectNameMessage } from './ProjectNames.js';
import { readProjectUsageData, summarizeProjectUsage, protectDeletedProjects } from './ProjectUsage.js';

export const PROJECTS_STORE = 'projects';

// La publicación cloud de proyectos (users/{uid}/projectsV1, F0.3 §3) es una
// decisión explícitamente diferida: este store es local-first (sólo IDB).

function clone(value) {
    return value === null || value === undefined
        ? value
        : JSON.parse(JSON.stringify(value));
}

/** Normaliza instancias Project y POJOs a payload plano con id obligatorio. */
function toPayload(project) {
    const payload = typeof project?.toJSON === 'function' ? project.toJSON() : clone(project);
    if (!payload?.id) throw new TypeError('Project id is required');
    return payload;
}

/**
 * CRUD local de Projects sobre IndexedDB (F1.1). Inyección por constructor
 * ({ db }) para tests, igual que PayrollClosureStore. Sin outbox ni sync.
 */
export class ProjectStore {
    constructor({ db = indexedDBService } = {}) {
        this.db = db;
    }

    async create(project) {
        const payload = toPayload(project);
        return this._saveUnique(payload);
    }

    async _saveUnique(payload) {
        return mutateProjectCatalog(this.db, rows => {
            if (rows.some(row => row.id === payload.id && row.deletedAt != null)) throw new Error('La obra fue borrada. Actualiza la lista antes de modificarla.');
            const reserved = rows.flatMap(row => row.metadata?.nameConflict
                ? [row, { ...row, name: row.metadata.nameConflict.requestedName }] : [row]);
            const duplicate = findProjectNameConflict(payload.name, reserved, { excludeId: payload.id });
            if (duplicate) throw new Error(duplicateProjectNameMessage(duplicate));
            const current = rows.find(row => row.id === payload.id);
            if (current?.metadata?.nameConflict) {
                payload.metadata = { ...current.metadata, ...payload.metadata };
                if (payload.name !== current.name) {
                    payload.updatedAt = Math.max(Date.now(), (Number(current.updatedAt) || 0) + 1);
                    delete payload.metadata.nameConflict;
                }
            }
            return { writes: [payload], result: clone(payload) };
        });
    }

    async get(id) {
        const row = await this.db.get(PROJECTS_STORE, String(id || ''));
        if (row?.deletedAt != null) return (await this._visibleCatalog()).find(project => project.id === row.id) || null;
        if (row) rememberProjectWriteStates([row]);
        return clone(row || null);
    }

    async _visibleCatalog() {
        let records = await this.db.getAll(PROJECTS_STORE) || [];
        if (records.some(row => row.deletedAt != null)) {
            const data = await readProjectUsageData({ idb: this.db });
            const usage = summarizeProjectUsage(records, data);
            const deletedIds = new Set(records.filter(row => row.deletedAt != null).map(row => row.id));
            const protectedRows = protectDeletedProjects(records, usage).filter(row => deletedIds.has(row.id) && row.deletedAt == null);
            if (protectedRows.length) {
                records = await mutateProjectCatalog(this.db, current => {
                    const recovered = new Map(protectedRows.map(row => [row.id, row]));
                    const final = stageProjectNameConflicts(current.map(row => row.deletedAt != null && recovered.has(row.id) ? recovered.get(row.id) : row));
                    const before = new Map(current.map(row => [row.id, JSON.stringify(row)]));
                    return { writes: final.filter(row => JSON.stringify(row) !== before.get(row.id)), result: final };
                });
            }
        }
        return records.filter(row => row.deletedAt == null);
    }

    async listAll() {
        const records = await this._visibleCatalog();
        rememberProjectWriteStates(records);
        return (records || [])
            .sort((left, right) => (left.createdAt - right.createdAt) ||
                String(left.id).localeCompare(String(right.id)))
            .map(clone);
    }

    async listByStatus(status) {
        const records = await this.listAll();
        return records.filter(project => project.status === status);
    }

    /** Toda mutación estampa updatedAt (F0.3 §1); no muta la instancia recibida. */
    async update(project) {
        const payload = toPayload(project);
        payload.updatedAt = Math.max(Date.now(), Number(payload.updatedAt) || 0);
        return this._saveUnique(payload);
    }
}

export const projectStore = new ProjectStore();
export default projectStore;
