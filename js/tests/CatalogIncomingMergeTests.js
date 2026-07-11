/**
 * 🧪 CatalogIncomingMergeTests — puestos/líderes entrantes SIN reemplazo mayorista.
 *
 * Incidente 2026-07-11: PositionsLiveSync/LeadersLiveSync hacían
 * `state.positions = listaDeLaNube` — reemplazo TOTAL, sin merge. Una nube
 * envenenada/parcial (12 de 20 puestos) pisaba el catálogo local sano, y el
 * limpiador de integridad remataba a los empleados (mitigado por la guardia
 * anti-masacre, pero el catálogo igual se perdía localmente).
 *
 * Este merge replica el patrón de EmployeesIncomingMerge para entidades
 * escalares: LWW por registro + línea de base del último snapshot entrante
 * para distinguir "borrado remoto confirmado" de "alta local sin subir" y
 * de "carrera con una edición local no subida".
 */

import { createCatalogIncomingMerge } from '../modules/services/CatalogIncomingMerge.js';
import fs from 'fs';
import path from 'path';

const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

function freshMerge() { return createCatalogIncomingMerge(); }

testRunner.addSuite('CatalogIncomingMerge — LWW por registro con línea de base', {

    'registro en ambos lados: gana el updatedAt más nuevo (por lado)'() {
        const merge = freshMerge();
        const local = [{ id: 'p1', name: 'Local edit', updatedAt: 2000 }, { id: 'p2', name: 'Local viejo', updatedAt: 100 }];
        const incoming = [{ id: 'p1', name: 'Nube vieja', updatedAt: 1000 }, { id: 'p2', name: 'Nube nueva', updatedAt: 500 }];
        const out = merge(local, incoming);
        const byId = new Map(out.map(p => [p.id, p]));
        testRunner.assertEquals(byId.get('p1').name, 'Local edit', 'la edición local más nueva sobrevive');
        testRunner.assertEquals(byId.get('p2').name, 'Nube nueva', 'el registro remoto más nuevo gana');
    },

    'alta local nunca vista en un snapshot entrante: se CONSERVA (todavía no subió)'() {
        const merge = freshMerge();
        const out = merge(
            [{ id: 'p-nueva', name: 'Alta local', updatedAt: 100 }],
            [{ id: 'p-nube', name: 'Nube', updatedAt: 50 }]
        );
        testRunner.assertEquals(out.length, 2, 'ambas deben estar');
        testRunner.assert(out.some(p => p.id === 'p-nueva'), 'el alta local sin subir no se pierde');
    },

    'nube envenenada/parcial: el catálogo local re-estampado SOBREVIVE al snapshot pobre'() {
        // La firma exacta del incidente: local restaurado con 3 puestos
        // (updatedAt = now), la nube solo trae 1 con stamps viejos.
        const merge = freshMerge();
        const NOW = 5000;
        const local = [
            { id: 'a', name: 'A', updatedAt: NOW },
            { id: 'b', name: 'B', updatedAt: NOW },
            { id: 'c', name: 'C', updatedAt: NOW }
        ];
        const out = merge(local, [{ id: 'a', name: 'A vieja', updatedAt: 100 }]);
        testRunner.assertEquals(out.length, 3, 'ningún puesto local se pierde ante una nube parcial');
        testRunner.assertEquals(out.find(p => p.id === 'a').name, 'A', 'la copia local más nueva gana el LWW');
    },

    'borrado remoto confirmado: estaba en la línea de base y el local no editó después → se elimina'() {
        const merge = freshMerge();
        // Snapshot 1: la nube conoce p1 y p2.
        merge([], [{ id: 'p1', updatedAt: 100 }, { id: 'p2', updatedAt: 100 }]);
        // Snapshot 2: p2 desapareció de la nube (doc borrado); local sin ediciones posteriores.
        const out = merge(
            [{ id: 'p1', updatedAt: 100 }, { id: 'p2', updatedAt: 100 }],
            [{ id: 'p1', updatedAt: 100 }]
        );
        testRunner.assertEquals(out.length, 1, 'el borrado remoto debe propagarse');
        testRunner.assertEquals(out[0].id, 'p1', 'solo sobrevive el que sigue en la nube');
    },

    'carrera: edición local POSTERIOR a la última sync sobrevive al borrado remoto'() {
        const merge = freshMerge();
        merge([], [{ id: 'p1', updatedAt: 100 }]);
        const out = merge(
            [{ id: 'p1', name: 'Editado offline', updatedAt: 900 }],
            []
        );
        testRunner.assertEquals(out.length, 1, 'la edición local posterior no se descarta por un borrado dudoso');
        testRunner.assertEquals(out[0].name, 'Editado offline');
    },

    'las instancias son independientes (puestos y líderes no comparten línea de base)'() {
        const mergeA = freshMerge();
        const mergeB = freshMerge();
        mergeA([], [{ id: 'x', updatedAt: 100 }]);
        // B nunca vio 'x': para B es alta local y se conserva.
        const out = mergeB([{ id: 'x', updatedAt: 50 }], []);
        testRunner.assertEquals(out.length, 1, 'la línea de base de A no debe contaminar a B');
    }

});

testRunner.addSuite('LiveSync de catálogos — contrato: merge, no reemplazo', {

    'PositionsLiveSync.onApply fusiona con mergeIncomingPositions (no pisa el catálogo)'() {
        const idx = APP_SRC.indexOf('PositionsLiveSync.start');
        testRunner.assert(idx !== -1, 'debe existir el arranque del LiveSync de cargos');
        const body = APP_SRC.slice(idx, idx + 1400);
        testRunner.assert(body.includes('mergeIncomingPositions('),
            'los cargos entrantes deben FUSIONARSE por registro, no reemplazar la lista entera');
    },

    'LeadersLiveSync.onApply fusiona con mergeIncomingLeaders'() {
        const idx = APP_SRC.indexOf('LeadersLiveSync.start');
        testRunner.assert(idx !== -1, 'debe existir el arranque del LiveSync de líderes');
        const body = APP_SRC.slice(idx, idx + 1400);
        testRunner.assert(body.includes('mergeIncomingLeaders('),
            'los líderes entrantes deben FUSIONARSE por registro, no reemplazar la lista entera');
    }

});
