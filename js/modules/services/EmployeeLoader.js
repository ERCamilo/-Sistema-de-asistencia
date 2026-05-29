/**
 * 👥 EmployeeLoader.js (Fase 4.1 paso 4)
 *
 * Combina migración + carga de empleados en un único flujo. Es la pieza
 * que invocará el callback de subscribeToChanges para reemplazar el
 * acceso directo a remoteData.employees por la nueva lógica.
 *
 * Diseño con inyección de dependencias:
 *   migrate(remoteData, opts) → { migrated, count? }
 *   loadEmployees(remoteData) → Array
 *
 * Esto permite testear el orquestador sin tocar FirebaseService ni
 * el moduleNameMapper.
 *
 * Garantías:
 *   1. Si migrate o loadEmployees fallan, NO romper la app: devolver
 *      empleados del legacy (remoteData.employees) como fallback. Mejor
 *      ver datos viejos que pantalla rota.
 *   2. El llamador puede inspeccionar `result.error` si quiere reportar.
 *   3. Después de una migración exitosa, loadEmployees recibe un
 *      remoteData con schemaVersion>=2 para que tome el camino nuevo.
 */

import { TARGET_SCHEMA_VERSION } from './SchemaMigration.js';

export async function loadAndMigrateEmployees({
    remoteData,
    isDemo,
    migrate,
    loadEmployees,
    loadPositions,
    loadLeaders
} = {}) {
    const result = {
        migrated: false,
        count: 0,
        employees: [],
        positions: [],
        leaders: [],
        error: null
    };

    if (!remoteData || typeof remoteData !== 'object') {
        return result;
    }

    const legacyArr = (key) => Array.isArray(remoteData[key]) ? remoteData[key] : [];

    // 1. Intentar migrar (si aplica).
    try {
        const migrateResult = await migrate(remoteData, { isDemo: !!isDemo });
        result.migrated = !!migrateResult?.migrated;
        result.count = migrateResult?.count || 0;
    } catch (e) {
        console.error('❌ EmployeeLoader: migrate falló, usando legacy como fallback:', e);
        result.error = e;
        result.employees = legacyArr('employees');
        result.positions = legacyArr('positions');
        result.leaders = legacyArr('leaders');
        return result;
    }

    // 2. Cargar desde la fuente correcta. Si acabamos de migrar, "forzamos"
    //    schemaVersion al objetivo (3) en el payload pasado a los loaders para
    //    que decidan usar las subcolecciones sin esperar al próximo fire del
    //    listener. Como TARGET=3, esto también satisface a empleados (>=2).
    const payloadForLoad = result.migrated
        ? { ...remoteData, schemaVersion: TARGET_SCHEMA_VERSION }
        : remoteData;

    // 2a. Empleados (loader requerido).
    try {
        const emps = await loadEmployees(payloadForLoad);
        result.employees = Array.isArray(emps) ? emps : [];
    } catch (e) {
        console.error('❌ EmployeeLoader: loadEmployees falló, fallback al legacy:', e);
        result.error = e;
        result.employees = legacyArr('employees');
    }

    // 2b. Cargos (loader opcional — sin él, fallback al arreglo legacy).
    if (typeof loadPositions === 'function') {
        try {
            const pos = await loadPositions(payloadForLoad);
            result.positions = Array.isArray(pos) ? pos : [];
        } catch (e) {
            console.error('❌ EmployeeLoader: loadPositions falló, fallback al legacy:', e);
            result.error = result.error || e;
            result.positions = legacyArr('positions');
        }
    } else {
        result.positions = legacyArr('positions');
    }

    // 2c. Líderes (loader opcional — sin él, fallback al arreglo legacy).
    if (typeof loadLeaders === 'function') {
        try {
            const leads = await loadLeaders(payloadForLoad);
            result.leaders = Array.isArray(leads) ? leads : [];
        } catch (e) {
            console.error('❌ EmployeeLoader: loadLeaders falló, fallback al legacy:', e);
            result.error = result.error || e;
            result.leaders = legacyArr('leaders');
        }
    } else {
        result.leaders = legacyArr('leaders');
    }

    return result;
}
