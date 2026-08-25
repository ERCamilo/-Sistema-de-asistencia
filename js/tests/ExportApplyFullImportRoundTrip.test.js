/**
 * Characterization: FULL import round trip through ExportController's public
 * surface. `applyFullImport` itself is private — the only public entry is
 * confirmImportFull(), which parses state.importFullText and hands the parsed
 * payload to window.showConfirm({ onConfirm }).
 */

import { state } from '../modules/core/AppState.js';
import { confirmImportFull, setImportFullText } from '../modules/features/export/ExportController.js';
import { flushPendingSave } from '../modules/services/PersistenceService.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fullImportPayload() {
    return {
        exportedAt: '2026-08-24T12:00:00.000Z',
        version: '1.0.0',
        data: {
            settings: { regularHoursPerDay: 9, syncEnabled: true },
            positions: [
                { id: 'pos-master', name: 'Albañil', active: true },
                { id: 'pos-dup', name: 'Albañil', active: true }, // duplicate by NAME → merged into master
                { name: 'Soldador', active: true }                // no id → gets one assigned
            ],
            employees: [
                { id: 'emp-live', number: '1', name: 'Vivo Núñez', positions: ['pos-master', 'pos-dup'], loans: [], active: true },
                { id: 'emp-gone', number: '2', name: 'Eliminado Gómez', positions: [], loans: [], active: false, deletedAt: 1724000000000 }
            ],
            leaders: [{ id: 'lead-1', number: '7', name: 'Marta López', active: true }],
            attendance: {
                'emp-live-2026-08-20': { employeeId: 'emp-live', date: '2026-08-20', present: true, hoursWorked: 8 },
                'emp-gone-2026-08-21': { employeeId: 'emp-gone', date: '2026-08-21', present: false, deletedAt: 1724100000000 }
            },
            tempAssignments: [], dayHoursConfig: {}
        }
    };
}

describe('ExportController FULL import round trip (applyFullImport via confirm flow)', () => {
    let snap;

    beforeEach(() => {
        snap = JSON.parse(JSON.stringify({
            employees: state.employees, positions: state.positions, leaders: state.leaders,
            attendance: state.attendance, settings: state.settings,
            isDataLoaded: state.isDataLoaded, useIndexedDB: state.useIndexedDB,
            showImportFullModal: state.showImportFullModal, importFullText: state.importFullText
        }));
        // saveApplicationData is gated on these flags (fresh registry boots unloaded).
        state.isDataLoaded = true;
        state.useIndexedDB = true;
        indexedDBService.saveState.mockClear();
    });

    afterEach(() => {
        delete window.showConfirm;
        Object.assign(state, snap);
    });

    test('restores every collection verbatim and sanitizes positions before saving', async () => {
        const payload = fullImportPayload();
        const confirmSpy = jest.fn();
        window.showConfirm = confirmSpy;

        setImportFullText(JSON.stringify(payload));
        confirmImportFull();

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        const opts = confirmSpy.mock.calls[0][0];
        expect(opts.title).toBe('Importar datos FULL');
        expect(opts.message).toContain('Se encontraron 2 empleados');

        const beforeApply = Date.now();
        opts.onConfirm(); // → applyFullImport(importedData)

        // Collections are restored RAW (no class inflation on import), so the
        // tombstoned employee keeps deletedAt exactly as exported.
        // Quirk pinned: an employee whose position references were remapped by
        // the sanitizer is NOT verbatim — it loses the merged duplicate id and gets fresh stamps.
        expect(state.employees[1]).toEqual(payload.data.employees[1]);
        const liveEmp = state.employees[0];
        expect(liveEmp.id).toBe('emp-live');
        expect(liveEmp.name).toBe('Vivo Núñez');
        expect(liveEmp.positions).toEqual(['pos-master']);
        expect(liveEmp.updatedAt).toBeGreaterThanOrEqual(beforeApply);
        expect(liveEmp.positionsUpdatedAt).toBeGreaterThanOrEqual(beforeApply);
        expect(state.leaders).toEqual(payload.data.leaders);
        expect(state.attendance).toEqual(payload.data.attendance);
        expect(Object.keys(state.attendance).sort())
            .toEqual(['emp-gone-2026-08-21', 'emp-live-2026-08-20']);
        expect(state.settings.regularHoursPerDay).toBe(9);

        // Positions get sanitized as-is: duplicate-by-name merges onto the
        // master id and the id-less position receives a fresh id.
        expect(state.positions.map(p => p.name).sort()).toEqual(['Albañil', 'Soldador']);
        expect(state.positions.find(p => p.id === 'pos-master').name).toBe('Albañil');
        const soldador = state.positions.find(p => p.name === 'Soldador');
        expect(typeof soldador.id).toBe('string');
        expect(soldador.id.length).toBeGreaterThan(0);

        // Modal flow closes cleanly after applying.
        expect(state.showImportFullModal).toBe(false);
        expect(state.importFullText).toBe('');

        // Persistence stays on the mocked IndexedDB service — never real storage.
        expect(flushPendingSave()).toBe(true);
        await sleep(10);
        expect(indexedDBService.saveState).toHaveBeenCalled();
    });
});
