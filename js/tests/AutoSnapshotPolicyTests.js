/**
 * 🧪 AutoSnapshotPolicyTests (R-gaps: tormenta de reintentos de snapshot)
 *
 * El backup automático sólo estampaba lastSnapshotTimestamp en ÉXITO. Si
 * createSnapshot fallaba (cuota, doc >1MB, offline), el guard `now - lastBackup
 * > interval` seguía pasando en CADA save → cada guardado re-serializaba el
 * estado completo e intentaba el snapshot otra vez: una tormenta de reintentos
 * costosa en el hot path.
 *
 * Fix: un cooldown de reintento entre intentos. Crucialmente, el cooldown es
 * DEVICE-LOCAL (localStorage), NO state.settings — settings se mirror-ea a la
 * nube y un timestamp de "intento fallido" suprimiría los backups de OTROS
 * dispositivos.
 */

import fs from 'fs';
import path from 'path';
import {
    shouldAttemptAutoSnapshot,
    SNAPSHOT_RETRY_COOLDOWN_MS
} from '../modules/services/AutoSnapshotPolicy.js';

const DAY = 24 * 60 * 60 * 1000;

const PS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);

testRunner.addSuite("AutoSnapshotPolicy — shouldAttemptAutoSnapshot", {

    "freq 'none' → no intenta"() {
        testRunner.assert(
            shouldAttemptAutoSnapshot({ freq: 'none', now: 1000 * DAY, lastSuccess: 0, lastAttempt: 0 }) === false,
            "con backup desactivado no debe intentar");
    },

    "freq desconocida → no intenta"() {
        testRunner.assert(
            shouldAttemptAutoSnapshot({ freq: 'yearly', now: 1000 * DAY, lastSuccess: 0, lastAttempt: 0 }) === false,
            "una frecuencia no soportada no debe intentar");
    },

    "daily, vencido por horario y sin intento reciente → intenta"() {
        const now = 1000 * DAY;
        testRunner.assert(
            shouldAttemptAutoSnapshot({ freq: 'daily', now, lastSuccess: now - 2 * DAY, lastAttempt: 0 }) === true,
            "si pasó el intervalo y no hubo intento reciente, debe intentar");
    },

    "daily, vencido pero con intento RECIENTE → NO intenta (anti-tormenta)"() {
        const now = 1000 * DAY;
        // El último ÉXITO es viejo (vencido), pero acabamos de intentar (y falló):
        // el cooldown debe bloquear el reintento inmediato.
        testRunner.assert(
            shouldAttemptAutoSnapshot({
                freq: 'daily', now,
                lastSuccess: now - 2 * DAY,
                lastAttempt: now - (SNAPSHOT_RETRY_COOLDOWN_MS - 1000)
            }) === false,
            "dentro del cooldown de reintento NO debe re-intentar (evita la tormenta)");
    },

    "daily, último backup reciente → NO intenta (no vencido)"() {
        const now = 1000 * DAY;
        testRunner.assert(
            shouldAttemptAutoSnapshot({ freq: 'daily', now, lastSuccess: now - 1000, lastAttempt: 0 }) === false,
            "si el último backup es reciente no está vencido, no intenta");
    },

    "el cooldown es positivo y razonable (≥ varios minutos)"() {
        testRunner.assert(SNAPSHOT_RETRY_COOLDOWN_MS >= 5 * 60 * 1000,
            "el cooldown debe ser de al menos varios minutos para frenar la tormenta");
    }

});

testRunner.addSuite("AutoSnapshotPolicy — cableado device-local en PersistenceService", {

    "el backup automático usa shouldAttemptAutoSnapshot"() {
        testRunner.assert(/shouldAttemptAutoSnapshot\s*\(/.test(PS_SRC),
            'el bloque de backup automático debe usar shouldAttemptAutoSnapshot');
    },

    "el cooldown de intento se guarda en localStorage (device-local), no en state.settings"() {
        // El intento debe persistirse en localStorage para NO mirror-earse a la nube.
        testRunner.assert(/_SNAPSHOT_ATTEMPT_LS_KEY/.test(PS_SRC),
            'debe existir la clave device-local del último intento de snapshot');
        const block = PS_SRC.match(/if \(shouldAttemptAutoSnapshot\([\s\S]{0,400}/);
        testRunner.assert(!!block, 'debe existir el bloque del guard (call-site)');
        testRunner.assert(/localStorage\.setItem\(\s*_SNAPSHOT_ATTEMPT_LS_KEY/.test(block[0]),
            'el intento debe estamparse en localStorage (device-local), nunca en state.settings');
        testRunner.assert(!/settings\.lastSnapshotAttempt/.test(PS_SRC),
            'NO debe estamparse el intento en state.settings (se mirror-earía a la nube)');
    }

});
