/**
 * 🧪 IndexedDBSaveStateKeyTests (Auditoría 2026-06-09, hallazgos H1, H2, L1)
 *
 * H1: saveState deduplicaba empleados/líderes SOLO por `number` y descartaba
 *     en silencio cualquier registro sin número (`if (!num) return;`) —
 *     pérdida de datos local silenciosa.
 *     Fix: clave de dedup `number || id` vía RecordKey.dedupKeyForRecord
 *     (módulo puro, testeable de verdad).
 *
 * H2: clearAll() usaba una lista hardcodeada de 6 stores y dejaba intactos
 *     los 5 stores de caja chica (datos financieros + fotos de comprobantes)
 *     al "Borrar Información Local".
 *     Fix: iterar db.objectStoreNames.
 *
 * L1: la clase tenía DOS definiciones de clear() (la primera era código muerto).
 */

import fs from 'fs';
import path from 'path';
import { dedupKeyForRecord } from '../modules/services/RecordKey.js';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/IndexedDBService.js'), 'utf8'
);

testRunner.addSuite("RecordKey — dedupKeyForRecord (behavioral, H1)", {

    "con number → clave por número"() {
        testRunner.assertEquals(dedupKeyForRecord({ number: '42', id: 'e1' }), 'num:42');
    },

    "number con espacios se recorta"() {
        testRunner.assertEquals(dedupKeyForRecord({ number: '  7 ', id: 'e1' }), 'num:7');
    },

    "SIN number pero con id → clave por id (antes se descartaba el registro)"() {
        testRunner.assertEquals(dedupKeyForRecord({ number: '', id: 'emp-uuid-9' }), 'id:emp-uuid-9');
        testRunner.assertEquals(dedupKeyForRecord({ id: 'emp-uuid-9' }), 'id:emp-uuid-9');
    },

    "number numérico (no string) también funciona"() {
        testRunner.assertEquals(dedupKeyForRecord({ number: 15, id: 'x' }), 'num:15');
    },

    "sin number NI id → null (único caso descartable)"() {
        testRunner.assertEquals(dedupKeyForRecord({}), null);
        testRunner.assertEquals(dedupKeyForRecord(null), null);
        testRunner.assertEquals(dedupKeyForRecord({ number: '', id: '' }), null);
    },

    "dos empleados sin número con ids distintos NO colisionan"() {
        const a = dedupKeyForRecord({ id: 'a' });
        const b = dedupKeyForRecord({ id: 'b' });
        testRunner.assert(a !== b, 'ids distintos → claves distintas');
    },

    "flag OFF conserva exactamente las claves legacy aunque exista projectId"() {
        const scope = { enabled: false, projectId: 'PRJ-B', defaultProjectId: 'PRJ-D' };
        testRunner.assertEquals(dedupKeyForRecord({ number: '42', projectId: 'PRJ-A' }, scope), 'num:42');
        testRunner.assertEquals(dedupKeyForRecord({ id: 'emp-9', projectId: 'PRJ-A' }, scope), 'id:emp-9');
    },

    "flag ON incluye proyecto efectivo en claves por number e id"() {
        const scope = { enabled: true, projectId: 'PRJ-B', defaultProjectId: 'PRJ-D' };
        testRunner.assertEquals(
            dedupKeyForRecord({ number: '42', projectId: 'PRJ-A' }, scope),
            'project:PRJ-A:num:42'
        );
        testRunner.assertEquals(
            dedupKeyForRecord({ id: 'leader-9', projectId: 'PRJ-B' }, scope),
            'project:PRJ-B:id:leader-9'
        );
        testRunner.assert(
            dedupKeyForRecord({ id: 'leader-9', projectId: 'PRJ-A' }, scope)
                !== dedupKeyForRecord({ id: 'leader-9', projectId: 'PRJ-B' }, scope),
            'el fallback id también debe quedar aislado por proyecto'
        );
    },

    "flag ON resuelve registros legacy sin projectId al default, nunca al activo"() {
        const scope = { enabled: true, projectId: 'PRJ-B', defaultProjectId: 'PRJ-D' };
        testRunner.assertEquals(
            dedupKeyForRecord({ number: '42' }, scope),
            'project:PRJ-D:num:42'
        );
    },

    "flag ON sin default conserva la precedencia del projectId explícito"() {
        const scope = { enabled: true, projectId: null, defaultProjectId: null };
        testRunner.assertEquals(
            dedupKeyForRecord({ number: '12', projectId: 'PRJ-A' }, scope),
            'project:PRJ-A:num:12'
        );
        testRunner.assertEquals(
            dedupKeyForRecord({ number: '12' }, scope),
            'legacy-unresolved:num:12'
        );
    }

});

testRunner.addSuite("IndexedDBService — contratos de saveState/clearAll (H1, H2, L1)", {

    "saveState deduplica con dedupKeyForRecord (no descarta registros sin number)"() {
        testRunner.assert(
            /dedupKeyForRecord/.test(SRC),
            'IndexedDBService debe importar y usar dedupKeyForRecord de RecordKey.js'
        );
        // El patrón viejo de descarte silencioso no debe existir en el bloque de dedup:
        const dedupBlock = SRC.match(/DEDUPLICACIÓN INTERNA[\s\S]{0,1500}/);
        if (dedupBlock) {
            testRunner.assert(
                !/if\s*\(!num\)\s*return;/.test(dedupBlock[0]),
                'el descarte silencioso `if (!num) return;` debe eliminarse del bloque de dedup'
            );
        }
    },

    "clearAll limpia TODOS los stores (objectStoreNames, no lista hardcodeada)"() {
        const block = SRC.match(/async\s+clearAll\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!block, 'clearAll debe existir');
        testRunner.assert(
            /objectStoreNames/.test(block[0]),
            'clearAll debe iterar db.objectStoreNames — la lista hardcodeada dejaba caja chica y comprobantes sin borrar'
        );
        testRunner.assert(
            !/\[\s*'employees'\s*,/.test(block[0]),
            'clearAll no debe usar la lista hardcodeada de stores'
        );
    },

    "clear() está definido UNA sola vez (L1: la copia duplicada era código muerto)"() {
        const matches = SRC.match(/^\s{4}async\s+clear\s*\(/gm) || [];
        testRunner.assertEquals(
            matches.length, 1,
            'IndexedDBService debe tener exactamente una definición de clear()'
        );
    }

});
