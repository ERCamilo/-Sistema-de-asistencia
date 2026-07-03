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
    },

    "deleteCloudData acepta options.collections para borrado ACOTADO (Fase 0.5, U5)"() {
        // 'Subir y Reemplazar' borra SÓLO el dataset principal — caja chica
        // tiene su propio sync y ese flujo no la re-sube; borrarla sin
        // reemplazo sería pérdida de datos. Sin argumento, el comportamiento
        // por defecto (borrar TODO, para 'Borrar Nube') no cambia.
        const block = FIREBASE_SRC.match(/async\s+deleteCloudData\s*\([\s\S]*?\n\s{4}\}/);
        testRunner.assert(!!block, 'deleteCloudData debe existir');
        testRunner.assert(
            /options\.collections|collections\s*\}/.test(block[0]),
            'deleteCloudData debe aceptar una lista opcional de colecciones a borrar'
        );
        testRunner.assert(
            /ALL_CLOUD_COLLECTIONS|DEFAULT_COLLECTIONS|SUBCOLLECTIONS/.test(block[0]),
            'sin el parámetro, debe caer al listado completo (comportamiento previo intacto)'
        );
    }

});

// FirebaseService.js está mockeado GLOBALMENTE por jest.config.js
// (moduleNameMapper '(^|/)FirebaseService\.js$' → __mocks__/FirebaseService.js),
// así que su lógica interna real no es testeable conductualmente en este
// harness — por eso este contrato es sobre el TEXTO FUENTE, mismo patrón
// que el resto de este archivo (deleteCloudData arriba). La lógica de merge
// en sí (mergeAttendanceRecords) SÍ está testeada conductualmente y a fondo
// en AttendanceMergeTests.js (Fase 1, U3).
function saveDailyAttendanceBlock() {
    return FIREBASE_SRC.match(/async\s+saveDailyAttendance\s*\([\s\S]*?\n\s{4}\}/);
}

testRunner.addSuite("FirebaseService — Contrato saveDailyAttendance read-merge-write (Fase 1, U4)", {

    "saveDailyAttendance lee el doc remoto (getDoc) antes de escribir"() {
        const b = saveDailyAttendanceBlock();
        testRunner.assert(!!b, 'saveDailyAttendance debe existir');
        testRunner.assert(/getDoc\s*\(/.test(b[0]), 'debe leer el doc remoto antes de mergear');
    },

    "saveDailyAttendance resuelve con mergeAttendanceRecords (LWW por-registro, U3)"() {
        const b = saveDailyAttendanceBlock();
        testRunner.assert(/mergeAttendanceRecords\s*\(/.test(b[0]),
            'debe rutear por mergeAttendanceRecords en vez de un setDoc directo — evita el franken-merge de Firestore');
    },

    "el getDoc va ANTES del mergeAttendanceRecords, y éste ANTES del setDoc final"() {
        const b = saveDailyAttendanceBlock()[0];
        const getDocIdx = b.search(/getDoc\s*\(/);
        const mergeIdx = b.search(/mergeAttendanceRecords\s*\(/);
        const setDocIdx = b.lastIndexOf('setDoc(');
        testRunner.assert(getDocIdx !== -1 && mergeIdx !== -1 && setDocIdx !== -1,
            'deben existir las 3 llamadas');
        testRunner.assert(getDocIdx < mergeIdx && mergeIdx < setDocIdx,
            'orden incorrecto: debe ser getDoc → mergeAttendanceRecords → setDoc');
    },

    "el read remoto tiene su propio catch, y NO re-lanza (si falla, igual escribe sin merge)"() {
        const b = saveDailyAttendanceBlock()[0];
        const getDocIdx = b.search(/getDoc\s*\(/);
        const setDocIdx = b.lastIndexOf('setDoc(');
        const between = b.slice(getDocIdx, setDocIdx);
        testRunner.assert(/catch\s*\(/.test(between),
            'debe haber un catch entre el getDoc y el setDoc final (fallback al fast-path)');
        testRunner.assert(!/catch\s*\([^)]*\)\s*\{[^}]*throw/.test(between),
            'el catch del read remoto NO debe re-lanzar — perdería el save del usuario si el read falla');
    },

    "sigue escribiendo el documento con { merge: true } (protege campos de nivel-doc desconocidos)"() {
        const b = saveDailyAttendanceBlock()[0];
        testRunner.assert(/\{\s*merge:\s*true\s*\}/.test(b), 'debe conservar merge:true a nivel de documento');
    },

    "el mock de tests expone saveDailyAttendance (paridad de API)"() {
        const mockSrc = fs.readFileSync(
            path.resolve(__dirname, '../../__mocks__/FirebaseService.js'), 'utf8'
        );
        testRunner.assert(/saveDailyAttendance/.test(mockSrc),
            '__mocks__/FirebaseService.js debe incluir saveDailyAttendance para tests de app.js/PersistenceService');
    }

});
