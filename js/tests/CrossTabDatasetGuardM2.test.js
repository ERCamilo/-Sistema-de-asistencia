/**
 * M2 — dos pestañas. Una pestaña abierta antes de una restauración conserva en
 * memoria el dataset anterior; el reemplazo completo se anuncia por
 * localStorage y la otra pestaña recarga sin volver a guardar lo viejo.
 * (La prueba en Chromium con dos pestañas reales está en el informe.)
 */
import {
    DATASET_REPLACED_LS_KEY,
    announceDatasetReplaced,
    currentTabId,
    installCrossTabDatasetGuard
} from '../modules/services/CrossTabDatasetGuard.js';
import { DETACHED_RESTORE_LS_KEY } from '../modules/services/DetachedRestoreGuard.js';
import {
    advanceDatasetEpoch,
    beginLocalDataWipe,
    endLocalDataWipe,
    flushPendingSave,
    saveApplicationData
} from '../modules/services/PersistenceService.js';

function storageEvent(key, newValue) {
    return Object.assign(new Event('storage'), { key, newValue });
}

describe('M2: guarda del dataset entre pestañas', () => {
    let win;
    let unsubscribe;

    beforeEach(() => {
        localStorage.clear();
        win = new EventTarget();
    });

    afterEach(() => {
        unsubscribe?.();
        endLocalDataWipe();
    });

    test('un reemplazo completo en esta pestaña se anuncia a las demás con su identificador', () => {
        advanceDatasetEpoch();
        const info = JSON.parse(localStorage.getItem(DATASET_REPLACED_LS_KEY));
        expect(info).toMatchObject({ tab: currentTabId(), reason: 'full-replace' });
    });

    test('otra pestaña recibe el anuncio; la propia lo ignora', () => {
        const onReplaced = jest.fn();
        unsubscribe = installCrossTabDatasetGuard({ win, onReplaced });
        win.dispatchEvent(storageEvent(DATASET_REPLACED_LS_KEY, JSON.stringify({ tab: 'otra-pestaña', reason: 'full-replace' })));
        expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({ tab: 'otra-pestaña' }));

        onReplaced.mockClear();
        announceDatasetReplaced('full-replace');
        win.dispatchEvent(storageEvent(DATASET_REPLACED_LS_KEY, localStorage.getItem(DATASET_REPLACED_LS_KEY)));
        expect(onReplaced).not.toHaveBeenCalled();
        // Valores ilegibles o borrados no disparan nada.
        win.dispatchEvent(storageEvent(DATASET_REPLACED_LS_KEY, '{roto'));
        win.dispatchEvent(storageEvent(DATASET_REPLACED_LS_KEY, null));
        expect(onReplaced).not.toHaveBeenCalled();
    });

    test('la decisión de restauración desconectada resuelta en otra pestaña cierra solo un diálogo pendiente', () => {
        let pending = false;
        const decided = jest.fn();
        unsubscribe = installCrossTabDatasetGuard({
            win,
            onReplaced: jest.fn(),
            detachedKey: DETACHED_RESTORE_LS_KEY,
            isDetachedDecisionPending: () => pending,
            onDetachedDecidedElsewhere: decided
        });
        win.dispatchEvent(storageEvent(DETACHED_RESTORE_LS_KEY, null));
        expect(decided).not.toHaveBeenCalled();                 // sin diálogo abierto
        pending = true;
        win.dispatchEvent(storageEvent(DETACHED_RESTORE_LS_KEY, JSON.stringify({ restoredAt: 1 })));
        expect(decided).not.toHaveBeenCalled();                 // la marca se creó, no se resolvió
        win.dispatchEvent(storageEvent(DETACHED_RESTORE_LS_KEY, null));
        expect(decided).toHaveBeenCalledTimes(1);
    });

    test('tras el anuncio, la pestaña vieja no persiste su estado en el pagehide', async () => {
        // Un guardado debounced pendiente con el estado viejo…
        saveApplicationData({ skipValidation: true });
        beginLocalDataWipe();                                   // lo que hace reloadStaleTab
        expect(flushPendingSave()).toBe(false);                 // …no se drena al descargar
    });
});
