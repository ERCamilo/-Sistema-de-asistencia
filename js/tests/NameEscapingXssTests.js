/**
 * 🧪 NameEscapingXssTests (Judgment Day Fase 2A Ronda 2)
 *
 * XSS almacenado: los nombres de empleado/puesto/líder son texto libre que se
 * sincroniza entre dispositivos y se renderiza por innerHTML (Modal.confirm,
 * Notification, plantillas de tarjetas). La Ronda 1 escapó algunos toasts pero
 * dejó viva la MISMA clase de bug en varios sitios hermanos (confirmaciones de
 * toggle activar/pausar, tarjetas del wizard de duplicados). Un nombre con
 * `<img src=x onerror=...>` ejecuta script al abrir esos diálogos/tarjetas.
 *
 * Contract test: los sitios señalados NO deben interpolar el nombre crudo.
 */

import fs from 'fs';
import path from 'path';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const EMP_LIST = read('../modules/features/employees/EmployeesList.js');
const POS_LIST = read('../modules/features/employees/PositionsList.js');
const LDR_LIST = read('../modules/features/employees/LeadersList.js');
const MAINT = read('../modules/ui/MaintenanceUI.js');

testRunner.addSuite("XSS — nombres escapados en confirmaciones y tarjetas (Ronda 2)", {

    "EmployeesList: el Modal.confirm de activar/pausar no interpola emp.name crudo"() {
        const raw = EMP_LIST.match(/message:\s*`[^`]*\$\{emp\.name\}[^`]*`/g) || [];
        testRunner.assertEquals(raw.length, 0,
            `los mensajes de Modal.confirm deben escapar emp.name: ${raw.join(' | ')}`);
    },

    "PositionsList: ningún Modal.confirm interpola pos.name crudo"() {
        const raw = POS_LIST.match(/message:\s*`[^`]*\$\{pos\.name\}[^`]*`/g) || [];
        testRunner.assertEquals(raw.length, 0,
            `los mensajes de Modal deben escapar pos.name: ${raw.join(' | ')}`);
    },

    "LeadersList: ni el Modal.confirm ni el toast interpolan ldr.name crudo"() {
        const rawMsg = LDR_LIST.match(/message:\s*`[^`]*\$\{ldr\.name\}[^`]*`/g) || [];
        const rawToast = LDR_LIST.match(/showAlert\(`[^`]*\$\{ldr\.name\}[^`]*`/g) || [];
        testRunner.assertEquals(rawMsg.length + rawToast.length, 0,
            `ldr.name debe escaparse en mensajes/toasts: ${[...rawMsg, ...rawToast].join(' | ')}`);
    },

    "MaintenanceUI: las tarjetas/planes no interpolan el nombre crudo por innerHTML"() {
        const patterns = [
            /`"\$\{m\.name\}"`/,                     // 167: "${m.name}" en el plan manual
            /\$\{o\.name \|\| '\?'\}/,               // 328: <li> de huérfanos
            /\$\{emp\.name \|\| '\(sin nombre\)'\}/, // 636: <h4> de la tarjeta
            /<h4[^>]*>\$\{emp\.name\}</            // 1085: <h4> de la tarjeta de comparación
        ];
        const stillRaw = patterns.filter(re => re.test(MAINT)).map(re => re.source);
        testRunner.assertEquals(stillRaw.length, 0,
            `estos sitios aún interpolan el nombre crudo: ${stillRaw.join(' | ')}`);
    }

});

console.log('🧪 NameEscapingXss tests cargados.');
