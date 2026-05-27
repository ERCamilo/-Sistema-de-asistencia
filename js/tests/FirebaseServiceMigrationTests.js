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

    "migrateIfNeeded usa createSnapshot con razón pre-migration-v2"() {
        const block = fbSource.match(/migrateIfNeeded[\s\S]*?(?=\n\s{4}(?:async\s+\w+|\w+\s*\()|\n\}\s*$)/);
        const txt = block[0];
        testRunner.assert(
            /pre-migration-v2/.test(txt),
            "El snapshot que crea debe llevar la razón 'pre-migration-v2' (catálogo)"
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

console.log('🧪 FirebaseService migration contract tests cargados.');
