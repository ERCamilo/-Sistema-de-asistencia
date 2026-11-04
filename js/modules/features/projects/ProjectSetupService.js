import { isProjectsEnabled, setProjectsEnabled } from '../../config/FeatureFlags.js';
import { initProjectsInfrastructure } from './ProjectsBoot.js';
import { projectStore } from './ProjectStore.js';
import { getEntityScope, setActiveProjectId } from './ProjectContext.js';
import { Project, PROJECT_STATUS } from './Project.js';
import { projectDeletionPolicy } from './ProjectDeletionPolicy.js';
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

    async changeProjectDeletionRequest(projectId, { cancel = false } = {}) {
        if (!this.flags.isEnabled()) throw new Error('Proyectos no está activado.');
        if (isFullImportIsolationInProgress() || isProjectRepairIsolationInProgress()) {
            throw new Error('Espera a que termine la restauración o reparación de datos.');
        }
        if (typeof this.isDraftDirty === 'function' && this.isDraftDirty()) {
            throw new Error('Guarda o cancela los cambios pendientes antes de continuar.');
        }
        const setup = await this.getState();
        const project = setup.projects.find(row => String(row.id) === String(projectId));
        if (!project) throw new Error('La obra ya no está disponible.');
        if (project.id === setup.activeProjectId || project.id === setup.defaultProjectId) {
            throw new Error('La obra inicial o en uso no se puede programar para eliminación.');
        }
        const method = cancel ? 'cancelDeletion' : 'requestDeletion';
        if (typeof this.store[method] !== 'function') {
            throw new Error('El almacenamiento no permite cambiar la solicitud.');
        }
        const saved = await this.store[method](project.id);
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('projects:setup-changed', {
            detail: { projectId: project.id, deletionRequestChanged: true }
        }));
        return { project: saved, state: await this.getState() };
    }

    /**
     * Read-only impact report. An occupied work is never deleted from this
     * screen; a complete purge would also require a durable backup and
     * per-entity cloud tombstones acknowledged by every synchronized device.
     */
    async previewProjectDeletion(projectId) {
        if (!this.flags.isEnabled()) throw new Error('Proyectos no está activado.');
        const setup = await this.getState();
        const project = setup.projects.find(item => String(item.id) === String(projectId));
        if (!project) throw new Error('La obra ya no existe. Actualiza la lista.');
        const usageByProject = await this.getProjectUsage(setup.projects);
        const usage = usageByProject[project.id];
        if (!usage?.verified) throw new Error('No se pudo verificar el historial. No se permite borrar.');
        const protectedProject = project.id === setup.activeProjectId || project.id === setup.defaultProjectId;
        const blockers = Object.entries(usage)
            .filter(([key, count]) => [
                'employees', 'positions', 'leaders', 'attendance', 'loans', 'payrollClosures',
                'pettyCash', 'other', 'pending'
            ].includes(key) && Number(count) > 0)
            .map(([kind, count]) => ({ kind, count }));
        return {
            projectId: project.id, projectName: project.name,
            usage, blockers, occupied: !usage.empty,
            canDeleteEmpty: usage.empty && !protectedProject
                && projectDeletionPolicy(project).canFinalizeEmpty,
            deletionPolicy: projectDeletionPolicy(project),
            canDeleteWithData: false,
            requiresBackup: !usage.empty,
            requiresCloudAcknowledgement: !usage.empty,
            protectedProject,
            warning: usage.empty
                ? 'Solo puede borrarse una obra vacía que no sea la actual ni la inicial.'
                : 'El borrado total aún está bloqueado: primero hay que respaldar, preservar datos compartidos y confirmar las eliminaciones sincronizadas.'
        };
    }

    async deleteEmptyProject(projectId) {
        if (!this.flags.isEnabled()) throw new Error('Proyectos no está activado.');
        if (isFullImportIsolationInProgress() || isProjectRepairIsolationInProgress()) throw new Error('Espera a que termine la restauración o reparación de datos.');
        const deleted = await deleteEmptyProject(projectId, { idb: this.store.db, getLiveState: () => state });
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { projectId, deleted: true } }));
        return deleted;
    }

    /**
     * Explicit reversible status changes. Historical data is never deleted.
     * Active/default projects cannot be closed or archived while selected.
     */
    async transitionProjectStatus(projectId, action) {
        if (this.flags.isEnabled() !== true) throw new Error('Activa Proyectos antes de modificar una obra.');
        if (isFullImportIsolationInProgress() || isProjectRepairIsolationInProgress()) {
            throw new Error('Espera a que termine la restauración o reparación de datos.');
        }
        if (typeof this.isDraftDirty === 'function' && this.isDraftDirty()) {
            throw new Error('Guarda o cancela los cambios pendientes antes de modificar el estado de una obra.');
        }
        const id = String(projectId || '').trim();
        const names = {
            close: 'Cerrar obra',
            archive: 'Archivar obra',
            unarchive: 'Sacar del archivo',
            reopen: 'Reabrir obra'
        };
        if (!names[action]) throw new Error('La operación de estado no está disponible.');
        const setup = await this.getState();
        if (!setup.projects.some(project => String(project.id) === id)) {
            throw new Error('La obra ya no está disponible. Actualiza la lista.');
        }
        if (id === String(setup.activeProjectId || '')) {
            throw new Error('Cambia a otra obra activa antes de cerrar o archivar esta.');
        }
        if (id === String(setup.defaultProjectId || '')) {
            throw new Error('La obra inicial se conserva activa como referencia del sistema.');
        }
        const original = await this.store.get(id);
        if (!original || original.deletedAt != null) {
            throw new Error('La obra fue eliminada o ya no está disponible.');
        }
        const next = Project.fromJSON(original);
        // The real store performs a fresh, atomic transition. Test adapters
        // retain the model fallback without requiring an IndexedDB connection.
        let saved;
        if (typeof this.store.transitionStatus === 'function') {
            saved = await this.store.transitionStatus(id, action);
        } else {
            next[action]();
            saved = await this.store.update(next);
        }
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('projects:setup-changed', {
                detail: { projectId: id, statusChanged: true, status: saved.status }
            }));
        }
        return { project: saved, state: await this.getState() };
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
