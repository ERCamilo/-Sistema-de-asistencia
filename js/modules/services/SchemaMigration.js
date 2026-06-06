/**
 * 📦 SchemaMigration.js
 * Helper puro para la migración del modelo de datos en la nube (Fase 4.1).
 *
 * Modelo viejo (v1, blob):
 *   users/{uid}/data/current
 *     ├── employees: [...]   ← arreglo gigante (last-write-wins lo borra todo)
 *     ├── positions, leaders, settings
 *
 * Modelo nuevo (v2, por-empleado):
 *   users/{uid}/data/current
 *     ├── schemaVersion: 2
 *     ├── positions, leaders, settings
 *     └── employees: [...]   ← legacy, se conserva 4 semanas como respaldo
 *   users/{uid}/employees/{id}   ← un doc por empleado (incluye loans, advances...)
 *
 * Este módulo no toca Firebase ni IndexedDB; solo razona sobre los datos
 * y produce un plan de escrituras. La capa que lo invoca aplica el plan.
 */

export const SCHEMA_VERSION_FIELD = 'schemaVersion';
export const TARGET_SCHEMA_VERSION = 3;

/**
 * Decide si una cuenta necesita migrar al modelo nuevo.
 * @param {object|null} parentDoc  El doc users/{uid}/data/current
 * @param {object} opts            { isDemo?: boolean }
 * @returns {boolean}
 */
export function needsMigration(parentDoc, opts = {}) {
    if (!parentDoc || typeof parentDoc !== 'object') return false;
    if (opts.isDemo) return false;

    const version = parentDoc[SCHEMA_VERSION_FIELD];
    if (typeof version === 'number' && version >= TARGET_SCHEMA_VERSION) {
        return false; // ya migrada
    }

    const employees = parentDoc.employees;
    const positions = parentDoc.positions;
    const leaders = parentDoc.leaders;
    const hasEmployees = Array.isArray(employees) && employees.length > 0;
    const hasPositions = Array.isArray(positions) && positions.length > 0;
    const hasLeaders = Array.isArray(leaders) && leaders.length > 0;

    if (!hasEmployees && !hasPositions && !hasLeaders) {
        return false; // cuenta nueva o vacía — nada que migrar
    }

    return true;
}

/**
 * Construye el plan de escrituras: un [{ id, payload }] por empleado.
 */
export function prepareEmployeeMigrationWrites(employees) {
    if (!Array.isArray(employees) || employees.length === 0) return [];

    const byId = new Map();

    employees.forEach((emp, idx) => {
        if (!emp || typeof emp !== 'object') return;
        const id = String(emp.id || '').trim();
        if (!id) return; // sin id no podemos crear el doc

        const incomingOrigTs = typeof emp.updatedAt === 'number' ? emp.updatedAt : null;

        const existing = byId.get(id);
        if (existing) {
            const eTs = existing._origTs;
            const iTs = incomingOrigTs;
            const eHas = eTs !== null;
            const iHas = iTs !== null;
            if (eHas && !iHas) return;
            if (eHas && iHas && iTs < eTs) return;
        }

        const payload = JSON.parse(JSON.stringify(emp));
        if (typeof payload.updatedAt !== 'number') {
            payload.updatedAt = Date.now();
        }

        byId.set(id, { id, payload, _origTs: incomingOrigTs, _order: idx });
    });

    const out = [...byId.values()].sort((a, b) => a._order - b._order);
    return out.map(({ id, payload }) => ({ id, payload }));
}

/**
 * Construye el plan de escrituras para cargos.
 * @param {Array} positions
 * @returns {Array<{id: string, payload: object}>}
 */
export function preparePositionMigrationWrites(positions) {
    if (!Array.isArray(positions) || positions.length === 0) return [];

    const byId = new Map();

    positions.forEach((pos, idx) => {
        if (!pos || typeof pos !== 'object') return;
        const id = String(pos.id || '').trim();
        if (!id) return;

        const payload = JSON.parse(JSON.stringify(pos));
        if (typeof payload.updatedAt !== 'number') {
            payload.updatedAt = Date.now();
        }

        byId.set(id, { id, payload, _order: idx });
    });

    const out = [...byId.values()].sort((a, b) => a._order - b._order);
    return out.map(({ id, payload }) => ({ id, payload }));
}

/**
 * Construye el plan de escrituras para líderes.
 * @param {Array} leaders
 * @returns {Array<{id: string, payload: object}>}
 */
export function prepareLeaderMigrationWrites(leaders) {
    if (!Array.isArray(leaders) || leaders.length === 0) return [];

    const byId = new Map();

    leaders.forEach((lead, idx) => {
        if (!lead || typeof lead !== 'object') return;
        const id = String(lead.id || '').trim();
        if (!id) return;

        const payload = JSON.parse(JSON.stringify(lead));
        if (typeof payload.updatedAt !== 'number') {
            payload.updatedAt = Date.now();
        }

        byId.set(id, { id, payload, _order: idx });
    });

    const out = [...byId.values()].sort((a, b) => a._order - b._order);
    return out.map(({ id, payload }) => ({ id, payload }));
}
