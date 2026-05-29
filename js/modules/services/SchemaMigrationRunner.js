/**
 * 🔄 SchemaMigrationRunner.js
 * Orquestador puro de la migración v1 → v2 (Fase 4.1 paso 3).
 *
 * Recibe sus dependencias inyectadas para que se pueda testear sin Firebase.
 * El paso 4 lo conecta con las funciones reales:
 *   - createSnapshot     → FirebaseService.createSnapshot('pre-restore', 'pre-migration-v2')
 *   - saveEmployees      → EmployeeRepository.saveMany
 *   - markSchemaVersion  → setDoc(parent, { schemaVersion: 2 }, { merge: true })
 *   - notify             → Notification.success
 *
 * Garantías clave:
 *   1. Si createSnapshot falla, NO se escriben empleados (no romper la red
 *      de seguridad).
 *   2. Si saveEmployees falla, NO se marca schemaVersion (permite reintentar
 *      en la siguiente carga).
 *   3. setDoc con merge:true en cada empleado hace que un reintento parcial
 *      sea idempotente.
 */

import {
    needsMigration,
    prepareEmployeeMigrationWrites,
    preparePositionMigrationWrites,
    prepareLeaderMigrationWrites,
    TARGET_SCHEMA_VERSION
} from './SchemaMigration.js';

/**
 * @param {object} args
 * @param {object|null} args.parentDoc     El doc users/{uid}/data/current
 * @param {boolean}     [args.isDemo]      Si está en modo demo, no migra
 * @param {() => Promise<any>}      args.createSnapshot
 * @param {(emps: Array) => Promise<any>}  args.saveEmployees
 * @param {(positions: Array) => Promise<any>} args.savePositions
 * @param {(leaders: Array) => Promise<any>} args.saveLeaders
 * @param {(version: number) => Promise<any>} args.markSchemaVersion
 * @param {(msg: string) => void}   [args.notify]
 * @returns {Promise<{migrated: boolean, count?: number}>}
 */
export async function runMigrationIfNeeded({
    parentDoc,
    isDemo,
    createSnapshot,
    saveEmployees,
    savePositions,
    saveLeaders,
    markSchemaVersion,
    notify
} = {}) {
    if (!needsMigration(parentDoc, { isDemo })) {
        return { migrated: false };
    }

    // 1. Snapshot pre-migración.
    await createSnapshot();

    const version = parentDoc.schemaVersion || 0;

    // 2. Migrar empleados si la versión previa es v1 o ausente
    let employeesMigrated = 0;
    if (version < 2) {
        const writes = prepareEmployeeMigrationWrites(parentDoc.employees);
        const payloads = writes.map(w => w.payload);
        await saveEmployees(payloads);
        employeesMigrated = writes.length;
    }

    // 3. Migrar posiciones y líderes si la versión previa es < 3
    let positionsMigrated = 0;
    let leadersMigrated = 0;
    if (version < 3) {
        const posWrites = preparePositionMigrationWrites(parentDoc.positions);
        const posPayloads = posWrites.map(w => w.payload);
        await savePositions(posPayloads);
        positionsMigrated = posWrites.length;

        const leadWrites = prepareLeaderMigrationWrites(parentDoc.leaders);
        const leadPayloads = leadWrites.map(w => w.payload);
        await saveLeaders(leadPayloads);
        leadersMigrated = leadWrites.length;
    }

    // 4. Marcar la cuenta como migrada.
    await markSchemaVersion(TARGET_SCHEMA_VERSION);

    // 5. Notificar al usuario.
    if (typeof notify === 'function') {
        notify(`✅ Sistema actualizado a versión 3 · Cargos (${positionsMigrated}) y Líderes (${leadersMigrated}) migrados a multi-dispositivo`);
    }

    return { migrated: true, count: employeesMigrated + positionsMigrated + leadersMigrated };
}
