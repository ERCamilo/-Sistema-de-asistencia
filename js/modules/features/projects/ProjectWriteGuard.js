import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { effectiveProjectId, peekEntityScope } from './EntityProjectScope.js';

// Se actualiza al resolver el contexto y al confirmar transacciones del catálogo.
const catalog = new Map();
export function rememberProjectWriteStates(projects) {
    for (const project of projects || []) if (project?.id) catalog.set(project.id, { status: project.status, deletedAt: project.deletedAt });
}
export function assertProjectWritable(projectId, { project = catalog.get(projectId), enabled = isProjectsEnabled() } = {}) {
    if (!enabled) return;
    if (!projectId || (project && (project.deletedAt != null || project.status !== 'active'))) {
        throw new Error('La obra no permite operaciones: está pausada, cerrada, archivada o no disponible. Reanúdala y selecciona una obra activa.');
    }
}
export function assertEntityProjectWritable(entity, scope = peekEntityScope()) {
    if (!isProjectsEnabled() || !scope.enabled) return;
    assertProjectWritable(effectiveProjectId(entity, scope) || scope.projectId);
}
/** Relee IDB en entradas asíncronas, incluidas propuestas Mini abiertas antes de pausar. */
export async function requireWritableProject(projectId, { store, enabled = isProjectsEnabled() } = {}) {
    if (!enabled) return;
    const source = store || (await import('./ProjectStore.js')).projectStore;
    const project = await source.get(projectId);
    if (!project) throw new Error('La obra ya no está disponible para escribir.');
    rememberProjectWriteStates([project]);
    assertProjectWritable(projectId, { project, enabled });
}
