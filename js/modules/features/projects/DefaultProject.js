/**
 * 🏠 DefaultProject (F1.2) — garantiza que exista exactamente UN proyecto por
 * defecto cuando el flag multiproyecto está activo (F0.3 §1).
 *
 * Mecanismo de puntero: localStorage `asistencia_default_project_id`.
 * Rationale: el "cuál es el default" es una preferencia del dispositivo sobre
 * datos locales-first (IDB), igual que los feature flags; no requiere sync ni
 * esquema en IDB y su lectura es síncrona/O(1) en cada arranque.
 *
 * Recuperación determinista (Dirección): si el puntero falta o cuelga (proyecto
 * inexistente o NO activo — closed/archived), se escanea ProjectStore.listAll()
 * (ordenado por createdAt asc) y se toma el PRIMER proyecto activo; si no hay
 * ninguno se crea exactamente uno nuevo "Mi obra". El puntero siempre se
 * re-apunta al resultado ⇒ ensure() N veces devuelve siempre el mismo id con un
 * solo default en el store.
 *
 * Concurrencia (W2): la sección crítica leer-puntero→crear corre bajo el lease
 * cross-tab 'default-project-init' (misma maquinaria que MainSync/PettyCash).
 * Como acquireLease re-admite al mismo ownerId al instante, la exclusión
 * intra-pestaña es compartir la promesa en vuelo (análogo al guard `_flushing`).
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { projectStore } from './ProjectStore.js';
import { Project, PROJECT_STATUS } from './Project.js';
import { createCrossTabLock } from '../../services/CrossTabLock.js';

export const DEFAULT_PROJECT_LS_KEY = 'asistencia_default_project_id';
export const DEFAULT_PROJECT_NAME = 'Mi obra';
export const DEFAULT_PROJECT_INIT_LEASE = 'default-project-init';

function readPointer() {
    try {
        return localStorage.getItem(DEFAULT_PROJECT_LS_KEY);
    } catch (_) {
        return null;
    }
}

function writePointer(id) {
    try {
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, id);
    } catch (_) { /* sin persistencia: la recuperación vuelve a resolverla */ }
}

export class DefaultProjectService {
    constructor({ store = projectStore, crossTabLock = null } = {}) {
        this.store = store;
        this._inFlight = null;
        // Lease cross-tab sobre la MISMA db que el store; sin db inyectada
        // (stores de test) degrada a ejecución directa, igual que en sync.
        this.crossTabLock = crossTabLock ?? createCrossTabLock({
            leaseStore: store?.db ?? null
        });
    }

    /**
     * Get-or-create idempotente. Flag OFF ⇒ null sin tocar nada (guard anti-
     * accidentes: nunca crea proyectos en modo legacy).
     */
    async ensureDefaultProject() {
        if (!isProjectsEnabled()) return null;

        if (!this._inFlight) {
            this._inFlight = this.crossTabLock
                .run(DEFAULT_PROJECT_INIT_LEASE, () => this._ensureUnlocked())
                .finally(() => { this._inFlight = null; });
        }
        return this._inFlight;
    }

    /** Sólo invocar bajo `crossTabLock.run`: lee puntero y crea bajo lease. */
    async _ensureUnlocked() {
        const pointerId = readPointer();
        if (pointerId) {
            const existing = await this.store.get(pointerId);
            // Puntero colgante: inexistente O no activo ⇒ misma recuperación
            // determinista que un puntero ausente (un solo contrato).
            if (existing && existing.status === PROJECT_STATUS.ACTIVE) return existing;
        }

        // Recuperación: listAll ya viene ordenado por createdAt asc, así que
        // el primer activo es el más antiguo — elección determinista.
        const candidates = await this.store.listAll();
        const recovered = candidates.find(p => p.status === PROJECT_STATUS.ACTIVE);
        if (recovered) {
            writePointer(recovered.id);
            return recovered;
        }

        const created = await this.store.create(
            Project.create({ name: DEFAULT_PROJECT_NAME })
        );
        writePointer(created.id);
        return created;
    }
}

export const defaultProjectService = new DefaultProjectService();
export const ensureDefaultProject = () => defaultProjectService.ensureDefaultProject();

// TODO(boot-wiring F1.2): llamar una única vez desde initializeApp()
// (js/app.js ~línea 7047, justo después del `await hydrateApplicationAndInitializeWeather`)
// dentro de `if (isProjectsEnabled()) { try { await ensureDefaultProject(); } catch (_) {} }`.
// Se difiere el edit real: hay trabajo paralelo sin commitear en el árbol y el
// flag está OFF por defecto, así que la llamada es inerte hoy — cero riesgo gana.
