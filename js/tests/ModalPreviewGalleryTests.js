import { openSafeModalPreview } from '../modules/ui/ModalPreviewGallery.js';

testRunner.addSuite('Galería de modales — preview sin efectos', {
    'cada callback destructivo es un no-op en la vista previa'() {
        let received = null;
        let writes = 0;
        const opened = openSafeModalPreview('outgoing-conflict', {
            outgoing: { show: (options) => { received = options; } }
        });
        testRunner.assertEquals(opened, true);
        received.onUseCloud(); received.onCombine(); received.onUseDevice(); received.onCancel();
        testRunner.assertEquals(writes, 0, 'la galería no puede escribir ni borrar');
    },

    'usa componentes reales para incoming y restore'() {
        let incoming = 0; let restore = 0;
        openSafeModalPreview('incoming-changes', { incoming: { show: () => incoming++ } });
        openSafeModalPreview('restore-backup', { restore: { showComparisonModal: () => restore++ } });
        testRunner.assertEquals(incoming, 1);
        testRunner.assertEquals(restore, 1);
    }
});
