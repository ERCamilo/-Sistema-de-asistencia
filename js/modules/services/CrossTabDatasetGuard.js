/**
 * 🧷 CrossTabDatasetGuard.js (M2, dos pestañas)
 *
 * La época del dataset (PersistenceService) protege los guardados en vuelo de
 * ESTA pestaña. Otra pestaña abierta antes de una restauración conserva en
 * memoria el estado anterior: al guardar (debounce, pagehide) o al subir con la
 * sesión recuperada pisaría lo restaurado en IndexedDB y en la nube.
 *
 * Cada reemplazo completo del dataset (FILE, FULL, restauración desconectada,
 * reparación de propiedad) se anuncia por localStorage. Las demás pestañas
 * bloquean sus guardados implícitos y recargan desde lo restaurado. Lo mismo
 * si otra pestaña resolvió la decisión de «restauración desconectada» mientras
 * aquí seguía abierto el diálogo.
 */

export const DATASET_REPLACED_LS_KEY = 'asistencia_dataset_replaced_v1';

const TAB_ID_KEY = Symbol.for('sa.crossTabDatasetGuard.tabId');
const tabId = globalThis[TAB_ID_KEY]
    || (globalThis[TAB_ID_KEY] = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export function currentTabId() {
    return tabId;
}

/** Anuncia a las otras pestañas que el dataset local fue reemplazado. Nunca lanza. */
export function announceDatasetReplaced(reason = 'replace', { storage = globalThis.localStorage, now = Date.now() } = {}) {
    if (!storage) return false;
    try {
        storage.setItem(DATASET_REPLACED_LS_KEY, JSON.stringify({
            at: now,
            tab: tabId,
            reason: String(reason || 'replace'),
            nonce: Math.random().toString(36).slice(2)
        }));
        return true;
    } catch (_) {
        return false;
    }
}

function parse(raw) {
    try {
        const value = JSON.parse(raw);
        return value && typeof value === 'object' ? value : null;
    } catch (_) {
        return null;
    }
}

/**
 * Escucha los anuncios de otras pestañas.
 * @param {{ win?: Window, onReplaced: (info) => void,
 *           detachedKey?: string, isDetachedDecisionPending?: () => boolean,
 *           onDetachedDecidedElsewhere?: () => void }} options
 * @returns {() => void} desuscribir
 */
export function installCrossTabDatasetGuard({
    win = globalThis.window,
    onReplaced,
    detachedKey = null,
    isDetachedDecisionPending = () => false,
    onDetachedDecidedElsewhere = null
} = {}) {
    if (!win || typeof win.addEventListener !== 'function') return () => {};
    const listener = (event) => {
        if (event?.key === DATASET_REPLACED_LS_KEY && event.newValue) {
            const info = parse(event.newValue);
            if (info && info.tab !== tabId && typeof onReplaced === 'function') onReplaced(info);
            return;
        }
        if (detachedKey && event?.key === detachedKey && !event.newValue
            && isDetachedDecisionPending() && typeof onDetachedDecidedElsewhere === 'function') {
            onDetachedDecidedElsewhere();
        }
    };
    win.addEventListener('storage', listener);
    return () => win.removeEventListener('storage', listener);
}

export default {
    DATASET_REPLACED_LS_KEY,
    currentTabId,
    announceDatasetReplaced,
    installCrossTabDatasetGuard
};
