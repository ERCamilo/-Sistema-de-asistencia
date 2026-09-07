/**
 * 🛡️ AttendanceCoherenceCoverageTests — RED DE SEGURIDAD para Fase 4 Paso 4.
 *
 * Paso 3 ruteó TODA escritura de asistencia por coherencia explícita. Paso 4 saca
 * la red del proxy (los traps). Antes de sacarla hay que PROBAR que Paso 3 está
 * completo: que no quedó NINGUNA mutación de state.attendance sin coherencia cerca.
 *
 * Este escáner recorre el fuente de cada archivo VIVO con escrituras de asistencia
 * y, por cada mutación de la raíz (asignación de clave / delete / reemplazo bulk),
 * verifica que haya una llamada de coherencia (invalidateEmployeeStats /
 * invalidateAllStats / buildAttendanceIndex) dentro de WINDOW líneas — O que el sitio
 * esté en la ALLOWLIST documentada de excepciones intencionales.
 *
 * Si aparece una mutación NUEVA sin coherencia → el test FALLA listando el sitio.
 * Mantener este test verde es PRECONDICIÓN de Paso 4: si está verde, sacar los
 * traps del proxy no puede dejar nada desincronizado en silencio.
 *
 * ⚠️ ALCANCE: el escáner cubre las mutaciones de la RAÍZ state.attendance
 * (state.attendance[k]=..., delete state.attendance[k], state.attendance=...). Las
 * mutaciones IN-PLACE de campos (att.present=false en removeAttendance;
 * state.attendance[k].notes='' en saveQuickNoteFromDetail) NO matchean el patrón y
 * se verificaron a mano en Paso 3 (ambas tienen coherencia en su función). Si en el
 * futuro se agrega una mutación in-place financiera, agregar su patrón acá.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');

// Archivos VIVOS con escrituras de asistencia (relativos a js/).
const FILES = [
    'app.js',
    'modules/services/PersistenceService.js',
    'modules/services/DataService.js',
    'modules/services/DomainResetService.js',
    'modules/ui/AttendanceHandlers.js',
    'modules/ui/modals/AdvancedAttendanceModal.js',
    'modules/features/notes/NotesController.js',
    'modules/features/export/ExportController.js',
];

const COHERENCE = /invalidate(EmployeeStats|AllStats)\s*\(|buildAttendanceIndex\s*\(/;
// Mutaciones de la raíz state.attendance: (this.)?state.attendance[...] = | delete (this.)?state.attendance[...]
const MUTATION = /(?:this\.)?state\.attendance\s*(?:\[[^\]]+\])?\s*=|delete\s+(?:this\.)?state\.attendance/;

const WINDOW = 48; // Los guards de generación de auth agregan 4 líneas en este bloque crítico; la coherencia sigue siendo obligatoria.

/**
 * ALLOWLIST de excepciones INTENCIONALES (mutación de asistencia sin coherencia, a propósito).
 * Clave = `${archivo}::${línea trimmeada}`. Cada entrada DEBE estar justificada.
 */
const ALLOWLIST = new Map([
    // addPositionHours (familia 3, Paso 3): empuja una entrada a positionHours y reasigna
    // el MISMO objeto a la MISMA clave. Cambia positionHours pero NO hoursWorked → las stats
    // mensuales (que suman hoursWorked) no cambian, y el índice sigue apuntando a la misma
    // referencia → no necesita coherencia. El commit real (saveMultiPosition) sí la tiene.
    // Fase 1 (U1b): el texto cambió al rutear por el choke point stampAttendanceWrite;
    // la justificación (editing-buffer, no toca hoursWorked → sin coherencia) sigue igual.
    ['app.js::state.attendance[key] = { ...stampAttendanceWrite(att), _isDirty: true };', 'editing-buffer: positionHours, no hoursWorked'],
]);

function scan(relPath) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    const lines = src.split('\n');
    const found = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue; // comentarios
        if (!MUTATION.test(line)) continue;
        const from = Math.max(0, i - WINDOW);
        const to = Math.min(lines.length, i + WINDOW + 1);
        if (COHERENCE.test(lines.slice(from, to).join('\n'))) continue; // tiene coherencia cerca
        found.push({ key: `${relPath}::${trimmed}`, display: `${relPath}:${i + 1}: ${trimmed.slice(0, 90)}` });
    }
    return found;
}

testRunner.addSuite("Cobertura de coherencia de asistencia (red para Paso 4)", {

    "toda mutación de asistencia tiene coherencia cerca (salvo allowlist documentada)"() {
        const uncovered = [];
        FILES.forEach(f => uncovered.push(...scan(f)));

        const unexpected = uncovered.filter(u => !ALLOWLIST.has(u.key));
        testRunner.assertEquals(
            unexpected.length, 0,
            'Hay mutaciones de asistencia SIN coherencia cerca y fuera de la allowlist.\n' +
            'Si son intencionales, agregalas a ALLOWLIST con justificación; si no, agregá la coherencia:\n  ' +
            unexpected.map(u => u.display).join('\n  ')
        );
    },

    "la allowlist no tiene entradas obsoletas (sitios que ya recibieron coherencia)"() {
        const uncoveredKeys = new Set();
        FILES.forEach(f => scan(f).forEach(u => uncoveredKeys.add(u.key)));

        const obsolete = [...ALLOWLIST.keys()].filter(k => !uncoveredKeys.has(k));
        testRunner.assertEquals(
            obsolete.length, 0,
            'La allowlist tiene entradas que YA no aparecen como descubiertas (¿se les agregó coherencia ' +
            'o cambió el código?). Quitalas para que la red no afloje:\n  ' + obsolete.join('\n  ')
        );
    }
});

console.log('🛡️ AttendanceCoherenceCoverage tests cargados.');
