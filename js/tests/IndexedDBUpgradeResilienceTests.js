/**
 * 🧪 IndexedDBUpgradeResilienceTests (R-gaps: cuelgue de upgrade)
 *
 * init() abre la DB con una versión fija. Cuando se sube la versión (p.ej. para
 * agregar un store), el upgrade queda BLOQUEADO mientras otra pestaña mantenga
 * abierta una conexión a la versión vieja. Antes init() sólo hacía console.warn
 * en onblocked y nunca cableaba onversionchange, así que:
 *   - la pestaña vieja NO cedía su conexión → el upgrade colgaba indefinidamente;
 *   - la promesa de init() de la pestaña nueva no resolvía ni rechazaba;
 *   - como el boot espera loadApplicationData (que usa init()), la app se colgaba
 *     hasta que el loaderTimeout la fuerza a renderizar vacío/desactualizado.
 *
 * Fix: onversionchange cierra esta conexión para ceder el paso al upgrade de la
 * otra pestaña, y onblocked avisa al usuario (no sólo a la consola).
 */

import fs from 'fs';
import path from 'path';

const IDB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'), 'utf8'
);

testRunner.addSuite("IndexedDB — resiliencia de upgrade (onversionchange / onblocked)", {

    "init cablea onversionchange"() {
        testRunner.assert(/onversionchange\s*=/.test(IDB_SRC),
            'init debe cablear db.onversionchange para ceder la conexión ante un upgrade de otra pestaña');
    },

    "onversionchange cierra la conexión (cede el paso al upgrade de otra pestaña)"() {
        const block = IDB_SRC.match(/onversionchange\s*=\s*\([\s\S]{0,300}/);
        testRunner.assert(!!block, 'debe existir el handler onversionchange');
        testRunner.assert(/\.close\s*\(/.test(block[0]),
            'onversionchange debe cerrar la conexión (db.close) para no colgar el upgrade');
    },

    "onblocked avisa al usuario (no sólo console.warn)"() {
        const block = IDB_SRC.match(/onblocked\s*=\s*\([\s\S]{0,400}/);
        testRunner.assert(!!block, 'debe existir el handler onblocked');
        testRunner.assert(/Notification/.test(block[0]),
            'onblocked debe avisar al usuario con Notification, no sólo console.warn');
    }

});

testRunner.addSuite("IndexedDB — schema v11: store mainSyncOutbox (bandeja de pendientes cloud)", {

    "la versión de la DB subió a 11"() {
        testRunner.assert(/version\s*=\s*11/.test(IDB_SRC),
            'IndexedDBService debe abrir la DB en versión 11 (subida desde 10 para el nuevo store)');
    },

    "existe el store mainSyncOutbox con keyPath 'key' autoIncrement (NO reutiliza sync_queue)"() {
        const block = IDB_SRC.match(/mainSyncOutbox['"][\s\S]{0,250}/);
        testRunner.assert(!!block, 'debe existir la creación del store mainSyncOutbox');
        testRunner.assert(/keyPath\s*:\s*['"]key['"]/.test(block[0]),
            "mainSyncOutbox debe usar keyPath:'key' (autoIncrement), como pettyCashOutbox — NO 'id' como sync_queue");
        testRunner.assert(/autoIncrement\s*:\s*true/.test(block[0]),
            'mainSyncOutbox debe ser autoIncrement');
    },

    "mainSyncOutbox tiene índice 'status'"() {
        const block = IDB_SRC.match(/mainSyncOutbox['"][\s\S]{0,400}/);
        testRunner.assert(/createIndex\(\s*['"]status['"]/.test(block[0]),
            "mainSyncOutbox debe indexar 'status' para separar pending/dead");
    },

    "mainSyncOutbox NO está en la lista ownStores de clearFirst (no debe borrarse en un restore)"() {
        const block = IDB_SRC.match(/const ownStores\s*=\s*\[[^\]]*\]/);
        testRunner.assert(!!block, 'debe existir la lista ownStores');
        testRunner.assert(!/mainSyncOutbox/.test(block[0]),
            'mainSyncOutbox NO debe estar en ownStores — un restore/demo/cuenta-nueva no debe borrar escrituras cloud pendientes (mismo criterio que pettyCashOutbox)');
    }

});
