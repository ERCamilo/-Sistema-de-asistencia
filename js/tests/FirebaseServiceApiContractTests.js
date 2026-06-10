/**
 * 🧪 FirebaseServiceApiContractTests (Auditoría 2026-06-09, hallazgo C1)
 *
 * Contract tests (source-level) que garantizan que la API pública de
 * FirebaseService usada por el resto del código EXISTE de verdad.
 *
 * Motivación: app.js llamaba a FirebaseService.deleteCloudData() en tres
 * lugares (BORRAR NUBE del sync center, deleteCloudDataNow y el flujo de
 * restore "Reemplazo Total de la Nube") pero el método nunca fue definido
 * en FirebaseService.js → TypeError en runtime y features rotas en silencio.
 *
 * Suite 1: smoke test genérico — todo `FirebaseService.métodoX(` referenciado
 *          en app.js debe estar definido en la clase FirebaseService.
 * Suite 2: contrato específico de deleteCloudData().
 */

import fs from 'fs';
import path from 'path';

const FIREBASE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);
const APP_SRC = fs.readFileSync(
    path.resolve(__dirname, '../app.js'), 'utf8'
);

/** Extrae los nombres de método definidos en la clase FirebaseService. */
function definedMethods(src) {
    const names = new Set();
    // `async foo(` o `foo(` al inicio de línea dentro de la clase (indentación 4).
    const re = /^\s{4}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\(/gm;
    let m;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
    return names;
}

/** Extrae los métodos invocados como FirebaseService.foo( en un source. */
function calledMethods(src) {
    const names = new Set();
    const re = /FirebaseService\.([a-zA-Z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
    return names;
}

testRunner.addSuite("FirebaseService — API smoke test (todo método llamado existe)", {

    "todos los métodos FirebaseService.X() usados en app.js están definidos"() {
        const defined = definedMethods(FIREBASE_SRC);
        const called = calledMethods(APP_SRC);
        const missing = [...called].filter(name => !defined.has(name));
        testRunner.assert(
            missing.length === 0,
            `app.js llama a métodos inexistentes de FirebaseService: ${missing.join(', ')}. ` +
            `Definirlos en FirebaseService.js o corregir el caller.`
        );
    },

    "el smoke test se auto-valida (detecta métodos conocidos)"() {
        // Sanity check del propio parser: métodos que sabemos que existen y se llaman.
        const defined = definedMethods(FIREBASE_SRC);
        testRunner.assert(defined.has('saveFullState'), 'el parser debe detectar saveFullState');
        testRunner.assert(defined.has('createSnapshot'), 'el parser debe detectar createSnapshot');
        const called = calledMethods(APP_SRC);
        testRunner.assert(called.has('getFullState'), 'el parser debe detectar llamadas a getFullState');
    }

});

testRunner.addSuite("FirebaseService — Contrato deleteCloudData (C1)", {

    "FirebaseService define un método async deleteCloudData()"() {
        testRunner.assert(
            /async\s+deleteCloudData\s*\(/.test(FIREBASE_SRC),
            'FirebaseService debe definir async deleteCloudData() — app.js:550/3049/5323 lo invocan'
        );
    },

    "deleteCloudData borra el doc espejo data/current"() {
        const block = FIREBASE_SRC.match(/async\s+deleteCloudData\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!block, 'deleteCloudData debe existir');
        testRunner.assert(
            /deleteDoc\s*\(/.test(block[0]) && /'current'/.test(block[0]),
            'deleteCloudData debe borrar el documento users/{uid}/data/current'
        );
    },

    "deleteCloudData borra las subcolecciones de entidades y caja chica"() {
        const block = FIREBASE_SRC.match(/async\s+deleteCloudData\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!block, 'deleteCloudData debe existir');
        ['employees', 'positions', 'leaders', 'attendance', 'projects', 'cashPeriods', 'pettyCash']
            .forEach(col => {
                testRunner.assert(
                    new RegExp(`['"]${col}['"]`).test(block[0]),
                    `deleteCloudData debe vaciar la subcolección ${col}`
                );
            });
    },

    "deleteCloudData NO toca los snapshots (red de seguridad)"() {
        const block = FIREBASE_SRC.match(/async\s+deleteCloudData\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!block, 'deleteCloudData debe existir');
        testRunner.assert(
            !/['"]snapshots['"]/.test(block[0]),
            'deleteCloudData debe preservar los snapshots — para borrarlos existe deleteSnapshotsByType'
        );
    },

    "deleteCloudData usa writeBatch (las subcolecciones pueden tener cientos de docs)"() {
        const block = FIREBASE_SRC.match(/async\s+deleteCloudData\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!block, 'deleteCloudData debe existir');
        testRunner.assert(
            /writeBatch\s*\(/.test(block[0]),
            'deleteCloudData debe borrar en lotes con writeBatch (límite 500 ops por batch)'
        );
    },

    "el mock de tests expone deleteCloudData (paridad de API)"() {
        const mockSrc = fs.readFileSync(
            path.resolve(__dirname, '../../__mocks__/FirebaseService.js'), 'utf8'
        );
        testRunner.assert(
            /deleteCloudData/.test(mockSrc),
            '__mocks__/FirebaseService.js debe incluir deleteCloudData para tests de app.js'
        );
    }

});
