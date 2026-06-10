/**
 * 🧪 LowSeverityRound2Tests (Auditoría 2026-06-09, hallazgos L4/L6/L7/L8)
 *
 * L4 — DataService usaba globals implícitos (Employee, Position, Leader,
 *      Attendance, Modal, icons) que app.js cuelga de globalThis: si el orden
 *      de carga cambia, loadAll()/reset() petan con ReferenceError.
 *      Fix: imports explícitos.
 *
 * L6 — StorageService.save() logueaba tamaños/estado de los datos SIN gate en
 *      producción (ruido + divulgación en máquinas compartidas).
 *      Fix: los logs verbosos van detrás de window.debug.
 *
 * L7 — prepareDataForNewAccount regeneraba ids de líderes/cargos/empleados/
 *      asistencia pero NO tocaba la caja chica: la cuenta clonada conservaba
 *      los ids de movimientos viejos y los stores con datos de la cuenta
 *      anterior. Fix: regeneración pura de ids (PettyCashIdRegen) + re-encolado
 *      vía PettyCashStore.save (la outbox los sube al entrar a la cuenta nueva)
 *      + limpieza de la outbox vieja.
 *
 * L8 — El auto-backup de sessionStorage podía exceder la cuota en silencio
 *      (catch genérico). Fix: ante QuotaExceededError reintenta un respaldo
 *      REDUCIDO (sin asistencia, lo más pesado) y avisa por consola.
 */

import fs from 'fs';
import path from 'path';
import { regeneratePettyCashIds } from '../modules/services/PettyCashIdRegen.js';
import { createAutoBackup } from '../modules/services/PersistenceService.js';
import { state } from '../modules/core/AppState.js';

const DS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/DataService.js'), 'utf8'
);
const SS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/StorageService.js'), 'utf8'
);
const PS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/PersistenceService.js'), 'utf8'
);

// ─── L4 ──────────────────────────────────────────────────────────────────────

testRunner.addSuite("DataService — imports explícitos, sin globals (L4)", {

    "importa los modelos que instancia (Employee/Position/Leader/Attendance)"() {
        ['Employee', 'Position', 'Leader', 'Attendance'].forEach(cls => {
            testRunner.assert(
                new RegExp(`import\\s*\\{[^}]*\\b${cls}\\b[^}]*\\}\\s*from`).test(DS_SRC),
                `DataService debe importar ${cls} explícitamente — hoy depende de un global colgado por app.js`
            );
        });
    },

    "importa Modal e icons (usados en reset/export/import)"() {
        testRunner.assert(/import\s*\{\s*Modal\s*\}\s*from/.test(DS_SRC),
            'DataService debe importar Modal');
        testRunner.assert(/import\s+icons\s+from/.test(DS_SRC),
            'DataService debe importar icons (IconSystem)');
        testRunner.assert(/import\s*\{\s*Notification\s*\}\s*from/.test(DS_SRC),
            'DataService debe importar Notification');
    }

});

// ─── L6 ──────────────────────────────────────────────────────────────────────

testRunner.addSuite("StorageService — sin logs verbosos en producción (L6)", {

    "save() no tiene console.log sin gate"() {
        const block = SS_SRC.match(/save\s*\(data\)\s*\{[\s\S]{0,1800}?\n    \}/);
        testRunner.assert(!!block, 'save() debe existir');
        testRunner.assert(!/^\s*console\.log\(/m.test(block[0]),
            'save() no debe loguear tamaños/contenido sin gate (window.debug) — divulgación + ruido en producción');
    }

});

// ─── L7 ──────────────────────────────────────────────────────────────────────

const uidSeq = (() => { let n = 0; return () => `new-${++n}`; })();

testRunner.addSuite("Caja chica — regeneración de ids para cuenta nueva (L7)", {

    "asigna ids nuevos a proyectos, periodos y movimientos"() {
        const out = regeneratePettyCashIds({
            projects: [{ id: 'p1', nombre: 'Obra' }],
            periods: [{ id: 'per1', projectId: 'p1' }],
            movements: [{ id: 'm1', projectId: 'p1', periodId: 'per1', monto: 100 }]
        }, uidSeq);
        testRunner.assert(out.projects[0].id !== 'p1', 'el proyecto debe tener id nuevo');
        testRunner.assert(out.periods[0].id !== 'per1', 'el periodo debe tener id nuevo');
        testRunner.assert(out.movements[0].id !== 'm1', 'el movimiento debe tener id nuevo');
        testRunner.assertEquals(out.movements[0].monto, 100, 'los datos se conservan');
    },

    "remapea las referencias cruzadas (projectId/periodId) de forma consistente"() {
        const out = regeneratePettyCashIds({
            projects: [{ id: 'p1' }],
            periods: [{ id: 'per1', projectId: 'p1' }],
            movements: [{ id: 'm1', projectId: 'p1', periodId: 'per1' }]
        }, uidSeq);
        testRunner.assertEquals(out.periods[0].projectId, out.projects[0].id,
            'period.projectId debe apuntar al id NUEVO del proyecto');
        testRunner.assertEquals(out.movements[0].projectId, out.projects[0].id,
            'movement.projectId debe apuntar al id NUEVO del proyecto');
        testRunner.assertEquals(out.movements[0].periodId, out.periods[0].id,
            'movement.periodId debe apuntar al id NUEVO del periodo');
    },

    "expone el idMap viejo→nuevo (para re-encadenar comprobantes)"() {
        const out = regeneratePettyCashIds({
            projects: [], periods: [],
            movements: [{ id: 'm1' }]
        }, uidSeq);
        testRunner.assert(out.idMap instanceof Map, 'debe devolver un Map');
        testRunner.assertEquals(out.idMap.get('m1'), out.movements[0].id,
            'idMap debe mapear el id viejo del movimiento al nuevo');
    },

    "tolera entrada vacía o inválida"() {
        const out = regeneratePettyCashIds(null, uidSeq);
        testRunner.assert(Array.isArray(out.projects) && out.projects.length === 0, 'null → vacío');
        const out2 = regeneratePettyCashIds({}, uidSeq);
        testRunner.assert(Array.isArray(out2.movements) && out2.movements.length === 0, '{} → vacío');
    },

    "fuente: prepareDataForNewAccount integra la caja chica (regen + outbox limpia)"() {
        const block = PS_SRC.match(/export async function prepareDataForNewAccount[\s\S]{0,5000}?\n\}/);
        testRunner.assert(!!block, 'prepareDataForNewAccount debe existir');
        testRunner.assert(/regeneratePettyCashIds/.test(block[0]),
            'debe regenerar los ids de caja chica — la cuenta clonada no debe conservar ids viejos');
        testRunner.assert(/pettyCashOutbox/.test(block[0]),
            'debe limpiar la outbox vieja (sus entradas referencian ids/cuenta anteriores)');
        testRunner.assert(/PettyCashStore\.save/.test(block[0]),
            'debe re-encolar vía PettyCashStore.save para que la outbox los suba a la cuenta nueva');
    }

});

// ─── L8 ──────────────────────────────────────────────────────────────────────

testRunner.addSuite("Auto-backup — cuota de sessionStorage (L8)", {

    async "ante QuotaExceededError reintenta un respaldo reducido (sin asistencia)"() {
        const setItem = jest.spyOn(Storage.prototype, 'setItem');
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            // Primer intento (backup completo) revienta por cuota; el segundo cabe.
            const quotaErr = new DOMException('quota', 'QuotaExceededError');
            setItem.mockImplementationOnce(() => { throw quotaErr; });

            const prevEmployees = state.employees, prevAttendance = state.attendance;
            state.employees = [{ id: 'e1', name: 'Ana' }];
            state.attendance = { 'e1-2026-06-10': { employeeId: 'e1' } };
            try {
                createAutoBackup();
            } finally {
                state.employees = prevEmployees;
                state.attendance = prevAttendance;
            }

            testRunner.assert(setItem.mock.calls.length >= 2,
                'tras el fallo por cuota debe haber un SEGUNDO intento (reducido)');
            const reducedPayload = JSON.parse(setItem.mock.calls[setItem.mock.calls.length - 1][1]);
            testRunner.assert(!reducedPayload.data.attendance,
                'el respaldo reducido NO debe incluir attendance (lo más pesado)');
            testRunner.assert(Array.isArray(reducedPayload.data.employees),
                'el respaldo reducido SÍ conserva empleados (lo más valioso)');
            testRunner.assert(warn.mock.calls.length >= 1,
                'debe avisar por consola que el respaldo quedó reducido');
        } finally {
            setItem.mockRestore();
            warn.mockRestore();
        }
    },

    async "un error que NO es de cuota no intenta el respaldo reducido"() {
        const setItem = jest.spyOn(Storage.prototype, 'setItem');
        const err = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            setItem.mockImplementationOnce(() => { throw new Error('otra cosa'); });
            createAutoBackup();
            testRunner.assertEquals(setItem.mock.calls.length, 1,
                'sin error de cuota no hay reintento reducido');
            testRunner.assert(err.mock.calls.length >= 1, 'el error se reporta');
        } finally {
            setItem.mockRestore();
            err.mockRestore();
        }
    }

});
