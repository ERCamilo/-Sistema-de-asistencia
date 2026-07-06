/**
 * 🧪 IntegrityFixStampsTests (fix del bucle de sanitización, test de campo 2026-07-06)
 *
 * Bucle real observado en campo con 2 dispositivos conectados: el log
 * repetía sin parar "🛡️ 2 referencia(s) huérfana(s) corregida(s)" →
 * _executeSave → "☁️ Estado sincronizado" → y de vuelta. Causa raíz:
 * validateDataIntegrity corregía referencias huérfanas DENTRO de un
 * empleado (emp.positions con ids de puestos borrados, positionSalaries
 * ídem) SIN estampar emp.updatedAt. Consecuencias en cadena:
 *
 *   1. EntityUploadTracker (fix de cuota) filtra al empleado — updatedAt
 *      sin cambios = "nada que subir" → la corrección NUNCA llega a la nube.
 *   2. La nube queda sucia → el merge entrante (mergePositions es UNIÓN de
 *      conjuntos, no LWW) resucita el huérfano desde la copia remota.
 *   3. El validador lo vuelve a corregir → guardar → espejo → el listener
 *      del otro dispositivo → valida → corrige → guarda → ping-pong
 *      infinito, quemando lecturas y escrituras de Firestore.
 *
 * Regla que esta suite blinda (la MISMA del choke point de Fase 1/U3):
 * toda mutación de un empleado/puesto debe estampar updatedAt — también
 * las correcciones automáticas de integridad. Y su inversa: si NO hubo
 * corrección, updatedAt NO se toca (estampar de más re-subiría a todos
 * los empleados en cada validación — otra vez el bug de cuota).
 */

import { validateDataIntegrity } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';

function snapshotState() {
    return JSON.parse(JSON.stringify({
        employees: state.employees, positions: state.positions,
        leaders: state.leaders, attendance: state.attendance
    }));
}
function restoreState(snap) {
    state.employees = snap.employees; state.positions = snap.positions;
    state.leaders = snap.leaders; state.attendance = snap.attendance;
}

testRunner.addSuite("IntegrityFixStamps — las correcciones estampan updatedAt (rompe el bucle)", {

    async "corregir un emp.positions huérfano estampa emp.updatedAt"() {
        const snap = snapshotState();
        try {
            state.positions = [{ id: 'pos-viva', name: 'Válida' }];
            state.leaders = [];
            state.attendance = {};
            state.employees = [{
                id: 'e1', name: 'Ana', updatedAt: 1000,
                positions: ['pos-viva', 'pos-borrada'] // huérfana
            }];
            const before = Date.now() - 1;
            await validateDataIntegrity();
            const emp = state.employees.find(e => e.id === 'e1');
            testRunner.assertEquals(emp.positions.join(','), 'pos-viva', 'precondición: el huérfano se corrige');
            testRunner.assert(emp.updatedAt > before,
                'la corrección DEBE estampar emp.updatedAt — sin esto, EntityUploadTracker la filtra, nunca sube, y el merge entrante resucita el huérfano en bucle');
        } finally { restoreState(snap); }
    },

    async "corregir un positionSalaries huérfano estampa emp.updatedAt"() {
        const snap = snapshotState();
        try {
            state.positions = [{ id: 'pos-viva', name: 'Válida' }];
            state.leaders = [];
            state.attendance = {};
            state.employees = [{
                id: 'e1', name: 'Ana', updatedAt: 1000,
                positions: ['pos-viva'],
                positionSalaries: { 'pos-viva': 100, 'pos-borrada': 50 }
            }];
            const before = Date.now() - 1;
            await validateDataIntegrity();
            const emp = state.employees.find(e => e.id === 'e1');
            testRunner.assert(!('pos-borrada' in (emp.positionSalaries || {})), 'precondición: se limpia');
            testRunner.assert(emp.updatedAt > before, 'debe estampar emp.updatedAt');
        } finally { restoreState(snap); }
    },

    async "un empleado SIN huérfanos NO recibe estampa (estampar de más re-sube a todos = bug de cuota)"() {
        const snap = snapshotState();
        try {
            state.positions = [{ id: 'pos-viva', name: 'Válida' }];
            state.leaders = [];
            state.attendance = {};
            state.employees = [{
                id: 'e-limpio', name: 'Luis', updatedAt: 1000,
                positions: ['pos-viva'],
                positionSalaries: { 'pos-viva': 100 },
                loans: [{ id: 'L1' }] // con id — el backfill tampoco lo toca
            }];
            await validateDataIntegrity();
            const emp = state.employees.find(e => e.id === 'e-limpio');
            testRunner.assertEquals(emp.updatedAt, 1000,
                'sin correcciones, updatedAt debe quedar EXACTAMENTE igual');
        } finally { restoreState(snap); }
    },

    async "corregir un pos.leaderId huérfano estampa pos.updatedAt"() {
        const snap = snapshotState();
        try {
            state.positions = [{ id: 'p1', name: 'Puesto', leaderId: 'lider-borrado', updatedAt: 1000 }];
            state.leaders = [];
            state.attendance = {};
            state.employees = [];
            const before = Date.now() - 1;
            await validateDataIntegrity();
            const pos = state.positions.find(p => p.id === 'p1');
            testRunner.assertEquals(pos.leaderId, null, 'precondición: se anula la referencia');
            testRunner.assert(pos.updatedAt > before,
                'debe estampar pos.updatedAt — sin esto, PositionRepository nunca sube el arreglo');
        } finally { restoreState(snap); }
    },

    async "un puesto SIN huérfanos NO recibe estampa"() {
        const snap = snapshotState();
        try {
            state.leaders = [{ id: 'lider-vivo', name: 'Líder' }];
            state.positions = [{ id: 'p1', name: 'Puesto', leaderId: 'lider-vivo', updatedAt: 1000 }];
            state.attendance = {};
            state.employees = [];
            await validateDataIntegrity();
            const pos = state.positions.find(p => p.id === 'p1');
            testRunner.assertEquals(pos.updatedAt, 1000);
        } finally { restoreState(snap); }
    }

});

// ─── Cableado del cortacircuito en app.js (capa 2) ───────────────────────────

testRunner.addSuite("IntegrityFixStamps — el guard post-sync de app.js pasa por el cortacircuito", {

    "app.js importa recordSanitizeRound de SanitizeLoopBreaker.js"() {
        const fs = require('fs');
        const path = require('path');
        const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
        testRunner.assert(
            /import\s*\{[^}]*recordSanitizeRound[^}]*\}\s*from\s+['"]\.\/modules\/services\/SanitizeLoopBreaker\.js['"]/.test(APP_SRC),
            'app.js debe importar recordSanitizeRound'
        );
    },

    "la re-subida del guard post-sync está gateada por recordSanitizeRound(remoteFixes)"() {
        const fs = require('fs');
        const path = require('path');
        const APP_SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
        testRunner.assert(
            /if\s*\(\s*recordSanitizeRound\s*\(\s*remoteFixes\s*\)\s*\)[\s\S]{0,220}saveApplicationData\s*\(\s*\{\s*force:\s*true\s*\}\s*\)/.test(APP_SRC),
            'el saveApplicationData({force:true}) del guard debe correr SOLO si el cortacircuito lo permite'
        );
        testRunner.assert(
            !/if\s*\(\s*remoteFixes\s*>\s*0\s*\)[\s\S]{0,220}saveApplicationData\s*\(\s*\{\s*force:\s*true\s*\}\s*\)/.test(APP_SRC),
            'el gate viejo (remoteFixes > 0 directo, sin cortacircuito) no debe seguir existiendo'
        );
    }

});

console.log('🧪 IntegrityFixStamps tests cargados.');
