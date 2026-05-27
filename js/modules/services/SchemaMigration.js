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
export const TARGET_SCHEMA_VERSION = 2;

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
    if (!Array.isArray(employees) || employees.length === 0) {
        return false; // cuenta nueva o vacía — nada que migrar
    }

    return true;
}

/**
 * Construye el plan de escrituras: un [{ id, payload }] por empleado.
 * Defensivo:
 *   - Empleados sin id se omiten.
 *   - Duplicados por id → gana el de updatedAt mayor (o el último si ninguno
 *     tiene updatedAt, comportamiento simple y predecible).
 *   - Cada payload tiene updatedAt (clave para merge por ID en Fase 2.2).
 *
 * @param {Array} employees Lista de empleados (formato plano o instancias).
 * @returns {Array<{id: string, payload: object}>}
 */
export function prepareEmployeeMigrationWrites(employees) {
    if (!Array.isArray(employees) || employees.length === 0) return [];

    const byId = new Map();

    employees.forEach((emp, idx) => {
        if (!emp || typeof emp !== 'object') return;
        const id = String(emp.id || '').trim();
        if (!id) return; // sin id no podemos crear el doc

        const incomingOrigTs = typeof emp.updatedAt === 'number' ? emp.updatedAt : null;

        // Si ya tenemos uno con este id, conservar el "más fresco".
        // Reglas (sobre los updatedAt ORIGINALES, no los inyectados):
        //   - Si solo uno tiene updatedAt → ese gana.
        //   - Si ambos tienen → el mayor gana.
        //   - Si ninguno tiene → last-wins (el actual reemplaza).
        const existing = byId.get(id);
        if (existing) {
            const eTs = existing._origTs;
            const iTs = incomingOrigTs;
            const eHas = eTs !== null;
            const iHas = iTs !== null;
            if (eHas && !iHas) return;             // existing tiene fecha, incoming no → no reemplazar
            if (eHas && iHas && iTs < eTs) return; // existing es más nuevo → no reemplazar
            // En el resto de casos, incoming reemplaza (incluyendo last-wins).
        }

        // Clonar plano para no exportar referencias mutables y descartar
        // instancias de clase (toJSON-ish behavior).
        const payload = JSON.parse(JSON.stringify(emp));
        if (typeof payload.updatedAt !== 'number') {
            payload.updatedAt = Date.now();
        }

        byId.set(id, { id, payload, _origTs: incomingOrigTs, _order: idx });
    });

    // Salida estable: ordenar por orden de aparición original (para idempotencia
    // exacta en tests).
    const out = [...byId.values()].sort((a, b) => a._order - b._order);
    return out.map(({ id, payload }) => ({ id, payload }));
}
