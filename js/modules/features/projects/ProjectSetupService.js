import { isProjectsEnabled, setProjectsEnabled } from '../../config/FeatureFlags.js';
import { initProjectsInfrastructure } from './ProjectsBoot.js';
import { projectStore } from './ProjectStore.js';
import { getEntityScope, setActiveProjectId } from './ProjectContext.js';
import { mutateProjectCatalog } from './ProjectNameConflicts.js';
import { Project, PROJECT_STATUS } from './Project.js';
import { isSettingsDraftDirty } from '../../ui/settings/SettingsDraftBar.js';
import { findProjectNameConflict, duplicateProjectNameMessage } from './ProjectNames.js';
import { state } from '../../core/AppState.js';
import { readProjectUsageData, summarizeProjectUsage, deleteEmptyProject, protectedProjectIds } from './ProjectUsage.js';
import { isFullImportIsolationInProgress, isProjectRepairIsolationInProgress } from '../../services/PersistenceService.js';

export const PROJECT_SETUP_NAME_MAX_LENGTH = 80;

export function normalizeProjectSetupName(value) {
    const name = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('El nombre del proyecto es obligatorio.');
    if (name.length > PROJECT_SETUP_NAME_MAX_LENGTH) {
        throw new Error(`El nombre del proyecto no puede superar ${PROJECT_SETUP_NAME_MAX_LENGTH} caracteres.`);
    }
    return name;
}

export function assertUniqueProjectName(name, existingProjects = [], { excludeId = null } = {}) {
    const duplicate = findProjectNameConflict(normalizeProjectSetupName(name), existingProjects, { excludeId });
    if (duplicate) {
        throw new Error(duplicateProjectNameMessage(duplicate));
    }
}

export class ProjectSetupService {
    constructor({
        store = projectStore,
        getScope = getEntityScope,
        boot = initProjectsInfrastructure,
        flags = { isEnabled: isProjectsEnabled, setEnabled: setProjectsEnabled },
        setActiveId = setActiveProjectId,
        isDraftDirty = (doc = (typeof document !== 'undefined' ? document : null)) => (doc ? isSettingsDraftDirty(doc) : false)
    } = {}) {
        this.store = store;
        this.getScope = getScope;
        this.boot = boot;
        this.flags = flags;
        this.setActiveId = setActiveId;
        this.isDraftDirty = isDraftDirty;
        this.switchGeneration = 0;
        // Serialize mutations so a slower superseded switch cannot overwrite
        // a newer request after that newer request has already been accepted.
        this.switchQueue = Promise.resolve();
    }

    async getState() {
        const enabled = this.flags.isEnabled() === true;
        if (!enabled) {
            return {
                enabled: false,
                ready: false,
                activeProjectId: null,
                defaultProjectId: null,
                activeProject: null,
                projects: []
            };
        }

        const scope = await this.getScope();
        const projects = await this.store.listAll();
        const activeProjectId = scope?.enabled === true && scope.projectId
            ? String(scope.projectId)
            : null;
        const defaultProjectId = scope?.defaultProjectId ? String(scope.defaultProjectId) : null;
        const activeProject = activeProjectId
            ? projects.find(project => String(project.id) === activeProjectId) || null
            : null;
        const ready = !!(
            scope?.enabled === true
            && activeProjectId
            && defaultProjectId
            && activeProject?.status === PROJECT_STATUS.ACTIVE
        );

        return {
            enabled,
            ready,
            activeProjectId,
            defaultProjectId,
            activeProject,
            projects
        };
    }

    async getProjectsOverview() {
        const state = await this.getState();
        const stats = {
            total: state.projects.length,
            active: state.projects.filter(p => p.status === PROJECT_STATUS.ACTIVE).length,
            paused: state.projects.filter(p => p.status === PROJECT_STATUS.PAUSED).length,
            closed: state.projects.filter(p => p.status === PROJECT_STATUS.CLOSED).length,
            archived: state.projects.filter(p => p.status === PROJECT_STATUS.ARCHIVED).length
        };
        return {
            ...state,
            stats
        };
    }

    async getProjectUsage(projects) {
        const protectedIds = protectedProjectIds();
        const usage = summarizeProjectUsage(projects, await readProjectUsageData({ idb: this.store.db }), { liveState: state, defaultProjectId: protectedIds.defaultProjectId });
        for (const project of projects) {
            usage[project.id].deleteReason = project.id === protectedIds.activeProjectId ? 'Cambia a otra obra para borrarla.'
                : project.id === protectedIds.defaultProjectId ? 'La obra inicial se conserva.' : '';
        }
        return usage;
    }

    async setProjectPaused(projectId, paused) {
        const execute = async () => {
            if (!this.flags.isEnabled()) throw new Error('Proyectos no está activado.');
            if (isFullImportIsolationInProgress() || isProjectRepairIsolationInProgress()) throw new Error('Espera a que termine la restauración o reparación.');
            if (this.isDraftDirty()) throw new Error('Guarda o cancela los cambios de configuración antes de continuar.');
            const scope = await this.getScope();
            const updated = await mutateProjectCatalog(this.store.db, rows => {
                const row = rows.find(p => p.id === projectId && p.deletedAt == null);
                if (!row) throw new Error('Proyecto inexistente o borrado.');
                if (paused && (scope.projectId === projectId || protectedProjectIds().activeProjectId === projectId)) {
                    throw new Error('Cambia a otra obra antes de pausar la obra en uso.');
                }
                const model = Project.fromJSON(row);
                paused ? model.pause() : model.resume();
                const payload = model.toJSON();
                return { writes: [payload], result: payload };
            });
            if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { projectId, paused } }));
            return updated;
        };
        const pending = this.switchQueue.then(execute);
        this.switchQueue = pending.catch(() => {});
        return pending;
    }

    pauseProject(projectId) { return this.setProjectPaused(projectId, true); }
    resumeProject(projectId) { return this.setProjectPaused(projectId, false); }

    async deleteEmptyProject(projectId) {
        if (!this.flags.isEnabled()) throw new Error('Proyectos no está activado.');
        if (isFullImportIsolationInProgress() || isProjectRepairIsolationInProgress()) throw new Error('Espera a que termine la restauración o reparación de datos.');
        const deleted = await deleteEmptyProject(projectId, { idb: this.store.db, getLiveState: () => state });
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { projectId, deleted: true } }));
        return deleted;
    }

    async activate({ uid = null } = {}) {
        const wasEnabled = this.flags.isEnabled() === true;
        if (!wasEnabled) this.flags.setEnabled(true);

        try {
            const bootResult = await this.boot({ uid });
            const state = await this.getState();
            if (!state.ready) {
                throw new Error('No se pudo resolver un proyecto activo válido. La activación no quedó disponible.');
            }
            return { ...state, bootResult };
        } catch (error) {
            if (!wasEnabled) this.flags.setEnabled(false);
            throw error;
        }
    }

    async renameActiveProject(value) {
        if (this.flags.isEnabled() !== true) {
            throw new Error('Activa Proyectos antes de cambiar el nombre del proyecto.');
        }
        const name = normalizeProjectSetupName(value);
        const state = await this.getState();
        if (!state.ready || !state.activeProject) {
            throw new Error('No hay un proyecto activo válido para renombrar.');
        }
        // Cambiar solo mayúsculas del propio nombre es válido; chocar con otra obra no.
        assertUniqueProjectName(name, state.projects, { excludeId: state.activeProject.id });
        const model = Project.create({ ...state.activeProject, name });
        const updated = await this.store.update(model);
        return { ...(await this.getState()), activeProject: updated };
    }

    /**
     * R07 A2a: renombrado para onboarding de PRIMERA obra. Reconfigura el
     * proyecto default/activo YA EXISTENTE en lugar de crear un segundo
     * proyecto. Explícito por diseño (first-project mode): no se auto-detecta
     * por conteo ni por nombre; el caller decide usarlo.
     *
     * Devuelve `previousProject` (snapshot durable) para que el caller pueda
     * compensar el renombrado si un paso posterior (clonado/persistencia de
     * estructura opcional) falla — todo-o-nada, sin obra a medio renombrar.
     */
    async renameDefaultProjectForOnboarding({ name } = {}) {
        if (this.flags.isEnabled() !== true) {
            throw new Error('Activa Proyectos antes de configurar la primera obra.');
        }
        const normalizedName = normalizeProjectSetupName(name);
        const state = await this.getState();
        if (!state.ready || !state.activeProject) {
            throw new Error('No hay un proyecto activo válido para configurar como primera obra.');
        }

        // Unicidad excluyendo al propio proyecto (renombrar sobre su nombre
        // actual u otra capitalización es válido; chocar con OTRA obra no).
        assertUniqueProjectName(normalizedName, state.projects, { excludeId: state.activeProject.id });

        const previousProject = { ...state.activeProject };
        const model = Project.create({ ...state.activeProject, name: normalizedName });
        const updated = await this.store.update(model);
        return {
            project: updated,
            previousProject,
            state: await this.getState()
        };
    }

    /**
     * Compensación del renombrado de primera obra: restaura el snapshot
     * durable previo del proyecto default. Sólo para rollback del onboarding.
     */
    async restoreDefaultProjectSnapshot(previousProject) {
        if (!previousProject || !previousProject.id) return false;
        const model = Project.create(previousProject);
        const restored = await this.store.update(model);
        return restored || null;
    }

    async createEmptyProject({ name, metadata } = {}) {
        if (this.flags.isEnabled() !== true) {
            throw new Error('Activa Proyectos antes de crear un nuevo proyecto.');
        }
        const normalizedName = normalizeProjectSetupName(name);
        const existingProjects = await this.store.listAll();
        assertUniqueProjectName(normalizedName, existingProjects);

        const payload = { name: normalizedName };
        if (metadata && typeof metadata === 'object') {
            payload.metadata = metadata;
        }
        const model = Project.create(payload);
        const created = await this.store.create(model);
        return {
            project: created,
            state: await this.getState()
        };
    }

    async switchActiveProject(targetProjectId, { doc = (typeof document !== 'undefined' ? document : null) } = {}) {
        if (this.flags.isEnabled() !== true) {
            throw new Error('Activa Proyectos antes de cambiar de proyecto.');
        }

        if (typeof this.isDraftDirty === 'function') {
            const hasDraft = doc ? this.isDraftDirty(doc) : this.isDraftDirty();
            if (hasDraft === true) {
                throw new Error('Hay cambios sin guardar en la configuración. Guarda o cancela los cambios manualmente antes de cambiar de proyecto.');
            }
        }

        const currentGen = ++this.switchGeneration;
        const execute = async () => {
            // A newer request can supersede this one while it is waiting in the
            // queue. In that case it must never mutate the canonical context.
            if (this.switchGeneration !== currentGen) {
                return {
                    stale: true,
                    generation: currentGen,
                    switched: false,
                    state: await this.getState()
                };
            }

            if (this.flags.isEnabled() !== true) {
                throw new Error('Activa Proyectos antes de cambiar de proyecto.');
            }
            if (typeof this.isDraftDirty === 'function') {
                const hasDraft = doc ? this.isDraftDirty(doc) : this.isDraftDirty();
                if (hasDraft === true) {
                    throw new Error('Hay cambios sin guardar en la configuración. Guarda o cancela los cambios manualmente antes de cambiar de proyecto.');
                }
            }

            const currentScope = await this.getScope();
            const previousProjectId = currentScope?.projectId ? String(currentScope.projectId) : null;
            if (this.switchGeneration !== currentGen) {
                return {
                    stale: true,
                    generation: currentGen,
                    switched: false,
                    previousProjectId,
                    state: await this.getState()
                };
            }

            const resolvedId = await this.setActiveId(targetProjectId);
            const nextState = await this.getState();
            const stale = this.switchGeneration !== currentGen;

            return {
                stale,
                generation: currentGen,
                switched: !stale && resolvedId !== previousProjectId,
                previousProjectId,
                activeProjectId: nextState.activeProjectId,
                activeProject: nextState.activeProject,
                state: nextState
            };
        };

        const task = this.switchQueue.then(execute, execute);
        this.switchQueue = task.then(() => undefined, () => undefined);
        return task;
    }
}

export const projectSetupService = new ProjectSetupService();
export default projectSetupService;
