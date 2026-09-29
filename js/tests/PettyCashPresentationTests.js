import {
    formatPettyCashDate,
    isEmptyReceiptPlaceholder,
    isReceiptJobIncomplete,
    receiptBackupState,
    summarizeReceiptBatch
} from '../modules/features/pettycash/PettyCashPresentation.js';

testRunner.addSuite('Caja chica — presentación de fechas y lotes', {

    'muestra fechas ISO como día-mes-año sin alterar el dato'() {
        testRunner.assertEquals(formatPettyCashDate('2026-07-28'), '28-07-2026');
        testRunner.assertEquals(formatPettyCashDate('2026-07-28T10:30:00Z'), '28-07-2026');
        testRunner.assertEquals(formatPettyCashDate(''), '—');
    },

    'indica si el comprobante quedó respaldado en la nube'() {
        testRunner.assertEquals(receiptBackupState({ receiptStatus: 'uploaded' }).state, 'uploaded');
        testRunner.assertEquals(receiptBackupState({ receiptStatus: 'uploaded' }).label, 'Respaldado');
        testRunner.assertEquals(receiptBackupState({ receiptStatus: 'local' }).state, 'pending');
        testRunner.assertEquals(receiptBackupState({ receiptStatus: 'local' }).label, 'Por subir');
        testRunner.assertEquals(receiptBackupState({ hasReceipt: true }), null);
        testRunner.assertEquals(receiptBackupState({}), null);
        testRunner.assertEquals(receiptBackupState(null), null);
    },

    'identifica los registros que todavía no deben mostrarse'() {
        testRunner.assertEquals(isReceiptJobIncomplete({ queueStatus: 'processing' }), true);
        testRunner.assertEquals(isReceiptJobIncomplete({ queueStatus: 'waiting-network' }), true);
        testRunner.assertEquals(isReceiptJobIncomplete({ queueStatus: 'awaiting-review' }), false);
        testRunner.assertEquals(isReceiptJobIncomplete({ queueStatus: 'confirmed' }), false);
        testRunner.assertEquals(isEmptyReceiptPlaceholder({
            type: 'gasto',
            amount: 0,
            hasReceipt: true
        }), true);
        testRunner.assertEquals(isEmptyReceiptPlaceholder({
            type: 'gasto',
            amount: 125,
            hasReceipt: true
        }), false);
    },

    'resume el avance del lote con una cuenta exacta'() {
        const summary = summarizeReceiptBatch({
            total: 4,
            queuedIds: ['a', 'b', 'c', 'd']
        }, [
            { txId: 'a', queueStatus: 'awaiting-review' },
            { txId: 'b', queueStatus: 'awaiting-review' },
            { txId: 'c', queueStatus: 'awaiting-review' },
            { txId: 'd', queueStatus: 'processing' }
        ]);

        testRunner.assertEquals(summary.label, '3/4 procesadas · 1 aún procesándose');
        testRunner.assertEquals(summary.finished, false);
    },

    'distingue una factura pausada de otra que sigue procesándose'() {
        const summary = summarizeReceiptBatch({
            total: 2,
            queuedIds: ['a', 'b']
        }, [
            { txId: 'a', queueStatus: 'awaiting-review' },
            { txId: 'b', queueStatus: 'waiting-network' }
        ]);

        testRunner.assertEquals(summary.label, '1/2 procesadas · 1 pendiente');
    }
});
