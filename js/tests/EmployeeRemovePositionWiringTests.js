/**
 * 🧪 EmployeeRemovePositionWiringTests
 *
 * Contract tests del flujo "quitar una posición a un empleado con días
 * trabajados en ella" (EmployeeModal). La lógica pura está cubierta en
 * AttendancePositionAuditTests; acá se blinda el cableado:
 *   - al guardar, se detectan las posiciones REMOVIDAS con historial y se
 *     interpone el modal de impacto ANTES de aplicar nada;
 *   - opciones: Conservar historial (default recomendado) / Reasignar esos
 *     días a otra posición del empleado / Cancelar;
 *   - la reasignación corre dentro de batchSetState + rebuild del índice y
 *     sube por el canal daily (dateKeys + immediate) en el MISMO guardado
 *     del announce (un solo mirror);
 *   - los nombres van escapados (innerHTML del Modal).
 */

import fs from 'fs';
import path from 'path';

const MODAL_SRC = fs.readFileSync(path.resolve(__dirname, '../modules/ui/modals/EmployeeModal.js'), 'utf8');

testRunner.addSuite("EmployeeRemovePosition — detección e interposición del modal", {

    "EmployeeModal importa la auditoría/reasignación y el escape"() {
        testRunner.assert(/from '\.\.\/\.\.\/services\/AttendancePositionAudit\.js'/.test(MODAL_SRC),
            'debe importar AttendancePositionAudit');
        testRunner.assert(/collectPositionDays/.test(MODAL_SRC) && /reassignPositionDays/.test(MODAL_SRC),
            'debe usar collectPositionDays y reassignPositionDays');
        testRunner.assert(/escapeHTML/.test(MODAL_SRC) && /Sanitize\.js/.test(MODAL_SRC),
            'debe importar escapeHTML (el contenido va por innerHTML)');
    },

    "al guardar una edición se detectan las posiciones removidas CON historial"() {
        const idx = MODAL_SRC.indexOf('static save(');
        testRunner.assert(idx !== -1, 'debe existir static save');
        const block = MODAL_SRC.slice(idx, idx + 12000);
        testRunner.assert(/!selectedPositions\.includes\(/.test(block),
            'removidas = posiciones previas que ya no están en las seleccionadas');
        testRunner.assert(/collectPositionDays\(/.test(block),
            'cada removida se audita contra la asistencia');
        testRunner.assert(/_showPositionRemovalImpact\(/.test(block),
            'con historial afectado se interpone el modal de impacto');
    },

    "el modal ofrece Conservar (default recomendado), Reasignar y Cancelar"() {
        const idx = MODAL_SRC.lastIndexOf('_showPositionRemovalImpact');
        testRunner.assert(idx !== -1, 'debe existir _showPositionRemovalImpact');
        const block = MODAL_SRC.slice(idx, idx + 8000);
        const conservarBtn = block.indexOf('🛡️ Conservar historial');
        const reasignarBtn = block.indexOf('🔁 Reasignar esos días');
        testRunner.assert(conservarBtn !== -1, 'botón Conservar historial');
        testRunner.assert(reasignarBtn !== -1, 'botón Reasignar esos días');
        testRunner.assert(/Cancelar/.test(block), 'opción Cancelar');
        testRunner.assert(conservarBtn < reasignarBtn,
            'el botón Conservar (el camino seguro) se ofrece ANTES que el de Reasignar');
    },

    "el modal muestra el impacto: días, rango de fechas, horas y plata"() {
        const idx = MODAL_SRC.lastIndexOf('_showPositionRemovalImpact');
        const block = MODAL_SRC.slice(idx, idx + 8000);
        testRunner.assert(/audit\.count/.test(block), 'muestra cuántos días');
        testRunner.assert(/firstDate/.test(block) && /lastDate/.test(block), 'muestra el rango de fechas');
        testRunner.assert(/totalHours/.test(block), 'muestra las horas afectadas');
        testRunner.assert(/positionSalaries/.test(block) || /hourlyRate/.test(block),
            'resuelve tarifas para estimar el impacto en dinero');
        testRunner.assert(/pagad/i.test(block),
            'advierte que si esos días ya fueron pagados los reportes dejan de cuadrar');
    },

    "los nombres interpolados en el modal van escapados (XSS)"() {
        const idx = MODAL_SRC.lastIndexOf('_showPositionRemovalImpact');
        const block = MODAL_SRC.slice(idx, idx + 8000);
        testRunner.assert(/escapeHTML\(/.test(block),
            'nombres de empleado/posición por escapeHTML — Modal rinde por innerHTML');
    }

});

testRunner.addSuite("EmployeeRemovePosition — ejecución de la reasignación", {

    "la reasignación corre dentro de batchSetState y reconstruye el índice"() {
        const idx = MODAL_SRC.indexOf('static save(');
        const block = MODAL_SRC.slice(idx, idx + 12000);
        testRunner.assert(
            /batchSetState\(\s*\(\)\s*=>\s*\{[\s\S]{0,500}?reassignPositionDays\([\s\S]{0,400}?buildAttendanceIndex\(\)/.test(block),
            'mutación de asistencia dentro de batchSetState + rebuild del índice (mismo contrato que el purge)'
        );
    },

    "las fechas tocadas suben por el canal daily en el MISMO guardado del announce"() {
        const idx = MODAL_SRC.indexOf('static save(');
        const block = MODAL_SRC.slice(idx, idx + 12000);
        testRunner.assert(
            /dateKeys[\s\S]{0,200}?immediate\s*[:=]\s*true/.test(block),
            'el guardado lleva dateKeys + immediate:true — un daily por fecha, un solo mirror'
        );
    }

});

console.log('🧪 EmployeeRemovePositionWiring contract tests cargados.');
