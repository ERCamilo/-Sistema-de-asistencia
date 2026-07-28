/**
 * 🧪 IndexedDBReceiptsTests (contract tests)
 *
 * IndexedDBService está mockeado por moduleNameMapper, así que no se puede
 * testear su comportamiento real. Verificamos el SOURCE (igual que los tests
 * de FirebaseService): que la DB suba a v9, cree el store de comprobantes de
 * caja chica de forma idempotente, y exponga los métodos de fotos.
 */

import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'),
    'utf8'
);

testRunner.addSuite("IndexedDBService — store de comprobantes (v9+)", {

    "la versión por defecto de la DB es 10 o mayor"() {
        const m = SRC.match(/version\s*=\s*(\d+)/);
        testRunner.assert(m && Number(m[1]) >= 10, 'El constructor debe usar version >= 10');
    },

    "crea el store pettyCashReceipts de forma idempotente"() {
        testRunner.assert(
            /objectStoreNames\.contains\(['"]pettyCashReceipts['"]\)/.test(SRC),
            'Debe chequear contains() antes de crear (idempotente)'
        );
        testRunner.assert(
            /createObjectStore\(['"]pettyCashReceipts['"]/.test(SRC),
            'Debe crear el store pettyCashReceipts'
        );
    },

    "el store usa txId como keyPath"() {
        testRunner.assert(
            /createObjectStore\(['"]pettyCashReceipts['"]\s*,\s*\{\s*keyPath:\s*['"]txId['"]/.test(SRC),
            'pettyCashReceipts debe tener keyPath txId'
        );
    },

    "expone los métodos de comprobantes"() {
        testRunner.assert(/saveReceipt\s*\(/.test(SRC), 'saveReceipt');
        testRunner.assert(/saveReceiptOriginal\s*\(/.test(SRC), 'saveReceiptOriginal');
        testRunner.assert(/updateReceiptJob\s*\(/.test(SRC), 'updateReceiptJob');
        testRunner.assert(/listReceiptJobs\s*\(/.test(SRC), 'listReceiptJobs');
        testRunner.assert(/getReceipt\s*\(/.test(SRC), 'getReceipt');
        testRunner.assert(/deleteReceipt\s*\(/.test(SRC), 'deleteReceipt');
        testRunner.assert(/listPendingReceipts\s*\(/.test(SRC), 'listPendingReceipts');
    },

    "los originales nuevos quedan explícitamente sólo en local"() {
        const block = SRC.match(/async saveReceiptOriginal[\s\S]{0,2200}?\n    \}/);
        testRunner.assert(!!block, 'saveReceiptOriginal debe existir');
        testRunner.assert(/originalBlob/.test(block[0]), 'debe persistir el Blob original');
        testRunner.assert(/status:\s*['"]local-only['"]/.test(block[0]), 'status debe ser local-only');
        testRunner.assert(/uploadStatus:\s*['"]deferred['"]/.test(block[0]), 'la subida debe quedar diferida');
        testRunner.assert(/previewDataUrl/.test(block[0]), 'la miniatura debe guardarse por separado');
    }

});

testRunner.addSuite("IndexedDBService — stores de caja chica + outbox (v10)", {

    "crea los 3 stores de datos + outbox de forma idempotente"() {
        ['pettyCashProjects', 'pettyCashPeriods', 'pettyCashMovements', 'pettyCashOutbox'].forEach(name => {
            testRunner.assert(
                new RegExp(`objectStoreNames\\.contains\\(['"]${name}['"]\\)`).test(SRC),
                `chequea contains() de ${name}`
            );
            testRunner.assert(
                new RegExp(`createObjectStore\\(['"]${name}['"]`).test(SRC),
                `crea ${name}`
            );
        });
    },

    "el outbox usa autoIncrement"() {
        testRunner.assert(
            /createObjectStore\(['"]pettyCashOutbox['"]\s*,\s*\{[^}]*autoIncrement:\s*true/.test(SRC),
            'pettyCashOutbox debe ser autoIncrement'
        );
    }

});

console.log('🧪 IndexedDBReceipts (contract) tests cargados.');
