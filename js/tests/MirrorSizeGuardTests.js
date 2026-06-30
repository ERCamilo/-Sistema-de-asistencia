/**
 * 🧪 MirrorSizeGuardTests (R4)
 *
 * El doc espejo users/{uid}/data/current tiene el límite duro de 1 MB de
 * Firestore. Para cuentas migradas (schemaVersion>=2) los empleados/posiciones/
 * líderes van a subcolecciones, así que el doc queda chico. Para cuentas LEGACY
 * (schemaVersion<2) esas entidades viven INLINE en el doc — una nómina grande
 * con préstamos anidados puede superar 1 MB y hacer que setDoc tire, perdiendo
 * el sync silenciosamente.
 *
 * checkMirrorDocSize decide si el write inline es seguro o si la cuenta legacy
 * necesita migrar a per-doc. NUNCA hay que recortar entidades en silencio.
 */

import fs from 'fs';
import path from 'path';
import { checkMirrorDocSize, MIRROR_SIZE_WARN_BYTES } from '../modules/services/MirrorSizeGuard.js';

const FB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);

function bigString(bytes) {
    return 'x'.repeat(bytes);
}

testRunner.addSuite("R4 — guard de tamaño del doc espejo (1MB)", {

    "estado chico + legacy: ok, sin migración"() {
        const r = checkMirrorDocSize({ settings: { schemaVersion: 1 }, employees: [] }, 1);
        testRunner.assert(r.ok === true, 'un estado chico legacy debe poder escribirse');
        testRunner.assert(r.needsMigration === false, 'estado chico no requiere migración');
        testRunner.assert(typeof r.bytes === 'number' && r.bytes > 0, 'debe reportar bytes');
    },

    "estado chico + migrado: ok"() {
        const r = checkMirrorDocSize({ settings: { schemaVersion: 3 } }, 3);
        testRunner.assert(r.ok === true, 'estado migrado chico siempre ok');
        testRunner.assert(r.needsMigration === false, 'migrado no requiere migración');
    },

    "estado GRANDE + legacy: NO ok, requiere migración"() {
        const huge = { settings: { schemaVersion: 1 }, blob: bigString(MIRROR_SIZE_WARN_BYTES + 10) };
        const r = checkMirrorDocSize(huge, 1);
        testRunner.assert(r.ok === false, 'estado legacy grande NO debe escribirse inline (excede el margen)');
        testRunner.assert(r.needsMigration === true, 'estado legacy grande requiere migrar a per-doc');
    },

    "estado GRANDE + migrado: ok (entidades ya viven en subcolecciones)"() {
        // En migrado, employees/positions/leaders ya se borraron del cleanState,
        // así que el riesgo de 1MB inline no aplica: needsMigration debe ser false.
        const huge = { settings: { schemaVersion: 3 }, blob: bigString(MIRROR_SIZE_WARN_BYTES + 10) };
        const r = checkMirrorDocSize(huge, 3);
        testRunner.assert(r.needsMigration === false, 'migrado no debe pedir migración aunque sea grande');
    },

    "umbral por debajo del límite duro de 1MiB de Firestore"() {
        testRunner.assert(MIRROR_SIZE_WARN_BYTES < 1048576,
            'el margen de aviso debe estar por debajo del límite duro de 1 MiB');
    }

});

testRunner.addSuite("R4 — saveFullState cablea el guard antes del setDoc", {

    "saveFullState llama a checkMirrorDocSize"() {
        const block = FB_SRC.match(/async saveFullState\s*\([\s\S]{0,6000}?\n {4}\}/);
        testRunner.assert(!!block, 'saveFullState debe existir');
        testRunner.assert(/checkMirrorDocSize\s*\(/.test(block[0]),
            'saveFullState debe consultar checkMirrorDocSize (R4)');
    },

    "el guard va ANTES del setDoc del doc espejo (gatea el write)"() {
        const block = FB_SRC.match(/async saveFullState\s*\([\s\S]{0,6000}?\n {4}\}/);
        testRunner.assert(!!block, 'saveFullState debe existir');
        const guardIdx = block[0].indexOf('checkMirrorDocSize');
        const setDocIdx = block[0].indexOf('setDoc(');
        testRunner.assert(guardIdx !== -1 && setDocIdx !== -1, 'deben existir el guard y el setDoc');
        testRunner.assert(guardIdx < setDocIdx,
            'el guard de tamaño debe evaluarse ANTES del setDoc del doc espejo');
    },

    "ante exceso, NO recorta entidades: omite el write (return) y avisa"() {
        const block = FB_SRC.match(/if \(sizeCheck\.needsMigration\)[\s\S]{0,500}/);
        testRunner.assert(!!block, 'debe existir la rama needsMigration');
        testRunner.assert(/return/.test(block[0]),
            'ante exceso debe hacer return (omitir el write inline), no recortar entidades ni tirar');
        testRunner.assert(/mirror-too-large/.test(block[0]),
            'debe emitir/avisar el evento sync:mirror-too-large para solicitar migración');
    }

});
