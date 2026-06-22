/**
 * 🧪 ExportControllerHandlersTests — Caracterización de los handlers de UI de
 * ExportController aún no migrados, como red para pasarlos a batchSetState (Fase 3).
 * Excluye performDownload (toggles de loading async), setImportFullText (input),
 * applyFullImport/confirmImportFull (import de datos + save/confirm).
 */

import { state } from '../modules/core/AppState.js';
import {
    toggleShareOptions,
    openImportFullModal,
    closeImportFullModal,
} from '../modules/features/export/ExportController.js';

testRunner.addSuite("ExportController — Handlers de UI (caracterización)", {

    "toggleShareOptions alterna showShareOptions"() {
        state.showShareOptions = false;
        toggleShareOptions();
        testRunner.assertEquals(state.showShareOptions, true, "debe pasar a true");
        toggleShareOptions();
        testRunner.assertEquals(state.showShareOptions, false, "debe volver a false");
    },

    "openImportFullModal abre el modal y limpia el texto"() {
        state.showImportFullModal = false;
        state.importFullText = 'viejo';
        openImportFullModal();
        testRunner.assertEquals(state.showImportFullModal, true, "el modal debe abrir");
        testRunner.assertEquals(state.importFullText, '', "el texto debe limpiarse");
    },

    "closeImportFullModal cierra el modal y limpia el texto"() {
        state.showImportFullModal = true;
        state.importFullText = 'algo';
        closeImportFullModal();
        testRunner.assertEquals(state.showImportFullModal, false, "el modal debe cerrar");
        testRunner.assertEquals(state.importFullText, '', "el texto debe limpiarse");
    }
});

console.log('🧪 ExportControllerHandlers tests cargados.');
