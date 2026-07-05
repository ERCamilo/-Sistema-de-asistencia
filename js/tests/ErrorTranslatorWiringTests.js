/**
 * 🧪 ErrorTranslatorWiringTests
 *
 * Contract tests (source-level): confirman que los puntos de app.js donde
 * ANTES se concatenaba error.message/e.message crudo en una notificación al
 * usuario ahora pasan por translateError(). Ver ErrorTranslatorTests.js para
 * la lógica pura del traductor.
 */

import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

testRunner.addSuite("ErrorTranslatorWiring — app.js usa translateError en vez de .message crudo", {

    "app.js importa translateError de ErrorTranslator.js"() {
        testRunner.assert(
            /import\s*\{[^}]*translateError[^}]*\}\s*from\s+['"]\.\/modules\/services\/ErrorTranslator\.js['"]/.test(APP_SRC),
            "app.js debe importar translateError"
        );
    },

    // Hallazgo de la revisión en fresco: la primera versión de este cableado
    // llamaba translateError(error, 'un string') — un STRING plano como 2do
    // argumento, no {fallbackContext: '...'}. La firma real espera un objeto
    // de opciones; con un string, 'isOnline' in opts explotaba con TypeError
    // y translateError() nunca llegaba a devolver nada — el usuario no veía
    // NINGÚN mensaje (peor que el error crudo que se quería evitar). Cada
    // assert de acá exige la forma exacta {fallbackContext: '...'}, no solo
    // la presencia de la palabra translateError(.

    "el catch de arranque (DOMContentLoaded) usa translateError con {fallbackContext}"() {
        testRunner.assert(
            /Fallo de arranque[\s\S]{0,60}translateError\s*\(\s*error\s*,\s*\{\s*fallbackContext\s*:/.test(APP_SRC),
            "el mensaje de fallo de arranque debe pasar por translateError(error, {fallbackContext: '...'})"
        );
        testRunner.assert(
            !/Fallo de arranque[^`]*\$\{error\.message\}/.test(APP_SRC),
            "no debe seguir concatenando error.message crudo en el fallo de arranque"
        );
    },

    "el catch de descarga de snapshot usa translateError con {fallbackContext}"() {
        testRunner.assert(
            /No se pudo cargar el snapshot[\s\S]{0,40}translateError\s*\(\s*e\s*,\s*\{\s*fallbackContext\s*:/.test(APP_SRC),
            "debe pasar por translateError(e, {fallbackContext: '...'}) al fallar la descarga de un snapshot"
        );
    },

    "el catch de restauración fatal usa translateError con {fallbackContext}"() {
        testRunner.assert(
            /Error al restaurar[\s\S]{0,40}translateError\s*\(\s*e\s*,\s*\{\s*fallbackContext\s*:/.test(APP_SRC),
            "debe pasar por translateError(e, {fallbackContext: '...'}) al fallar la restauración"
        );
    },

    "el catch de aplicar backup local usa translateError con {fallbackContext}"() {
        testRunner.assert(
            /Error al aplicar backup local[\s\S]{0,40}translateError\s*\(\s*error\s*,\s*\{\s*fallbackContext\s*:/.test(APP_SRC),
            "debe pasar por translateError(error, {fallbackContext: '...'}) al fallar la aplicación del backup local"
        );
    },

    "el catch de lectura de backup (import de archivo) usa translateError con {fallbackContext}"() {
        testRunner.assert(
            /Error al leer el backup[\s\S]{0,40}translateError\s*\(\s*err\s*,\s*\{\s*fallbackContext\s*:/.test(APP_SRC),
            "debe pasar por translateError(err, {fallbackContext: '...'}) al fallar la lectura del archivo de backup"
        );
    },

    "ninguno de los 5 sitios pasa un string plano como 2do argumento (el bug real encontrado)"() {
        // Si algún call-site pasara translateError(x, 'texto') en vez de
        // translateError(x, {fallbackContext: 'texto'}), este patrón lo agarra:
        // una coma seguida de una comilla (string) en vez de una llave ({).
        testRunner.assert(
            !/translateError\s*\(\s*\w+\s*,\s*['"]/.test(APP_SRC),
            "ningún call-site de translateError debe pasar un string plano como 2do argumento — debe ser {fallbackContext: '...'}"
        );
    },

    "ninguno de los 5 sitios corregidos concatena ya .message crudo (regresión)"() {
        // Los 5 mensajes que motivaron este fix — ninguno debe volver a tener
        // `+ x.message` o `${x.message}` pegado directo al string del usuario.
        const RAW_PATTERNS = [
            /Fallo de arranque[^`]*\$\{error\.message\}/,
            /No se pudo cargar el snapshot:\s*'\s*\+\s*e\.message/,
            /Error al restaurar:\s*'\s*\+\s*e\.message/,
            /Error al aplicar backup local:\s*'\s*\+\s*error\.message/,
            /Error al leer el backup:\s*'\s*\+\s*err\.message/
        ];
        RAW_PATTERNS.forEach((re, i) => {
            testRunner.assert(!re.test(APP_SRC), `patrón crudo #${i + 1} no debe reaparecer en app.js`);
        });
    }

});

console.log('🧪 ErrorTranslatorWiring contract tests cargados.');
