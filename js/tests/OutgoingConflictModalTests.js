import { OutgoingConflictModal } from '../modules/ui/OutgoingConflictModal.js';

function reset() {
    document.querySelectorAll('.outgoing-conflict-modal, .outgoing-conflict-modal--preview').forEach((el) => el.remove());
}

function createSyncControls({ uploadPaused = false, downloadPaused = false } = {}) {
    const calls = [];
    return {
        calls,
        isSyncPaused: () => uploadPaused,
        isDownloadPaused: () => downloadPaused,
        pauseCloudUpload: () => calls.push('pause-upload'),
        pauseCloudDownload: () => calls.push('pause-download'),
        resumeCloudUpload: () => calls.push('resume-upload'),
        resumeCloudDownload: () => calls.push('resume-download')
    };
}

async function settle() {
    await Promise.resolve();
    await Promise.resolve();
}

testRunner.addSuite('OutgoingConflictModal — decisiones claras y pausa segura', {
    'muestra texto sencillo sin términos técnicos visibles'() {
        reset();
        OutgoingConflictModal.show();
        const text = document.querySelector('.outgoing-conflict-modal').textContent.toLowerCase();
        ['dataset', 'entidades', 'lww', 'merge', 'local', 'remoto', 'id', 'outbox', 'watermark'].forEach((term) => {
            testRunner.assert(!text.includes(term), `no debe mostrar el término técnico ${term}`);
        });
        testRunner.assert(text.includes('este dispositivo'));
        testRunner.assert(text.includes('la nube'));
        testRunner.assert(text.includes('botón de tu cuenta'));
        testRunner.assert(text.includes('arriba a la derecha'));
        testRunner.assert(!text.includes('datos principales'));
        testRunner.assert(text.includes('empleados, asistencia, cargos, responsables y ajustes'));
        testRunner.assert(text.includes('intenta juntar empleados, asistencia, cargos y responsables'));
        testRunner.assert(text.includes('los actuales de la nube pueden perderse'));
        reset();
    },

    'cada confirmación explica sólo qué se reemplaza, combina, conserva o pierde'() {
        reset();
        const expected = {
            'use-cloud': ['Se reemplazarán', 'Se conservarán', 'Se perderán'],
            combine: ['Se combinarán', 'Se conservarán', 'Se conservará el cambio más reciente'],
            'use-device': ['Se reemplazarán', 'Se conservarán', 'Se perderán']
        };
        Object.entries(expected).forEach(([choice, sections]) => {
            OutgoingConflictModal.show();
            const modal = document.querySelector('.outgoing-conflict-modal');
            modal.querySelector(`[data-conflict-choice="${choice}"]`).click();
            const text = modal.textContent.toLowerCase();
            sections.forEach((section) => testRunner.assert(modal.textContent.includes(section)));
            if (choice === 'combine') testRunner.assert(modal.textContent.includes('La versión anterior no se mantiene.'));
            ['dataset', 'entidades', 'lww', 'merge', 'local', 'remoto', 'outbox', 'watermark'].forEach((term) => {
                testRunner.assert(!text.includes(term), `la confirmación no debe mostrar ${term}`);
            });
            reset();
        });
    },

    'pausa subida y descarga al abrir producción, pero nunca en preview'() {
        reset();
        const productionControls = createSyncControls();
        OutgoingConflictModal.show({ syncControls: productionControls });
        testRunner.assertEquals(productionControls.calls.join(','), 'pause-upload,pause-download');
        reset();
        const previewControls = createSyncControls();
        OutgoingConflictModal.show({ preview: true, syncControls: previewControls });
        testRunner.assertEquals(previewControls.calls.length, 0, 'la vista previa no debe pausar la nube');
        reset();
    },

    async 'el selector no cambia datos y volver mantiene la pausa'() {
        reset();
        const controls = createSyncControls();
        let combined = 0;
        OutgoingConflictModal.show({ syncControls: controls, onCombine: () => { combined++; return true; } });
        const modal = document.querySelector('.outgoing-conflict-modal');
        modal.querySelector('[data-conflict-choice="combine"]').click();
        testRunner.assertEquals(combined, 0, 'elegir no puede cambiar datos antes de confirmar');
        testRunner.assert(/Se combinarán/.test(modal.textContent));
        modal.querySelector('[data-conflict-action="back"]').click();
        testRunner.assert(!!modal.querySelector('[data-conflict-choice="use-device"]'));
        testRunner.assertEquals(controls.calls.join(','), 'pause-upload,pause-download', 'volver debe mantener ambas pausas');
        reset();
    },

    'cancelar, cerrar y Escape mantienen ambas pausas'() {
        reset();
        ['cancel', 'overlay', 'escape'].forEach((action) => {
            const controls = createSyncControls();
            OutgoingConflictModal.show({ syncControls: controls, onCancel: () => {} });
            const modal = document.querySelector('.outgoing-conflict-modal');
            if (action === 'cancel') modal.querySelector('[data-conflict-action="cancel"]').click();
            if (action === 'overlay') modal.click();
            if (action === 'escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            testRunner.assertEquals(controls.calls.join(','), 'pause-upload,pause-download', `${action} debe conservar ambas pausas`);
            reset();
        });
    },

    async 'una opción exitosa reanuda sólo lo que este flujo pausó'() {
        reset();
        const controls = createSyncControls({ uploadPaused: true, downloadPaused: false });
        OutgoingConflictModal.show({ syncControls: controls, onUseCloud: () => true });
        const modal = document.querySelector('.outgoing-conflict-modal');
        modal.querySelector('[data-conflict-choice="use-cloud"]').click();
        modal.querySelector('[data-conflict-action="confirm"]').click();
        await settle();
        testRunner.assertEquals(controls.calls.join(','), 'pause-download,resume-download');
        reset();
    },

    async 'un fallo conserva la pausa por seguridad'() {
        reset();
        const controls = createSyncControls();
        OutgoingConflictModal.show({ syncControls: controls, onUseDevice: () => false });
        const modal = document.querySelector('.outgoing-conflict-modal');
        modal.querySelector('[data-conflict-choice="use-device"]').click();
        modal.querySelector('[data-conflict-action="confirm"]').click();
        await settle();
        testRunner.assertEquals(controls.calls.join(','), 'pause-upload,pause-download');
        reset();
    },

    'la vista previa no bloquea el modal de conflicto productivo'() {
        reset();
        const preview = OutgoingConflictModal.show({ preview: true });
        const production = OutgoingConflictModal.show({ onCancel: () => {} });
        testRunner.assert(!!preview && !!production);
        reset();
    },

    'Escape cierra sólo la vista previa activa sin cancelar el conflicto productivo'() {
        reset();
        let productionCancelled = 0;
        OutgoingConflictModal.show({ onCancel: () => productionCancelled++ });
        OutgoingConflictModal.show({ preview: true, onCancel: () => {} });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        testRunner.assert(!document.querySelector('.outgoing-conflict-modal--preview'));
        testRunner.assert(!!document.querySelector('.outgoing-conflict-modal'));
        testRunner.assertEquals(productionCancelled, 0);
        reset();
    }
});
