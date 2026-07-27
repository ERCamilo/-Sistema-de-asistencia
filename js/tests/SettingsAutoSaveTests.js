/**
 * 🧪 SettingsAutoSaveTests (Ajustes: auto-save de switches)
 *
 * Convención de controles de Ajustes (ver nota en SettingsUI.js):
 *   - Los SWITCHES (checkboxes tipo toggle) se comprometen SOLOS al cambiar:
 *     mutan state vía batchSetState, estampan updatedAt/_isDirty y disparan
 *     saveApplicationData — así el cambio persiste localmente y viaja en vivo
 *     al resto de los dispositivos (Fase 2B: doc per-registro de settings).
 *   - Los INPUTS VALIDADOS (texto/número/selects del formulario) siguen como
 *     borrador del DOM hasta "Guardar Configuración".
 *
 * Gap que cierra: el field test de Fase 2B mostró que mover un switch solo
 * mutaba state en memoria (sin persistir ni sincronizar) — el cambio se veía
 * aplicado en el dispositivo local pero se perdía en un F5 y nunca llegaba a
 * los demás dispositivos hasta el próximo "Guardar Configuración".
 *
 * La decisión de commit vive en commitAutoSaveSwitch (exportada de
 * SettingsUI.js) con dependencias inyectables — mismo patrón que
 * SettingsLiveSync.handleRemoteSettings. El cableado del listener de 'change'
 * se verifica a nivel fuente (mismo idioma que SettingsLiveSyncWiringTests).
 */

import { commitAutoSaveOption, commitAutoSaveSwitch } from '../modules/ui/SettingsUI.js';
import fs from 'fs';
import path from 'path';

const SETTINGS_UI_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/SettingsUI.js'), 'utf8'
);

const FIXED_NOW = 1_750_000_000_000;

function makeHarness(settingsOverrides = {}) {
    const st = {
        settings: {
            legacyNavigation: false,
            hideDuplicateAlerts: false,
            weatherEnabled: false,
            attendancePositionWatermarks: true,
            attendanceWatermarkVisibility: 'present',
            attendanceWatermarkContent: 'position',
            ...settingsOverrides
        }
    };
    const calls = { save: 0, batch: 0, saveArgs: [] };
    const deps = {
        state: st,
        batchSetState: (cb) => { calls.batch++; cb(st); },
        save: (opts) => { calls.save++; calls.saveArgs.push(opts); },
        now: () => FIXED_NOW
    };
    return { st, calls, deps };
}

testRunner.addSuite("SettingsUI — commitAutoSaveSwitch (auto-save de switches)", {

    "cada switch conocido comete su valor en state.settings y dispara el save"() {
        for (const id of ['legacyNavigation', 'hideDuplicateAlerts', 'weatherEnabled', 'attendancePositionWatermarks']) {
            const { st, calls, deps } = makeHarness();
            const result = commitAutoSaveSwitch({ id, checked: true, deps });

            testRunner.assert(result.committed === true, `${id}: debe reportar committed=true`);
            testRunner.assertEquals(st.settings[id], true, `${id}: debe escribir el valor en state.settings`);
            testRunner.assertEquals(calls.save, 1, `${id}: debe disparar exactamente un save`);
        }
    },

    "también comete el valor false (apagar un switch persiste igual que encenderlo)"() {
        const { st, calls, deps } = makeHarness({ legacyNavigation: true });
        const result = commitAutoSaveSwitch({ id: 'legacyNavigation', checked: false, deps });

        testRunner.assert(result.committed === true, 'apagar debe reportar committed=true');
        testRunner.assertEquals(st.settings.legacyNavigation, false, 'debe escribir false, no ignorarlo por falsy');
        testRunner.assertEquals(calls.save, 1, 'apagar también dispara el save');
    },

    "estampa updatedAt y _isDirty igual que window.saveSettings"() {
        const { st, deps } = makeHarness();
        commitAutoSaveSwitch({ id: 'hideDuplicateAlerts', checked: true, deps });

        testRunner.assertEquals(st.settings.updatedAt, FIXED_NOW, 'debe estampar settings.updatedAt con now()');
        testRunner.assertEquals(st.settings._isDirty, true, 'debe marcar settings._isDirty');
    },

    "la mutación de state ocurre DENTRO de batchSetState (sin deuda de escritura directa)"() {
        const { st, calls, deps } = makeHarness();
        let valueWhenSaveRan = null;
        deps.save = () => { valueWhenSaveRan = st.settings.weatherEnabled; calls.save++; };

        commitAutoSaveSwitch({ id: 'weatherEnabled', checked: true, deps });

        testRunner.assertEquals(calls.batch, 1, 'debe usar batchSetState exactamente una vez');
        testRunner.assertEquals(valueWhenSaveRan, true, 'el save debe correr DESPUÉS de la mutación (snapshot fresco)');
    },

    "un id desconocido no comete nada ni dispara save"() {
        const { st, calls, deps } = makeHarness();
        const result = commitAutoSaveSwitch({ id: 'companyName', checked: true, deps });

        testRunner.assert(result.committed === false, 'un input del formulario NO es un switch auto-save');
        testRunner.assertEquals(calls.save, 0, 'no debe disparar save');
        testRunner.assertEquals(calls.batch, 0, 'no debe tocar state');
        testRunner.assert(!('companyName' in st.settings), 'no debe inventar la clave en settings');
    },

    "sin id no revienta y no comete (target sin id, defensivo)"() {
        const { calls, deps } = makeHarness();
        const result = commitAutoSaveSwitch({ id: undefined, checked: true, deps });

        testRunner.assert(result.committed === false, 'sin id no hay commit');
        testRunner.assertEquals(calls.save, 0, 'sin id no hay save');
    }
});

testRunner.addSuite("SettingsUI — commitAutoSaveOption (opciones cerradas)", {

    "comete visibilidad y contenido de la marca de agua"() {
        const cases = [
            ['attendanceWatermarkVisibility', 'always'],
            ['attendanceWatermarkContent', 'number']
        ];

        for (const [name, value] of cases) {
            const { st, calls, deps } = makeHarness();
            const result = commitAutoSaveOption({ name, value, deps });

            testRunner.assert(result.committed === true, `${name}: debe reportar committed=true`);
            testRunner.assertEquals(st.settings[name], value, `${name}: debe guardar una opción válida`);
            testRunner.assertEquals(calls.save, 1, `${name}: debe persistir inmediatamente`);
            testRunner.assertEquals(calls.batch, 1, `${name}: debe usar batchSetState`);
        }
    },

    "rechaza nombres y valores fuera del dominio"() {
        const { st, calls, deps } = makeHarness();
        const badValue = commitAutoSaveOption({
            name: 'attendanceWatermarkVisibility',
            value: 'sometimes',
            deps
        });
        const badName = commitAutoSaveOption({ name: 'companyName', value: 'always', deps });

        testRunner.assert(badValue.committed === false, 'no debe aceptar una visibilidad inventada');
        testRunner.assert(badName.committed === false, 'no debe aceptar un control no registrado');
        testRunner.assertEquals(st.settings.attendanceWatermarkVisibility, 'present',
            'una opción inválida no debe modificar el valor actual');
        testRunner.assertEquals(calls.save, 0, 'las opciones inválidas no deben persistir');
        testRunner.assertEquals(calls.batch, 0, 'las opciones inválidas no deben tocar state');
    }
});

testRunner.addSuite("SettingsUI — cableado del listener de change (source-level)", {

    "el camino del evento change delega en commitAutoSaveSwitch"() {
        const switchIdx = SETTINGS_UI_SRC.indexOf('function _handleSettingsSwitch');
        const changeIdx = SETTINGS_UI_SRC.indexOf('function _handleSettingsChange');
        testRunner.assert(switchIdx !== -1 && changeIdx !== -1,
            '_handleSettingsSwitch y _handleSettingsChange deben existir');

        const switchBody = SETTINGS_UI_SRC.slice(switchIdx, switchIdx + 800);
        testRunner.assert(
            /commitAutoSaveSwitch\s*\(/.test(switchBody),
            'el manejo de switches debe delegar el commit en commitAutoSaveSwitch'
        );
        const changeBody = SETTINGS_UI_SRC.slice(changeIdx, changeIdx + 800);
        testRunner.assert(
            /_handleSettingsSwitch\s*\(/.test(changeBody),
            'el listener de change debe rutear los checkboxes a _handleSettingsSwitch'
        );
        testRunner.assert(
            /_handleSettingsOption\s*\(/.test(changeBody),
            'el listener de change debe rutear los radios a _handleSettingsOption'
        );
    },

    "los listeners ya no mutan state.settings directo (la deuda migró a batchSetState)"() {
        const start = SETTINGS_UI_SRC.indexOf('function _isDraftField');
        const end = SETTINGS_UI_SRC.indexOf('function _attachSettingsDelegation');
        testRunner.assert(start !== -1 && end !== -1 && end > start,
            'la región de listeners debe existir');
        const listeners = SETTINGS_UI_SRC.slice(start, end);
        testRunner.assert(
            !/state\.settings\.[A-Za-z0-9_$]+\s*=/.test(listeners),
            'los handlers no deben asignar state.settings.X directo — eso vive en commitAutoSaveSwitch vía batchSetState'
        );
    }
});
