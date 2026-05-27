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
    TARGET_SCHEMA_VERSION
} from './SchemaMigration.js';

/**
 * @param {object} args
 * @param {object|null} args.parentDoc     El doc users/{uid}/data/current
 * @param {boolean}     [args.isDemo]      Si está en modo demo, no migra
 * @param {() => Promise<any>}      args.createSnapshot
 * @param {(emps: Array) => Promise<any>}  args.saveEmployees
 * @param {(version: number) => Promise<any>} args.markSchemaVersion
 * @param {(msg: string) => void}   [args.notify]
 * @returns {Promise<{migrated: boolean, count?: number}>}
 */
export async function runMigrationIfNeeded({
    parentDoc,
    isDemo,
    createSnapshot,
    saveEmployees,
    markSchemaVersion,
    notify
} = {}) {
    if (!needsMigration(parentDoc, { isDemo })) {
        return { migrated: false };
    }

    // 1. Snapshot pre-migración. Si falla, abortamos: no queremos
    //    iniciar una operación destructiva sin red de seguridad.
    await createSnapshot();

    // 2. Construir el plan y escribir empleados granular.
    const writes = prepareEmployeeMigrationWrites(parentDoc.employees);
    const payloads = writes.map(w => w.payload);
    await saveEmployees(payloads);

    // 3. Marcar la cuenta como migrada. Si esto falla, los empleados
    //    ya están escritos — el próximo arranque encontrará schemaVersion
    //    aún ausente y volverá a correr la migración. Como cada saveOne
    //    usa merge: true, reintentar es seguro.
    await markSchemaVersion(TARGET_SCHEMA_VERSION);

    // 4. Notificar al usuario.
    if (typeof notify === 'function') {
        const count = writes.length;
        const word = count === 1 ? 'empleado' : 'empleados';
        notify(`✅ Sistema actualizado · ${count} ${word} migrado${count === 1 ? '' : 's'} a multi-dispositivo`);
    }

    return { migrated: true, count: writes.length };
}
