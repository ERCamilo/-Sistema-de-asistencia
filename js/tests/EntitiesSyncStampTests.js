/**
 * 🧪 EntitiesSyncStampTests (Fase 2, U4)
 *
 * Marca de agua persistente de la ÚLTIMA subida de entidades confirmada
 * (canal 'entities' del outbox). Alimenta el badge "pendiente de subir" del
 * ledger de préstamos: un préstamo con updatedAt POSTERIOR a la última
 * subida confirmada tiene cambios que todavía no llegaron a la nube.
 *
 * Se estampa con el `ts` de la ENTRADA del outbox que se subió (momento del
 * enqueue = momento de la foto del snapshot), NO con Date.now() del flush:
 * todo lo actualizado después del enqueue NO estaba en esa foto y debe
 * seguir contando como pendiente.
 */

import { recordEntitiesSyncOk, getLastEntitiesSyncOk, isPendingUpload, clearEntitiesSyncStamp } from '../modules/services/EntitiesSyncStamp.js';

testRunner.addSuite("EntitiesSyncStamp — registro y lectura", {

    "sin registro previo, getLastEntitiesSyncOk devuelve 0"() {
        clearEntitiesSyncStamp();
        testRunner.assertEquals(getLastEntitiesSyncOk(), 0);
    },

    "recordEntitiesSyncOk persiste el timestamp y getLastEntitiesSyncOk lo devuelve"() {
        clearEntitiesSyncStamp();
        recordEntitiesSyncOk(12345);
        testRunner.assertEquals(getLastEntitiesSyncOk(), 12345);
    },

    "un registro más NUEVO reemplaza al anterior"() {
        clearEntitiesSyncStamp();
        recordEntitiesSyncOk(100);
        recordEntitiesSyncOk(200);
        testRunner.assertEquals(getLastEntitiesSyncOk(), 200);
    },

    "un registro más VIEJO que el actual NO retrocede la marca (flushes fuera de orden)"() {
        clearEntitiesSyncStamp();
        recordEntitiesSyncOk(200);
        recordEntitiesSyncOk(100);
        testRunner.assertEquals(getLastEntitiesSyncOk(), 200,
            'la marca solo avanza — un flush tardío de una entrada vieja no debe hacer reaparecer badges ya confirmados');
    },

    "recordEntitiesSyncOk con valor no-finito (null/NaN/undefined) es un no-op"() {
        clearEntitiesSyncStamp();
        recordEntitiesSyncOk(500);
        recordEntitiesSyncOk(null);
        recordEntitiesSyncOk(Number.NaN);
        recordEntitiesSyncOk(undefined);
        testRunner.assertEquals(getLastEntitiesSyncOk(), 500);
    }

});

testRunner.addSuite("EntitiesSyncStamp — isPendingUpload", {

    "updatedAt POSTERIOR a la última subida confirmada → pendiente"() {
        clearEntitiesSyncStamp();
        recordEntitiesSyncOk(1000);
        testRunner.assertEquals(isPendingUpload(1500), true);
    },

    "updatedAt ANTERIOR o IGUAL a la última subida → no pendiente"() {
        clearEntitiesSyncStamp();
        recordEntitiesSyncOk(1000);
        testRunner.assertEquals(isPendingUpload(1000), false);
        testRunner.assertEquals(isPendingUpload(500), false);
    },

    "sin NINGUNA subida confirmada todavía, todo updatedAt finito cuenta como pendiente"() {
        clearEntitiesSyncStamp();
        testRunner.assertEquals(isPendingUpload(1), true,
            'cuenta nueva con sesión: nada se confirmó nunca — honesto decir que está pendiente');
    },

    "updatedAt no-finito (undefined/NaN/null) nunca es pendiente (no hay evidencia de cambio)"() {
        clearEntitiesSyncStamp();
        testRunner.assertEquals(isPendingUpload(undefined), false);
        testRunner.assertEquals(isPendingUpload(Number.NaN), false);
        testRunner.assertEquals(isPendingUpload(null), false);
    }

});

testRunner.addSuite("EntitiesSyncStamp — defensivo ante localStorage roto", {

    "getItem lanzando no rompe (devuelve 0)"() {
        const original = localStorage.getItem;
        localStorage.getItem = () => { throw new Error('SecurityError'); };
        let value; let threw = false;
        try { value = getLastEntitiesSyncOk(); } catch (_) { threw = true; }
        localStorage.getItem = original;
        testRunner.assertEquals(threw, false);
        testRunner.assertEquals(value, 0);
    },

    "setItem lanzando no propaga el error"() {
        clearEntitiesSyncStamp();
        const original = localStorage.setItem;
        localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        let threw = false;
        try { recordEntitiesSyncOk(999); } catch (_) { threw = true; }
        localStorage.setItem = original;
        testRunner.assertEquals(threw, false);
    },

    "valor corrupto guardado (no numérico) se trata como 0"() {
        localStorage.setItem('attendance-entities-sync-ok', 'basura');
        testRunner.assertEquals(getLastEntitiesSyncOk(), 0);
        clearEntitiesSyncStamp();
    }

});

console.log('🧪 EntitiesSyncStamp tests cargados.');
