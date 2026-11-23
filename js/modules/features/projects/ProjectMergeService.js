import { applyOwnershipRepair, REPAIR_ACTION, REPAIR_STATUS } from './ProjectOwnershipRepairService.js';
import { protectedProjectIds, readProjectUsageData } from './ProjectUsage.js';
import { planProjectMerge } from './ProjectMergePlan.js';
import { indexedDBService } from '../../services/IndexedDBService.js';
import { projectContext } from './ProjectContext.js';
import { suggestMergeDirection } from './ProjectMergeDirection.js';

export { suggestMergeDirection };

/**
 * 🤝 ProjectMergeService — fusionar dos obras desde la pantalla «Obras repetidas».
 *
 * Orquesta: copia de seguridad antes → motor (MERGE_PROJECT, una transacción) →
 * cambio de obra activa si la retirada era la activa → aviso al catálogo para que
 * publique la lápida (`mergedIntoId`). Nunca lanza: devuelve { ok, … } con un
 * mensaje listo para el usuario. Si algo falla, el motor no cambió nada.
 */

const GENERIC_FAILURE = 'No se pudo fusionar las obras. No se cambió nada.';
let busy = false;

const trimId = value => String(value ?? '').trim();
/** Una frase para el usuario a partir de los motivos que devolvió el motor. */
export function mergeFailureMessage(blockers = []) {
    const messages = [...new Set((blockers || []).map(blocker => blocker?.message).filter(Boolean))];
    return messages.length ? messages.join(' ') : GENERIC_FAILURE;
}

/**
 * ¿Se puede fusionar? Es el mismo plan que usa el motor, sobre los datos guardados,
 * sin escribir nada. No ve lo que aún está solo en memoria: eso lo vuelve a comprobar
 * el motor al confirmar. Los errores de lectura se propagan (el que llama decide).
 */
export async function checkProjectMerge(sourceId, targetId, overrides = {}) {
    const deps = {
        readData: () => readProjectUsageData({ idb: indexedDBService }),
        listProjects: () => indexedDBService.getAll('projects'),
        protectedIds: () => protectedProjectIds(),
        ...overrides
    };
    const [data, projects] = await Promise.all([deps.readData(), deps.listProjects()]);
    const plan = planProjectMerge({
        sourceId, targetId, data: { ...data, projects }, timestamp: Date.now(), protectedIds: deps.protectedIds()
    });
    return plan.ok ? { ok: true, blockers: [] } : { ok: false, blockers: plan.blockers };
}

function defaultDeps() {
    return {
        createSnapshot: async () => {
            if (globalThis.createFirebaseSnapshot) await globalThis.createFirebaseSnapshot('pre-restore', 'pre-fusion-obras');
        },
        applyRepair: params => applyOwnershipRepair(params),
        getActiveProjectId: () => protectedProjectIds().activeProjectId,
        setActiveProjectId: id => projectContext.setActiveProjectId(id)
    };
}

function announceMerge(target, source) {
    try {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: { source: 'merge', projectId: target, mergedProjectId: source } }));
        }
    } catch (_) { /* sin UI */ }
}

export async function mergeProjects({ sourceId, targetId, projectName } = {}, overrides = {}) {
    const source = trimId(sourceId);
    const target = trimId(targetId);
    if (!source || !target || source === target) return { ok: false, message: 'Elige dos obras distintas.' };
    if (busy) return { ok: false, message: 'Ya hay una fusión en curso. Espera a que termine.' };
    busy = true;
    const deps = { ...defaultDeps(), ...overrides };
    try {
        try {
            await deps.createSnapshot();
        } catch (error) {
            console.error('No se pudo crear la copia de seguridad antes de fusionar obras:', error);
            return { ok: false, message: 'No se pudo crear la copia de seguridad. No se cambió nada.' };
        }
        const wasActive = trimId(await deps.getActiveProjectId()) === source;
        const result = await deps.applyRepair({
            action: REPAIR_ACTION.MERGE_PROJECT, sourceProjectId: source, targetProjectId: target, projectName
        });
        if (![REPAIR_STATUS.OK, REPAIR_STATUS.NO_OP].includes(result?.status)) {
            const blockers = Array.isArray(result?.conflicts) ? result.conflicts : [];
            return { ok: false, message: result?.reason || mergeFailureMessage(blockers), blockers };
        }
        const outcome = { ok: true, counts: result.counts || {}, targetName: result.targetName || '' };
        if (wasActive) {
            try { await deps.setActiveProjectId(target); } catch (error) {
                console.warn('Fusión hecha, pero no se pudo cambiar de obra activa:', error?.message || error);
                outcome.activeSwitchFailed = true;
            }
        }
        announceMerge(target, source);
        return outcome;
    } catch (error) {
        console.error('Error fusionando obras:', error);
        return { ok: false, message: GENERIC_FAILURE };
    } finally {
        busy = false;
    }
}

export default { mergeProjects, suggestMergeDirection, mergeFailureMessage, checkProjectMerge };
