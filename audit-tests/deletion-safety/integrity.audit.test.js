import { state, stateManager } from '../../js/modules/core/AppState.js';
import { validateDataIntegrity } from '../../js/modules/services/PersistenceService.js';
import { setProjectsEnabled } from '../../js/modules/config/FeatureFlags.js';

beforeEach(() => {
    localStorage.clear();setProjectsEnabled(false);
    stateManager.setState({
        employees: [{ id: 'e', name: 'Ficticio', positions: ['known'], loans: [], advances: [], bonuses: [], deductions: [] }],
        positions: [{ id: 'known', name: 'Puesto disponible', leaderId: null }], leaders: [],
        attendance: {}, settings: { ...state.settings, schemaVersion: 4 }
    }, { silent: true });
});

test('[INTEGRIDAD] una referencia aislada a un puesto faltante no se elimina sin evidencia de borrado', async () => {
    stateManager.batchSetState(raw => { raw.employees[0].positions = ['known', 'missing']; });
    await validateDataIntegrity();
    expect(state.employees[0].positions).toEqual(['known', 'missing']);
});

test('[INTEGRIDAD] reparar un catálogo incompleto no retira horas del puesto ausente', async () => {
    stateManager.batchSetState(raw => {
        raw.attendance = { 'e-2026-11-01': { employeeId: 'e', date: '2026-11-01', present: true,
            selectedPosition: 'known', hoursWorked: 8, updatedAt: 100,
            positionHours: [{ positionId: 'known', hours: 4 }, { positionId: 'missing', hours: 4 }] } };
    });
    await validateDataIntegrity();
    expect(state.attendance['e-2026-11-01'].positionHours).toEqual([
        { positionId: 'known', hours: 4 }, { positionId: 'missing', hours: 4 }
    ]);
});
