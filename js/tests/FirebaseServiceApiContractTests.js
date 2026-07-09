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

// Fase 2 U1: los writes per-entidad (empleados/puestos/líderes) se extraen de
// saveFullState a un método propio, saveEntities, para que MainSyncStore los
// encole APARTE del mirror y no queden atrapados detrás de su gate de
// watermark (ver MainSyncStore._resolveCloudCall, kind === 'entities').
function saveFullStateBlock() {
    return FIREBASE_SRC.match(/async\s+saveFullState\s*\([\s\S]*?\n\s{4}\}/);
}
function saveEntitiesBlock() {
    return FIREBASE_SRC.match(/async\s+saveEntities\s*\([\s\S]*?\n\s{4}\}/);
}

testRunner.addSuite("FirebaseService — Contrato saveEntities (Fase 2, U1)", {

    "FirebaseService define un método async saveEntities()"() {
        testRunner.assert(
            !!saveEntitiesBlock(),
            'FirebaseService debe definir async saveEntities(employees, positions, leaders, schemaVersion)'
        );
    },

    "saveEntities gatea empleados en schemaVersion>=2 y puestos/líderes en >=3, igual que saveFullState antes"() {
        const b = saveEntitiesBlock();
        testRunner.assert(!!b, 'saveEntities debe existir');
        testRunner.assert(/schemaVersion\s*>=\s*2/.test(b[0]),
            'debe gatear el write de empleados en schemaVersion >= 2 (mismo umbral que saveFullState tenía)');
        testRunner.assert(/schemaVersion\s*>=\s*3/.test(b[0]),
            'debe gatear el write de puestos/líderes en schemaVersion >= 3 (mismo umbral que saveFullState tenía)');
    },

    "saveEntities llama a EmployeeRepository.saveMany/PositionRepository.saveMany/LeaderRepository.saveMany"() {
        const b = saveEntitiesBlock();
        testRunner.assert(!!b, 'saveEntities debe existir');
        testRunner.assert(/EmployeeRepository\.saveMany\s*\(/.test(b[0]), 'debe escribir empleados via EmployeeRepository.saveMany');
        testRunner.assert(/PositionRepository\.saveMany\s*\(/.test(b[0]), 'debe escribir puestos via PositionRepository.saveMany');
        testRunner.assert(/LeaderRepository\.saveMany\s*\(/.test(b[0]), 'debe escribir líderes via LeaderRepository.saveMany');
    },

    "saveFullState YA NO llama a EmployeeRepository/PositionRepository/LeaderRepository.saveMany (se movió a saveEntities)"() {
        const b = saveFullStateBlock();
        testRunner.assert(!!b, 'saveFullState debe existir');
        testRunner.assert(!/EmployeeRepository\.saveMany\s*\(/.test(b[0]),
            'saveFullState ya no debe escribir empleados inline — eso ahora lo hace saveEntities via el outbox');
        testRunner.assert(!/PositionRepository\.saveMany\s*\(/.test(b[0]),
            'saveFullState ya no debe escribir puestos inline — eso ahora lo hace saveEntities via el outbox');
        testRunner.assert(!/LeaderRepository\.saveMany\s*\(/.test(b[0]),
            'saveFullState ya no debe escribir líderes inline — eso ahora lo hace saveEntities via el outbox');
    },

    "saveFullState sigue excluyendo employees/positions/leaders del doc espejo cuando la cuenta migró"() {
        const b = saveFullStateBlock();
        testRunner.assert(!!b, 'saveFullState debe existir');
        testRunner.assert(/delete\s+snapshotContext\.employees/.test(b[0]),
            'el doc espejo no debe llevar employees inline en cuentas migradas (>=v2)');
        testRunner.assert(/delete\s+snapshotContext\.positions/.test(b[0]),
            'el doc espejo no debe llevar positions inline en cuentas migradas (>=v3)');
        testRunner.assert(/delete\s+snapshotContext\.leaders/.test(b[0]),
            'el doc espejo no debe llevar leaders inline en cuentas migradas (>=v3)');
    },

    "el mock de tests expone saveEntities (paridad de API)"() {
        const mockSrc = fs.readFileSync(
            path.resolve(__dirname, '../../__mocks__/FirebaseService.js'), 'utf8'
        );
        testRunner.assert(/saveEntities/.test(mockSrc),
            '__mocks__/FirebaseService.js debe incluir saveEntities para tests de PersistenceService/MainSyncStore');
    }

});

// Fase 2 U1 — fix de regresión: al mover el write per-entidad fuera de
// saveFullState (arriba), se rompieron 5 llamadores DIRECTOS que invocan
// FirebaseService.saveFullState(state) sin pasar por el outbox/MainSyncStore
// (Reemplazo Total de la Nube, Subir y Reemplazar, Sync Now manual,
// uploadToCloud, la migración de primera vez): esos callers dependían de que
// saveFullState escribiera las entidades ella misma. saveFullState debe
// volver a llamar a this.saveEntities(...) internamente, salvo que el caller
// pida saltarlo con opts.skipEntities (sólo _mainSyncGuards().saveMirror lo
// hace, porque el outbox ya escribe las entidades aparte vía su propia
// entrada 'entities').
testRunner.addSuite("FirebaseService — saveFullState restaura el write de entidades (Fase 2 U1, fix de regresión)", {

    "saveFullState acepta un segundo parámetro opts (para poder recibir { skipEntities: true })"() {
        testRunner.assert(
            /async\s+saveFullState\s*\(\s*state\s*,\s*opts\s*=\s*\{\s*\}\s*\)/.test(FIREBASE_SRC),
            'saveFullState debe declararse como saveFullState(state, opts = {})'
        );
    },

    "saveFullState llama a this.saveEntities(...) salvo que opts.skipEntities sea true"() {
        const b = saveFullStateBlock();
        testRunner.assert(!!b, 'saveFullState debe existir');
        testRunner.assert(/this\.saveEntities\s*\(/.test(b[0]),
            'saveFullState debe volver a invocar this.saveEntities(...) — todo llamador DIRECTO (fuera del outbox) dependía de que saveFullState escribiera las entidades');
        testRunner.assert(/if\s*\(\s*!opts\.skipEntities\s*\)[\s\S]{0,120}this\.saveEntities\s*\(/.test(b[0]),
            'la llamada a this.saveEntities debe estar gateada por !opts.skipEntities, para que SOLO el thunk saveMirror del outbox pueda saltarla');
    },

    "saveFullState pasa employees/positions/leaders/schemaVersion a saveEntities"() {
        const b = saveFullStateBlock();
        testRunner.assert(!!b, 'saveFullState debe existir');
        const callMatch = b[0].match(/this\.saveEntities\s*\(([^)]*)\)/);
        testRunner.assert(!!callMatch, 'debe poder localizarse la llamada a this.saveEntities(...)');
        testRunner.assert(/state\.employees/.test(callMatch[1]), 'debe pasar state.employees');
        testRunner.assert(/state\.positions/.test(callMatch[1]), 'debe pasar state.positions');
        testRunner.assert(/state\.leaders/.test(callMatch[1]), 'debe pasar state.leaders');
        testRunner.assert(/schemaVersion/.test(callMatch[1]), 'debe pasar schemaVersion');
    }

});

// Fix crítico post-Fase-2-U1 (test de campo, 2026-07-05): saveEntities subía
// TODAS las entidades en CADA guardado (mergeRemote:true = lectura+escritura
// por entidad) sin importar si algo había cambiado. Con 28 empleados + 20
// puestos + 6 líderes, un guardado no relacionado (una nota, un día de
// asistencia) agotaba cuota de Firestore en horas. Fix: EntityUploadTracker
// filtra a solo lo que cambió desde la última subida exitosa.
testRunner.addSuite("FirebaseService — saveEntities NO re-sube entidades sin cambios (fix crítico de cuota)", {

    "FirebaseService.js importa createEntityUploadTracker de EntityUploadTracker.js"() {
        testRunner.assert(
            /import\s*\{[^}]*createEntityUploadTracker[^}]*\}\s*from\s+['"]\.\/EntityUploadTracker\.js['"]/.test(FIREBASE_SRC),
            "FirebaseService.js debe importar createEntityUploadTracker"
        );
    },

    "saveEntities filtra employees con un tracker antes de EmployeeRepository.saveMany"() {
        const b = saveEntitiesBlock();
        testRunner.assert(!!b, 'saveEntities debe existir');
        testRunner.assert(
            /filterChanged\s*\([\s\S]{0,80}\)[\s\S]{0,120}EmployeeRepository\.saveMany/.test(b[0]),
            'debe filtrar employees con el tracker (filterChanged) antes de subirlos'
        );
    },

    "saveEntities filtra positions y leaders con sus propios trackers"() {
        const b = saveEntitiesBlock();
        testRunner.assert(
            /filterChanged\s*\([\s\S]{0,80}\)[\s\S]{0,120}PositionRepository\.saveMany/.test(b[0]),
            'positions debe filtrarse antes de PositionRepository.saveMany'
        );
        testRunner.assert(
            /filterChanged\s*\([\s\S]{0,80}\)[\s\S]{0,120}LeaderRepository\.saveMany/.test(b[0]),
            'leaders debe filtrarse antes de LeaderRepository.saveMany'
        );
    },

    "saveEntities marca como subidas las entidades tras un saveMany exitoso"() {
        const b = saveEntitiesBlock();
        testRunner.assert(
            (b[0].match(/markUploaded\s*\(/g) || []).length >= 3,
            'debe llamar markUploaded tras cada saveMany exitoso (employees, positions, leaders)'
        );
    },

    "cada tipo de entidad usa un tracker INDEPENDIENTE con su propia storageKey persistente"() {
        // Cada tracker se crea con una storageKey DISTINTA: independientes (no
        // mezclan ids entre employees/positions/leaders) Y persistentes (el
        // watermark sobrevive al reload en vez de re-subir todo el roster).
        const calls = FIREBASE_SRC.match(/createEntityUploadTracker\s*\(\s*'[^']+'\s*\)/g) || [];
        testRunner.assert(calls.length >= 3,
            'deben crearse 3 trackers, cada uno con su storageKey (employees, positions, leaders)');
        const keys = calls.map(c => c.match(/'([^']+)'/)[1]);
        testRunner.assertEquals(new Set(keys).size, keys.length,
            'las storageKeys deben ser DISTINTAS entre tipos — compartir una mezclaría ids');
    }

});

testRunner.addSuite("FirebaseService — deleteCloudData invalida el watermark de subida (Ronda 2)", {

    // 🐛 Judgment Day Fase 2A Ronda 2 (CRITICAL): con el watermark ahora
    // PERSISTENTE, borrar la nube y re-subir (Borrar Nube / Subir y Reemplazar /
    // Reemplazo Total, todos vía deleteCloudData) dejaba el watermark diciendo
    // "ya subí X" contra una nube vacía → saveEntities filtraba y las entidades
    // nunca volvían a subir. deleteCloudData debe resetear los trackers de las
    // entidades que borra para que la re-subida no quede filtrada.
    "deleteCloudData resetea los trackers de subida de las entidades que borra"() {
        const idx = FIREBASE_SRC.indexOf('async deleteCloudData');
        testRunner.assert(idx !== -1, 'debe existir deleteCloudData');
        const block = FIREBASE_SRC.slice(idx, idx + 2600);
        testRunner.assert(/_employeeUploadTracker\.reset\(\)/.test(block),
            'debe resetear el tracker de empleados al borrar la nube');
        testRunner.assert(/_positionUploadTracker\.reset\(\)/.test(block),
            'debe resetear el tracker de puestos');
        testRunner.assert(/_leaderUploadTracker\.reset\(\)/.test(block),
            'debe resetear el tracker de líderes');
    },

    // 🐛 Ronda 3 (Juez A): los resets corrían upfront para TODAS las
    // colecciones antes de tocar Firestore — si el borrado abortaba en la
    // primera, los watermarks de colecciones jamás tocadas quedaban limpios
    // (re-subida completa innecesaria = cuota). El reset va POR colección,
    // justo antes de borrar ESA colección (antes y no después: si el borrado
    // falla a mitad, watermark limpio = re-subida benigna; watermark stale
    // sobre una colección parcialmente borrada = docs que nunca vuelven).
    "el reset del tracker vive DENTRO del loop por colección (no upfront para todas)"() {
        const idx = FIREBASE_SRC.indexOf('async deleteCloudData');
        const block = FIREBASE_SRC.slice(idx, idx + 2600);
        testRunner.assert(
            /for\s*\(const colName of SUBCOLLECTIONS\)[\s\S]{0,1000}\.reset\(\)/.test(block),
            'el reset debe ejecutarse dentro del loop, por la colección que se está borrando'
        );
    },

    // 🐛 Ronda 3 (Juez A): replaceCloudFull re-sube el roster entero por fuera
    // de saveEntities, sin tocar el tracker — el watermark quedaba stale y el
    // próximo saveEntities re-subía todo de nuevo (cuota). Tras el saveMany,
    // el watermark debe reflejar exactamente lo escrito.
    "replaceCloudFull deja el watermark reflejando lo re-subido (reset + markUploaded)"() {
        const idx = FIREBASE_SRC.indexOf('async replaceCloudFull');
        testRunner.assert(idx !== -1, 'debe existir replaceCloudFull');
        const block = FIREBASE_SRC.slice(idx, idx + 3200);
        testRunner.assert(/_employeeUploadTracker\.reset\(\)/.test(block),
            'debe resetear el watermark de empleados (borra sellos de ids que ya no existen)');
        testRunner.assert(/_employeeUploadTracker\.markUploaded\(/.test(block),
            'debe marcar como subidos los empleados que el saveMany escribió OK');
    },

    // 🐛 Judgment Day Fase 2A Ronda 4 (Juez A): migrateIfNeeded re-sube el
    // roster por fuera de saveEntities en la migración de esquema, sin tocar el
    // tracker → el próximo saveEntities re-subía todo una vez. Los callbacks
    // deben marcar el watermark de cada tipo.
    "migrateIfNeeded marca el watermark de cada tipo tras el saveMany de la migración"() {
        const idx = FIREBASE_SRC.indexOf('async migrateIfNeeded');
        testRunner.assert(idx !== -1, 'debe existir migrateIfNeeded');
        const block = FIREBASE_SRC.slice(idx, idx + 1400);
        testRunner.assert(/_employeeUploadTracker\.markUploaded\(/.test(block), 'empleados');
        testRunner.assert(/_positionUploadTracker\.markUploaded\(/.test(block), 'puestos');
        testRunner.assert(/_leaderUploadTracker\.markUploaded\(/.test(block), 'líderes');
    },

    // Seam público para flujos que escriben empleados por fuera de saveEntities
    // (CloudReconcile).
    "expone markEmployeesUploaded como seam público del watermark"() {
        testRunner.assert(/markEmployeesUploaded\s*\(/.test(FIREBASE_SRC),
            'FirebaseService debe exponer markEmployeesUploaded');
    }

});
