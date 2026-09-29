/**
 * 🧪 WizardDeleteWiringTests (Feature #2)
 *
 * Contract tests del cableado de "eliminar" en el wizard de duplicados
 * (MaintenanceUI). La lógica pura está en ManualGroupValidatorTests
 * (rol 'delete' → deleteIds) y EmployeeDeletionGuardTests
 * (canDeleteDuplicateEmployee).
 */

import fs from 'fs';
import path from 'path';

const MAINT_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/MaintenanceUI.js'), 'utf8');

const DUP_SRC = require('fs').readFileSync(require('path').resolve(__dirname, '../modules/features/employees/EmployeeDuplicateService.js'), 'utf8');
testRunner.addSuite("WizardDeleteWiring — botón y ejecución", {

    "MaintenanceUI importa el guard liviano y el encolado de tombstone"() {
        testRunner.assert(/canDeleteDuplicateEmployee/.test(MAINT_SRC) && /EmployeeDeletionGuard\.js/.test(MAINT_SRC),
            'debe importar canDeleteDuplicateEmployee');
        // El borrado va por el servicio único de duplicados (lápida, no hard-delete).
        testRunner.assert(/deleteDuplicateEmployee/.test(MAINT_SRC) && /EmployeeDuplicateService\.js/.test(MAINT_SRC),
            'debe usar deleteDuplicateEmployee del servicio único');
        testRunner.assert(/enqueueEmployeeTombstone/.test(DUP_SRC),
            'el servicio debe encolar enqueueEmployeeTombstone (borrado robusto, no hard-delete)');
    },

    "la tarjeta del wizard tiene el botón 'Eliminar' con data-role='delete'"() {
        testRunner.assert(
            /set-member-role[\s\S]{0,60}'Eliminar'[\s\S]{0,60}'delete'/.test(MAINT_SRC),
            'debe existir el botón Eliminar que asigna el rol delete'
        );
    },

    "applyManualGroup lee deleteIds de la validación"() {
        testRunner.assert(
            /const\s*\{\s*masterId[^}]*deleteIds\s*\}\s*=\s*validation/.test(MAINT_SRC),
            'applyManualGroup debe desestructurar deleteIds'
        );
    },

    "confirma los borrados ANTES de ejecutar (guard + advertencia)"() {
        testRunner.assert(/_confirmDuplicateDeletes\s*\(/.test(MAINT_SRC),
            'debe existir la confirmación previa');
        const idx = MAINT_SRC.indexOf('async _confirmDuplicateDeletes');
        testRunner.assert(idx !== -1, 'debe existir el método de confirmación');
        const block = MAINT_SRC.slice(idx, idx + 2400);
        testRunner.assert(/canDeleteDuplicateEmployee\s*\(/.test(block),
            'debe chequear el guard de saldo (bloquea si debe plata)');
        testRunner.assert(/attendanceCount|asistencia/.test(block) && /loans|préstamo/.test(block),
            'debe advertir sobre asistencia/préstamos que se pierden');
        testRunner.assert(/Modal\.confirm/.test(block), 'debe pedir confirmación');
        testRunner.assert(/escapeHTML\s*\(/.test(block), 'debe escapar los nombres (innerHTML de Modal.confirm)');
    },

    // 🐛 Judgment Day Fase 2A: el mensaje de bloqueo del guard pasa por
    // NotificationSystem.error -> Notification.innerHTML (sin escape propio),
    // pero interpolaba "${m.name || m.id}" crudo. Debe escaparse como el resto.
    "el error de guard de saldo escapa el nombre del duplicado (XSS)"() {
        const idx = MAINT_SRC.indexOf('async _confirmDuplicateDeletes');
        const block = MAINT_SRC.slice(idx, idx + 2400);
        testRunner.assert(
            /NotificationSystem\.error\([\s\S]{0,160}escapeHTML\(\s*m\.name/.test(block),
            'el mensaje de bloqueo va por Notification (innerHTML) — debe escapar m.name'
        );
    },

    "el guard bloquea el apply entero si algún borrado tiene saldo (return sin ejecutar)"() {
        const idx = MAINT_SRC.indexOf('if (deleteIds && deleteIds.length > 0)');
        testRunner.assert(idx !== -1, 'debe gatear la ejecución por deleteIds');
        const block = MAINT_SRC.slice(idx, idx + 260);
        testRunner.assert(/_confirmDuplicateDeletes[\s\S]{0,80}if\s*\(\s*!proceed\s*\)\s*return/.test(block),
            'si la confirmación no procede, applyManualGroup debe abortar sin tocar nada');
    },

    "ejecuta el tombstone sacando de state (batchSetState) y encolando con el ts del borrado"() {
        testRunner.assert(
            /for\s*\(\s*const\s+delId\s+of\s+deleteIds\s*\)\s*deleteDuplicateEmployee\s*\(\s*delId\s*,\s*\{\s*at:\s*now\s*\}\s*\)/.test(MAINT_SRC),
            'debe eliminar cada duplicado con el ts del borrado'
        );
        testRunner.assert(
            /stateManager\.batchSetState[\s\S]{0,160}state\.employees\s*=\s*state\.employees\.filter/.test(DUP_SRC)
            && /enqueueEmployeeTombstone\s*\(\s*id\s*,\s*at\s*\)/.test(DUP_SRC),
            'el servicio saca de state (batchSetState) y encola la lápida con el ts del borrado'
        );
    }

});

console.log('🧪 WizardDeleteWiring contract tests cargados.');
