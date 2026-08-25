/**
 * 🧪 AppStorageFailureDialogTests (incidente de producción: boot colgado por IndexedDB)
 *
 * Cuando otra ventana oculta retenía una conexión vieja durante un upgrade de
 * versión, indexedDB.open quedaba pendiente para siempre: el listener de auth
 * nunca se registraba y el usuario quedaba sin una salida útil. El controlador
 * de arranque ahora conserva el error visible y ofrece recargar la aplicación.
 *
 * Fix en dos capas (contratos acá):
 *   1. PersistenceService.loadApplicationData ya NO traga los errores tipados
 *      de apertura (IndexedDBOpenBlockedError / IndexedDBOpenTimeoutError):
 *      propagan al catch de arranque de app.js. El resto de errores sigue con
 *      el comportamiento legacy (log + return false, UI no bloqueada).
 *   2. app.js muestra un Modal.confirm accionable ("Recargar ahora" /
 *      "Continuar sin datos locales") para esos dos nombres de error.
 */

import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);

testRunner.addSuite("app.js — catch de arranque: diálogo accionable ante fallos tipados de IndexedDB", {

    "el catch de arranque distingue ambos nombres de error tipados"() {
        const initLogIdx = APP_SRC.indexOf("'❌ Error fatal durante la inicialización:'");
        testRunner.assert(initLogIdx !== -1, 'debe existir el log fatal del catch de arranque');
        const catchBlock = APP_SRC.slice(Math.max(0, initLogIdx - 300), initLogIdx + 1500);
        testRunner.assert(catchBlock.includes("error?.name === 'IndexedDBOpenBlockedError'"),
            'el catch debe chequear error.name === IndexedDBOpenBlockedError');
        testRunner.assert(catchBlock.includes("error?.name === 'IndexedDBOpenTimeoutError'"),
            'el catch debe chequear error.name === IndexedDBOpenTimeoutError');
        // El log genérico previo queda intacto (diagnóstico completo en consola).
        testRunner.assert(true);
    },

    "existe el diálogo de recuperación basado en Modal.confirm"() {
        const idx = APP_SRC.indexOf('async function showStorageFailureRecoveryDialog');
        testRunner.assert(idx !== -1, 'debe existir showStorageFailureRecoveryDialog');
        const block = APP_SRC.slice(idx, idx + 1600);
        testRunner.assert(/Modal\.confirm\s*\(/.test(block),
            'el diálogo debe usar Modal.confirm (mismo patrón que handleLocalOwnerMismatch)');
        testRunner.assert(block.includes("'Recargar ahora'"),
            "confirmText debe ser 'Recargar ahora'");
        testRunner.assert(block.includes("'Continuar sin datos locales'"),
            "cancelText debe ser 'Continuar sin datos locales'");
    },

    "confirmar recarga la página (window.location.reload)"() {
        const idx = APP_SRC.indexOf('async function showStorageFailureRecoveryDialog');
        const block = APP_SRC.slice(idx, idx + 1600);
        testRunner.assert(/window\.location\.reload\(\)/.test(block),
            'al confirmar debe ejecutar window.location.reload()');
    },

    "cada caso tiene su copy: bloqueado por otra ventana vs timeout"() {
        const idx = APP_SRC.indexOf('async function showStorageFailureRecoveryDialog');
        const block = APP_SRC.slice(idx, idx + 1600);
        testRunner.assert(
            block.includes('bloqueando la actualización del almacenamiento local'),
            'caso Blocked: el mensaje debe explicar que otra ventana bloquea la actualización'
        );
        testRunner.assert(
            block.includes('Cerrá todas las ventanas de la app y volvé a abrir.'),
            'caso Blocked: el mensaje debe pedir cerrar las otras ventanas y reabrir'
        );
        testRunner.assert(
            block.includes('El almacenamiento local tardó demasiado en responder.'),
            'caso Timeout: el mensaje debe explicar que el storage no respondió a tiempo'
        );
    },

    "la llamada al diálogo es fire-and-forget con .catch (no rompe el render de error)"() {
        testRunner.assert(
            /showStorageFailureRecoveryDialog\(error\.name\)\s*\.\s*catch\(/.test(APP_SRC),
            'el diálogo debe llamarse con .catch para no generar unhandled rejection'
        );
    },

    "el comportamiento genérico del catch queda intacto para otros errores"() {
        const initLogIdx = APP_SRC.indexOf("'❌ Error fatal durante la inicialización:'");
        const catchBlock = APP_SRC.slice(initLogIdx, initLogIdx + 1500);
        const renderIdx = catchBlock.indexOf('render();');
        const dialogIdx = catchBlock.indexOf('showStorageFailureRecoveryDialog(error.name)');
        testRunner.assert(renderIdx !== -1, 'el catch debe seguir renderizando el estado de error');
        testRunner.assert(dialogIdx !== -1 && dialogIdx < renderIdx,
            'el diálogo va ANTES del render (junto al log), sin reemplazar el flujo genérico');
        const errorEventIdx = catchBlock.indexOf("new CustomEvent('app:error'");
        testRunner.assert(errorEventIdx !== -1 && errorEventIdx < renderIdx,
            'el catch debe publicar app:error antes de intentar el render de recuperación');
        testRunner.assert(!catchBlock.includes('loaderTimeout'),
            'app.js no debe volver a ser dueño del timeout del loader');
    }

});

testRunner.addSuite("PersistenceService — el error tipado de IndexedDB propaga al catch del boot", {

    "loadApplicationData re-lanza los errores tipados de apertura (no los traga)"() {
        const start = PERSISTENCE_SRC.indexOf('export async function loadApplicationData(');
        const end = PERSISTENCE_SRC.indexOf('export async function loadDemoDataIntoDB(', start);
        testRunner.assert(start !== -1 && end !== -1, 'debe existir loadApplicationData');
        const body = PERSISTENCE_SRC.slice(start, end);
        testRunner.assert(body.includes("error?.name === 'IndexedDBOpenBlockedError'"),
            'el catch debe re-lanzar IndexedDBOpenBlockedError');
        testRunner.assert(body.includes("error?.name === 'IndexedDBOpenTimeoutError'"),
            'el catch debe re-lanzar IndexedDBOpenTimeoutError');
        testRunner.assert(/\)\s*\{\s*throw error;\s*\}/.test(body),
            'los errores tipados deben re-lanzarse con throw error (llegan al catch de app.js)');
    },

    "los demás errores siguen con el comportamiento legacy (log + return false)"() {
        const start = PERSISTENCE_SRC.indexOf('export async function loadApplicationData(');
        const end = PERSISTENCE_SRC.indexOf('export async function loadDemoDataIntoDB(', start);
        const body = PERSISTENCE_SRC.slice(start, end);
        testRunner.assert(body.includes("'❌ Error fatal al cargar datos:'"),
            'debe conservar el console.error genérico del catch');
        testRunner.assert(body.includes('state.isDataLoaded = true; // No bloquear la UI'),
            'debe conservar state.isDataLoaded = true para no bloquear la UI');
        testRunner.assert(body.includes('return false;'),
            'debe conservar return false como salida legacy');
    }

});

console.log('🧪 App storage failure dialog contract tests cargados.');
