/**
 * 🏠 DefaultProject (F1.2) — garantiza que exista exactamente UN proyecto por
 * defecto cuando el flag multiproyecto está activo (F0.3 §1).
 *
 * Mecanismo de puntero: localStorage `asistencia_default_project_id`.
 * Rationale: el "cuál es el default" es una preferencia del dispositivo sobre
 * datos locales-first (IDB), igual que los feature flags; no requiere sync ni
 * esquema en IDB y su lectura es síncrona/O(1) en cada arranque.
 *
 * Recuperación determinista (Dirección): si el puntero falta o apunta a un
 * proyecto inexistente, se escanea ProjectStore.listAll() (ordenado por
 * createdAt asc) y se toma el PRIMER proyecto activo; si no hay ninguno se
 * crea exactamente uno nuevo "Mi obra". El puntero siempre se re-apunta al
 * resultado ⇒ ensure() N veces devuelve siempre el mismo id con un solo
 * default en el store.
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { projectStore } from './ProjectStore.js';
import { Project } from './Project.js';

export const DEFAULT_PROJECT_LS_KEY = 'asistencia_default_project_id';
export const DEFAULT_PROJECT_NAME = 'Mi obra';

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
    constructor({ store = projectStore } = {}) {
        this.store = store;
    }

    /**
     * Get-or-create idempotente. Flag OFF ⇒ null sin tocar nada (guard anti-
     * accidentes: nunca crea proyectos en modo legacy).
     */
    async ensureDefaultProject() {
        if (!isProjectsEnabled()) return null;

        const pointerId = readPointer();
        if (pointerId) {
            const existing = await this.store.get(pointerId);
            if (existing) return existing;
        }

        // Recuperación: listAll ya viene ordenado por createdAt asc, así que
        // el primer activo es el más antiguo — elección determinista.
        const candidates = await this.store.listAll();
        const recovered = candidates.find(p => p.status === 'active');
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
