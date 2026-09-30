/** Notas y tarjetas de puestos/líderes muestran solo la obra activa. */
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { NotesCenter } from '../modules/features/notes/NotesCenter.js';
import { PositionCard } from '../modules/features/employees/PositionsList.js';
import { LeaderCard } from '../modules/features/employees/LeadersList.js';

const A = 'PRJ-obra-a-0001';
const B = 'PRJ-obra-b-0002';
let snapshot;
beforeEach(() => {
    snapshot = { employees: state.employees, positions: state.positions, leaders: state.leaders, attendance: state.attendance, showNotesCenter: state.showNotesCenter };
    setProjectsEnabled(true);
    replaceEntityScope({ enabled: true, projectId: A, defaultProjectId: A });
    state.leaders = [{ id: 'L', name: 'Jefe', active: true, projectId: A }];
    state.positions = [{ id: 'P', name: 'Albañil', active: true, leaderId: 'L', projectId: A, hourlyRate: 100 }];
    state.employees = [
        { id: 'ea', number: '1', name: 'Ana Obra A', active: true, positions: ['P'], projectId: A },
        { id: 'eb', number: '2', name: 'Beto Obra B', active: true, positions: ['P'], projectId: B }
    ];
    state.attendance = {
        'ea-2026-09-01': { employeeId: 'ea', date: '2026-09-01', notes: 'nota de A', projectId: A },
        'eb-2026-09-01': { employeeId: 'eb', date: '2026-09-01', notes: 'nota de B', projectId: B }
    };
});
afterEach(() => { Object.assign(state, snapshot); resetEntityScope(); setProjectsEnabled(false); });

test('el centro de notas solo lista la obra activa', () => {
    state.showNotesCenter = true;
    const html = NotesCenter();
    expect(html).toContain('Ana Obra A');
    expect(html).not.toContain('Beto Obra B');
});

test('la tarjeta de puesto cuenta solo empleados de la obra activa', () => {
    const html = PositionCard(state.positions[0]);
    expect(html).toContain('Ana Obra A');
    expect(html).not.toContain('Beto Obra B');
});

test('la tarjeta de líder muestra solo empleados de la obra activa', () => {
    const html = LeaderCard(state.leaders[0]);
    expect(html).toContain('Ana Obra A');
    expect(html).not.toContain('Beto Obra B');
});
