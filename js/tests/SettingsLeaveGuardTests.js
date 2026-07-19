/**
 * 🧪 SettingsLeaveGuardTests (Ajustes: confirm al salir con draft sucio)
 *
 * Tercer tramo de la convención de controles de Ajustes (ver SettingsUI.js):
 * los inputs validados son borrador del DOM, y cambiar de pestaña re-renderiza
 * el formulario desde state — el draft se perdía en silencio. Este guard
 * pregunta ANTES de navegar cuando hay draft sucio: "Guardar Configuración"
 * sigue siendo el commit; salir confirmando descarta.
 *
 * Es un guard de CASO BORDE: la barra pegajosa (SettingsDraftBar) es el
 * mecanismo principal de aviso. Por eso el guard nunca BLOQUEA la navegación
 * si el confirm no está disponible (defensivo) — mejor perder un draft que
 * dejar al usuario atrapado en Ajustes.
 */

import { guardSettingsDraftOnLeave } from '../modules/ui/settings/SettingsDraftBar.js';
import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const SETTINGS_UI_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/SettingsUI.js'), 'utf8'
);

function buildForm({ dirty }) {
    document.body.innerHTML = '<input id="companyName" value="Empresa Test">';
    if (dirty) document.getElementById('companyName').value = 'Otra Empresa';
}

testRunner.addSuite("SettingsDraftBar — guardSettingsDraftOnLeave", {

    "sin draft sucio navega directo, sin preguntar"() {
        buildForm({ dirty: false });
        let proceeded = 0, asked = 0;
        const result = guardSettingsDraftOnLeave({
            doc: document,
            showConfirm: () => { asked++; },
            onProceed: () => { proceeded++; }
        });

        testRunner.assertEquals(proceeded, 1, 'debe navegar de una');
        testRunner.assertEquals(asked, 0, 'no debe molestar con confirm');
        testRunner.assert(result.asked === false, 'debe reportar que no preguntó');
    },

    "con draft sucio pregunta y NO navega hasta que el usuario confirma"() {
        buildForm({ dirty: true });
        let proceeded = 0;
        let confirmOpts = null;
        guardSettingsDraftOnLeave({
            doc: document,
            showConfirm: (opts) => { confirmOpts = opts; },
            onProceed: () => { proceeded++; }
        });

        testRunner.assert(!!confirmOpts, 'debe abrir el confirm');
        testRunner.assertEquals(proceeded, 0, 'NO debe navegar antes de la confirmación');

        confirmOpts.onConfirm();
        testRunner.assertEquals(proceeded, 1, 'confirmar debe ejecutar la navegación diferida');
    },

    "el confirm explica que se descartan los cambios (copy honesto)"() {
        buildForm({ dirty: true });
        let confirmOpts = null;
        guardSettingsDraftOnLeave({
            doc: document,
            showConfirm: (opts) => { confirmOpts = opts; },
            onProceed: () => {}
        });

        testRunner.assert(/sin guardar/i.test(`${confirmOpts.title} ${confirmOpts.message}`),
            'debe avisar que hay cambios sin guardar');
        testRunner.assert(typeof confirmOpts.confirmText === 'string' && confirmOpts.confirmText.length > 0,
            'debe tener texto de confirmación explícito');
    },

    "si showConfirm no está disponible, navega igual (nunca bloquear)"() {
        buildForm({ dirty: true });
        let proceeded = 0;
        const result = guardSettingsDraftOnLeave({
            doc: document,
            showConfirm: undefined,
            onProceed: () => { proceeded++; }
        });

        testRunner.assertEquals(proceeded, 1, 'sin confirm disponible debe navegar igual');
        testRunner.assert(result.asked === false, 'no pudo preguntar');
    }
});

testRunner.addSuite("SettingsLeaveGuard — cableado (source-level)", {

    "change-settings-tab pasa por el guard antes de cambiar de sub-pestaña"() {
        const idx = SETTINGS_UI_SRC.indexOf("'change-settings-tab'");
        testRunner.assert(idx !== -1, 'la acción change-settings-tab debe existir');
        const entry = SETTINGS_UI_SRC.slice(idx, idx + 400);
        testRunner.assert(
            /guardSettingsDraftOnLeave\s*\(/.test(entry),
            'el cambio de sub-pestaña debe pasar por guardSettingsDraftOnLeave'
        );
    },

    "window.changeTab guarda la salida de settings con el guard"() {
        const idx = APP_SRC.indexOf('window.changeTab =');
        testRunner.assert(idx !== -1, 'window.changeTab debe existir');
        const body = APP_SRC.slice(idx, idx + 1600);
        testRunner.assert(
            /guardSettingsDraftOnLeave\s*\(/.test(body),
            'salir de la pestaña de Ajustes debe pasar por guardSettingsDraftOnLeave'
        );
        testRunner.assert(
            /activeTab\s*===\s*['"]settings['"]/.test(body),
            'el guard debe aplicar solo cuando se SALE de settings'
        );
    }
});
