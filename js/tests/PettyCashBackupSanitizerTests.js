import { sanitizePettyCashForSnapshot, preparePettyCashBackupForRestore } from '../modules/services/SnapshotSanitizer.js';

testRunner.addSuite('Caja Chica — respaldo sin binarios', {
    'conserva referencias remotas durables y excluye blobs, previews y URLs firmadas'() {
        const backup = sanitizePettyCashForSnapshot({
            projects: [{ id: 'p1', name: 'Obra' }],
            periods: [{ id: 'per1', projectId: 'p1' }],
            movements: [{
                id: 'mov-1', txId: 'mov-1', receiptUrl: 'receipts/u1/mov-1.pdf',
                receiptStorage: 'supabase', receiptStatus: 'uploaded', receiptMimeType: 'application/pdf',
                receiptPageCount: 2, remoteUploadedAt: 10,
                originalBlob: new Blob(['binary']), previewDataUrl: 'data:image/png;base64,AA==',
                dataUrl: 'data:image/png;base64,BB==', signedUrl: 'https://signed.example/path?token=secret'
            }]
        });
        const movement = backup.movements[0];
        testRunner.assertEquals(movement.receiptUrl, 'receipts/u1/mov-1.pdf');
        testRunner.assertEquals(movement.receiptMimeType, 'application/pdf');
        testRunner.assertEquals(movement.originalBlob, undefined);
        testRunner.assertEquals(movement.previewDataUrl, undefined);
        testRunner.assertEquals(movement.dataUrl, undefined);
        testRunner.assertEquals(movement.signedUrl, undefined);
    }
});

testRunner.addSuite('Caja Chica — respaldo sin base64 crudo', {
    'elimina campos base64 explícitos sin borrar textos financieros'() {
        const clean = sanitizePettyCashForSnapshot({
            movements: [{
                id: 'm1', amount: 125000, description: 'Pago factura 12345',
                fileBase64: 'JVBERi0xLjQKJcTl8uXr', imageBase64: 'iVBORw0KGgoAAAANSUhEUg', receipt_base64: 'c29tZS1yZWNlaXB0',
                receiptUrl: 'receipts/m1.pdf'
            }]
        });
        const movement = clean.movements[0];
        testRunner.assert(!('fileBase64' in movement));
        testRunner.assert(!('imageBase64' in movement));
        testRunner.assert(!('receipt_base64' in movement));
        testRunner.assertEquals(movement.description, 'Pago factura 12345');
        testRunner.assertEquals(movement.amount, 125000);
        testRunner.assertEquals(movement.receiptUrl, 'receipts/m1.pdf');
    }
});

testRunner.addSuite('Caja Chica — restauración honesta de comprobantes', {
    'marca los comprobantes sólo locales como no recuperables desde el backup'() {
        const prepared = preparePettyCashBackupForRestore({
            projects: [], periods: [], movements: [
                { id: 'local', hasReceipt: true, receiptStorage: 'local-only', receiptStatus: 'local' },
                { id: 'remote', hasReceipt: true, receiptStorage: 'supabase', receiptUrl: 'receipts/u/remote.jpg' }
            ]
        });
        testRunner.assertEquals(prepared.unrecoverableReceiptCount, 1);
        testRunner.assertEquals(prepared.pettyCash.movements[0].receiptRecovery, 'not-recoverable-from-backup');
        testRunner.assertEquals(prepared.pettyCash.movements[1].receiptRecovery, undefined);
    }
});
