import { isProjectsEnabled, setProjectsEnabled } from '../../config/FeatureFlags.js';
import { initProjectsInfrastructure } from './ProjectsBoot.js';
import { projectStore } from './ProjectStore.js';
import { getEntityScope } from './ProjectContext.js';
import { Project, PROJECT_STATUS } from './Project.js';

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
        flags = { isEnabled: isProjectsEnabled, setEnabled: setProjectsEnabled }
    } = {}) {
        this.store = store;
        this.getScope = getScope;
        this.boot = boot;
        this.flags = flags;
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
}

export const projectSetupService = new ProjectSetupService();
export default projectSetupService;
