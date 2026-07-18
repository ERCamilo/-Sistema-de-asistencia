/**
 * 🧪 FirebaseServiceMigrationTests (Fase 4.1 paso 3b)
 *
 * Tests de contrato sobre las APIs de migración añadidas al
 * FirebaseService activo: migrateIfNeeded() y loadEmployeesIfMigrated().
 *
 * No son tests behaviorales completos porque el moduleNameMapper hace
 * imposible observar las llamadas reales (problema documentado en
 * FirebaseServiceMergeAndReasonTests). En su lugar, leemos el source
 * y verificamos las invariantes mínimas.
 */

import fs from 'fs';
import path from 'path';

const FB_PATH = path.resolve(__dirname, '../modules/services/FirebaseService.js');
const fbSource = fs.readFileSync(FB_PATH, 'utf8');

testRunner.addSuite("FirebaseService — Contrato migrateIfNeeded (Fase 4.1)", {

    "existe el método migrateIfNeeded"() {
        testRunner.assert(
            /\b(async\s+)?migrateIfNeeded\s*\(/.test(fbSource),
            "Debe existir el método migrateIfNeeded en FirebaseService"
        );
    },

    "importa runMigrationIfNeeded del orquestador"() {
        testRunner.assert(
            /from\s+['"]\.\/SchemaMigrationRunner\.js['"]/.test(fbSource),
            "Debe importar de SchemaMigrationRunner.js"
        );
    },

    "importa EmployeeRepository"() {
        testRunner.assert(
            /from\s+['"]\.\/EmployeeRepository\.js['"]/.test(fbSource),
            "Debe importar de EmployeeRepository.js"
        );
    },

    "migrateIfNeeded usa Notification.success como notify"() {
        const block = fbSource.match(/migrateIfNeeded[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!block, "Debe poder localizarse el método");
        const txt = block[0];
        testRunner.assert(
            /Notification\.success/.test(txt) || /notify:\s*\(.*?\)\s*=>\s*Notification/.test(txt),
            "Debe pasar Notification.success (o equivalente) como notify"
        );
    },

    "migrateIfNeeded usa createSnapshot con razón pre-migration-v4 (Fase 2B U3)"() {
        const block = fbSource.match(/migrateIfNeeded[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = block[0];
        testRunner.assert(
            /pre-migration-v4/.test(txt),
            "El snapshot que crea debe llevar la razón 'pre-migration-v4' (catálogo)"
        );
    },

    "migrateIfNeeded pasa saveSettings (Fase 2B U3, reutiliza el writer de U1)"() {
        const block = fbSource.match(/migrateIfNeeded[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = block[0];
        testRunner.assert(
            /saveSettings\s*:\s*\(.*?\)\s*=>\s*this\.saveSettings\(/.test(txt),
            "Debe pasar saveSettings al runner delegando en this.saveSettings (writer existente de U1, sin infra nueva)"
        );
    },

    "migrateIfNeeded emite sync:migration-start vía notifyMigrationStart (Fase 2B U3)"() {
        const block = fbSource.match(/migrateIfNeeded[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = block[0];
        testRunner.assert(
            /notifyMigrationStart/.test(txt) && /sync:migration-start/.test(txt),
            "Debe pasar notifyMigrationStart al runner y emitir 'sync:migration-start' por eventBus"
        );
    },

    "migrateIfNeeded marca schemaVersion con merge:true"() {
        const block = fbSource.match(/migrateIfNeeded[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = block[0];
        // Buscamos un setDoc cerca del marcado de schemaVersion con merge:true
        testRunner.assert(
            /schemaVersion[\s\S]*?merge\s*:\s*true/.test(txt) ||
            /merge\s*:\s*true[\s\S]*?schemaVersion/.test(txt),
            "Debe escribir schemaVersion con { merge: true } para no destruir el resto del parent"
        );
    },

    "migrateIfNeeded incluye lastChangedBy para que el echo filter ignore la propia escritura"() {
        const block = fbSource.match(/migrateIfNeeded[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = block[0];
        testRunner.assert(
            /lastChangedBy/.test(txt) || /getDeviceId/.test(txt),
            "Al marcar schemaVersion, debe incluir lastChangedBy para que el listener no rebote esta misma escritura"
        );
    }

});

testRunner.addSuite("FirebaseService — Contrato loadEmployeesIfMigrated (Fase 4.1)", {

    "existe el método loadEmployeesIfMigrated"() {
        testRunner.assert(
            /\b(async\s+)?loadEmployeesIfMigrated\s*\(/.test(fbSource),
            "Debe existir el método loadEmployeesIfMigrated"
        );
    },

    "loadEmployeesIfMigrated consulta schemaVersion antes de elegir la fuente"() {
        const block = fbSource.match(/loadEmployeesIfMigrated[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!block, "Método debe ser localizable");
        const txt = block[0];
        testRunner.assert(
            /schemaVersion/.test(txt),
            "Debe verificar schemaVersion para decidir desde dónde leer"
        );
    },

    "loadEmployeesIfMigrated usa EmployeeRepository cuando hay migración"() {
        const block = fbSource.match(/loadEmployeesIfMigrated[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = block[0];
        testRunner.assert(
            /EmployeeRepository\.loadAll/.test(txt) || /repo\.loadAll/.test(txt),
            "Cuando schemaVersion>=2, debe leer de EmployeeRepository.loadAll"
        );
    }

});

testRunner.addSuite("FirebaseService — Contrato saveFullState con schemaVersion>=2 (Fase 4.1 paso 4)", {

    "saveFullState comprueba schemaVersion antes de escribir el mirror"() {
        const block = fbSource.match(/async\s+saveFullState[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!block, "Método localizable");
        const txt = block[0];
        testRunner.assert(
            /schemaVersion/.test(txt),
            "saveFullState debe consultar schemaVersion para decidir el camino de escritura"
        );
    },

    // Fase 2 U1: este write per-entidad se extrajo de saveFullState a
    // saveEntities() (encolado APARTE del mirror por MainSyncStore, sin su
    // gate de watermark) — ver FirebaseServiceApiContractTests.js para el
    // contrato completo de saveEntities.
    "saveEntities invoca EmployeeRepository cuando schemaVersion>=2 (movido de saveFullState, Fase 2 U1)"() {
        const block = fbSource.match(/async\s+saveEntities[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!block, "Método saveEntities debe ser localizable");
        const txt = block[0];
        testRunner.assert(
            /EmployeeRepository\.saveMany/.test(txt) || /EmployeeRepository\.saveOne/.test(txt),
            "Debe escribir empleados granular usando EmployeeRepository cuando ya migró"
        );
    },

    "saveFullState elimina employees del payload del mirror tras migración"() {
        const block = fbSource.match(/async\s+saveFullState[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = block[0];
        // Debe haber un delete del campo employees del snapshotContext o cleanState
        // SOLO en el camino post-migración (no incondicional).
        testRunner.assert(
            /delete\s+\w+\.employees/.test(txt),
            "Debe eliminar employees del payload del mirror cuando schemaVersion>=2"
        );
    }

});

// Fase 2 U1: el write per-entidad (y su mergeRemote:true) se movió de
// saveFullState a saveEntities — mismo comportamiento, nueva ubicación.
testRunner.addSuite("FirebaseService — saveEntities pasa mergeRemote (Fase 2.2, movido en Fase 2 U1)", {

    "saveEntities llama a saveMany con { mergeRemote: true }"() {
        const block = fbSource.match(/async\s+saveEntities[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        testRunner.assert(!!block, "Método saveEntities debe ser localizable");
        const txt = block[0];
        testRunner.assert(
            /saveMany\([^)]*mergeRemote[\s\S]{0,80}true/.test(txt),
            "saveEntities debe pasar mergeRemote:true a saveMany para que cada saveOne haga read-merge-write"
        );
    }

});

console.log('🧪 FirebaseService migration contract tests cargados.');
