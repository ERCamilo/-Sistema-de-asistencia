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
import { ensureCanonicalProject } from './ProjectRegistry.js';
import { adoptProject } from './ProjectAdoption.js';
import { indexedDBService } from '../../services/IndexedDBService.js';
import { ensureDefaultSeed } from '../payroll/ProjectPayrollConfigStore.js';

export async function initProjectsInfrastructure({
    defaults = defaultProjectService,
    context = projectContext,
    uid = null
} = {}) {
    if (!isProjectsEnabled()) {
        return { defaultProjectId: null, activeProjectId: null };
    }

    try {
        const defaultProject = await defaults.ensureDefaultProject();
        // A0.5: si hay uid, promover/adoptar identidad canónica antes de resolver active (para que active resuelva sobre el canónico)
        let canonicalId = defaultProject ? defaultProject.id : null;
        const effectiveUid = uid || (typeof window !== 'undefined' && window.currentUser?.uid) || (typeof globalThis !== 'undefined' && globalThis.currentUser?.uid) || null;
        if (effectiveUid && defaultProject?.id) {
            try {
                const reg = await ensureCanonicalProject({ uid: String(effectiveUid), localProject: defaultProject });
                if (reg?.canonicalId && reg.canonicalId !== defaultProject.id) {
                    await adoptProject({ legacyId: defaultProject.id, canonicalId: reg.canonicalId, uid: String(effectiveUid) });
                    canonicalId = reg.canonicalId;
                    // Re-resolver default tras adopción (el puntero LS ahora apunta al canónico)
                    const refreshedDefault = await defaults.ensureDefaultProject();
                    if (refreshedDefault?.id) canonicalId = refreshedDefault.id;
                } else if (reg?.canonicalId) {
                    canonicalId = reg.canonicalId;
                }
            } catch (e) {
                console.warn('⚠️ ProjectsBoot: identidad canónica no disponible en este arranque (provisional):', e?.message || e);
            }
        }
        const activeProjectId = await context.getActiveProjectId();
        // F1.6-A2: semilla atómica de payroll config para el proyecto default
        // canónico (local-only, idempotente, sin dual-write). Flag OFF nunca
        // llega acá (corta arriba) pero ensureDefaultSeed re-valida el flag.
        // Never-throw: cualquier fallo se degrada a warn y el boot continúa.
        if (canonicalId) {
            try {
                let legacySettings = {};
                try {
                    const raw = await indexedDBService.get('settings', 'app');
                    if (raw && typeof raw === 'object') legacySettings = raw;
                } catch (_) {}
                await ensureDefaultSeed(canonicalId, legacySettings).catch(() => {});
            } catch (e) {
                console.warn('⚠️ ProjectsBoot: payroll config seed no disponible en este arranque:', e?.message || e);
            }
        }
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
            defaultProjectId: canonicalId,
            activeProjectId
        };
    } catch (error) {
        console.warn('⚠️ ProjectsBoot: infraestructura de proyectos no disponible en este arranque:', error?.message || error);
        return { defaultProjectId: null, activeProjectId: null };
    }
}

export default initProjectsInfrastructure;
