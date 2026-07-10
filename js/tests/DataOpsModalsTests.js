/**
 * 🧪 DataOpsModalsTests (Fase 0.5, U7a)
 *
 * Modal rico de confirmación para las operaciones de datos: dice la verdad
 * con un FLUJO VISUAL de iconos (nube → disquete = descargar; equipo → nube
 * = subir; tacho = borrar), bullets de qué va a pasar exactamente, checkboxes
 * para las opciones (snapshots, pausa) y confirmación tipeada para las
 * destructivas — todo en UN solo modal en vez de 3-4 diálogos encadenados.
 *
 * confirmDataOperation(opts) → Promise<null | {checkboxId: boolean, ...}>
 *   null = cancelado; objeto = confirmado con los valores de los checkboxes.
 */

import { confirmDataOperation } from '../modules/ui/DataOpsModals.js';

function cleanupModals() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.remove());
    document.body.style.overflow = '';
}

function q(sel) { return document.querySelector(sel); }
function buttons() { return [...document.querySelectorAll('.modal-btn')]; }
function confirmBtn() { return buttons().at(-1); }
function cancelBtn() { return buttons()[0]; }

testRunner.addSuite("DataOpsModals — confirmDataOperation (Fase 0.5, U7a)", {

    async "renderiza el flujo visual de iconos con data-flow y los bullets de la operación"() {
        cleanupModals();
        const p = confirmDataOperation({
            title: 'Descargar y Reemplazar',
            flow: 'cloud-to-device',
            bullets: ['Se borra todo lo local', 'La nube queda como única fuente'],
            confirmText: 'Reemplazar'
        });
        try {
            const flowEl = q('.dataops-flow');
            testRunner.assert(!!flowEl, 'debe renderizar el contenedor del flujo visual');
            testRunner.assertEquals(flowEl.dataset.flow, 'cloud-to-device');
            testRunner.assert(flowEl.querySelectorAll('.dataops-flow-icon').length >= 2,
                'el flujo debe mostrar origen y destino (p.ej. nube → disquete)');

            const bullets = [...document.querySelectorAll('.dataops-bullets li')];
            testRunner.assertEquals(bullets.length, 2, 'debe listar exactamente lo que va a pasar');
            testRunner.assert(bullets[0].textContent.includes('Se borra todo lo local'));
        } finally {
            cancelBtn()?.click();
            await p;
            cleanupModals();
        }
    },

    async "cancelar resuelve null (la operación NO se ejecuta)"() {
        cleanupModals();
        const p = confirmDataOperation({ title: 'X', flow: 'delete-local', bullets: ['a'] });
        cancelBtn().click();
        const result = await p;
        testRunner.assertEquals(result, null);
        cleanupModals();
    },

    async "confirmar sin checkboxes resuelve un objeto vacío (confirmado, sin opciones)"() {
        cleanupModals();
        const p = confirmDataOperation({ title: 'X', flow: 'device-to-cloud', bullets: ['a'] });
        confirmBtn().click();
        const result = await p;
        testRunner.assert(result !== null, 'confirmado no debe ser null');
        testRunner.assertEquals(Object.keys(result).length, 0);
        cleanupModals();
    },

    async "los checkboxes devuelven sus valores (default y toggleado)"() {
        cleanupModals();
        const p = confirmDataOperation({
            title: 'Borrar Nube', flow: 'delete-cloud', bullets: ['a'],
            checkboxes: [
                { id: 'alsoSnapshots', label: 'Borrar también los respaldos', checked: false },
                { id: 'pauseUpload', label: 'Pausar la subida', checked: true }
            ]
        });
        const snapshotsBox = q('input[data-check-id="alsoSnapshots"]');
        const pauseBox = q('input[data-check-id="pauseUpload"]');
        testRunner.assert(!!snapshotsBox && !!pauseBox, 'debe renderizar ambos checkboxes');
        testRunner.assertEquals(pauseBox.checked, true, 'debe respetar el default checked');

        snapshotsBox.click(); // el usuario activa borrar respaldos
        confirmBtn().click();
        const result = await p;

        testRunner.assertEquals(result.alsoSnapshots, true, 'debe reflejar el toggle del usuario');
        testRunner.assertEquals(result.pauseUpload, true, 'debe reflejar el default no tocado');
        cleanupModals();
    },

    async "requireTyping: el botón de confirmar queda deshabilitado hasta tipear el texto EXACTO"() {
        cleanupModals();
        const p = confirmDataOperation({
            title: 'Borrar Nube', flow: 'delete-cloud', bullets: ['a'],
            requireTyping: 'BORRAR NUBE'
        });
        const input = q('.dataops-typing');
        testRunner.assert(!!input, 'debe renderizar el campo de confirmación tipeada');
        testRunner.assertEquals(confirmBtn().disabled, true, 'deshabilitado al abrir');

        input.value = 'borrar nube';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        testRunner.assertEquals(confirmBtn().disabled, true, 'el texto debe ser EXACTO (sensible a mayúsculas)');

        input.value = 'BORRAR NUBE';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        testRunner.assertEquals(confirmBtn().disabled, false, 'con el texto exacto se habilita');

        confirmBtn().click();
        const result = await p;
        testRunner.assert(result !== null, 'confirmado tras tipear');
        cleanupModals();
    }

});

// ─── U7b: cableado de los 4 handlers + textos honestos ───────────────────────

const fs = require('fs');
const path = require('path');
const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const SETTINGS_TAB_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/settings/SettingsDataTab.js'), 'utf8');
const SYNC_UI_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/SyncUI.js'), 'utf8');
const DATA_SERVICE_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/services/DataService.js'), 'utf8');

testRunner.addSuite("Cableado U7b — los 4 handlers usan el modal rico con su flujo de iconos", {

    "Descargar y Reemplazar usa confirmDataOperation con flow cloud-to-device"() {
        const idx = APP_SRC.indexOf('downloadFromCloud: async () =>');
        testRunner.assert(idx !== -1, 'debe existir App.Sync.downloadFromCloud');
        const block = APP_SRC.slice(idx, idx + 2200);
        testRunner.assert(/confirmDataOperation\s*\(/.test(block), 'debe usar el modal rico');
        testRunner.assert(/cloud-to-device/.test(block), 'flujo visual: nube → disquete');
    },

    "Subir y Reemplazar usa flow device-to-cloud y confirmación tipeada (destruye la nube)"() {
        const idx = APP_SRC.indexOf('uploadToCloud: async () =>');
        testRunner.assert(idx !== -1, 'debe existir App.Sync.uploadToCloud');
        const block = APP_SRC.slice(idx, idx + 2600);
        testRunner.assert(/confirmDataOperation\s*\(/.test(block), 'debe usar el modal rico');
        testRunner.assert(/device-to-cloud/.test(block), 'flujo visual: disquete → nube');
        testRunner.assert(/requireTyping/.test(block),
            'reemplazar la nube es destructivo — debe exigir confirmación tipeada');
    },

    "Borrar Nube usa flow delete-cloud con checkboxes de snapshots y pausa en UN solo modal"() {
        const idx = APP_SRC.indexOf('deleteCloudData: async () =>');
        testRunner.assert(idx !== -1, 'debe existir App.Sync.deleteCloudData');
        const block = APP_SRC.slice(idx, idx + 3000);
        testRunner.assert(/confirmDataOperation\s*\(/.test(block), 'debe usar el modal rico');
        testRunner.assert(/delete-cloud/.test(block), 'flujo visual: nube ✕');
        testRunner.assert(/BORRAR NUBE/.test(block), 'la confirmación tipeada se conserva');
        testRunner.assert(/alsoSnapshots/.test(block) && /pauseUpload/.test(block),
            'las opciones van como checkboxes del MISMO modal, no como diálogos encadenados');
    },

    "Borrar Local (DataService.reset) usa flow delete-local"() {
        testRunner.assert(/confirmDataOperation\s*\(/.test(DATA_SERVICE_SRC),
            'reset debe usar el modal rico');
        testRunner.assert(/delete-local/.test(DATA_SERVICE_SRC), 'flujo visual: disquete ✕');
    }

});

testRunner.addSuite("Textos honestos U7b — cada botón dice lo que hace de verdad", {

    "SettingsDataTab: los botones de nube dicen 'Reemplazar' explícitamente"() {
        testRunner.assert(/Descargar y Reemplazar/.test(SETTINGS_TAB_SRC),
            'el botón de descarga debe llamarse por lo que hace: Descargar y Reemplazar');
        testRunner.assert(/Subir y Reemplazar/.test(SETTINGS_TAB_SRC),
            'el botón de subida debe llamarse por lo que hace: Subir y Reemplazar');
        testRunner.assert(!/exactamente lo que tienes aquí/.test(SETTINGS_TAB_SRC),
            'la promesa vieja (que era mentira con merge:true) no debe volver');
    },

    "SyncUI (sync inicial): los botones de FUSIÓN ya no prometen 'reemplazar'"() {
        // Los handlers del Sync Center (window.uploadToCloud/downloadFromCloud)
        // FUSIONAN — merge:true / spread — pero la copy prometía reemplazo
        // total ('sobrescribirá completamente los datos del otro lado').
        const block = SYNC_UI_SRC.slice(SYNC_UI_SRC.indexOf('buildFullSyncModalHTML'));
        testRunner.assert(!/Reemplaza los datos en la nube/.test(block),
            'el botón de subir del sync inicial fusiona, no reemplaza');
        testRunner.assert(!/Reemplaza tus datos locales/.test(block),
            'el botón de descargar del sync inicial fusiona, no reemplaza');
        testRunner.assert(/[Cc]ombina/.test(block),
            'la copy debe describir la fusión (combinar) que realmente ocurre');
    }

});

console.log('🧪 DataOpsModals tests cargados.');
