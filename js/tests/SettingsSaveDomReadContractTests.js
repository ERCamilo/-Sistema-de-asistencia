/**
 * 🧪 SettingsSaveDomReadContractTests (F2 — Judgment Day)
 *
 * Convención de controles de Ajustes (ver nota en SettingsUI.js, commit
 * 3fcd428): los switches auto-save (legacyNavigation, hideDuplicateAlerts,
 * weatherEnabled, attendancePositionWatermarks) y las opciones cerradas de
 * marca de agua se comprometen SOLAS en state al cambiar — ya NO son borrador del DOM. window.saveSettings
 * (app.js) los leía igual de 3 checkboxes como si fueran borrador,
 * contradiciendo esa convención documentada.
 *
 * app.js no tiene un harness que ejecute window.saveSettings de verdad (IIFE
 * gigante acoplado al DOM real de Ajustes) — igual que OutgoingConflictTests
 * y SettingsLiveSyncWiringTests, este es un contrato SOURCE-LEVEL sobre el
 * texto del archivo.
 */

import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

function saveSettingsBody() {
    const start = APP_SRC.indexOf('window.saveSettings = function');
    if (start === -1) return '';
    const end = APP_SRC.indexOf('\n};', start);
    return end === -1 ? APP_SRC.slice(start) : APP_SRC.slice(start, end);
}

const SAVE_SETTINGS_SRC = saveSettingsBody();

testRunner.addSuite("window.saveSettings — no lee los switches auto-save del DOM (F2)", {

    "existe el bloque de window.saveSettings en app.js"() {
        testRunner.assert(!!SAVE_SETTINGS_SRC, 'debe encontrarse "window.saveSettings = function ... };" en app.js');
    },

    "no consulta document.getElementById('legacyNavigation')"() {
        testRunner.assert(!/getElementById\(\s*['"]legacyNavigation['"]\s*\)/.test(SAVE_SETTINGS_SRC),
            'legacyNavigation ya está comprometido en state por commitAutoSaveSwitch; no es borrador del DOM');
    },

    "no consulta document.getElementById('hideDuplicateAlerts')"() {
        testRunner.assert(!/getElementById\(\s*['"]hideDuplicateAlerts['"]\s*\)/.test(SAVE_SETTINGS_SRC),
            'hideDuplicateAlerts ya está comprometido en state por commitAutoSaveSwitch; no es borrador del DOM');
    },

    "no consulta document.getElementById('weatherEnabled')"() {
        testRunner.assert(!/getElementById\(\s*['"]weatherEnabled['"]\s*\)/.test(SAVE_SETTINGS_SRC),
            'weatherEnabled ya está comprometido en state por commitAutoSaveSwitch; no es borrador del DOM');
    },

    "no consulta document.getElementById('attendancePositionWatermarks')"() {
        testRunner.assert(!/getElementById\(\s*['"]attendancePositionWatermarks['"]\s*\)/.test(SAVE_SETTINGS_SRC),
            'attendancePositionWatermarks ya está comprometido en state por commitAutoSaveSwitch; no es borrador del DOM');
    },

    "no lee las opciones de marca de agua desde el DOM"() {
        for (const key of ['attendanceWatermarkVisibility', 'attendanceWatermarkContent']) {
            const re = new RegExp(`getElementById\\(\\s*['"]${key}['"]\\s*\\)`);
            testRunner.assert(!re.test(SAVE_SETTINGS_SRC),
                `${key} ya está comprometido en state por commitAutoSaveOption; no es borrador del DOM`);
        }
    },

    "weatherEnabled se sigue leyendo (de state.settings, no del checkbox) para la validación de ubicación"() {
        testRunner.assert(/weatherEnabled\s*=\s*state\.settings\.weatherEnabled\s*===\s*true/.test(SAVE_SETTINGS_SRC),
            'weatherEnabled debe tomarse de state.settings, no del checkbox del DOM');
    },

    "no reasigna state.settings.legacyNavigation / hideDuplicateAlerts / weatherEnabled (ya comprometidos)"() {
        for (const key of [
            'legacyNavigation',
            'hideDuplicateAlerts',
            'weatherEnabled',
            'attendancePositionWatermarks',
            'attendanceWatermarkVisibility',
            'attendanceWatermarkContent'
        ]) {
            // (?!=) evita falsos positivos con comparaciones (=== true)
            const re = new RegExp(`state\\.settings\\.${key}\\s*=(?!=)`);
            testRunner.assert(!re.test(SAVE_SETTINGS_SRC),
                `saveSettings no debe reasignar state.settings.${key}: ya lo comete commitAutoSaveSwitch, re-escribirlo acá pisaría un valor fresco con uno potencialmente stale`);
        }
    },

    "el resto de los campos borrador (companyName, factores, etc.) se sigue leyendo del DOM igual que antes"() {
        for (const id of ['companyName', 'regularHoursPerDay', 'overtimeFactor', 'holidayFactor', 'defaultDeductionPercentage']) {
            const re = new RegExp(`getElementById\\(\\s*['"]${id}['"]\\s*\\)`);
            testRunner.assert(re.test(SAVE_SETTINGS_SRC),
                `${id} sigue siendo borrador del DOM — el fix de F2 no debe tocar este comportamiento`);
        }
    }
});

console.log('🧪 SettingsSaveDomReadContractTests cargados.');
