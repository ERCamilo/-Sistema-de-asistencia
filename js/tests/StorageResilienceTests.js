/**
 * 🧪 StorageResilienceTests (Auditoría 2026-06-09, hallazgo H5)
 *
 * Dos protecciones contra la "resurrección de datos viejos":
 *
 * 1. navigator.storage.persist(): sin esto el navegador puede desalojar
 *    IndexedDB bajo presión de almacenamiento (Safari es agresivo). Si eso
 *    pasa, loadApplicationData cae al fallback de localStorage...
 *
 * 2. ...que conservaba PARA SIEMPRE la copia 'asistencia-data' de antes de
 *    la migración a IndexedDB. Esa copia congelada en el tiempo se cargaba
 *    como verdad, se re-migraba y podía subirse a la nube. Tras una
 *    migración exitosa debe eliminarse.
 */

import fs from 'fs';
import path from 'path';

const PERSISTENCE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);

testRunner.addSuite("PersistenceService — resiliencia de almacenamiento (H5)", {

    "loadApplicationData solicita almacenamiento persistente (anti-desalojo)"() {
        testRunner.assert(
            /navigator\.storage[\s\S]{0,80}persist\s*\(/.test(PERSISTENCE_SRC),
            'debe llamarse navigator.storage.persist() (best-effort) al cargar la app'
        );
    },

    "la solicitud de persistencia es defensiva (no rompe navegadores sin soporte)"() {
        const block = PERSISTENCE_SRC.match(/navigator\.storage[\s\S]{0,300}/);
        testRunner.assert(!!block, 'el bloque de persist debe existir');
        testRunner.assert(
            /\?\.|typeof|&&/.test(block[0]),
            'debe verificarse soporte (optional chaining / typeof) antes de llamar persist()'
        );
    },

    "tras migrar LocalStorage→IndexedDB se elimina la copia legacy 'asistencia-data'"() {
        // En el camino de migración (hasDataInLS + isSupported) debe limpiarse
        // la clave vieja para que un futuro desalojo de IDB no resucite datos
        // congelados de meses atrás.
        const migrationBlock = PERSISTENCE_SRC.match(/migrated-to-idb[\s\S]{0,600}/);
        testRunner.assert(!!migrationBlock, 'el flujo de migración debe existir');
        testRunner.assert(
            /storageService\.clear\s*\(|dataService\.storage\.clear\s*\(|removeItem\(\s*['"]asistencia-data['"]/.test(PERSISTENCE_SRC),
            'tras la migración exitosa debe eliminarse la copia legacy de localStorage'
        );
    }

});
