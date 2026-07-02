/**
 * 🧪 DataOpsReplaceLocalTests (Fase 0.5, U4)
 *
 * "Descargar y Reemplazar": borra todos los datos locales y adopta la nube
 * como ÚNICA fuente de verdad, sin rastros de lo que había en IndexedDB.
 *
 * Defectos del flujo viejo (App.Sync.downloadFromCloud) que este contrato
 * cierra:
 *   - No purgaba el outbox ni las colas de borrado → tras el reload, el
 *     drenado del login subía datos PRE-descarga y pisaba/borraba en la
 *     nube justo lo que el usuario eligió como verdad (bug ALTA #1).
 *   - Object.assign(state, cloudState) contaminaba el state con metadata
 *     del doc espejo (updatedAt, lastDevice, lastChangedBy).
 *   - Un fallo de lectura de entidades (loadAll() → null) se trataba como
 *     lista vacía en vez de abortar — en modo REEMPLAZO eso blanquearía
 *     la nómina local sin datos de reemplazo reales.
 *
 * Orden crítico del contrato: FETCH PRIMERO (si la red falla no se tocó
 * nada), recién después wipe + aplicar + persistir + reload.
 */

import { replaceLocalWithCloud } from '../modules/services/DataOps.js';
import { state } from '../modules/core/AppState.js';

function snapshotState() {
    return JSON.parse(JSON.stringify({
        employees: state.employees, positions: state.positions, leaders: state.leaders,
        attendance: state.attendance, settings: state.settings
    }));
}
function restoreState(snap) {
    state.employees = snap.employees; state.positions = snap.positions; state.leaders = snap.leaders;
    state.attendance = snap.attendance; state.settings = snap.settings;
}

function makeDeps(overrides = {}) {
    return {
        fetchFullState: jest.fn().mockResolvedValue({
            settings: { schemaVersion: 3, businessName: 'Cloud SA' },
            employees: [], positions: [], leaders: [],
            updatedAt: { seconds: 1 }, lastDevice: 'otro', lastChangedBy: 'device-B'
        }),
        loadEmployees: jest.fn().mockResolvedValue([{ id: 'eC1', name: 'Cloud Emp', positions: [] }]),
        loadPositions: jest.fn().mockResolvedValue([{ id: 'pC1', name: 'Cloud Pos' }]),
        loadLeaders: jest.fn().mockResolvedValue([]),
        fetchAllAttendance: jest.fn().mockResolvedValue({
            'eC1-2026-07-01': { employeeId: 'eC1', date: '2026-07-01', present: true }
        }),
        wipeLocal: jest.fn().mockResolvedValue({ ok: true, errors: [] }),
        persistState: jest.fn().mockResolvedValue(undefined),
        endWipe: jest.fn(),
        reload: jest.fn(),
        ...overrides
    };
}

testRunner.addSuite("DataOps — replaceLocalWithCloud (Fase 0.5, U4)", {

    async "flujo feliz: fetch → wipe → aplicar → persistir → reload, y reporta ok"() {
        const snap = snapshotState();
        const deps = makeDeps();
        try {
            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, true);
            testRunner.assertEquals(deps.wipeLocal.mock.calls.length, 1, 'debe borrar todo rastro local');
            testRunner.assertEquals(deps.persistState.mock.calls.length, 1, 'debe persistir el estado nuevo');
            testRunner.assertEquals(deps.reload.mock.calls.length, 1, 'debe recargar la página');
            testRunner.assertEquals(state.employees[0].id, 'eC1', 'los empleados deben ser los de la nube');
            testRunner.assertEquals(state.settings.businessName, 'Cloud SA', 'los settings deben ser los de la nube');
            testRunner.assert(!!state.attendance['eC1-2026-07-01'], 'la asistencia debe ser la de la nube');
        } finally { restoreState(snap); }
    },

    async "FETCH PRIMERO: si la nube no responde, NO se toca nada local (ni wipe ni persist)"() {
        const snap = snapshotState();
        const deps = makeDeps({ fetchFullState: jest.fn().mockRejectedValue(new Error('offline')) });
        try {
            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, false);
            testRunner.assertEquals(deps.wipeLocal.mock.calls.length, 0,
                'con la red caída NO debe borrarse nada — el usuario quedaría sin local Y sin nube');
            testRunner.assertEquals(deps.reload.mock.calls.length, 0, 'no debe recargar');
        } finally { restoreState(snap); }
    },

    async "sin datos en la nube (getFullState null) → aborta sin tocar nada"() {
        const snap = snapshotState();
        const deps = makeDeps({ fetchFullState: jest.fn().mockResolvedValue(null) });
        try {
            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, false);
            testRunner.assertEquals(result.reason, 'no-cloud-data');
            testRunner.assertEquals(deps.wipeLocal.mock.calls.length, 0);
        } finally { restoreState(snap); }
    },

    async "una lectura de entidades fallida (loadAll → null) ABORTA — en modo reemplazo null NO es lista vacía"() {
        // M1 invertido: en el flujo de FUSIÓN, null→[] conserva lo local (correcto).
        // En REEMPLAZO, tratar null como [] borraría la nómina local y la
        // reemplazaría por nada — pérdida total con la nube intacta pero ilegible.
        const snap = snapshotState();
        const deps = makeDeps({ loadEmployees: jest.fn().mockResolvedValue(null) });
        try {
            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, false);
            testRunner.assertEquals(deps.wipeLocal.mock.calls.length, 0,
                'no debe borrar lo local si no pudo leer las entidades de reemplazo');
        } finally { restoreState(snap); }
    },

    async "no contamina el state con metadata del doc espejo (updatedAt/lastDevice/lastChangedBy)"() {
        const snap = snapshotState();
        const deps = makeDeps();
        try {
            await replaceLocalWithCloud(deps);

            testRunner.assertEquals(state.updatedAt, undefined, 'updatedAt es metadata del doc, no estado');
            testRunner.assertEquals(state.lastDevice, undefined, 'lastDevice es metadata del doc, no estado');
            testRunner.assertEquals(state.lastChangedBy, undefined, 'lastChangedBy es metadata del doc, no estado');
        } finally { restoreState(snap); }
    },

    async "si el wipe o la persistencia fallan a MITAD, restaura el guardado normal (endWipe) y reporta el error"() {
        const snap = snapshotState();
        const deps = makeDeps({ persistState: jest.fn().mockRejectedValue(new Error('IDB caído')) });
        try {
            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, false);
            testRunner.assertEquals(deps.endWipe.mock.calls.length, 1,
                'debe liberar el guard de wipe — si no, la sesión queda muda (sin guardar) hasta el F5');
            testRunner.assertEquals(deps.reload.mock.calls.length, 0, 'no debe recargar sobre un estado a medias');
        } finally { restoreState(snap); }
    },

    async "cuenta legacy (schemaVersion < 2): entidades salen del doc espejo, sin tocar los repos per-doc"() {
        const snap = snapshotState();
        const deps = makeDeps({
            fetchFullState: jest.fn().mockResolvedValue({
                settings: { schemaVersion: 0 },
                employees: [{ id: 'eL1', name: 'Legacy Emp', positions: [] }],
                positions: [{ id: 'pL1', name: 'Legacy Pos' }],
                leaders: []
            })
        });
        try {
            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, true);
            testRunner.assertEquals(deps.loadEmployees.mock.calls.length, 0, 'cuenta legacy no lee subcolecciones');
            testRunner.assertEquals(state.employees[0].id, 'eL1', 'empleados inline del doc espejo');
        } finally { restoreState(snap); }
    }

});

testRunner.addSuite("app.js — App.Sync.downloadFromCloud delega en DataOps (U4)", {

    "el handler de Ajustes usa replaceLocalWithCloud, no el flujo viejo inline"() {
        const fs = require('fs');
        const path = require('path');
        const appSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

        const idx = appSource.indexOf('downloadFromCloud: async () =>');
        testRunner.assert(idx !== -1, 'debe existir App.Sync.downloadFromCloud');
        const block = appSource.slice(idx, idx + 1800);
        testRunner.assert(/replaceLocalWithCloud\s*\(/.test(block),
            'debe delegar en DataOps.replaceLocalWithCloud (purga outbox + fetch-first + sin metadata)');
        testRunner.assert(!/Object\.assign\(state,\s*cloudState\)/.test(block),
            'el Object.assign contaminante del flujo viejo no debe volver');
    }

});

console.log('🧪 DataOps replaceLocalWithCloud tests cargados.');
