/**
 * F3.5 — SA→Mini v1 controller: disciplina de copiado.
 *
 * El transporte es sólo portapapeles y la exportación es de sólo lectura:
 * - En éxito: UNA escritura al portapapeles con el envelope sa-roster/v1
 *   pretty-readable, notificación de éxito y registros intactos.
 * - En fallo (scope no resoluble o validación): CERO escrituras al
 *   portapapeles y notificación de error accionable.
 */

import { state } from '../modules/core/AppState.js';
import {
    showExportMenuHandler,
    closeExportMenuHandler,
    shareExportMiniV1,
    registerLegacyGlobals
} from '../modules/features/export/ExportController.js';
import {
    getEntityScope,
    ACTIVE_PROJECT_LS_KEY
} from '../modules/features/projects/ProjectContext.js';
import { DEFAULT_PROJECT_LS_KEY } from '../modules/features/projects/EntityProjectScope.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

jest.mock('../modules/core/RenderManager.js', () => ({ render: jest.fn() }));

const PRJ_DEFAULT = 'PRJ-DEFAULT-0000';
const PRJ_A = 'PRJ-A-000000';
const PRJ_B = 'PRJ-B-000000';

const PROJECTS = {
    [PRJ_DEFAULT]: { id: PRJ_DEFAULT, name: 'Mi obra', status: 'active', createdAt: 500, updatedAt: 500 },
    [PRJ_A]: { id: PRJ_A, name: 'Obra A', status: 'active', createdAt: 1000, updatedAt: 1000 },
    [PRJ_B]: { id: PRJ_B, name: 'Obra B', status: 'active', createdAt: 2000, updatedAt: 2000 }
};

function installProjectsMock() {
    indexedDBService.get.mockImplementation(async (_store, id) => PROJECTS[id] ?? null);
    indexedDBService.getAll.mockImplementation(async () => Object.values(PROJECTS));
    indexedDBService.update.mockResolvedValue(1);
}

async function primeScope(activeId) {
    if (activeId) localStorage.setItem(ACTIVE_PROJECT_LS_KEY, activeId);
    else localStorage.removeItem(ACTIVE_PROJECT_LS_KEY);
    return getEntityScope();
}

function seedRoster() {
    // Posición sellada al proyecto activo (PRJ_A): con scope capturado, una
    // posición sin sello pertenece al default (legacy-default) y referenciarla
    // desde A sería fuga entre proyectos (fail-closed).
    state.positions = [{ id: 'pos-1', name: 'Oficial Albañil', hourlyRate: 312.5, projectId: PRJ_A }];
    state.employees = [
        {
            id: 'e-1', number: '1', name: 'Ana García',
            positions: ['pos-1'], active: true, projectId: PRJ_A
        },
        {
            id: 'e-2', number: '2', name: 'Pedro B',
            positions: ['pos-1'], active: false, projectId: PRJ_B
        }
    ];
    state.settings = { ...(state.settings || {}), regularHoursPerDay: 8 };
}

let writeText;
let clipboardDescriptor;
let snap;

beforeEach(async () => {
    snap = JSON.parse(JSON.stringify({
        employees: state.employees,
        positions: state.positions,
        settings: state.settings
    }));
    snap.includeSalaryFlag = state.exportMiniV1IncludeSalary;
    snap.showExportMenu = state.showExportMenu;

    localStorage.clear();
    localStorage.setItem(DEFAULT_PROJECT_LS_KEY, PRJ_DEFAULT);
    setProjectsEnabled(false);
    await getEntityScope();
    installProjectsMock();

    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true
    });
    window.showNotification = jest.fn();
});

afterEach(() => {
    state.employees = snap.employees;
    state.positions = snap.positions;
    state.settings = snap.settings;
    state.exportMiniV1IncludeSalary = snap.includeSalaryFlag;
    state.showExportMenu = snap.showExportMenu;
    localStorage.clear();
    setProjectsEnabled(false);
    if (clipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    } else {
        delete navigator.clipboard;
    }
    delete window.showNotification;
    jest.clearAllMocks();
});

describe('SA→Mini v1 controller — disciplina de copiado', () => {
    test('éxito: una escritura al portapapeles con el envelope y registros intactos', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        seedRoster();
        const before = JSON.stringify({ employees: state.employees, positions: state.positions });

        await shareExportMiniV1();

        expect(writeText).toHaveBeenCalledTimes(1);
        const parsed = JSON.parse(writeText.mock.calls[0][0]);
        expect(parsed.schema).toBe('sa-roster/v1');
        expect(parsed.version).toBe(1);
        expect(parsed.saProjectId).toBe(PRJ_A);
        expect(parsed.employees).toHaveLength(1);
        expect(parsed.employees[0]).toMatchObject({
            saEmployeeId: 'e-1',
            number: '1',
            name: 'Ana García'
        });
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringContaining('MINI v1'),
            'success'
        );
        expect(JSON.stringify({ employees: state.employees, positions: state.positions })).toBe(before);
    });

    test('sueldo apagado por defecto; opt-in vía checkbox u opción lo incluye', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        seedRoster();

        await shareExportMiniV1();
        expect(JSON.parse(writeText.mock.calls[0][0]).employees[0]).not.toHaveProperty('sueldo');

        writeText.mockClear();
        state.exportMiniV1IncludeSalary = true;
        await shareExportMiniV1();
        expect(JSON.parse(writeText.mock.calls[0][0]).employees[0].sueldo).toBe('2500');

        writeText.mockClear();
        state.exportMiniV1IncludeSalary = false;
        await shareExportMiniV1({ includeSalary: true });
        expect(JSON.parse(writeText.mock.calls[0][0]).employees[0].sueldo).toBe('2500');
    });

    test('scope no resoluble (Proyectos OFF): no copia y avisa accionable', async () => {
        setProjectsEnabled(false);
        await getEntityScope();
        seedRoster();

        await shareExportMiniV1();

        expect(writeText).not.toHaveBeenCalled();
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringContaining('Proyectos'),
            'error'
        );
    });

    test('validación fallida (números duplicados): no copia nada', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        seedRoster();
        state.employees = [
            { id: 'e-1', number: '001', name: 'Ana', positions: [], active: true, projectId: PRJ_A },
            { id: 'e-2', number: '1', name: 'Luis', positions: [], active: true, projectId: PRJ_A }
        ];

        await shareExportMiniV1();

        expect(writeText).not.toHaveBeenCalled();
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringContaining('MINI v1'),
            'error'
        );
    });

    test('registra los globales del dispatcher sin romper los legacy', () => {
        registerLegacyGlobals();
        expect(typeof window.shareExportMiniV1).toBe('function');
        expect(typeof window.toggleMiniV1Salary).toBe('function');
        expect(typeof window.shareExportMini).toBe('function');
    });

    test('fuga entre proyectos: puesto de otro proyecto no copia nada', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        state.positions = [
            { id: 'pos-a', name: 'Oficial A', hourlyRate: 312.5, projectId: PRJ_A },
            { id: 'pos-b', name: 'Oficial B', hourlyRate: 999, projectId: PRJ_B }
        ];
        state.employees = [
            { id: 'e-1', number: '1', name: 'Ana', positions: ['pos-b'], active: true, projectId: PRJ_A }
        ];
        state.settings = { ...(state.settings || {}), regularHoursPerDay: 8 };

        await shareExportMiniV1({ includeSalary: true });

        expect(writeText).not.toHaveBeenCalled();
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringContaining('MINI v1'),
            'error'
        );
    });

    test('opt-in salarial se revoca al abrir y al cerrar: el siguiente export exige nuevo check', async () => {
        setProjectsEnabled(true);
        await primeScope(PRJ_A);
        seedRoster();

        // Export previo con check: incluye sueldo.
        state.exportMiniV1IncludeSalary = true;
        await shareExportMiniV1();
        expect(JSON.parse(writeText.mock.calls[0][0]).employees[0].sueldo).toBe('2500');
        // El propio export cierra el menú ⇒ revoca el opt-in.
        expect(state.exportMiniV1IncludeSalary).toBe(false);

        // Reabrir el menú no hereda el check previo.
        state.exportMiniV1IncludeSalary = true;
        showExportMenuHandler({ filename: 'x', blob: null, title: 't', text: '' });
        expect(state.exportMiniV1IncludeSalary).toBe(false);

        // Cerrar tampoco lo conserva.
        state.exportMiniV1IncludeSalary = true;
        closeExportMenuHandler();
        expect(state.exportMiniV1IncludeSalary).toBe(false);

        // El siguiente export sin nuevo check NO incluye sueldo.
        writeText.mockClear();
        await shareExportMiniV1();
        expect(writeText).toHaveBeenCalledTimes(1);
        expect(JSON.parse(writeText.mock.calls[0][0]).employees[0]).not.toHaveProperty('sueldo');
    });
});
