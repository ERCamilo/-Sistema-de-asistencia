/**
 * 🧪 ConflictForcePushTests (Auditoría 2026-06-09, hallazgo H4)
 *
 * El listener subscribeToChanges, cuando descartaba un snapshot de la nube por
 * "más viejo" (watermark), programaba a 1s un FirebaseService.saveFullState(state)
 * CRUDO. Ese camino salta el chequeo de conflictos salientes de _executeSave:
 * bajo desfase de reloj entre dispositivos, un cambio REAL del otro dispositivo
 * (con reloj lento → timestamp "viejo") era pisado en silencio por el force-push.
 *
 * Fix: el re-sync deja de ser un saveFullState crudo. Se encola un guardado
 * NORMAL (saveApplicationData) que pasa por _executeSave:
 *   - si el estado local es genuinamente más nuevo (p.ej. un save interrumpido
 *     por F5) → sube como siempre;
 *   - si hay conflicto saliente real → se le pregunta al usuario (sync:outgoing-
 *     conflict) en vez de sobrescribir a ciegas.
 *
 * El watermark puro (shouldAcceptRemote) NO cambia: sigue protegiendo el estado
 * local de aplicar datos más viejos. Sólo cambia QUÉ se hace tras descartar.
 */

import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

testRunner.addSuite("Conflictos — sin force-push crudo bajo desfase de reloj (H4)", {

    "el camino de descarte por watermark NO hace saveFullState crudo"() {
        // Bloque desde la condición de watermark hasta el return de descarte.
        const block = APP_SRC.match(/if\s*\(\s*!shouldAcceptRemote[\s\S]{0,1400}?return;/);
        testRunner.assert(!!block, 'debe existir el bloque de descarte por watermark');
        testRunner.assert(
            !/FirebaseService\.saveFullState\s*\(\s*state\s*\)/.test(block[0]),
            'el re-sync NO debe ser un FirebaseService.saveFullState(state) crudo (salta el chequeo de conflictos)'
        );
    },

    "el re-sync usa el camino guardado (saveApplicationData → _executeSave)"() {
        const block = APP_SRC.match(/if\s*\(\s*!shouldAcceptRemote[\s\S]{0,1400}?return;/);
        testRunner.assert(!!block, 'debe existir el bloque de descarte por watermark');
        testRunner.assert(
            /saveApplicationData\s*\(/.test(block[0]),
            're-sync debe encolarse vía saveApplicationData() para pasar por el chequeo de conflictos salientes'
        );
    },

    "saveApplicationData del re-sync NO usa force:true (debe respetar el chequeo)"() {
        const block = APP_SRC.match(/if\s*\(\s*!shouldAcceptRemote[\s\S]{0,1400}?return;/);
        testRunner.assert(!!block, 'debe existir el bloque de descarte por watermark');
        // No debe haber un saveApplicationData({ force: true }) en este re-sync:
        // force saltaría el chequeo de conflictos que justamente queremos preservar.
        testRunner.assert(
            !/saveApplicationData\s*\(\s*\{[^}]*force\s*:\s*true/.test(block[0]),
            'el re-sync NO debe forzar (force:true saltaría el chequeo de conflictos salientes)'
        );
    }

});
