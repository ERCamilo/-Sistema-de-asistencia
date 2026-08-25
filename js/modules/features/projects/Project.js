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

export class Project {
    constructor(data = {}) {
        const now = Date.now();
        this.id = data.id || makeProjectId();
        this.name = data.name;
        this.status = data.status || PROJECT_STATUS.ACTIVE;
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
        if (Object.prototype.hasOwnProperty.call(data, 'metadata')) this.metadata = data.metadata;
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
