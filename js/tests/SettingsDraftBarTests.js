/**
 * 🧪 SettingsDraftBarTests (Ajustes: barra pegajosa de cambios sin guardar)
 *
 * Convención de controles de Ajustes (ver nota en SettingsUI.js): los inputs
 * validados del formulario son BORRADOR en el DOM hasta "Guardar
 * Configuración". Esta barra hace visible ese estado: aparece fija abajo
 * cuando hay diferencias entre lo tipeado y lo guardado, con acciones
 * Guardar (delega en save-settings) y Descartar (re-render desde state).
 *
 * Detección de sucio: se compara `value` contra `defaultValue` (y la opción
 * `defaultSelected` en selects) — el DOM rendereado desde state ES la línea
 * de base, así que no hay mapa campo→state que mantener, un revert manual
 * vuelve a "limpio" y cualquier re-render (que reconstruye el formulario
 * desde state) resetea la base solo.
 */

import {
    SETTINGS_DRAFT_FIELD_IDS,
    isSettingsDraftDirty,
    refreshSettingsDraftBar,
    discardSettingsDraft,
    SETTINGS_DRAFT_BAR_ID
} from '../modules/ui/settings/SettingsDraftBar.js';

function buildForm() {
    document.body.innerHTML = `
        <input id="companyName" value="Empresa Test">
        <input id="regularHoursPerDay" type="number" value="8">
        <select id="scrollbarMode">
            <option value="always">Siempre</option>
            <option value="on-scroll" selected>Al hacer scroll</option>
            <option value="hidden">Oculto</option>
        </select>
    `;
}

testRunner.addSuite("SettingsDraftBar — isSettingsDraftDirty (value vs defaultValue)", {

    "formulario recién rendereado (value == defaultValue) no está sucio"() {
        buildForm();
        testRunner.assert(isSettingsDraftDirty(document) === false,
            'sin ediciones no hay draft sucio');
    },

    "editar un input de texto lo ensucia"() {
        buildForm();
        document.getElementById('companyName').value = 'Otra Empresa';
        testRunner.assert(isSettingsDraftDirty(document) === true,
            'un texto editado debe marcar sucio');
    },

    "editar un input numérico lo ensucia"() {
        buildForm();
        document.getElementById('regularHoursPerDay').value = '9';
        testRunner.assert(isSettingsDraftDirty(document) === true,
            'un número editado debe marcar sucio');
    },

    "revertir a mano la edición vuelve a limpio"() {
        buildForm();
        const input = document.getElementById('companyName');
        input.value = 'Otra Empresa';
        input.value = 'Empresa Test';
        testRunner.assert(isSettingsDraftDirty(document) === false,
            'volver al valor rendereado debe quedar limpio (no es un flag pegajoso)');
    },

    "cambiar la opción de un select lo ensucia y volver a la default lo limpia"() {
        buildForm();
        const select = document.getElementById('scrollbarMode');
        select.value = 'hidden';
        testRunner.assert(isSettingsDraftDirty(document) === true,
            'select fuera de su defaultSelected debe marcar sucio');
        select.value = 'on-scroll';
        testRunner.assert(isSettingsDraftDirty(document) === false,
            'select de vuelta en su defaultSelected debe quedar limpio');
    },

    "campos ausentes del DOM (otra pestaña activa) no cuentan como sucios"() {
        document.body.innerHTML = '<div id="app"></div>';
        testRunner.assert(isSettingsDraftDirty(document) === false,
            'sin formulario no hay draft');
    },

    "los switches auto-save NO participan del draft"() {
        for (const id of ['legacyNavigation', 'hideDuplicateAlerts', 'weatherEnabled']) {
            testRunner.assert(!SETTINGS_DRAFT_FIELD_IDS.includes(id),
                `${id} se comete solo al cambiar (commitAutoSaveSwitch) — no es borrador`);
        }
    }
});

testRunner.addSuite("SettingsDraftBar — barra pegajosa (crear/mostrar/ocultar)", {

    "refreshSettingsDraftBar crea la barra oculta cuando no hay draft"() {
        buildForm();
        refreshSettingsDraftBar(document);
        const bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(!!bar, 'la barra debe existir en el body');
        testRunner.assert(bar.hidden === true, 'sin draft la barra queda oculta');
    },

    "con draft sucio la barra se muestra, y al limpiar se vuelve a ocultar"() {
        buildForm();
        document.getElementById('companyName').value = 'Otra Empresa';
        refreshSettingsDraftBar(document);
        const bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(bar.hidden === false, 'con draft la barra se muestra');

        document.getElementById('companyName').value = 'Empresa Test';
        refreshSettingsDraftBar(document);
        testRunner.assert(bar.hidden === true, 'al volver a limpio la barra se oculta');
    },

    "refreshSettingsDraftBar es idempotente (una sola barra por documento)"() {
        buildForm();
        refreshSettingsDraftBar(document);
        refreshSettingsDraftBar(document);
        refreshSettingsDraftBar(document);
        const bars = document.querySelectorAll(`#${SETTINGS_DRAFT_BAR_ID}`);
        testRunner.assertEquals(bars.length, 1, 'no debe duplicar la barra');
    },

    "la barra ofrece Guardar (delega en save-settings) y Descartar"() {
        buildForm();
        document.getElementById('companyName').value = 'Otra Empresa';
        refreshSettingsDraftBar(document);
        const bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(!!bar.querySelector('[data-settings-action="save-settings"]'),
            'Guardar reusa la acción save-settings existente (validación incluida)');
        testRunner.assert(!!bar.querySelector('[data-settings-action="discard-settings-draft"]'),
            'Descartar debe tener su acción propia');
    },

    "discardSettingsDraft re-renderiza desde state y oculta la barra"() {
        buildForm();
        document.getElementById('companyName').value = 'Otra Empresa';
        refreshSettingsDraftBar(document);

        let renders = 0;
        discardSettingsDraft({ doc: document, render: () => { renders++; buildForm(); } });

        testRunner.assertEquals(renders, 1, 'descartar debe re-renderizar (el DOM vuelve a state)');
        const bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(!bar || bar.hidden === true, 'tras descartar la barra queda oculta');
    }
});
