/**
 * 🔄 SchemaMigrationRunner.js
 * Orquestador puro de la migración v1 → v4 (Fase 4.1 paso 3 / Fase 2B U3).
 *
 * Recibe sus dependencias inyectadas para que se pueda testear sin Firebase.
 * El paso 4 lo conecta con las funciones reales:
 *   - createSnapshot      → FirebaseService.createSnapshot('pre-restore', 'pre-migration-v4')
 *   - saveEmployees       → EmployeeRepository.saveMany
 *   - saveSettings        → FirebaseService.saveSettings (Fase 2B U1)
 *   - markSchemaVersion   → setDoc(parent, { schemaVersion: 4 }, { merge: true })
 *   - notifyMigrationStart → eventBus.emit('sync:migration-start')
 *   - notify              → Notification.success
 *
 * Garantías clave:
 *   1. Si createSnapshot falla, NO se escribe nada (no romper la red
 *      de seguridad).
 *   2. Si saveEmployees falla, NO se marca schemaVersion (permite reintentar
 *      en la siguiente carga).
 *   3. setDoc con merge:true en cada empleado hace que un reintento parcial
 *      sea idempotente.
 *   4. Los gates version<2 / version<3 / version<4 son rangos mutuamente
 *      excluyentes: una cuenta v3 SOLO entra a la rama v4 (settings), sin
 *      re-correr la migración de roster ya completada.
 *   5. v4 (Fase 2B U3): el seed del doc de settings per-registro es
 *      COPY-FORWARD no-destructivo — nunca borra ni muta parentDoc.settings,
 *      así un dispositivo todavía en v3 sigue viendo su copia inline.
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
 * @param {(settings: object) => Promise<any>} args.saveSettings Fase 2B U3 —
 *   siembra el doc per-registro de settings desde parentDoc.settings.
 * @param {(version: number) => Promise<any>} args.markSchemaVersion
 * @param {() => void}   [args.notifyMigrationStart] Fase 2B U3 — dispara
 *   'sync:migration-start' al entrar a la rama v4 (spinner de UX).
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
    saveSettings,
    markSchemaVersion,
    notifyMigrationStart,
    notify
} = {}) {
    if (!needsMigration(parentDoc, { isDemo })) {
        return { migrated: false };
    }

    // 1. Snapshot pre-migración (el caller lo tagea con el rótulo vigente —
    //    hoy 'pre-migration-v4', ver FirebaseService.migrateIfNeeded).
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

    // 4. Mover settings a su doc per-registro si la versión previa es < 4
    //    (Fase 2B U3). Gate mutuamente excluyente con los de arriba: una
    //    cuenta v3 entra SOLO acá, sin re-correr la migración de roster.
    //    COPY-FORWARD no-destructivo: NUNCA se borra ni muta
    //    parentDoc.settings — el espejo conserva su copia inline para los
    //    dispositivos que todavía no migraron a v4.
    let settingsSeeded = false;
    if (version < 4) {
        if (typeof notifyMigrationStart === 'function') {
            notifyMigrationStart();
        }
        await saveSettings(parentDoc.settings || {});
        settingsSeeded = true;
    }

    // 5. Marcar la cuenta como migrada.
    await markSchemaVersion(TARGET_SCHEMA_VERSION);

    // 6. Notificar al usuario.
    if (typeof notify === 'function') {
        const parts = [];
        if (positionsMigrated > 0 || leadersMigrated > 0) {
            parts.push(`Cargos (${positionsMigrated}) y Líderes (${leadersMigrated}) migrados a multi-dispositivo`);
        }
        if (settingsSeeded) {
            parts.push('Preferencias movidas a sincronización individual');
        }
        const detail = parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
        notify(`✅ Sistema actualizado a versión ${TARGET_SCHEMA_VERSION}${detail}`);
    }

    return { migrated: true, count: employeesMigrated + positionsMigrated + leadersMigrated };
}
