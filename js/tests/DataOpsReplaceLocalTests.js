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

    async "si la persistencia falla DESPUÉS del wipe, recarga igual — la recarga ES la recuperación (JD-F3, CRÍTICO)"() {
        // Contrato viejo (equivocado): reportaba el error SIN recargar. Pero en
        // ese punto lo local ya está borrado y la persistencia falló: si el
        // usuario cerraba la pestaña (reacción natural ante un toast de error),
        // perdía todo. La recarga con local vacío + sesión activa dispara la
        // re-adopción normal de la nube — ese es el camino de recuperación.
        const snap = snapshotState();
        const deps = makeDeps({ persistState: jest.fn().mockRejectedValue(new Error('IDB caído')) });
        try {
            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, false);
            testRunner.assertEquals(result.reason, 'apply-failed');
            testRunner.assertEquals(deps.endWipe.mock.calls.length, 1,
                'libera el guard antes de recargar (inofensivo, y protege entornos donde reload es no-op)');
            testRunner.assertEquals(deps.reload.mock.calls.length, 1,
                'DEBE recargar: quedarse en una sesión con local borrado y sin persistir es la peor opción');
        } finally { restoreState(snap); }
    },

    async "la persistencia por defecto usa clearFirst:true — un wipe parcial no degrada el reemplazo a merge (JD-F7)"() {
        // wipeAllLocalTraces es best-effort: si su clearAll de IndexedDB falla,
        // el flujo continúa. saveState SIN clearFirst hace put() (upsert) y
        // nunca borra registros ausentes — empleados/asistencia viejos
        // sobrevivirían mezclados con el dataset de la nube tras el reload.
        const snap = snapshotState();
        const deps = makeDeps();
        delete deps.persistState; // usar el default real
        const idb = require('../modules/services/IndexedDBService.js').default;
        try {
            idb.saveState.mockClear();

            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, true);
            testRunner.assert(idb.saveState.mock.calls.length >= 1, 'el default debe persistir vía saveState');
            testRunner.assertEquals(idb.saveState.mock.calls[0][1]?.clearFirst, true,
                'debe escribir con clearFirst:true — reemplazo real aunque el wipe previo haya fallado');
        } finally { restoreState(snap); }
    },

    async "si el wipe no pudo purgar el outbox por NINGUNA de sus dos vías, ABORTA antes de aplicar (JD-F10)"() {
        // Doble red: la purga explícita (purge-pending-cloud-writes) y el
        // clearAll de IndexedDB (que también vacía mainSyncOutbox). Si AMBAS
        // fallaron, el outbox quedó vivo con entradas pre-descarga — continuar
        // significaría que el drenado del login siguiente pise la nube recién
        // adoptada (el bug ALTA #1 de vuelta). Abortar acá es seguro: el state
        // en memoria aún no se tocó y endWipe reactiva el guardado normal.
        const snap = snapshotState();
        const deps = makeDeps({
            wipeLocal: jest.fn().mockResolvedValue({
                ok: false,
                errors: [{ step: 'purge-pending-cloud-writes', error: 'x' }, { step: 'clear-indexeddb', error: 'y' }]
            })
        });
        try {
            const result = await replaceLocalWithCloud(deps);

            testRunner.assertEquals(result.ok, false);
            testRunner.assertEquals(result.reason, 'wipe-failed');
            testRunner.assertEquals(deps.persistState.mock.calls.length, 0, 'no debe aplicar nada');
            testRunner.assertEquals(deps.reload.mock.calls.length, 0, 'sin reload: el state en memoria sigue intacto');
            testRunner.assertEquals(deps.endWipe.mock.calls.length, 1, 'debe reactivar el guardado normal');
        } finally { restoreState(snap); }
    },

    async "un fallo de UNA sola vía de purga NO aborta (la otra vía cubrió el outbox) — control de JD-F10"() {
        const snap = snapshotState();
        const deps = makeDeps({
            wipeLocal: jest.fn().mockResolvedValue({
                ok: false,
                errors: [{ step: 'purge-pending-cloud-writes', error: 'x' }]
            })
        });
        try {
            const result = await replaceLocalWithCloud(deps);
            testRunner.assertEquals(result.ok, true,
                'con clear-indexeddb exitoso el outbox quedó vacío igual — continuar es seguro');
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
