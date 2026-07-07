/**
 * 🧪 DeleteEmployeeWiringTests
 *
 * Contract tests (source-level) del cableado de "eliminar empleado":
 * botón solo en pausados → data-action → window.deleteEmployeeHandler →
 * guard + orquestador. La lógica está cubierta en EmployeeDeletionGuardTests
 * y EmployeeDeletionTests.
 */

import fs from 'fs';
import path from 'path';

const LIST_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/features/employees/EmployeesList.js'), 'utf8');
const UI_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/features/employees/EmployeesUI.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

testRunner.addSuite("DeleteEmployeeWiring — botón y handler", {

    "el botón de eliminar SOLO aparece para empleados pausados (!emp.active)"() {
        testRunner.assert(
            /!emp\.active\s*\?\s*`[\s\S]{0,200}data-action="delete-employee"/.test(LIST_SRC),
            'el botón delete-employee debe estar gateado por !emp.active — no se elimina a un activo'
        );
    },

    "EmployeesList importa el guard y el orquestador"() {
        testRunner.assert(/from\s+['"]\.\.\/\.\.\/services\/EmployeeDeletionGuard\.js['"]/.test(LIST_SRC),
            'debe importar canDeleteEmployee');
        testRunner.assert(/from\s+['"]\.\.\/\.\.\/services\/EmployeeDeletion\.js['"]/.test(LIST_SRC),
            'debe importar deleteEmployeePermanently');
    },

    "deleteEmployeeHandler re-valida el guard antes de confirmar"() {
        const idx = LIST_SRC.indexOf('export function deleteEmployeeHandler');
        testRunner.assert(idx !== -1, 'debe existir deleteEmployeeHandler');
        const block = LIST_SRC.slice(idx, idx + 900);
        testRunner.assert(/canDeleteEmployee\s*\(\s*emp\s*\)/.test(block),
            'el handler debe re-chequear el guard (no confiar solo en que el botón esté visible)');
        testRunner.assert(/Modal\.confirm/.test(block), 'debe pedir confirmación (destructivo)');
    },

    "el handler escapa el nombre del empleado en el diálogo (XSS)"() {
        const idx = LIST_SRC.indexOf('export function deleteEmployeeHandler');
        const block = LIST_SRC.slice(idx, idx + 1400);
        testRunner.assert(/escapeHTML\s*\(\s*emp\.name\s*\)/.test(block),
            'el nombre va por Modal.confirm (innerHTML) — debe escaparse');
    },

    // 🐛 Judgment Day Fase 2A: los toasts de showAlert también van por
    // Notification.innerHTML (sin escape propio), pero interpolaban emp.name
    // crudo (toggle activar/pausar y "empleado eliminado"). Un nombre con
    // <img onerror> ejecuta script en cualquier dispositivo que sincronice.
    "todo toast de showAlert que muestra el nombre del empleado lo escapa (XSS)"() {
        const alertsWithName = LIST_SRC.match(/showAlert\(`[^`]*\$\{[^}]*emp\.name[^}]*\}[^`]*`/g) || [];
        testRunner.assert(alertsWithName.length > 0, 'debe haber al menos un toast que muestra emp.name');
        alertsWithName.forEach(call => {
            testRunner.assert(/escapeHTML\(\s*emp\.name\s*\)/.test(call),
                `el nombre en el toast debe ir por escapeHTML (innerHTML de Notification): ${call}`);
        });
    },

    "el handler encola el tombstone (no un hard-delete) vía enqueueEmployeeTombstone"() {
        const idx = LIST_SRC.indexOf('export function deleteEmployeeHandler');
        const block = LIST_SRC.slice(idx, idx + 1400);
        testRunner.assert(/enqueueEmployeeTombstone\s*\(/.test(block),
            'debe encolar el tombstone durable, no hard-delete');
        testRunner.assert(/deleteEmployeePermanently\s*\(/.test(block),
            'debe pasar por el orquestador con guard');
    },

    "EmployeesUI mapea data-action delete-employee a window.deleteEmployeeHandler"() {
        testRunner.assert(
            /['"]delete-employee['"]\s*:\s*\(id\)\s*=>\s*window\.deleteEmployeeHandler\?\.\(id\)/.test(UI_SRC),
            'el action map debe enrutar delete-employee'
        );
        testRunner.assert(/deleteEmployeeHandler/.test(UI_SRC) && /from\s+['"]\.\/EmployeesList\.js['"]/.test(UI_SRC),
            'EmployeesUI debe re-exportar deleteEmployeeHandler');
    },

    "app.js registra window.deleteEmployeeHandler (en las dos ramas de boot)"() {
        const count = (APP_SRC.match(/window\.deleteEmployeeHandler\s*=\s*EmployeesUI\.deleteEmployeeHandler/g) || []).length;
        testRunner.assert(count >= 2,
            `deleteEmployeeHandler debe registrarse en ambos puntos de boot (encontrados ${count})`);
    }

});

console.log('🧪 DeleteEmployeeWiring contract tests cargados.');
