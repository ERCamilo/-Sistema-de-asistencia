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

testRunner.addSuite("IndexedDB — schema v15: stores de sync, Mini e historial de Nómina", {

    "la versión de la DB subió a 15"() {
        testRunner.assert(/version\s*=\s*15/.test(IDB_SRC),
            'IndexedDBService debe abrir la DB en versión 15 para crear el historial de Nómina');
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

    "pettyCashMirrorOutbox compacta por id y tiene índice 'status'"() {
        const block = IDB_SRC.match(/pettyCashMirrorOutbox['"][\s\S]{0,400}/);
        testRunner.assert(!!block, 'debe existir la creación del store pettyCashMirrorOutbox');
        testRunner.assert(/keyPath\s*:\s*['"]id['"]/.test(block[0]),
            "pettyCashMirrorOutbox debe compactar la última operación usando keyPath:'id'");
        testRunner.assert(/createIndex\(\s*['"]status['"]/.test(block[0]),
            "pettyCashMirrorOutbox debe indexar 'status'");
    },

    "mainSyncOutbox NO está en la lista ownStores de clearFirst (no debe borrarse en un restore)"() {
        const block = IDB_SRC.match(/const ownStores\s*=\s*\[[^\]]*\]/);
        testRunner.assert(!!block, 'debe existir la lista ownStores');
        testRunner.assert(!/mainSyncOutbox/.test(block[0]),
            'mainSyncOutbox NO debe estar en ownStores — un restore/demo/cuenta-nueva no debe borrar escrituras cloud pendientes (mismo criterio que pettyCashOutbox)');
    }

    ,"los stores de alias y auditoría están aislados e indexados"() {
        const aliasBlock = IDB_SRC.match(/miniAttendanceAliases['"][\s\S]{0,500}/)?.[0] || '';
        const auditBlock = IDB_SRC.match(/miniAttendanceAliasAudit['"][\s\S]{0,500}/)?.[0] || '';
        testRunner.assert(/keyPath\s*:\s*['"]aliasId['"]/.test(aliasBlock),
            'aliases debe usar aliasId');
        ['scopeKey', 'targetEmployeeId', 'active'].forEach(index =>
            testRunner.assert(aliasBlock.includes(`createIndex('${index}'`), `falta índice ${index}`));
        testRunner.assert(/keyPath\s*:\s*['"]auditId['"]/.test(auditBlock),
            'audit debe usar auditId');
        ['aliasId', 'scopeKey', 'eventType'].forEach(index =>
            testRunner.assert(auditBlock.includes(`createIndex('${index}'`), `falta índice ${index}`));
    }

    ,"el inbox Mini usa eventId y los índices de revisión local"() {
        const block = IDB_SRC.match(/miniAttendanceInbox['"][\s\S]{0,500}/)?.[0] || '';
        testRunner.assert(/keyPath\s*:\s*['"]eventId['"]/.test(block), 'inbox debe usar eventId');
        ['status', 'scopeKey', 'receivedAt'].forEach(index =>
            testRunner.assert(block.includes(`createIndex('${index}'`), `falta índice ${index}`));
    }

});
