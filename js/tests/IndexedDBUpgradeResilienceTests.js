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

testRunner.addSuite("IndexedDB — schema v20: sync, Mini, payroll history, projects, employee photos & payroll configs", {

    "the database version is 20"() {
        testRunner.assert(/version\s*=\s*20/.test(IDB_SRC),
            'IndexedDBService must open version 20 (employee photo cache + official projects + payroll configs)');
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

testRunner.addSuite("IndexedDB — apertura acotada del boot (timeout/blocked tipados)", {

    "init define las cotas de apertura (IDB_OPEN_TIMEOUT_MS / IDB_BLOCKED_GRACE_MS)"() {
        testRunner.assert(/IDB_OPEN_TIMEOUT_MS\s*=\s*8000/.test(IDB_SRC),
            'debe existir la cota global IDB_OPEN_TIMEOUT_MS = 8000 para el open');
        testRunner.assert(/IDB_BLOCKED_GRACE_MS\s*=\s*4000/.test(IDB_SRC),
            'debe existir la gracia corta IDB_BLOCKED_GRACE_MS = 4000 tras onblocked');
    },

    "el open tiene una cota global que rechaza con IndexedDBOpenTimeoutError"() {
        // Incidente de producción: otra ventana oculta reteniendo una conexión
        // vieja dejaba indexedDB.open pendiente PARA SIEMPRE (sin blocked ni
        // error). Sin cota, el boot queda colgado y el listener de auth nunca
        // se registra → usuario "deslogueado" y sin datos, consola limpia.
        const block = IDB_SRC.match(/openTimer\s*=\s*setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]{0,700}/);
        testRunner.assert(!!block, 'debe existir el timer de cota global openTimer');
        testRunner.assert(/IndexedDBOpenTimeoutError/.test(block[0]),
            'la cota debe rechazar con error.name = IndexedDBOpenTimeoutError');
        testRunner.assert(/IDB_OPEN_TIMEOUT_MS\)/.test(block[0]),
            'la cota debe usar la constante IDB_OPEN_TIMEOUT_MS como delay');
        testRunner.assert(/request\.cancel/.test(block[0]),
            'la cota debe intentar request.cancel de forma defensiva');
        // El timer nunca debe poder lanzar: el cancel va envuelto en try/catch.
        testRunner.assert(/try\s*\{\s*if\s*\(request\.cancel\)\s*request\.cancel\(\);\s*\}\s*catch/.test(block[0]),
            'request.cancel debe ir dentro de try/catch (nunca lanzar desde el timer)');
    },

    "onblocked ya NO deja la promesa pendiente sin límite (gracia corta + rechazo tipado)"() {
        const block = IDB_SRC.match(/onblocked\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,2400}/);
        testRunner.assert(!!block, 'debe existir el handler onblocked');
        testRunner.assert(/blockedTimer\s*=\s*setTimeout/.test(block[0]),
            'onblocked debe programar un timer de gracia corto (no dejar pending infinito)');
        testRunner.assert(/IDB_BLOCKED_GRACE_MS\)/.test(block[0]),
            'el timer de gracia debe usar la constante IDB_BLOCKED_GRACE_MS');
        testRunner.assert(/IndexedDBOpenBlockedError/.test(block[0]),
            'la gracia vencida debe rechazar con error.name = IndexedDBOpenBlockedError');
        testRunner.assert(
            /Cerr[aá] todas las ventanas|otra ventana o pestaña/i.test(block[0]),
            'el mensaje debe pedirle al usuario cerrar las otras ventanas/pestañas de la app'
        );
    },

    "los timers se limpian al asentarse (éxito/error) para no colgar timers ni doble-settear"() {
        // Éxito rápido NO debe dejar vivos openTimer/blockedTimer; y cada rama
        // guarda con settled para evitar rechazos tardíos sobre promesa resuelta.
        const successBlock = IDB_SRC.match(/onsuccess\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,200}/);
        const errorBlock = IDB_SRC.match(/onerror\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,300}/);
        testRunner.assert(!!successBlock && /clearOpenTimers\(\)/.test(successBlock[0]),
            'onsuccess debe limpiar los timers (clearOpenTimers)');
        testRunner.assert(!!errorBlock && /clearOpenTimers\(\)/.test(errorBlock[0]),
            'onerror debe limpiar los timers (clearOpenTimers)');
        const guardCount = (IDB_SRC.match(/if \(settled\) return;/g) || []).length;
        testRunner.assert(guardCount >= 3,
            `cada rama de settle debe guardar con settled (encontradas ${guardCount}, esperadas >= 3)`);
    }

});
