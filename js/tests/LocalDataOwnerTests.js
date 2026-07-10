/**
 * 🧪 LocalDataOwnerTests (Auditoría 2026-06-09, hallazgo C2)
 *
 * En un navegador compartido, los datos locales (IndexedDB) no tenían dueño:
 * si el usuario B iniciaba sesión donde antes trabajó el usuario A, la
 * "migración inicial" subía la nómina de A a la cuenta de B, y B veía los
 * datos de A.
 *
 * LocalDataOwner marca los datos locales con el uid del dueño:
 *   - claimLocalOwnership(uid): registra al dueño (primer login / tras wipe).
 *   - checkLocalOwnership(uid, {localHasData}): 'match' | 'mismatch' | 'unclaimed'.
 *   - clearLocalOwnership(): al borrar los datos locales.
 *
 * Suite de wiring: app.js debe consultar la propiedad ANTES de arrancar
 * sync/migración en onAuthStateChanged.
 */

import fs from 'fs';
import path from 'path';
import {
    LOCAL_OWNER_LS_KEY,
    getLocalOwnerUid,
    claimLocalOwnership,
    clearLocalOwnership,
    checkLocalOwnership
} from '../modules/services/LocalDataOwner.js';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

testRunner.addSuite("LocalDataOwner — claim/check/clear (behavioral)", {

    "sin registro previo → unclaimed (aunque haya datos locales)"() {
        localStorage.removeItem(LOCAL_OWNER_LS_KEY);
        testRunner.assertEquals(getLocalOwnerUid(), null, 'sin dueño registrado');
        testRunner.assertEquals(
            checkLocalOwnership('uid-A', { localHasData: true }), 'unclaimed',
            'datos legacy sin marcar no deben bloquear — se reclaman en este login'
        );
    },

    "claim + mismo uid → match"() {
        localStorage.removeItem(LOCAL_OWNER_LS_KEY);
        claimLocalOwnership('uid-A');
        testRunner.assertEquals(getLocalOwnerUid(), 'uid-A');
        testRunner.assertEquals(checkLocalOwnership('uid-A', { localHasData: true }), 'match');
    },

    "claim + OTRO uid + datos locales presentes → mismatch (caso crítico)"() {
        localStorage.removeItem(LOCAL_OWNER_LS_KEY);
        claimLocalOwnership('uid-A');
        testRunner.assertEquals(
            checkLocalOwnership('uid-B', { localHasData: true }), 'mismatch',
            'el login de otra cuenta con datos locales ajenos debe detectarse'
        );
    },

    "claim + otro uid pero SIN datos locales → match tras re-claim implícito"() {
        // Si no quedan datos que proteger, no hay nada que filtrar: el nuevo
        // usuario puede reclamar el dispositivo sin fricción.
        localStorage.removeItem(LOCAL_OWNER_LS_KEY);
        claimLocalOwnership('uid-A');
        const verdict = checkLocalOwnership('uid-B', { localHasData: false });
        testRunner.assert(
            verdict === 'unclaimed' || verdict === 'match',
            `sin datos locales no debe haber mismatch (recibido: ${verdict})`
        );
    },

    "clearLocalOwnership elimina el registro"() {
        claimLocalOwnership('uid-A');
        clearLocalOwnership();
        testRunner.assertEquals(getLocalOwnerUid(), null);
    },

    "claim ignora uids vacíos"() {
        localStorage.removeItem(LOCAL_OWNER_LS_KEY);
        claimLocalOwnership('');
        claimLocalOwnership(null);
        testRunner.assertEquals(getLocalOwnerUid(), null, 'uid falsy no debe registrarse');
    },

    "tolera localStorage roto (no lanza)"() {
        const original = Storage.prototype.getItem;
        Storage.prototype.getItem = () => { throw new Error('quota'); };
        try {
            testRunner.assertEquals(getLocalOwnerUid(), null, 'fallback null');
            testRunner.assertEquals(
                checkLocalOwnership('uid-A', { localHasData: true }), 'unclaimed',
                'fallback seguro'
            );
        } finally {
            Storage.prototype.getItem = original;
        }
    }

});

testRunner.addSuite("app.js — wiring del guard de propiedad (C2)", {

    "onAuthStateChanged consulta checkLocalOwnership antes de sincronizar"() {
        testRunner.assert(
            /checkLocalOwnership\s*\(/.test(APP_SRC),
            'app.js debe llamar a checkLocalOwnership en el handler de auth'
        );
    },

    "el handler de auth reclama la propiedad (claimLocalOwnership)"() {
        testRunner.assert(
            /claimLocalOwnership\s*\(/.test(APP_SRC),
            'app.js debe reclamar la propiedad del dispositivo en el primer login'
        );
    },

    "en mismatch se bloquea el flujo ANTES de startPettyCashSync y la migración inicial"() {
        // El check debe aparecer en el código ANTES (posicionalmente) del arranque
        // de sync de caja chica dentro del mismo handler.
        const checkIdx = APP_SRC.indexOf('checkLocalOwnership');
        const pettyIdx = APP_SRC.indexOf('startPettyCashSync');
        testRunner.assert(checkIdx > -1 && pettyIdx > -1, 'ambos puntos deben existir');
        testRunner.assert(
            checkIdx < pettyIdx,
            'el guard de propiedad debe evaluarse antes de arrancar cualquier sync'
        );
    },

    "el wipe de cambio de cuenta usa wipeAllLocalTraces (JD-F6, ALTO — mutuo A+B)"() {
        // handleLocalOwnerMismatch hacía su propia limpieza manual vieja:
        // 3 claves de localStorage + IDB, SIN beginLocalDataWipe (el pagehide
        // del reload podía drenar guardados de la cuenta VIEJA hacia la cuenta
        // NUEVA recién autenticada) y SIN purgar el outbox durable (un mirror
        // pendiente de la cuenta A podía subirse al data/current de la cuenta
        // B). Debe usar el mismo wipe real que 'Borrar Local'.
        const idx = APP_SRC.indexOf('async function handleLocalOwnerMismatch');
        testRunner.assert(idx !== -1, 'debe existir handleLocalOwnerMismatch');
        const block = APP_SRC.slice(idx, idx + 3000);
        testRunner.assert(/wipeAllLocalTraces\s*\(/.test(block),
            'debe delegar en wipeAllLocalTraces (purga outbox + colas + manifiesto completo + guard anti-pagehide)');
        testRunner.assert(!/localStorage\.removeItem\('asistencia-data'\)/.test(block),
            'la limpieza manual parcial vieja (3 claves sueltas) no debe volver');
        testRunner.assert(/claimLocalOwnership\s*\(\s*user\.uid\s*\)/.test(block),
            'tras el wipe debe reclamar la propiedad para la cuenta nueva');
    },

    "el flujo de borrado local limpia la marca de dueño"() {
        // Fase 0.5: la limpieza de propiedad vive ahora en el punto ÚNICO de
        // borrado local (LocalWipeService.wipeAllLocalTraces, paso 3e), que
        // usan tanto DataService.reset como el wipe de cambio de cuenta de
        // app.js. Su comportamiento está cubierto en LocalWipeServiceTests.
        const wipeSrc = fs.readFileSync(
            path.resolve(__dirname, '../modules/services/LocalWipeService.js'), 'utf8'
        );
        testRunner.assert(
            /clearLocalOwnership/.test(wipeSrc),
            'wipeAllLocalTraces debe limpiar la marca de dueño (paso clear-ownership)'
        );
        testRunner.assert(
            /wipeAllLocalTraces\s*\(/.test(APP_SRC),
            'el flujo de cambio de cuenta de app.js debe usar ese wipe único'
        );
    }

});
