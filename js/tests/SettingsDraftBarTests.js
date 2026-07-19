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
    hideSettingsDraftBar,
    discardSettingsDraft,
    guardSettingsDraftOnLeave,
    SETTINGS_DRAFT_BAR_ID
} from '../modules/ui/settings/SettingsDraftBar.js';
import { eventBus } from '../modules/core/Events.js';
import fs from 'fs';
import path from 'path';

const SETTINGS_UI_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/SettingsUI.js'), 'utf8'
);
const SETTINGS_DRAFT_BAR_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/settings/SettingsDraftBar.js'), 'utf8'
);

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

    "discardSettingsDraft resetea los campos EXPLÍCITO y oculta la barra (sin depender de render)"() {
        // Field test 2026-07-19: confiar en render() no alcanza — DOMDiff
        // compara ATRIBUTOS (isEqualNode) y con state sin cambios el HTML
        // nuevo es idéntico, así que el input editado se saltea y el draft
        // tipeado sobrevive: "Descartar" parecía una etiqueta muerta.
        buildForm();
        const input = document.getElementById('companyName');
        input.value = 'Otra Empresa';
        const select = document.getElementById('scrollbarMode');
        select.value = 'hidden';
        refreshSettingsDraftBar(document);

        discardSettingsDraft({ doc: document });

        testRunner.assertEquals(input.value, 'Empresa Test',
            'descartar debe devolver el input a su defaultValue (lo rendereado desde state)');
        testRunner.assertEquals(select.value, 'on-scroll',
            'descartar debe devolver el select a su opción defaultSelected');
        const bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(!bar || bar.hidden === true, 'tras descartar la barra queda oculta');
    },

    "discardSettingsDraft no requiere window.render (reset puramente de DOM)"() {
        buildForm();
        document.getElementById('companyName').value = 'Otra Empresa';
        const prevRender = window.render;
        window.render = undefined;
        try {
            discardSettingsDraft({ doc: document });
            testRunner.assertEquals(document.getElementById('companyName').value, 'Empresa Test',
                'el reset debe funcionar aunque no exista window.render');
        } finally {
            window.render = prevRender;
        }
    }
});

testRunner.addSuite("SettingsDraftBar — cableado en SettingsUI (source-level)", {

    "SettingsUI escucha 'input' y refresca la barra"() {
        testRunner.assert(
            /addEventListener\(\s*['"]input['"]/.test(SETTINGS_UI_SRC),
            'SettingsUI debe delegar el evento input para detectar drafts'
        );
        testRunner.assert(
            /refreshSettingsDraftBar\s*\(/.test(SETTINGS_UI_SRC),
            'el listener debe delegar en refreshSettingsDraftBar'
        );
    },

    "el mapa de acciones incluye discard-settings-draft"() {
        testRunner.assert(
            /['"]discard-settings-draft['"]\s*:/.test(SETTINGS_UI_SRC),
            '_SETTINGS_ACTION_MAP debe rutear discard-settings-draft'
        );
    },

    // F1: window.render() nunca es síncrono (renderOptimizer.scheduleRender →
    // requestAnimationFrame). Refrescar la barra justo después de llamar a
    // saveSettings() miraba el DOM viejo — la barra se re-evalúa sola en la
    // suscripción a 'render:complete' (ver SettingsDraftBar.js).
    "'save-settings' ya NO refresca la barra a mano (el DOM sigue viejo en ese tick)"() {
        const idx = SETTINGS_UI_SRC.indexOf("'save-settings':");
        testRunner.assert(idx !== -1, 'debe existir el wiring de save-settings');
        const block = SETTINGS_UI_SRC.slice(idx, idx + 200);
        testRunner.assert(!/refreshSettingsDraftBar\s*\(/.test(block),
            'save-settings no debe llamar refreshSettingsDraftBar sincrónicamente: el render real es async y se re-evalúa vía render:complete');
    },

    "SettingsDraftBar.js se suscribe a 'render:complete' en eventBus (F1)"() {
        testRunner.assert(
            /eventBus\.on\(\s*['"]render:complete['"]/.test(SETTINGS_DRAFT_BAR_SRC),
            'debe re-evaluar la barra en cada render real completado, en vez de asumir que render() es síncrono'
        );
    }
});

testRunner.addSuite("SettingsDraftBar — F1: re-evaluación async vía render:complete", {

    "emitir 'render:complete' en eventBus re-evalúa la barra sin refresh manual en el call site"() {
        buildForm();
        document.getElementById('companyName').value = 'Otra Empresa';
        refreshSettingsDraftBar(document);
        let bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(bar.hidden === false, 'arranca con draft sucio visible');

        // Simula el render real completando DESPUÉS: el formulario se
        // reconstruye desde state (limpio) y solo ENTONCES se emite el
        // evento — nadie llama a refreshSettingsDraftBar a mano acá.
        buildForm();
        eventBus.emit('render:complete', { timestamp: Date.now() });

        bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(!!bar, 'la suscripción debe re-evaluar (y re-crear si hace falta) la barra');
        testRunner.assert(bar.hidden === true,
            'tras el render real (formulario limpio) la barra debe ocultarse sola, sin refresh manual en el call site');
    },

    "hideSettingsDraftBar oculta de inmediato sin recalcular el estado sucio"() {
        buildForm();
        document.getElementById('companyName').value = 'Otra Empresa'; // sigue sucio
        refreshSettingsDraftBar(document);
        const bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(bar.hidden === false);

        hideSettingsDraftBar(document);
        testRunner.assert(bar.hidden === true,
            'debe ocultarse aunque el draft siga técnicamente sucio (uso: guard de salida, navegación agendada)');
    },

    "guardSettingsDraftOnLeave: onConfirm oculta la barra ya mismo aunque onProceed solo AGENDE la navegación"() {
        buildForm();
        document.getElementById('companyName').value = 'Otra Empresa';
        refreshSettingsDraftBar(document);
        const bar = document.getElementById(SETTINGS_DRAFT_BAR_ID);
        testRunner.assert(bar.hidden === false, 'arranca con draft sucio visible');

        let scheduled = null;
        // Como el render real: onProceed NO toca el DOM en este mismo tick,
        // solo agenda trabajo async (setTimeout/render diferido).
        const fakeAsyncOnProceed = () => {
            scheduled = setTimeout(() => {}, 0);
        };
        const showConfirm = ({ onConfirm }) => onConfirm();

        guardSettingsDraftOnLeave({ doc: document, showConfirm, onProceed: fakeAsyncOnProceed });

        testRunner.assert(bar.hidden === true,
            'la barra debe ocultarse en el mismo tick del onConfirm, sin esperar a que la navegación agendada corra');
        testRunner.assert(scheduled !== null, 'onProceed debe haberse invocado (agendó su trabajo async)');
        clearTimeout(scheduled);
    }
});
