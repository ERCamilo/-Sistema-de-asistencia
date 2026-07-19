/**
 * 🧪 IconSetCommitTests (Ajustes: iconSet pasa a la familia auto-commit)
 *
 * Field test 2026-07-19: el select de iconos tenía un "preview" que mutaba
 * state directo (state.settings.iconSet = applyIconSet(value)) sin estampar
 * ni guardar — el cambio quedaba comprometido en memoria (salir "era lo
 * mismo que guardar"), Descartar no podía revertirlo, y el receptor remoto
 * recibía el dato pero nunca aplicaba el registry (los iconos no cambiaban).
 *
 * Contrato nuevo (convención de controles, SettingsUI.js):
 *   - iconSet es AUTO-COMMIT (familia 1): elegir un set aplica Y guarda vía
 *     window.commitIconSet (batchSetState + estampas + saveApplicationData).
 *   - iconSet ya NO es campo borrador (fuera de SETTINGS_DRAFT_FIELD_IDS) y
 *     window.saveSettings ya no lo lee del DOM ni lo re-aplica.
 *   - Los caminos ENTRANTES (listener de settings per-doc y espejo) aplican
 *     applyIconSet cuando el merge remoto cambió el set — el registry global
 *     de iconos vive fuera de state y no se entera solo.
 *
 * app.js es un IIFE sin harness ejecutable — contratos SOURCE-LEVEL, mismo
 * idioma que SettingsLiveSyncWiringTests / SettingsSaveDomReadContractTests.
 */

import { SETTINGS_DRAFT_FIELD_IDS } from '../modules/ui/settings/SettingsDraftBar.js';
import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const GENERAL_TAB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/settings/SettingsGeneralTab.js'), 'utf8'
);

function sliceFrom(src, anchor, len) {
    const idx = src.indexOf(anchor);
    return idx === -1 ? '' : src.slice(idx, idx + len);
}

testRunner.addSuite("IconSet — auto-commit (familia 1 de la convención)", {

    "iconSet ya no es campo borrador"() {
        testRunner.assert(!SETTINGS_DRAFT_FIELD_IDS.includes('iconSet'),
            'iconSet se comete solo (commitIconSet) — no participa del draft ni de Descartar');
    },

    "window.commitIconSet existe y comete con batchSetState + estampas + save"() {
        const body = sliceFrom(APP_SRC, 'window.commitIconSet', 700);
        testRunner.assert(body.length > 0, 'window.commitIconSet debe existir en app.js');
        testRunner.assert(/batchSetState\s*\(/.test(body),
            'el commit debe mutar state dentro de batchSetState (escritura administrada)');
        testRunner.assert(/applyIconSet\s*\(/.test(body),
            'el commit debe aplicar el registry (applyIconSet) — eso ES el preview');
        testRunner.assert(/updatedAt/.test(body) && /_isDirty/.test(body),
            'debe estampar updatedAt/_isDirty como el resto de los commits de settings');
        testRunner.assert(/saveApplicationData\s*\(/.test(body),
            'debe disparar el guardado para que persista y sincronice');
    },

    "el select de iconos delega en commitIconSet (previewIconSet murió)"() {
        testRunner.assert(/onchange="commitIconSet\(this\.value\)"/.test(GENERAL_TAB_SRC),
            'el onchange del select debe llamar a commitIconSet');
        testRunner.assert(!/previewIconSet/.test(APP_SRC) && !/previewIconSet/.test(GENERAL_TAB_SRC),
            'previewIconSet no debe quedar: su nombre mentía (cometía, no previsualizaba)');
    },

    "window.saveSettings ya no lee iconSet del DOM ni lo re-aplica"() {
        const body = sliceFrom(APP_SRC, 'window.saveSettings', 5200);
        testRunner.assert(body.length > 0, 'window.saveSettings debe existir');
        testRunner.assert(!/getElementById\(\s*['"]iconSet['"]\s*\)/.test(body),
            'saveSettings no debe leer el select de iconos (ya está comprometido en state)');
        testRunner.assert(!/applyIconSet\s*\(/.test(body),
            'saveSettings no debe re-aplicar el icon set');
    }
});

testRunner.addSuite("IconSet — los caminos entrantes aplican el registry (source-level)", {

    "el listener de settings per-doc aplica applyIconSet cuando el merge cambió el set"() {
        const body = sliceFrom(APP_SRC, 'FirebaseService.subscribeToSettings(', 1800);
        testRunner.assert(body.length > 0, 'la suscripción a settings debe existir');
        testRunner.assert(/applyIconSet\s*\(/.test(body),
            'al aceptar un settings remoto con otro iconSet, el receptor debe aplicar el registry');
    },

    "el apply del espejo también aplica applyIconSet tras mergear settings"() {
        const anchor = APP_SRC.indexOf('async function applyRemoteData()');
        testRunner.assert(anchor !== -1, 'applyRemoteData debe existir');
        const body = APP_SRC.slice(anchor, anchor + 6000);
        testRunner.assert(/applyIconSet\s*\(/.test(body),
            'el merge de settings del espejo también debe aplicar el registry de iconos');
    }
});
