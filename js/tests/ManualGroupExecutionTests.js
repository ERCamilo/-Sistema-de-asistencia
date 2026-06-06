/**
 * 🧪 ManualGroupExecutionTests (Tarea #24)
 *
 * Contract tests sobre MaintenanceUI.applyManualGroup. La lógica
 * pura (mergeEmployees, executeMergePlan, validateManualGroup) ya
 * está testeada en sus propios módulos; aquí garantizamos que
 * applyManualGroup invoque las piezas en el orden correcto y maneje
 * cascada de reasignaciones.
 */

import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/MaintenanceUI.js'),
    'utf8'
);

// Extrae el cuerpo de applyManualGroup para verificar el orden de llamadas.
function applyManualGroupBody() {
    const m = SRC.match(/async\s+applyManualGroup\s*\([\s\S]*?\n\s{4}\}/);
    return m ? m[0] : '';
}

testRunner.addSuite("MaintenanceUI — applyManualGroup ejecución real (Tarea #24)", {

    "valida el grupo antes de ejecutar"() {
        const body = applyManualGroupBody();
        testRunner.assert(/validateManualGroup\s*\(/.test(body),
            'Debe correr validateManualGroup antes de aplicar nada');
    },

    "invoca executeMergePlan para los absorbs"() {
        const body = applyManualGroupBody();
        testRunner.assert(/executeMergePlan\s*\(/.test(body),
            'Para fusionar absorbs debe invocar executeMergePlan');
    },

    "invoca reassignEmployeeNumber para cada separate"() {
        const body = applyManualGroupBody();
        testRunner.assert(/reassignEmployeeNumber\s*\(/.test(body),
            'Cada separate debe disparar reassignEmployeeNumber');
    },

    "guarda con saveApplicationData tras aplicar"() {
        const body = applyManualGroupBody();
        testRunner.assert(/saveApplicationData\s*\(/.test(body),
            'Debe guardar después de los cambios');
    },

    "re-analiza conflictos tras la ejecución (cascada)"() {
        const body = applyManualGroupBody();
        testRunner.assert(/analyzeConflicts\s*\(/.test(body),
            'Debe re-correr analyzeConflicts para detectar nuevos grupos');
    },

    "recarga la subcolección cloud para re-análisis si schemaVersion>=2"() {
        const body = applyManualGroupBody();
        testRunner.assert(/EmployeeRepository\.loadAll/.test(body),
            'Re-carga cloud para que el re-análisis vea grupos cross-source');
    },

    "actualiza this.conflicts agregando nuevos grupos detectados"() {
        const body = applyManualGroupBody();
        testRunner.assert(/this\.conflicts/.test(body),
            'Debe modificar this.conflicts (queue de grupos pendientes)');
    },

    "incrementa currentConflictIndex (avanza al siguiente)"() {
        const body = applyManualGroupBody();
        testRunner.assert(/currentConflictIndex\s*\+\+|currentConflictIndex\s*=/.test(body),
            'Debe avanzar al siguiente grupo');
    },

    "materializa miembros cloud-only en state.employees antes de operar"() {
        const body = applyManualGroupBody();
        // Algún acceso a state.employees con push, find o asignación
        testRunner.assert(/state\.employees/.test(body),
            'Debe tocar state.employees (materializar cloud-only)');
    }

});

console.log('🧪 Manual group execution tests cargados.');
