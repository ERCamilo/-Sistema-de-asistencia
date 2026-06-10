/**
 * 🧪 SnapshotRetentionTests (Auditoría 2026-06-09, hallazgo M5)
 *
 * Los snapshots automáticos se acumulaban indefinidamente en Firestore/Storage
 * (deleteSnapshotsByType existía pero era manual). Con backups grandes en
 * Storage, el costo crece sin techo.
 *
 * Fix: una política de retención pura (selectSnapshotsToPrune) decide qué
 * snapshots AUTOMÁTICOS antiguos borrar, conservando los N más recientes por
 * razón. createSnapshot la dispara (best-effort) tras crear un snapshot 'auto'.
 *
 * Reglas de seguridad de la selección:
 *   - NUNCA selecciona protegidos (isProtected) ni 'pre-restore'.
 *   - NUNCA selecciona manuales (los crea el usuario a propósito).
 *   - Conserva los N más recientes por razón (por timestamp desc).
 */

import fs from 'fs';
import path from 'path';
import { selectSnapshotsToPrune, DEFAULT_KEEP_PER_AUTO_REASON } from '../modules/services/SnapshotRetention.js';

const FB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);

const mk = (id, type, ts, extra = {}) => ({ id, type, timestamp: ts, reason: extra.reason || (type === 'auto' ? 'daily-auto' : type), isProtected: !!extra.isProtected });

testRunner.addSuite("Retención de snapshots — selección pura (M5)", {

    "conserva los N más recientes y borra el resto (autos)"() {
        const snaps = [];
        for (let i = 0; i < 20; i++) snaps.push(mk(`s${i}`, 'auto', 1000 + i));
        const del = selectSnapshotsToPrune(snaps, { defaultKeep: 14 });
        testRunner.assertEquals(del.length, 6, 'de 20 autos, conservando 14, deben borrarse 6');
        // Los borrados deben ser los más VIEJOS (ts 1000..1005 → s0..s5)
        const sorted = del.slice().sort();
        testRunner.assert(del.includes('s0') && del.includes('s5'),
            'deben borrarse los más antiguos');
        testRunner.assert(!del.includes('s19') && !del.includes('s6'),
            'no deben borrarse los 14 más recientes');
    },

    "nunca selecciona snapshots protegidos"() {
        const snaps = [];
        for (let i = 0; i < 30; i++) snaps.push(mk(`p${i}`, 'pre-restore', 1000 + i, { reason: 'pre-restore', isProtected: true }));
        const del = selectSnapshotsToPrune(snaps, { defaultKeep: 5 });
        testRunner.assertEquals(del.length, 0, 'los protegidos jamás se podan');
    },

    "nunca selecciona snapshots manuales"() {
        const snaps = [];
        for (let i = 0; i < 30; i++) snaps.push(mk(`m${i}`, 'manual', 1000 + i, { reason: 'manual' }));
        const del = selectSnapshotsToPrune(snaps, { defaultKeep: 5 });
        testRunner.assertEquals(del.length, 0, 'los manuales los crea el usuario: no se podan automáticamente');
    },

    "agrupa por razón: cada grupo conserva su propio N"() {
        const snaps = [];
        for (let i = 0; i < 10; i++) snaps.push(mk(`d${i}`, 'auto', 2000 + i, { reason: 'daily-auto' }));
        for (let i = 0; i < 10; i++) snaps.push(mk(`w${i}`, 'auto', 3000 + i, { reason: 'weekly-auto' }));
        const del = selectSnapshotsToPrune(snaps, { keep: { 'daily-auto': 3, 'weekly-auto': 8 } });
        // daily: 10-3=7 borrados; weekly: 10-8=2 borrados
        testRunner.assertEquals(del.length, 9, '7 daily + 2 weekly = 9 a borrar');
    },

    "no peta con entrada inválida"() {
        testRunner.assertEquals(selectSnapshotsToPrune(null).length, 0, 'null → []');
        testRunner.assertEquals(selectSnapshotsToPrune(undefined).length, 0, 'undefined → []');
        testRunner.assertEquals(selectSnapshotsToPrune([]).length, 0, '[] → []');
    },

    "expone un tope por defecto razonable"() {
        testRunner.assert(typeof DEFAULT_KEEP_PER_AUTO_REASON === 'number' && DEFAULT_KEEP_PER_AUTO_REASON >= 7,
            'DEFAULT_KEEP_PER_AUTO_REASON debe ser un número sensato (>=7)');
    }

});

testRunner.addSuite("Retención de snapshots — cableado en FirebaseService (M5)", {

    "existe pruneOldSnapshots y usa selectSnapshotsToPrune"() {
        testRunner.assert(/pruneOldSnapshots\s*\(/.test(FB_SRC), 'debe existir pruneOldSnapshots()');
        testRunner.assert(/selectSnapshotsToPrune/.test(FB_SRC),
            'pruneOldSnapshots debe delegar la decisión en selectSnapshotsToPrune');
    },

    "createSnapshot dispara la poda tras un snapshot automático"() {
        const block = FB_SRC.match(/async createSnapshot\s*\([\s\S]{0,4800}?\n    \}/);
        testRunner.assert(!!block, 'createSnapshot debe existir');
        testRunner.assert(/pruneOldSnapshots/.test(block[0]),
            'createSnapshot debe invocar pruneOldSnapshots en el camino de éxito');
    }

});
