/**
 * 🚀 ProjectsBoot (F1.4/E) — arranque tolerante de la infraestructura de
 * proyectos. Único punto de wiring entre initializeApp() y el modelo
 * multiproyecto.
 *
 * Estrategia de error (documentada): NUNCA lanza hacia afuera. Cualquier
 * fallo (IDB caído, cuota llena, bug) se degrada a { null, null } con un
 * console.warn accionable. Racionalidad: el modelo multiproyecto es opt-in
 * detrás del flag F0.6; su falla NO puede romper un arranque legacy que
 * históricamente funciona sin él, y ensureDefaultProject() es get-or-create
 * idempotente ⇒ el próximo arranque recupera solo el estado faltante.
 *
 * Flag OFF ⇒ INERTE: corta antes de tocar storage. Además ambos servicios
 * internamente ya son no-op bajo OFF (defensa en profundidad).
 */

import { isProjectsEnabled } from '../../config/FeatureFlags.js';
import { defaultProjectService } from './DefaultProject.js';
import { projectContext, getEntityScope } from './ProjectContext.js';
import { migrateEntityProjectStamps } from './EntityProjectMigration.js';

export async function initProjectsInfrastructure({
    defaults = defaultProjectService,
    context = projectContext
} = {}) {
    if (!isProjectsEnabled()) {
        return { defaultProjectId: null, activeProjectId: null };
    }

    try {
        const defaultProject = await defaults.ensureDefaultProject();
        const activeProjectId = await context.getActiveProjectId();
        // F1.4: ceba el snapshot síncrono de EntityScope (render/save paths).
        // Sólo con los singletons por defecto: con deps inyectadas (tests)
        // el snapshot del módulo no se toca.
        if (defaults === defaultProjectService && context === projectContext) {
            const scope = await getEntityScope();
            // F1.4/M2: sello local de projectId, fire-and-forget. Sólo corre
            // con el scope resuelto (flag OFF nunca llega acá — corta arriba —
            // y la migración re-verifica el flag internamente). El .catch
            // mantiene intacto el contrato never-throw del boot.
            if (scope.enabled && scope.projectId) {
                Promise.resolve()
                    .then(() => migrateEntityProjectStamps())
                    .catch(error => console.warn(
                        '⚠️ ProjectsBoot: M2 sello local falló (arranque no afectado):',
                        error?.message || error
                    ));
            }
        }
        return {
            defaultProjectId: defaultProject ? defaultProject.id : null,
            activeProjectId
        };
    } catch (error) {
        console.warn('⚠️ ProjectsBoot: infraestructura de proyectos no disponible en este arranque:', error?.message || error);
        return { defaultProjectId: null, activeProjectId: null };
    }
}

export default initProjectsInfrastructure;
