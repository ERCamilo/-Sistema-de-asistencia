/**
 * 🎯 ProjectContext (F1.3) — mantiene el proyecto activo como preferencia
 * local del dispositivo (F0.3 §3).
 *
 * Storage: localStorage `asistencia_active_project_id`. NOTA de manifiesto:
 * esta clave NO se registra en LocalWipeService.LOCAL_TRACE_KEYS, con la misma
 * racionalidad que los feature flags — es un ajuste del dispositivo, no un
 * dato del usuario; sobrevive "Borrar Local" a propósito.
 *
 * Contrato:
 * - Flag OFF ⇒ getActiveProjectId() y setActiveProjectId() devuelven null sin
 *   tocar nada (modo legacy total). clearActiveProjectId() es no-op seguro.
 * - setActiveProjectId(id) valida contra el store (existencia + status
 *   'active') ANTES de persistir. Estilo de error: REJECTS (async) con Error
 *   descriptivo — los call-sites ya operan en contexto async y pueden mostrar
 *   notificación; no hay caso de programación (TypeError vs Error).
 * - Recuperación: si el id guardado apunta a un proyecto inexistente,
 *   getActiveProjectId() cae limpio al default (nunca lanza al caller).
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { projectStore } from './ProjectStore.js';
import { PROJECT_STATUS } from './Project.js';
import { DefaultProjectService } from './DefaultProject.js';

export const ACTIVE_PROJECT_LS_KEY = 'asistencia_active_project_id';

function readStoredId() {
    try {
        return localStorage.getItem(ACTIVE_PROJECT_LS_KEY);
    } catch (_) {
        return null;
    }
}

function writeStoredId(id) {
    try {
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, id);
    } catch (_) { /* preferencia volátil si localStorage está bloqueado */ }
}

export class ProjectContextService {
    constructor({ store = projectStore, defaults = new DefaultProjectService({ store: projectStore }) } = {}) {
        this.store = store;
        this.defaults = defaults;
    }

    /**
     * Resuelve ASÍNCRONAMENTE el id del proyecto activo (contrato real, S4):
     * - Flag OFF ⇒ null inmediato, sin tocar nada (modo legacy).
     * - Id guardado válido (existe en el store y status 'active') ⇒ ese id.
     * - Si falta, cuelga o apunta a un proyecto inexistente/no activo ⇒
     *   fallback en cascada: default almacenado → ensureDefaultProject() →
     *   como último recurso null.
     * - ⚠ PUEDE RECHAZAR: un fallo real de storage (IDB caído) propaga la
     *   promesa rechazada — comportamiento fijado por el test
     *   'genuine store failure during fallback propagates'. Sólo los datos
     *   ausentes/inválidos caen limpios; los call-sites deben await/catch.
     */
    async getActiveProjectId() {
        if (!isProjectsEnabled()) return null;

        const storedId = readStoredId();
        if (storedId) {
            const found = await this.store.get(storedId);
            if (found && found.status === PROJECT_STATUS.ACTIVE) return found.id;
        }
        const fallback = await this.defaults.ensureDefaultProject();
        return fallback ? fallback.id : null;
    }

    /**
     * Persiste el id activo tras validar existencia + status 'active'.
     * Devuelve el id validado; rechaza con Error si es inválido.
     */
    async setActiveProjectId(id) {
        if (!isProjectsEnabled()) return null;

        const candidate = await this.store.get(id);
        if (!candidate) throw new Error(`Proyecto inexistente: "${id}"`);
        if (candidate.status !== PROJECT_STATUS.ACTIVE) {
            throw new Error(`El proyecto "${candidate.name}" está "${candidate.status}"; sólo puede activarse uno "active".`);
        }
        writeStoredId(candidate.id);
        return candidate.id;
    }

    /** Limpia la preferencia local. Seguro bajo flag OFF (no-op). */
    clearActiveProjectId() {
        try {
            localStorage.removeItem(ACTIVE_PROJECT_LS_KEY);
        } catch (_) { /* nada que limpiar */ }
    }
}

export const projectContext = new ProjectContextService();
export const getActiveProjectId = () => projectContext.getActiveProjectId();
export const setActiveProjectId = id => projectContext.setActiveProjectId(id);
export const clearActiveProjectId = () => projectContext.clearActiveProjectId();
