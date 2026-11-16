import {
    findMissingPositionReferences
} from '../modules/features/projects/MissingPositionRepair.js';
import {
    initialPositionRepairState,
    renderMissingPositionsNotice,
    renderPositionRepairPanel,
    runPositionRepair,
    runPositionRepairUndo,
    readPositionRepairUndo,
    POSITION_REPAIR_UNDO_KEY
} from '../modules/features/projects/MissingPositionRepairUI.js';

const OBRA = 'PRJ-1';
function appState() {
    return {
        positions: [{ id: 'varillero', name: 'Varillero', hourlyRate: 100 }, { id: 'plomero', name: 'Plomero', hourlyRate: 50 }],
        employees: [
            { id: 'e1', number: '1', name: 'Ana', projectId: OBRA, positions: ['old-var'], positionSalaries: { 'old-var': 120 } },
            { id: 'e2', number: '2', name: 'Beto <b>', projectId: OBRA, positions: ['old-var'] },
            { id: 'e3', number: '3', name: 'Caro', projectId: OBRA, positions: ['old-x'] }
        ],
        attendance: {
            'e2-2026-11-02': { employeeId: 'e2', date: '2026-11-02', positionHours: [{ positionId: 'old-var', hours: 8 }],
                positionAssignments: { 'old-var': { schemaVersion: 1, positionId: 'old-var', positionName: 'Varillero' } } }
        }
    };
}
function memoryStorage() {
    const data = {};
    return { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; }, data };
}

test('el aviso cuenta puestos y empleados afectados', () => {
    const missing = findMissingPositionReferences(appState(), { defaultProjectId: OBRA });
    const html = renderMissingPositionsNotice(missing);
    expect(html).toContain('2 puestos no encontrados');
    expect(html).toContain('3 empleados apuntan');
    expect(html).toContain('data-r07-action="open-position-repair"');
    expect(renderMissingPositionsNotice([])).toBe('');
});

test('el panel preselecciona el puesto sugerido, pide salario a quien no lo tiene y escapa los nombres', () => {
    const state = appState();
    const missing = findMissingPositionReferences(state, { defaultProjectId: OBRA });
    const repairState = initialPositionRepairState(missing, state.positions, { defaultProjectId: OBRA });
    expect(repairState.decisions).toEqual({ 'old-var': 'varillero', 'old-x': '' });
    const html = renderPositionRepairPanel({ missingPositions: missing, positions: state.positions, appState: state,
        defaultProjectId: OBRA, hoursPerDay: 8, repairState });
    expect(html).toMatch(/<option value="varillero" selected>/);
    expect(html).toContain('1 empleado no tiene salario propio');
    expect(html).toContain('data-employee-id="e2"');
    expect(html).toContain('Beto &lt;b&gt;');
    expect(html).not.toContain('Beto <b>');
    expect(html).toContain('Nombre desconocido');
    expect(html).toContain('Buscar nombres en respaldos');
    expect(html).toContain('Reparar 1 puesto');
});

test('si el respaldo previo falla no se cambia nada', async () => {
    const state = appState();
    const missing = findMissingPositionReferences(state, { defaultProjectId: OBRA });
    const repairState = initialPositionRepairState(missing, state.positions, { defaultProjectId: OBRA });
    const save = jest.fn();
    const result = await runPositionRepair({ state, repairState, createSnapshot: async () => { throw new Error('offline'); },
        save, storage: memoryStorage() });
    expect(result.ok).toBe(false);
    expect(state.employees[0].positions).toEqual(['old-var']);
    expect(save).not.toHaveBeenCalled();
});

test('repara, guarda con las fechas tocadas, deja datos para deshacer y deshacer revierte', async () => {
    const state = appState();
    const storage = memoryStorage();
    const missing = findMissingPositionReferences(state, { defaultProjectId: OBRA });
    const repairState = initialPositionRepairState(missing, state.positions, { defaultProjectId: OBRA });
    repairState.salaries = { 'old-var': { e2: '800' } };
    const save = jest.fn();
    const createSnapshot = jest.fn(async () => 'snap');
    const rebuildIndex = jest.fn();
    const result = await runPositionRepair({ state, repairState, hoursPerDay: 8, createSnapshot, save, storage, rebuildIndex, now: 10 });
    expect(result.ok).toBe(true);
    expect(createSnapshot).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ dateKeys: ['2026-11-02'], immediate: true });
    expect(rebuildIndex).toHaveBeenCalled();
    expect(state.employees[1]).toMatchObject({ positions: ['varillero'], positionSalaries: { varillero: 100 }, positionSalaryModes: { varillero: 'daily' } });
    expect(state.employees[2].positions).toEqual(['old-x']); // sin decisión: intacto
    expect(readPositionRepairUndo(storage)).toMatchObject({ version: 1, at: 10 });

    const undone = await runPositionRepairUndo({ state, save, storage, now: 20 });
    expect(undone.ok).toBe(true);
    expect(state.employees[1].positions).toEqual(['old-var']);
    expect(state.employees[1].positionSalaries).toBeUndefined();
    expect(storage.getItem(POSITION_REPAIR_UNDO_KEY)).toBeNull();
    expect((await runPositionRepairUndo({ state, save, storage })).ok).toBe(false);
});

test('Multiobra cuenta los puestos no encontrados como pendientes de revisión', async () => {
    const { buildLocalReconciliationViewModel } = await import('../modules/features/projects/ProjectReconciliationUI.js');
    const state = appState();
    state.employees.forEach(employee => { employee.projectId = OBRA; });
    const model = buildLocalReconciliationViewModel(state, {
        enabled: true, defaultProjectId: OBRA, projects: [{ id: OBRA, name: 'Obra 1', status: 'active' }]
    });
    expect(model.missingPositions.map(item => item.positionId)).toEqual(['old-var', 'old-x']);
    expect(model.totalPendingCount).toBeGreaterThanOrEqual(2);
});
