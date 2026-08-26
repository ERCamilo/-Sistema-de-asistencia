/**
 * 🏗️ Project (F0.3 v1 + P5) — entidad raíz del modelo multiproyecto.
 * Slice F1.1: infraestructura interna local-first; nada del boot la consume
 * todavía (flag `projectsEnabled` permanece OFF, ver FeatureFlags.js).
 */

export const PROJECT_SCHEMA_VERSION = 1;

export const PROJECT_STATUS = Object.freeze({
    ACTIVE: 'active',
    CLOSED: 'closed',
    ARCHIVED: 'archived'
});

function makeProjectId() {
    // `PRJ-<timestamp base36>-<4 chars aleatorios>` (F0.3 §1), convención
    // consistente con EMP*/POS*/LOAN-*. El bucle garantiza los 4 chars:
    // Math.random().toString(36) puede acortarse (p.ej. 0.5 → '0.i').
    let token = '';
    while (token.length < 4) token += Math.random().toString(36).slice(2);
    return `PRJ-${Date.now().toString(36)}-${token.slice(0, 4)}`;
}

// F0.3 §1/§2 (S3): closed exige closedAt; archived exige closedAt Y archivedAt.
// Se valida en el constructor (único punto de paso de create() y fromJSON()),
// así un payload corrupto jamás entra al modelo ni al store.
function assertStatusTimestamps(status, data) {
    if (status !== PROJECT_STATUS.CLOSED && status !== PROJECT_STATUS.ARCHIVED) return;
    if (!Number.isFinite(data.closedAt)) {
        throw new Error(`Proyecto inválido: estado "${status}" requiere closedAt (numérico) y falta o es inválido.`);
    }
    if (status === PROJECT_STATUS.ARCHIVED && !Number.isFinite(data.archivedAt)) {
        throw new Error('Proyecto inválido: estado "archived" requiere archivedAt (numérico) y falta o es inválido.');
    }
}

// S5: clon profundo de metadata en la frontera del modelo — mutaciones hechas
// por el caller SOBRE EL OBJETO ENTREGADO no pueden filtrarse a toJSON()/store.
function cloneMetadata(metadata) {
    if (metadata === null || metadata === undefined) return metadata;
    return JSON.parse(JSON.stringify(metadata));
}

export class Project {
    constructor(data = {}) {
        const now = Date.now();
        this.id = data.id || makeProjectId();
        this.name = data.name;
        this.status = data.status || PROJECT_STATUS.ACTIVE;
        assertStatusTimestamps(this.status, data);
        this.schemaVersion = PROJECT_SCHEMA_VERSION;
        this.createdAt = data.createdAt || now;
        // Un proyecto recién creado no debe verse "más fresco" que sí mismo.
        this.updatedAt = data.updatedAt || this.createdAt;
        // Opcionales: sólo existen si existieron en el origen. Ausencia ≠ null
        // mantiene los payloads byte-estables (misma razón que deletedAt en
        // Employee): un guardado viejo nunca borra un campo que no conocía.
        if (Object.prototype.hasOwnProperty.call(data, 'closedAt')) this.closedAt = data.closedAt;
        if (Object.prototype.hasOwnProperty.call(data, 'archivedAt')) this.archivedAt = data.archivedAt;
        if (Object.prototype.hasOwnProperty.call(data, 'startDate')) this.startDate = data.startDate;
        if (Object.prototype.hasOwnProperty.call(data, 'endDate')) this.endDate = data.endDate;
        if (Object.prototype.hasOwnProperty.call(data, 'createdBy')) this.createdBy = data.createdBy;
        if (Object.prototype.hasOwnProperty.call(data, 'metadata')) this.metadata = cloneMetadata(data.metadata);
    }

    /** Fábrica canónica: estampa id + timestamps de nacimiento. */
    static create(data = {}) {
        if (!data.name || !String(data.name).trim()) {
            throw new Error('El nombre del proyecto es obligatorio');
        }
        return new Project({ ...data });
    }

    static fromJSON(json) {
        return new Project(json || {});
    }

    close() {
        if (this.status !== PROJECT_STATUS.ACTIVE) {
            throw new Error(`No se puede cerrar un proyecto en estado "${this.status}" (sólo active → closed).`);
        }
        this.status = PROJECT_STATUS.CLOSED;
        this.closedAt = Date.now();
        this.updatedAt = this.closedAt;
        return this;
    }

    reopen() {
        if (this.status !== PROJECT_STATUS.CLOSED) {
            throw new Error(`Sólo un proyecto closed puede reabrirse (estado actual: "${this.status}").`);
        }
        this.status = PROJECT_STATUS.ACTIVE;
        delete this.closedAt;
        this.updatedAt = Date.now();
        return this;
    }

    archive() {
        if (this.status !== PROJECT_STATUS.CLOSED) {
            throw new Error(`Sólo un proyecto closed puede archivarse (estado actual: "${this.status}").`);
        }
        this.status = PROJECT_STATUS.ARCHIVED;
        this.archivedAt = Date.now();
        this.updatedAt = this.archivedAt;
        return this;
    }

    unarchive() {
        if (this.status !== PROJECT_STATUS.ARCHIVED) {
            throw new Error(`El des-archivo vuelve primero a closed, nunca directo a active (estado actual: "${this.status}").`);
        }
        this.status = PROJECT_STATUS.CLOSED;
        delete this.archivedAt;
        this.updatedAt = Date.now();
        return this;
    }

    toJSON() {
        const json = {
            id: this.id,
            name: this.name,
            status: this.status,
            schemaVersion: this.schemaVersion,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
        for (const key of ['closedAt', 'archivedAt', 'startDate', 'endDate', 'createdBy', 'metadata']) {
            if (Object.prototype.hasOwnProperty.call(this, key)) json[key] = this[key];
        }
        return json;
    }
}
