/**
 * 🧪 FirebaseServiceMergeAndReasonTests
 *
 * Tests de contrato (source-level) sobre el FirebaseService.js activo.
 * Verifican que invariantes críticas de la sincronización no se rompan:
 *   - saveFullState() siempre pasa { merge: true } a setDoc (Fase 1.2).
 *   - saveFullState() excluye state.attendance del payload del mirror.
 *   - createSnapshot() guarda reason, reasonLabel, userNote, isProtected
 *     en metadata (Snapshot A).
 *   - El campo `reason` está incluido en el catálogo SnapshotReasons.
 *
 * Por qué tests de contrato y no behaviorales:
 *   El test infrastructure mockea FirebaseService.js entero vía
 *   moduleNameMapper. jest.requireActual crea un árbol de módulos separado
 *   que no comparte los mocks de firebase-data con el test, así que no
 *   podemos observar las llamadas reales a setDoc. Estos tests garantizan
 *   que el código no pierda las invariantes por accidente.
 */

import fs from 'fs';
import path from 'path';
import { SNAPSHOT_REASONS } from '../modules/services/SnapshotReasons.js';

// (sin import de firebase-data: usamos tests de contrato sobre el código fuente
//  porque jest.requireActual no comparte las instancias del mock con el test)

const FIREBASE_SERVICE_PATH = path.resolve(__dirname, '../modules/services/FirebaseService.js');
const fbSource = fs.readFileSync(FIREBASE_SERVICE_PATH, 'utf8');

testRunner.addSuite("FirebaseService — Contrato saveFullState (Fase 1.2)", {

    "saveFullState pasa { merge: true } a setDoc del documento 'data/current'"() {
        // Buscamos el bloque de saveFullState
        const saveFullStateMatch = fbSource.match(/async\s+saveFullState\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!saveFullStateMatch, "Debe existir el método saveFullState");

        const block = saveFullStateMatch[0];
        // Debe contener un setDoc con merge: true
        const hasMerge = /setDoc\([\s\S]*?,\s*\{\s*merge:\s*true\s*\}\s*\)/.test(block);
        testRunner.assert(
            hasMerge,
            "saveFullState debe llamar a setDoc con { merge: true } como tercer argumento — sin esto, un guardado parcial borra campos top-level que el dispositivo no conoce"
        );
    },

    "saveFullState referencia 'data/current' como path del mirror"() {
        testRunner.assert(
            fbSource.includes("'current'") || fbSource.includes('"current"'),
            "saveFullState debe escribir al documento 'data/current'"
        );
    },

    "saveFullState elimina attendance del payload del mirror"() {
        const saveFullStateMatch = fbSource.match(/async\s+saveFullState\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!saveFullStateMatch, "Debe existir saveFullState");
        const block = saveFullStateMatch[0];
        testRunner.assert(
            /delete\s+snapshotContext\.attendance/.test(block),
            "saveFullState debe eliminar attendance del payload (se sube vía colección granular)"
        );
    }

});

testRunner.addSuite("FirebaseService — Contrato createSnapshot con reason (Snapshot A)", {

    "createSnapshot acepta un parámetro reason/reasonOrOpts"() {
        const sig = fbSource.match(/async\s+createSnapshot\s*\([^)]*\)/);
        testRunner.assert(!!sig, "Debe existir createSnapshot");
        testRunner.assert(
            sig[0].includes('reason') || sig[0].includes('reasonOrOpts'),
            "La firma de createSnapshot debe aceptar reason/reasonOrOpts"
        );
    },

    "createSnapshot escribe reason en metadata"() {
        // Buscamos el bloque createSnapshot hasta la siguiente declaración (async/method)
const csMatch = fbSource.match(/async\s+createSnapshot[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!csMatch, "Debe existir createSnapshot");
        const block = csMatch[0];
        testRunner.assert(/metadata:\s*\{[\s\S]*?reason\s*:/.test(block),
            "metadata del snapshot debe incluir reason");
    },

    "createSnapshot escribe reasonLabel en metadata"() {
        // Buscamos el bloque createSnapshot hasta la siguiente declaración (async/method)
const csMatch = fbSource.match(/async\s+createSnapshot[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const block = csMatch[0];
        // Acepta tanto `reasonLabel:` como shorthand `reasonLabel,`/`reasonLabel\n`
        testRunner.assert(/metadata:\s*\{[\s\S]*?\breasonLabel\b[\s\S]*?\}/.test(block),
            "metadata del snapshot debe incluir reasonLabel");
    },

    "createSnapshot escribe userNote en metadata"() {
        // Buscamos el bloque createSnapshot hasta la siguiente declaración (async/method)
const csMatch = fbSource.match(/async\s+createSnapshot[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const block = csMatch[0];
        // Acepta shorthand también
        testRunner.assert(/metadata:\s*\{[\s\S]*?\buserNote\b[\s\S]*?\}/.test(block),
            "metadata del snapshot debe incluir userNote (para notas libres del usuario)");
    },

    "createSnapshot propaga el flag protected del catálogo a isProtected"() {
        // Buscamos el bloque createSnapshot hasta la siguiente declaración (async/method)
const csMatch = fbSource.match(/async\s+createSnapshot[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const block = csMatch[0];
        // Debe leer reasonInfo?.protected y mezclarlo con la lógica de isProtected
        testRunner.assert(
            /reasonInfo\?\.protected/.test(block) || /reasonInfo\.protected/.test(block),
            "createSnapshot debe consultar reasonInfo.protected para marcar isProtected"
        );
    },

    "createSnapshot importa SnapshotReasons"() {
        testRunner.assert(
            /from\s+['"]\.\/SnapshotReasons\.js['"]/.test(fbSource),
            "FirebaseService debe importar del catálogo SnapshotReasons"
        );
    }

});

testRunner.addSuite("FirebaseService — Integración con SnapshotNotifier (H)", {

    "createSnapshot llama a notifySnapshotCreated tras éxito"() {
        const csMatch = fbSource.match(/async\s+createSnapshot[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!csMatch, "Debe existir createSnapshot");
        const block = csMatch[0];
        testRunner.assert(
            /notifySnapshotCreated\s*\(/.test(block),
            "createSnapshot debe llamar a notifySnapshotCreated tras crear el snapshot"
        );
    },

    "FirebaseService importa SnapshotNotifier"() {
        testRunner.assert(
            /from\s+['"]\.\/SnapshotNotifier\.js['"]/.test(fbSource),
            "FirebaseService debe importar de SnapshotNotifier"
        );
    },

    "la llamada a notifySnapshotCreated está DESPUÉS del setDoc del snapshot"() {
        const csMatch = fbSource.match(/async\s+createSnapshot[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const block = csMatch[0];
        const setDocIdx = block.indexOf('setDoc(');
        const notifyIdx = block.indexOf('notifySnapshotCreated');
        testRunner.assert(setDocIdx >= 0 && notifyIdx >= 0, "Ambas llamadas deben existir");
        testRunner.assert(
            notifyIdx > setDocIdx,
            "notifySnapshotCreated debe invocarse DESPUÉS del setDoc para no notificar fallos como éxitos"
        );
    }

});

testRunner.addSuite("FirebaseService — Integración con catálogo SnapshotReasons", {

    "todas las razones usadas en código tienen entrada en el catálogo"() {
        // Buscamos llamadas literales 'reason-string' que aparezcan en el código de servicios.
        // Esta es una guarda débil pero útil contra typos de código de razón.
        const reasonCallsInService = [...fbSource.matchAll(/['"](pre-[a-z0-9-]+|daily-auto|manual)['"]/gi)]
            .map(m => m[1])
            .filter((v, i, arr) => arr.indexOf(v) === i);

        reasonCallsInService.forEach(code => {
            // Solo validamos códigos que parecen razones (con prefijo pre-/daily-/etc.)
            if (code === 'manual' || code === 'daily-auto' || code.startsWith('pre-')) {
                testRunner.assert(
                    !!SNAPSHOT_REASONS[code],
                    `El código de razón "${code}" usado en FirebaseService.js no existe en SNAPSHOT_REASONS`
                );
            }
        });
    }

});

testRunner.addSuite("FirebaseService — Contrato saveSettings LWW read-compare-write (Fase 2B, fix B1)", {

    "saveSettings importa resolveSettingsWrite de SettingsWriteGuard.js"() {
        // Fase 2B JD Ronda 2, fix F1: FirebaseService ahora delega la decisión
        // completa (LWW + override force) a resolveSettingsWrite, que a su vez
        // usa shouldWriteSettings internamente (ver SettingsWriteGuardTests.js).
        testRunner.assert(
            /from\s+['"]\.\/SettingsWriteGuard\.js['"]/.test(fbSource),
            "FirebaseService debe importar desde SettingsWriteGuard.js"
        );
        testRunner.assert(
            /import\s*\{[^}]*resolveSettingsWrite[^}]*\}\s*from\s*['"]\.\/SettingsWriteGuard\.js['"]/.test(fbSource),
            "FirebaseService debe importar resolveSettingsWrite de SettingsWriteGuard.js"
        );
    },

    "saveSettings hace un getDoc del doc remoto ANTES del setDoc final"() {
        const method = fbSource.match(/async\s+saveSettings\s*\([\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!method, "Debe existir el método saveSettings");
        const txt = method[0];
        const getDocIdx = txt.search(/await\s+getDoc\s*\(/);
        const setDocIdx = txt.search(/await\s+setDoc\s*\(\s*docRef/);
        testRunner.assert(getDocIdx >= 0, "saveSettings debe leer el doc remoto vía getDoc antes de decidir");
        testRunner.assert(setDocIdx >= 0, "saveSettings debe seguir escribiendo con setDoc");
        testRunner.assert(getDocIdx < setDocIdx, "el getDoc de comparación debe ocurrir ANTES del setDoc final");
    },

    "saveSettings usa resolveSettingsWrite para decidir si omite el write (F1: incluye el override force)"() {
        const method = fbSource.match(/async\s+saveSettings\s*\([\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = method[0];
        testRunner.assert(
            /resolveSettingsWrite\s*\(/.test(txt),
            "saveSettings debe invocar resolveSettingsWrite con force, remoteExists, el ts del payload y el ts remoto"
        );
    },

    "saveSettings hace fallback al write directo si el getDoc de comparación falla (try/catch propio)"() {
        const method = fbSource.match(/async\s+saveSettings\s*\([\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = method[0];
        // Debe existir un try/catch alrededor del getDoc que NO relance (a
        // diferencia del try/catch exterior que sí relanza el error de escritura).
        testRunner.assert(
            /catch[\s\S]{0,200}(read remoto|LWW|comparar)/i.test(txt),
            "debe haber un catch dedicado al read de comparación que documente el fallback (no debe abortar el write del usuario)"
        );
    }

});

console.log('🧪 FirebaseService merge+reason contract tests cargados.');
