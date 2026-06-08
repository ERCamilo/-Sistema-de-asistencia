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

testRunner.addSuite("IndexedDBService — store de comprobantes (v9)", {

    "la versión por defecto de la DB es 9"() {
        testRunner.assert(
            /version\s*=\s*9\b/.test(SRC),
            'El constructor debe usar version = 9 para crear el store nuevo'
        );
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
        testRunner.assert(/getReceipt\s*\(/.test(SRC), 'getReceipt');
        testRunner.assert(/deleteReceipt\s*\(/.test(SRC), 'deleteReceipt');
        testRunner.assert(/listPendingReceipts\s*\(/.test(SRC), 'listPendingReceipts');
    }

});

console.log('🧪 IndexedDBReceipts (contract) tests cargados.');
