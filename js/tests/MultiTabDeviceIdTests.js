/**
 * 🧪 MultiTabDeviceIdTests (Auditoría 2026-06-09, hallazgo H3)
 *
 * getDeviceId() guardaba el id en localStorage POR ORIGEN, así que todas las
 * pestañas del mismo navegador compartían el MISMO id. El filtro de eco
 * (FirebaseService) descarta cualquier snapshot cuyo lastChangedBy/deviceId
 * sea igual al propio: pestaña B veía el cambio de pestaña A, lo clasificaba
 * como su PROPIO eco y lo ignoraba → el estado viejo de B luego ganaba el
 * watermark y pisaba el cambio de A (lost update entre pestañas).
 *
 * Fix: el id ahora es POR PESTAÑA (sessionStorage, que NO se comparte entre
 * pestañas pero sí sobrevive un F5 dentro de la misma pestaña) + un token
 * aleatorio fuerte (crypto.randomUUID cuando está disponible). Dos pestañas
 * tienen ids distintos → cada una procesa el cambio de la otra como remoto.
 *
 * Contratos / comportamiento:
 *   - getDeviceId() es estable dentro de una misma pestaña (incluso tras F5,
 *     porque sessionStorage persiste en esa pestaña).
 *   - Dos pestañas (contexto de módulo fresco + su propio sessionStorage)
 *     obtienen ids distintos.
 *   - El id conserva el slug del origen (trazabilidad en logs de Firebase).
 *   - El código usa sessionStorage (no localStorage) como almacén por pestaña.
 *   - Los filtros de eco siguen comparando contra getDeviceId().
 */

import fs from 'fs';
import path from 'path';

const CONFIG_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/config/Config.js'), 'utf8'
);
const FB_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);

testRunner.addSuite("deviceId por pestaña — sin desync multi-tab (H3)", {

    "getDeviceId() es estable en repetidas llamadas dentro de la misma pestaña"() {
        jest.isolateModules(() => {
            try { sessionStorage.clear(); } catch (_) {}
            const { getDeviceId } = require('../modules/config/Config.js');
            const a = getDeviceId();
            const b = getDeviceId();
            testRunner.assert(!!a, 'getDeviceId debe devolver un id no vacío');
            testRunner.assertEquals(a, b, 'el id debe ser estable dentro de la pestaña');
        });
    },

    "sobrevive un reload de la misma pestaña (mismo sessionStorage → mismo id)"() {
        let first;
        jest.isolateModules(() => {
            try { sessionStorage.clear(); } catch (_) {}
            const { getDeviceId } = require('../modules/config/Config.js');
            first = getDeviceId();
        });
        // "Reload": contexto de módulo nuevo PERO el mismo sessionStorage de la
        // pestaña (no lo limpiamos) → debe recuperar el mismo id.
        let second;
        jest.isolateModules(() => {
            const { getDeviceId } = require('../modules/config/Config.js');
            second = getDeviceId();
        });
        testRunner.assertEquals(second, first, 'el id debe persistir al recargar la misma pestaña');
    },

    "dos pestañas (sessionStorage propio) obtienen ids distintos"() {
        let idTabA, idTabB;
        jest.isolateModules(() => {
            try { sessionStorage.clear(); } catch (_) {}
            const { getDeviceId } = require('../modules/config/Config.js');
            idTabA = getDeviceId();
        });
        jest.isolateModules(() => {
            // Cada pestaña tiene su propio sessionStorage; lo simulamos limpiando.
            try { sessionStorage.clear(); } catch (_) {}
            const { getDeviceId } = require('../modules/config/Config.js');
            idTabB = getDeviceId();
        });
        testRunner.assert(idTabA !== idTabB,
            'dos pestañas deben tener deviceId distinto — si fueran iguales, el filtro de eco descartaría los cambios de la otra pestaña');
    },

    "el id conserva el slug del origen (trazabilidad)"() {
        jest.isolateModules(() => {
            try { sessionStorage.clear(); } catch (_) {}
            const { getDeviceId } = require('../modules/config/Config.js');
            const id = getDeviceId();
            const host = window.location.host || '';
            const slug = host.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20);
            // En jsdom el host suele ser "localhost"; el slug puede ser vacío en
            // entornos raros, así que sólo exigimos el prefijo cuando hay slug.
            if (slug) {
                testRunner.assert(id.indexOf(slug) === 0,
                    `el id "${id}" debe comenzar con el slug del origen "${slug}"`);
            }
        });
    },

    "fuente: getDeviceId usa sessionStorage como almacén por pestaña"() {
        const block = CONFIG_SRC.match(/getDeviceId\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,1200}?\n\};/);
        testRunner.assert(!!block, 'getDeviceId debe existir');
        testRunner.assert(/sessionStorage/.test(block[0]),
            'getDeviceId debe usar sessionStorage (id por pestaña), no sólo localStorage');
    },

    "fuente: usa crypto.randomUUID cuando está disponible (resistencia a colisión)"() {
        testRunner.assert(/randomUUID/.test(CONFIG_SRC),
            'el id debe preferir crypto.randomUUID() sobre Math.random()');
    },

    "fuente: los filtros de eco siguen comparando contra getDeviceId()"() {
        const echoes = FB_SRC.match(/===\s*getDeviceId\(\)/g) || [];
        testRunner.assert(echoes.length >= 2,
            'los filtros de eco (mirror + asistencia) deben seguir comparando lastChangedBy/deviceId con getDeviceId()');
    }

});
