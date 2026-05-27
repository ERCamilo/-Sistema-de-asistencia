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

export async function loadAndMigrateEmployees({
    remoteData,
    isDemo,
    migrate,
    loadEmployees
} = {}) {
    const result = { migrated: false, count: 0, employees: [], error: null };

    if (!remoteData || typeof remoteData !== 'object') {
        return result;
    }

    // 1. Intentar migrar (si aplica).
    try {
        const migrateResult = await migrate(remoteData, { isDemo: !!isDemo });
        result.migrated = !!migrateResult?.migrated;
        result.count = migrateResult?.count || 0;
    } catch (e) {
        console.error('❌ EmployeeLoader: migrate falló, usando legacy como fallback:', e);
        result.error = e;
        result.employees = Array.isArray(remoteData.employees) ? remoteData.employees : [];
        return result;
    }

    // 2. Cargar empleados desde la fuente correcta.
    //    Si acabamos de migrar, "forzamos" schemaVersion en el payload pasado
    //    al loader para que decida usar la subcolección sin esperar al próximo
    //    fire del listener.
    const payloadForLoad = result.migrated
        ? { ...remoteData, schemaVersion: 2 }
        : remoteData;

    try {
        const emps = await loadEmployees(payloadForLoad);
        result.employees = Array.isArray(emps) ? emps : [];
    } catch (e) {
        console.error('❌ EmployeeLoader: loadEmployees falló, fallback al legacy:', e);
        result.error = e;
        result.employees = Array.isArray(remoteData.employees) ? remoteData.employees : [];
    }

    return result;
}
