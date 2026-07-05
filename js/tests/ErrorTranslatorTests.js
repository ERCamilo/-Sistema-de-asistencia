/**
 * 🧪 ErrorTranslatorTests
 *
 * translateError(error, opts) traduce errores técnicos (Firestore, Auth,
 * IndexedDB, red) a mensajes en español entendibles para un usuario sin
 * conocimientos técnicos. No reemplaza el logging técnico (console.error
 * sigue existiendo) — sólo decide qué texto ve el usuario.
 *
 * Disparador: incidente de campo 2026-07-05 (cuota de Firestore agotada) —
 * el usuario vio "FirebaseError: [code=resource-exhausted]: Quota exceeded"
 * crudo en la consola, y varios puntos de la app concatenan error.message
 * directo en notificaciones (ej. app.js:352,1695,1758,5449,5538).
 */

import { translateError } from '../modules/services/ErrorTranslator.js';

function firestoreError(code, message = 'Firestore internal message') {
    const e = new Error(message);
    e.code = code;
    return e;
}

testRunner.addSuite("ErrorTranslator — códigos de Firestore conocidos", {

    "resource-exhausted → menciona el límite de uso y tranquiliza sobre los datos locales"() {
        const msg = translateError(firestoreError('resource-exhausted'));
        testRunner.assert(/límite/i.test(msg), 'debe mencionar el límite alcanzado');
        testRunner.assert(/a salvo/i.test(msg), 'debe tranquilizar: los datos locales están a salvo');
        testRunner.assert(!/resource-exhausted|Firestore|FirebaseError/i.test(msg),
            'NO debe filtrar el código/nombre técnico al usuario');
    },

    "unavailable → sugiere revisar la conexión, no un error genérico"() {
        const msg = translateError(firestoreError('unavailable'));
        testRunner.assert(/conexi[oó]n/i.test(msg), 'debe mencionar la conexión a internet');
    },

    "permission-denied → menciona permisos, no un stack técnico"() {
        const msg = translateError(firestoreError('permission-denied'));
        testRunner.assert(/permiso/i.test(msg));
    },

    "unauthenticated → indica que hay que reingresar sesión"() {
        const msg = translateError(firestoreError('unauthenticated'));
        testRunner.assert(/sesi[oó]n/i.test(msg));
    },

    "deadline-exceeded → menciona que tardó demasiado, no un timeout técnico"() {
        const msg = translateError(firestoreError('deadline-exceeded'));
        testRunner.assert(/tard[oó]/i.test(msg));
    },

    "código de Firestore desconocido (no mapeado) cae al mensaje genérico, no muestra el código crudo"() {
        const msg = translateError(firestoreError('some-brand-new-code-2027'));
        testRunner.assert(!/some-brand-new-code-2027/.test(msg), 'no debe filtrar un código sin mapear');
        testRunner.assert(/problema/i.test(msg), 'debe caer al mensaje genérico');
    }

});

testRunner.addSuite("ErrorTranslator — Auth", {

    "auth/network-request-failed → menciona la conexión"() {
        const e = new Error('x'); e.code = 'auth/network-request-failed';
        testRunner.assert(/conexi[oó]n/i.test(translateError(e)));
    },

    "auth/too-many-requests → pide esperar, no expone el código auth/*"() {
        const e = new Error('x'); e.code = 'auth/too-many-requests';
        const msg = translateError(e);
        testRunner.assert(!/auth\//.test(msg), 'no debe filtrar el prefijo técnico auth/');
    }

});

testRunner.addSuite("ErrorTranslator — IndexedDB / almacenamiento local", {

    "ConstraintError (por name) → menciona el almacenamiento del dispositivo"() {
        const e = new Error('x'); e.name = 'ConstraintError';
        testRunner.assert(/almacenamiento/i.test(translateError(e)));
    },

    "ConstraintError (por texto del mensaje, sin name) también se detecta"() {
        const e = new Error('ConstraintError: key already exists');
        testRunner.assert(/almacenamiento/i.test(translateError(e)));
    },

    "QuotaExceededError (almacenamiento local lleno) → mensaje distinto al de cuota de Firestore"() {
        const e = new Error('x'); e.name = 'QuotaExceededError';
        const msg = translateError(e);
        testRunner.assert(/almacenamiento|espacio/i.test(msg));
        testRunner.assert(!/servicio de nube/i.test(msg), 'no debe confundirse con la cuota de Firestore');
    }

});

testRunner.addSuite("ErrorTranslator — red / sin conexión", {

    "isOnline:false (inyectado) → mensaje de sin conexión, aunque el error no tenga code"() {
        const msg = translateError(new Error('cualquier cosa'), { isOnline: false });
        testRunner.assert(/conexi[oó]n/i.test(msg));
    },

    "mensaje con patrón de red ('Failed to fetch') → mensaje de conexión aunque isOnline sea true"() {
        const msg = translateError(new Error('Failed to fetch'), { isOnline: true });
        testRunner.assert(/conexi[oó]n/i.test(msg));
    }

});

testRunner.addSuite("ErrorTranslator — fallback genérico y defensivo", {

    "error null/undefined no rompe y devuelve el fallback genérico"() {
        testRunner.assert(typeof translateError(null) === 'string');
        testRunner.assert(typeof translateError(undefined) === 'string');
    },

    "fallbackContext se incorpora al mensaje genérico cuando no hay código reconocible"() {
        const msg = translateError(new Error('algo raro sin code'), { fallbackContext: 'cargar el backup' });
        testRunner.assert(/cargar el backup/.test(msg), 'debe mencionar la acción que falló');
    },

    "el mensaje genérico NUNCA incluye error.message crudo (evita filtrar detalles técnicos)"() {
        const msg = translateError(new Error('TypeError: Cannot read property x of undefined at foo.js:123'));
        testRunner.assert(!/Cannot read property|foo\.js/.test(msg));
    },

    "un string plano (no un objeto Error) tampoco rompe"() {
        testRunner.assert(typeof translateError('boom') === 'string');
    },

    // Hallazgo de la revisión en fresco: los 5 call-sites reales de app.js
    // llamaban translateError(error, 'texto') — un STRING plano como 2do
    // argumento, no {fallbackContext: 'texto'}. Con 'isOnline' in opts,
    // eso explota con TypeError (el operador in exige un objeto a la
    // derecha) — translateError() nunca llegaba a devolver nada, y el
    // catch que lo envuelve quedaba sin mostrar NINGÚN mensaje al usuario.
    "opts como STRING plano (uso incorrecto real de los 5 call-sites) NO debe lanzar"() {
        let msg;
        let threw = false;
        try {
            msg = translateError(new Error('boom'), 'iniciar la aplicación');
        } catch (e) {
            threw = true;
        }
        testRunner.assertEquals(threw, false, 'translateError NO debe lanzar aunque el 2do argumento sea un string en vez de {fallbackContext}');
        testRunner.assert(typeof msg === 'string' && msg.length > 0, 'debe devolver igual un mensaje utilizable');
    },

    "opts como número o array (uso incorrecto) tampoco rompe"() {
        testRunner.assert(typeof translateError(new Error('x'), 42) === 'string');
        testRunner.assert(typeof translateError(new Error('x'), []) === 'string');
    }

});

console.log('🧪 ErrorTranslator tests cargados.');
