import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';
import { parseMiniAttendanceReport } from '../modules/features/attendance/MiniAttendanceParser.js';
import { createMiniAttendanceDraft, confirmMiniAttendanceDraftDate } from '../modules/features/attendance/MiniAttendanceDraft.js';
import { buildMiniAttendanceReviewViewModel } from '../modules/ui/MiniAttendanceReviewViewModel.js';
import { textRowLocalId } from '../modules/features/attendance/MiniAttendanceEmployeeProposal.js';
import { eventBus } from '../modules/core/Events.js';
import { state, stateManager } from '../modules/core/AppState.js';

// Pasted WhatsApp text: ficha, nombre y horas; el puesto solo viaja si la persona tiene varios.
const TEXT = '*Asistencia de hoy martes, 20 de octubre*\n_Última actualización: 8:30 p. m._\n\n7. Pedro Nuevo  *8h*\n8. Luis Gómez  *9h* _Plomero_\n';
const scope = { enabled: true, projectId: 'P-1', defaultProjectId: 'P-1' };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let controller, oldEmployees, oldPositions;
beforeEach(() => { oldEmployees = state.employees; oldPositions = state.positions; });
afterEach(() => { controller?.close(); stateManager.setState({ employees: oldEmployees, positions: oldPositions }); document.body.innerHTML = ''; delete window.showNotification; });

function pasted(employees = []) {
    controller = new MiniAttendanceImportModal({ employees, positions: [], saProjectId: 'P-1', attendance: {} });
    controller.render = jest.fn();
    controller.open();
    controller.draft = confirmMiniAttendanceDraftDate(
        createMiniAttendanceDraft({ parsed: parseMiniAttendanceReport(TEXT), employees, proposedDate: '2026-10-20' }), '2026-10-20');
    controller.rebuildConflictPlan();
    return controller;
}
const units = modal => buildMiniAttendanceReviewViewModel({
    draft: modal.draft, conflictPlan: modal.conflictPlan, employees: modal.employees, positions: modal.positions }).items;
const createButton = (modal, unit) => modal.renderReviewUnit(unit).querySelector('[data-mini-action="create-from-text"]');

test('una fila de texto sin coincidencia ofrece crear o vincular, y anuncia cuántas hay', () => {
    const modal = pasted();
    const button = createButton(modal, units(modal)[0]);
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('2');
});

test('una fila que ya coincide con un empleado de SA no ofrece crear', () => {
    const modal = pasted([{ id: 'EMP-7', number: '7', name: 'Pedro Nuevo', active: true, positions: [], projectId: 'P-1' }]);
    const matched = units(modal).find(unit => unit.occurrences[0].number === '7');
    expect(createButton(modal, matched)).toBeNull();
});

test('el clic guarda una propuesta local con ficha, nombre y puesto del texto, sin sueldo, y abre la revisión', async () => {
    const modal = pasted();
    const stage = jest.fn(async (proposal, options) => ({ id: 'entry-1', peerId: options.peerId, peerName: options.peerName, payload: proposal, status: 'pending', mappings: [], local: true }));
    const openReview = jest.fn();
    modal.employeeIntakeDeps = { store: { stage }, resolveScope: async () => scope, openReview };
    createButton(modal, units(modal)[0]).click();
    await flush();
    expect(stage).toHaveBeenCalledTimes(1);
    const [proposal, options] = stage.mock.calls[0];
    expect(proposal.employees).toEqual([
        { miniLocalId: textRowLocalId('7', 'Pedro Nuevo'), number: '7', name: 'Pedro Nuevo', position: '', dailySalary: null, phone: '', email: '' },
        { miniLocalId: textRowLocalId('8', 'Luis Gómez'), number: '8', name: 'Luis Gómez', position: 'Plomero', dailySalary: null, phone: '', email: '' }
    ]);
    expect(options).toMatchObject({ peerId: 'attendance:texto', local: true, scope });
    expect(openReview).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1' }), expect.anything());
    expect(state.employees).toBe(oldEmployees);
});

test('al aceptar, las filas del texto quedan vinculadas al empleado, pero las horas siguen por confirmar', async () => {
    const modal = pasted();
    stateManager.setState({
        employees: [
            { id: 'EMP-7', number: '7', name: 'Pedro Nuevo', active: true, positions: [], projectId: 'P-1' },
            { id: 'EMP-8', number: '8', name: 'Luis Gómez', active: true, positions: [], projectId: 'P-1' }
        ], positions: []
    });
    eventBus.emit('mini-employee-intake:accepted', {
        peerId: 'attendance:texto', saProjectId: 'P-1',
        mappings: [{ miniLocalId: textRowLocalId('7', 'Pedro Nuevo'), saEmployeeId: 'EMP-7' }]
    });
    await flush();
    const [pedro, luis] = modal.draft.rows;
    expect(pedro.match).toMatchObject({ status: 'confirmed', employeeId: 'EMP-7' });
    expect(pedro.reviewed).toBe(true);
    expect(pedro.approved).toBe(false);
    expect(luis.match.status).toBe('unmatched');
    expect(modal.draft.employeeOptions.map(option => option.employeeId)).toContain('EMP-7');
    expect(modal.render).toHaveBeenCalled();
});

test('un aviso de otra obra o de un Mini conectado no toca las filas del texto', async () => {
    const modal = pasted();
    stateManager.setState({ employees: [{ id: 'EMP-7', number: '7', name: 'Pedro Nuevo', active: true, positions: [], projectId: 'P-1' }], positions: [] });
    const mappings = [{ miniLocalId: textRowLocalId('7', 'Pedro Nuevo'), saEmployeeId: 'EMP-7' }];
    eventBus.emit('mini-employee-intake:accepted', { peerId: 'attendance:texto', saProjectId: 'OTRA', mappings });
    eventBus.emit('mini-employee-intake:accepted', { peerId: 'peer-1', saProjectId: 'P-1', mappings });
    await flush();
    expect(modal.draft.rows[0].match.status).toBe('unmatched');
});

test('sin obra seleccionada no se ofrece crear y la pantalla se pinta igual', () => {
    const modal = pasted();
    modal.saProjectId = '';
    const unit = units(modal)[0];
    expect(() => modal.renderReviewUnit(unit)).not.toThrow();
    expect(createButton(modal, unit)).toBeNull();
});
