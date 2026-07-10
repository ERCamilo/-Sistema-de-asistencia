/**
 * 🧪 ErrorLogWiringTests
 *
 * Contract tests (source-level): confirman que los sitios donde app.js/
 * SettingsUI.js capturan un error y muestran un mensaje traducido (ver
 * ErrorTranslatorWiringTests.js) TAMBIÉN lo registran en ErrorLog.js, y que
 * el botón "Exportar log de errores" de Ajustes está cableado de punta a
 * punta (HTML → action map → window.exportErrorLog).
 */

import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const SETTINGS_UI_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/SettingsUI.js'), 'utf8');
const SETTINGS_GENERAL_TAB_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/settings/SettingsGeneralTab.js'), 'utf8');

testRunner.addSuite("ErrorLogWiring — app.js registra en el log los mismos catches que traduce", {

    "app.js importa logError de ErrorLog.js"() {
        testRunner.assert(
            /import\s*\{[^}]*logError[^}]*\}\s*from\s+['"]\.\/modules\/services\/ErrorLog\.js['"]/.test(APP_SRC),
            "app.js debe importar logError"
        );
    },

    "el catch de arranque llama a logError"() {
        testRunner.assert(
            /Error inicializando sistema[\s\S]{0,80}logError\s*\(\s*error\s*,\s*'iniciar la aplicación'\s*\)/.test(APP_SRC),
            "el catch de arranque debe registrar el error en el log"
        );
    },

    "el catch de descarga de snapshot llama a logError"() {
        testRunner.assert(
            /logError\s*\(\s*e\s*,\s*'cargar el snapshot'\s*\)/.test(APP_SRC),
            "debe registrar en el log el error al descargar un snapshot"
        );
    },

    "el catch de restauración fatal llama a logError"() {
        testRunner.assert(
            /logError\s*\(\s*e\s*,\s*'restaurar el sistema'\s*\)/.test(APP_SRC),
            "debe registrar en el log el error de restauración fatal"
        );
    },

    "el catch de aplicar backup local llama a logError"() {
        testRunner.assert(
            /logError\s*\(\s*error\s*,\s*'aplicar el backup local'\s*\)/.test(APP_SRC),
            "debe registrar en el log el error al aplicar el backup local"
        );
    },

    "el catch de leer el backup llama a logError"() {
        testRunner.assert(
            /logError\s*\(\s*err\s*,\s*'leer el backup'\s*\)/.test(APP_SRC),
            "debe registrar en el log el error al leer el archivo de backup"
        );
    }

});

testRunner.addSuite("ErrorLogWiring — SettingsUI.js (clear-cache) también registra y traduce", {

    "SettingsUI.js importa logError y translateError"() {
        testRunner.assert(/from\s+['"]\.\.\/services\/ErrorLog\.js['"]/.test(SETTINGS_UI_SRC),
            "debe importar de ErrorLog.js");
        testRunner.assert(/from\s+['"]\.\.\/services\/ErrorTranslator\.js['"]/.test(SETTINGS_UI_SRC),
            "debe importar de ErrorTranslator.js");
    },

    "el catch de clear-cache llama a logError y translateError, no error.message crudo"() {
        const idx = SETTINGS_UI_SRC.indexOf("'clear-cache'");
        testRunner.assert(idx !== -1, "debe existir la acción clear-cache");
        const block = SETTINGS_UI_SRC.slice(idx, idx + 700);
        testRunner.assert(/logError\s*\(\s*err\s*,/.test(block), "debe registrar el error en el log");
        testRunner.assert(/translateError\s*\(\s*err\s*,\s*\{\s*fallbackContext\s*:/.test(block),
            "debe traducir el error con translateError(err, {fallbackContext: ...})");
        testRunner.assert(!/err\.message/.test(block) || /translateError/.test(block),
            "err.message solo debe aparecer envuelto por translateError, no concatenado crudo");
    }

});

testRunner.addSuite("ErrorLogWiring — botón 'Exportar log de errores' cableado de punta a punta", {

    "app.js define window.exportErrorLog"() {
        testRunner.assert(/window\.exportErrorLog\s*=\s*function/.test(APP_SRC),
            "debe existir window.exportErrorLog");
    },

    "window.exportErrorLog usa getAllErrors + formatErrorLogAsText de ErrorLog.js"() {
        const idx = APP_SRC.indexOf('window.exportErrorLog');
        testRunner.assert(idx !== -1, "debe existir la función");
        const block = APP_SRC.slice(idx, idx + 700);
        testRunner.assert(/getAllErrors\s*\(\s*\)/.test(block), "debe leer todas las entradas del log");
        testRunner.assert(/formatErrorLogAsText\s*\(/.test(block), "debe formatear el log como texto");
    },

    "window.exportErrorLog avisa (no descarga un archivo vacío) cuando no hay errores registrados"() {
        const idx = APP_SRC.indexOf('window.exportErrorLog');
        const block = APP_SRC.slice(idx, idx + 700);
        testRunner.assert(/entries\.length\s*===\s*0/.test(block),
            "debe chequear la lista vacía antes de generar el archivo");
    },

    "SettingsUI.js mapea 'export-error-log' a window.exportErrorLog"() {
        testRunner.assert(
            /['"]export-error-log['"]\s*:\s*\(\)\s*=>\s*window\.exportErrorLog\?\.\(\)/.test(SETTINGS_UI_SRC),
            "el action map debe enrutar export-error-log a window.exportErrorLog"
        );
    },

    "SettingsGeneralTab.js renderiza el botón con data-settings-action='export-error-log'"() {
        testRunner.assert(
            /data-settings-action="export-error-log"/.test(SETTINGS_GENERAL_TAB_SRC),
            "debe existir un botón con data-settings-action=export-error-log"
        );
    }

});

console.log('🧪 ErrorLogWiring contract tests cargados.');
