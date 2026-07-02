/**
 * 🔁 DataOps.js (Fase 0.5, U4-U5)
 *
 * Operaciones de REEMPLAZO total entre local y nube — la lógica, separada de
 * la UI (los modales de confirmación viven en la capa de presentación).
 *
 * Diferencia clave con los flujos de FUSIÓN del Sync Center: acá una fuente
 * REEMPLAZA a la otra por completo. Eso cambia las reglas de error:
 *   - En fusión, un fallo de lectura remota (null) se trata como "no fusionar
 *     nada" y lo local se conserva (M1).
 *   - En reemplazo, ese mismo null debe ABORTAR TODO: tratar un fallo de
 *     lectura como lista vacía borraría lo local sin reemplazo real.
 *
 * DI-friendly (mismo patrón que MainSyncStore.flush y LocalWipeService):
 * las dependencias efectosas se inyectan con defaults reales.
 */

import { state, stateManager, invalidateAllStats, buildAttendanceIndex } from '../core/AppState.js';
import { indexedDBService } from './IndexedDBService.js';
import { wipeAllLocalTraces } from './LocalWipeService.js';
import { endLocalDataWipe } from './PersistenceService.js';
import FirebaseService from './FirebaseService.js';
import { EmployeeRepository } from './EmployeeRepository.js';
import { PositionRepository } from './PositionRepository.js';
import { LeaderRepository } from './LeaderRepository.js';
import { Employee } from '../features/employees/Employee.js';
import { Position } from '../features/employees/Position.js';
import { Leader } from '../features/employees/Leader.js';

// Metadata del doc espejo que NUNCA debe filtrarse al state (el flujo viejo
// hacía Object.assign(state, cloudState) y arrastraba estos campos).
const MIRROR_METADATA_FIELDS = ['updatedAt', 'lastDevice', 'lastChangedBy', 'deviceId'];

/**
 * Borra todos los datos locales y adopta la nube como única fuente de verdad.
 *
 * Orden crítico: FETCH PRIMERO (si la red falla, no se tocó nada local),
 * recién después wipe + aplicar + persistir + reload. El wipe interno
 * (wipeAllLocalTraces) ya bloquea los guardados implícitos (U2) y purga el
 * outbox + colas legacy (U1) — sin esa purga, el drenado del próximo login
 * subía datos PRE-descarga y pisaba la nube recién adoptada (bug ALTA #1).
 *
 * @param {{
 *   fetchFullState?: () => Promise<Object|null>,
 *   loadEmployees?: () => Promise<Array|null>,
 *   loadPositions?: () => Promise<Array|null>,
 *   loadLeaders?: () => Promise<Array|null>,
 *   fetchAllAttendance?: () => Promise<Object>,
 *   wipeLocal?: () => Promise<{ok: boolean, errors: Array}>,
 *   persistState?: (rawState: Object) => Promise<*>,
 *   endWipe?: () => void,
 *   reload?: () => void
 * }} deps
 * @returns {Promise<{ok: boolean, reason?: string, error?: *}>}
 */
export async function replaceLocalWithCloud(deps = {}) {
    const {
        fetchFullState = () => FirebaseService.getFullState(),
        loadEmployees = () => EmployeeRepository.loadAll(),
        loadPositions = () => PositionRepository.loadAll(),
        loadLeaders = () => LeaderRepository.loadAll(),
        fetchAllAttendance = () => FirebaseService.getAllAttendance(),
        wipeLocal = () => wipeAllLocalTraces(),
        persistState = (raw) => indexedDBService.saveState(raw, {}),
        endWipe = endLocalDataWipe,
        reload = () => location.reload()
    } = deps;

    // ── 1. FETCH PRIMERO — nada local se toca hasta tener TODO el reemplazo ──
    let cloudState, employees, positions, leaders, attendance;
    try {
        cloudState = await fetchFullState();
        if (!cloudState) return { ok: false, reason: 'no-cloud-data' };

        const sv = (typeof cloudState.settings?.schemaVersion === 'number')
            ? cloudState.settings.schemaVersion
            : (typeof cloudState.schemaVersion === 'number' ? cloudState.schemaVersion : 0);

        if (sv >= 2) {
            employees = await loadEmployees();
            // En modo REEMPLAZO, null (fallo de lectura) ABORTA — no es "[]".
            if (!Array.isArray(employees)) return { ok: false, reason: 'entity-read-failed' };
        } else {
            employees = cloudState.employees || [];
        }

        if (sv >= 3) {
            positions = await loadPositions();
            leaders = await loadLeaders();
            if (!Array.isArray(positions) || !Array.isArray(leaders)) {
                return { ok: false, reason: 'entity-read-failed' };
            }
        } else {
            positions = cloudState.positions || [];
            leaders = cloudState.leaders || [];
        }

        attendance = await fetchAllAttendance();
        if (!attendance || typeof attendance !== 'object') {
            return { ok: false, reason: 'attendance-read-failed' };
        }
    } catch (error) {
        console.error('❌ replaceLocalWithCloud: fallo leyendo la nube (no se tocó nada local):', error);
        return { ok: false, reason: 'fetch-failed', error };
    }

    // ── 2. Wipe local + aplicar + persistir. Desde acá el guard de wipe (U2)
    //       bloquea todo guardado implícito; si algo falla, endWipe() lo
    //       libera para que la sesión no quede muda hasta el F5. ─────────────
    try {
        const wipeResult = await wipeLocal();
        if (!wipeResult.ok) {
            console.warn('⚠️ replaceLocalWithCloud: wipe parcial (se continúa):', wipeResult.errors);
        }

        // Aplicar el estado de la nube — campos de datos, sin metadata del doc.
        const cleanCloud = { ...cloudState };
        MIRROR_METADATA_FIELDS.forEach(f => delete cleanCloud[f]);
        delete cleanCloud.employees;
        delete cleanCloud.positions;
        delete cleanCloud.leaders;
        delete cleanCloud.attendance;

        // batchSetState: convención del repo para mutaciones múltiples — un
        // solo render agendado al cerrar, con la coherencia TOTAL (Familia
        // 6a: invalidateAllStats + rebuild sin argumento) DENTRO del batch,
        // así ningún repintado puede leer el índice/stats viejos contra la
        // asistencia nueva en la ventana del await de persistState.
        stateManager.batchSetState(() => {
            Object.assign(state, cleanCloud);
            state.employees = employees.map(e => e instanceof Employee ? e : new Employee(e));
            state.positions = positions.map(p => p instanceof Position ? p : new Position(p));
            state.leaders = leaders.map(l => l instanceof Leader ? l : new Leader(l));
            state.attendance = attendance;
            invalidateAllStats();
            buildAttendanceIndex();
        });

        // Persistencia DIRECTA (no saveApplicationData: está bloqueado por el
        // guard U2, y es correcto — no hay nada que encolar hacia la nube,
        // la nube ES la fuente).
        await persistState(JSON.parse(JSON.stringify({
            employees: state.employees, positions: state.positions,
            leaders: state.leaders, attendance: state.attendance,
            settings: state.settings
        })));

        reload();
        return { ok: true };
    } catch (error) {
        console.error('❌ replaceLocalWithCloud: fallo aplicando el reemplazo:', error);
        endWipe(); // restaurar el guardado normal — sin esto la sesión queda muda
        return { ok: false, reason: 'apply-failed', error };
    }
}

export default { replaceLocalWithCloud };
