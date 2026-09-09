import { isProjectsEnabled, setProjectsEnabled } from '../../config/FeatureFlags.js';
import { initProjectsInfrastructure } from './ProjectsBoot.js';
import { projectStore } from './ProjectStore.js';
import { getEntityScope, setActiveProjectId } from './ProjectContext.js';
import { Project, PROJECT_STATUS } from './Project.js';
import { isSettingsDraftDirty } from '../../ui/settings/SettingsDraftBar.js';

export const PROJECT_SETUP_NAME_MAX_LENGTH = 80;

export function normalizeProjectSetupName(value) {
    const name = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error('El nombre del proyecto es obligatorio.');
    if (name.length > PROJECT_SETUP_NAME_MAX_LENGTH) {
        throw new Error(`El nombre del proyecto no puede superar ${PROJECT_SETUP_NAME_MAX_LENGTH} caracteres.`);
    }
    return name;
}

export function assertUniqueProjectName(name, existingProjects = []) {
    const normalized = normalizeProjectSetupName(name).toLowerCase();
    const duplicate = (existingProjects || []).find(
        p => String(p?.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase() === normalized
    );
    if (duplicate) {
        throw new Error(`Ya existe un proyecto con el nombre "${duplicate.name}".`);
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
        const model = Project.create({ ...state.activeProject, name });
        const updated = await this.store.update(model);
        return { ...(await this.getState()), activeProject: updated };
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
