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
    },

    // 🐛 Ronda 3: los dos jueces cazaron residuos de la MISMA clase en el mismo
    // archivo que la Ronda 2 "cubrió": el nombre maestro del plan de fusiones
    // seguras (showPlanPreview) y las iniciales del avatar (derivadas del
    // nombre crudo — el primer carácter de '<img...' es '<' y entra al innerHTML).
    "MaintenanceUI: el nombre maestro del plan de fusiones seguras va escapado"() {
        testRunner.assert(!/<strong>\$\{masterName\}/.test(MAINT),
            'masterName se interpola crudo en el plan de fusiones seguras (innerHTML)');
        testRunner.assert(/escapeHTML\(masterName\)/.test(MAINT),
            'masterName debe pasar por escapeHTML');
    },

    "MaintenanceUI: las iniciales del avatar derivan de un nombre escapado"() {
        const initials = MAINT.match(/\$\{[^{}]*\.split\(' '\)[^{}]*\}/g) || [];
        testRunner.assert(initials.length >= 2, 'deben existir las expresiones de iniciales del avatar');
        const unescaped = initials.filter(x => !/escapeHTML\(/.test(x));
        testRunner.assertEquals(unescaped.length, 0,
            `iniciales sin escapar (innerHTML): ${unescaped.join(' | ')}`);
    },

    "MaintenanceUI: el id del empleado en la tarjeta va escapado"() {
        testRunner.assert(!/ID completo: \$\{emp\.id \|\| ''\}/.test(MAINT),
            'emp.id crudo en el title del tag de ID');
    },

    // 🐛 Judgment Day Fase 2A Ronda 5 (rastro del Juez B, cerrado inline): el
    // NÚMERO de ficha también es texto tecleable (la reasignación lo acepta sin
    // whitelist y lo persiste en emp.number) y sobrevive a un import de backup.
    // Se interpolaba crudo en el plan de fusiones, los kickers/subtítulos del
    // wizard (Modal rinde subtitle por innerHTML) y la tarjeta de conflicto.
    "MaintenanceUI: el número de ficha va escapado en planes, kickers y subtítulos"() {
        const rawPatterns = [
            /Ficha \$\{p\.number\}/,                 // 152/169: plan de fusiones
            /Ficha repetida: \$\{group\.number\}/,   // 493: subtitle (innerHTML del Modal)
            /Ficha repetida \$\{group\.number\}/,    // 520: kicker
            /Ficha en conflicto: \$\{group\.number\}/, // 1037: subtitle
            /<strong>\$\{group\.number\}<\/strong>/, // 1056: aviso de conflicto
            /<strong[^>]*>\$\{suggestedNumber\}<\/strong>/ // 1059: sugerido
        ];
        const stillRaw = rawPatterns.filter(re => re.test(MAINT)).map(re => re.source);
        testRunner.assertEquals(stillRaw.length, 0,
            `el número de ficha se interpola crudo en: ${stillRaw.join(' | ')}`);
    },

    // 🐛 Judgment Day Fase 2A Ronda 4 (ambos jueces): residuos de inyección por
    // ATRIBUTO en las mismas tarjetas. _reassignTo es texto tecleado por el
    // usuario (CRITICAL, Juez B); emp.id y el número sobreviven a un import de
    // backup con contenido arbitrario. escapeHTML también codifica comillas, así
    // que sirve para contexto de atributo. Un `x" onerror=...` rompe el atributo.
    "MaintenanceUI: los atributos con _reassignTo / emp.id / número van escapados"() {
        const rawPatterns = [
            /value="\$\{emp\._reassignTo/,            // input de nueva ficha (tecleado)
            /"reassign-input-\$\{emp\.id\}"/,          // for= / id=
            /data-id="\$\{emp\.id\}"/,                 // botones/inputs de rol
            /data-emp-id="\$\{emp\.id\}"/,             // tarjeta de reasignación
            /data-original="\$\{originalNumber\}"/,
            /value="\$\{originalNumber\}"/,
            /placeholder="\$\{suggestedNumber\}"/
        ];
        const stillRaw = rawPatterns.filter(re => re.test(MAINT)).map(re => re.source);
        testRunner.assertEquals(stillRaw.length, 0,
            `atributos con valor crudo (inyección por atributo): ${stillRaw.join(' | ')}`);
    }

});

console.log('🧪 NameEscapingXss tests cargados.');
