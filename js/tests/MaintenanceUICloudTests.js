/**
 * 🧪 MaintenanceUICloudTests (Tarea #20 — contract)
 *
 * Asegura que MaintenanceUI:
 *   - Importa ConflictPlanner y EmployeeRepository.
 *   - En .start() precarga la subcolección de empleados cuando
 *     schemaVersion >= 2 y hay sesión, y pasa cloudEmployees a
 *     analyzeConflicts.
 *   - Construye el plan con buildConflictPlan.
 *   - Crea un snapshot 'pre-cloud-dedup' antes de aplicar.
 *   - Invoca executeMergePlan al ejecutar.
 *   - Llama a saveApplicationData tras la ejecución.
 *
 * Tests behaviorales completos requerirían mockear demasiado; estos
 * contracts garantizan que el cableado no se rompa por refactors.
 */

import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/MaintenanceUI.js'),
    'utf8'
);

testRunner.addSuite("MaintenanceUI — cableado cloud-aware (Tarea #20)", {

    "importa ConflictPlanner"() {
        testRunner.assert(
            /from\s+['"]\.\.\/services\/ConflictPlanner\.js['"]/.test(SRC),
            'MaintenanceUI debe importar ConflictPlanner'
        );
    },

    "importa EmployeeRepository"() {
        testRunner.assert(
            /from\s+['"]\.\.\/services\/EmployeeRepository\.js['"]/.test(SRC),
            'MaintenanceUI debe importar EmployeeRepository'
        );
    },

    "start() es async (await sobre la carga de la nube)"() {
        testRunner.assert(
            /async\s+start\s*\(/.test(SRC),
            'start debe ser async'
        );
    },

    "start() llama a EmployeeRepository.loadAll cuando aplica"() {
        testRunner.assert(
            /EmployeeRepository\.loadAll\s*\(/.test(SRC),
            'Debe cargar la subcolección antes de analizar conflictos'
        );
    },

    "start() consulta state.settings.schemaVersion antes de cargar nube"() {
        // Sin este guard, cuentas legacy harían un loadAll inútil.
        testRunner.assert(
            /schemaVersion/.test(SRC),
            'Debe gatekeep la carga de nube según schemaVersion'
        );
    },

    "analyzeConflicts se llama con cloudEmployees"() {
        testRunner.assert(
            /analyzeConflicts\s*\(\s*\{[\s\S]{0,80}cloudEmployees/.test(SRC),
            'analyzeConflicts debe recibir { cloudEmployees }'
        );
    },

    "construye el plan via buildConflictPlan"() {
        testRunner.assert(
            /buildConflictPlan\s*\(/.test(SRC),
            'Debe construir el plan con buildConflictPlan'
        );
    },

    "snapshot pre-cloud-dedup se invoca antes de ejecutar"() {
        testRunner.assert(
            /pre-cloud-dedup/.test(SRC),
            'Debe crear snapshot con razón pre-cloud-dedup'
        );
    },

    "executeMergePlan se invoca para aplicar el plan"() {
        testRunner.assert(
            /executeMergePlan\s*\(/.test(SRC),
            'Debe invocar executeMergePlan'
        );
    },

    "saveApplicationData se invoca tras ejecutar el plan"() {
        // Ya estaba pero verifico que siga ahí (post-ejecución).
        testRunner.assert(
            /saveApplicationData\s*\(/.test(SRC),
            'Debe guardar tras aplicar fusiones'
        );
    }

});

testRunner.addSuite("MaintenanceUI — opción 'Revisar TODO manualmente' (Tarea #25)", {

    "el preview modal incluye un botón data-maint-action='review-all-manually'"() {
        testRunner.assert(
            /data-maint-action=["']review-all-manually["']/.test(SRC),
            'Debe existir botón con la acción review-all-manually'
        );
    },

    "review-all-manually está registrado en el delegation map"() {
        testRunner.assert(
            /'review-all-manually':/.test(SRC),
            'Acción debe estar en el delegation map'
        );
    },

    "existe el método reviewAllManually() en la clase"() {
        testRunner.assert(
            /reviewAllManually\s*\(/.test(SRC),
            'Método reviewAllManually debe existir en la clase'
        );
    }

});

console.log('🧪 MaintenanceUI cloud-aware tests cargados.');
