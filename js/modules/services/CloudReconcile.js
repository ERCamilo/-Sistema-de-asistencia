/**
 * ☁️🔧 CloudReconcile.js
 *
 * Red de seguridad para cuando el wizard de duplicados deja la nube en
 * estado inconsistente: local tiene N empleados ya saneados, pero
 * users/{uid}/employees/ todavía conserva los UUIDs absorbidos (porque
 * el delete encolado falló, abortó, o nunca se encoló).
 *
 * Estrategia "local-es-verdad" sin destruir datos:
 *   1. Lee la subcolección remota completa.
 *   2. Calcula los ids que están en la nube pero NO en el state local
 *      → ésos son huérfanos que el usuario quiere ver eliminados.
 *   3. Borra los huérfanos uno a uno.
 *   4. Re-empuja todos los empleados locales con saveMany (mergeRemote
 *      true por defecto: cualquier dato que la nube todavía tenga y
 *      local no, se preserva en el resultado — gracias al fix de
 *      unionById que ya no descarta items sin id).
 *
 * El helper es agnóstico al state global: recibe la lista local como
 * argumento y un repository inyectable para que los tests no necesiten
 * Firebase real.
 */

const _defaultRepoLoader = async () => {
    const mod = await import('./EmployeeRepository.js');
    return mod.EmployeeRepository || mod.default;
};

/**
 * @param {Array<object>} localEmployees Lista local autoritativa.
 * @param {object} [opts]
 * @param {object} [opts.repository] Stub para tests (debe exponer
 *   loadAll, deleteOne, saveMany).
 * @param {(progress: {phase: string, current?: number, total?: number}) => void} [opts.onProgress]
 * @returns {Promise<{cloudBefore:number, cloudAfter:number, deleted:string[], written:number, errors:Array}>}
 */
export async function reconcileCloudFromLocal(localEmployees, opts = {}) {
    const errors = [];
    const repository = opts.repository || await _defaultRepoLoader();
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    const localList = Array.isArray(localEmployees) ? localEmployees : [];
    const localIds = new Set(
        localList
            .map(e => e && e.id != null ? String(e.id) : null)
            .filter(Boolean)
    );

    onProgress({ phase: 'loading-cloud' });
    const cloudList = await repository.loadAll();
    const cloudBefore = cloudList.length;

    const orphans = cloudList
        .map(e => e && e.id != null ? String(e.id) : null)
        .filter(Boolean)
        .filter(id => !localIds.has(id));

    const deleted = [];
    for (let i = 0; i < orphans.length; i++) {
        const id = orphans[i];
        onProgress({ phase: 'deleting', current: i + 1, total: orphans.length });
        try {
            await repository.deleteOne(id);
            deleted.push(id);
        } catch (e) {
            errors.push({ id, op: 'delete', error: String(e?.message || e) });
        }
    }

    onProgress({ phase: 'pushing-local', total: localList.length });
    let written = 0;
    try {
        const res = await repository.saveMany(localList, { mergeRemote: true });
        written = res?.written ?? 0;
    } catch (e) {
        errors.push({ op: 'saveMany', error: String(e?.message || e) });
    }

    onProgress({ phase: 'done' });

    return {
        cloudBefore,
        cloudAfter: cloudBefore - deleted.length,
        deleted,
        written,
        errors
    };
}

export default { reconcileCloudFromLocal };
