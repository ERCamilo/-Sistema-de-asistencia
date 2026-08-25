import indexedDBService from '../../services/IndexedDBService.js';

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
        await this.db.update(PROJECTS_STORE, payload);
        return clone(payload);
    }

    async get(id) {
        return clone(await this.db.get(PROJECTS_STORE, String(id || '')) || null);
    }

    async listAll() {
        const records = await this.db.getAll(PROJECTS_STORE);
        return (records || [])
            .sort((left, right) => (left.createdAt - right.createdAt) ||
                String(left.id).localeCompare(String(right.id)))
            .map(clone);
    }

    /** Toda mutación estampa updatedAt (F0.3 §1); no muta la instancia recibida. */
    async update(project) {
        const payload = toPayload(project);
        payload.updatedAt = Date.now();
        await this.db.update(PROJECTS_STORE, payload);
        return clone(payload);
    }
}

export const projectStore = new ProjectStore();
export default projectStore;
