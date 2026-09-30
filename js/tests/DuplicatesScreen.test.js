/**
 * Pantalla «Duplicados»: una sola pantalla para unir, cambiar ficha, eliminar
 * y marcar «no son duplicados», con el mismo servicio de fusión que deja la
 * lápida `mergedIntoId` en la nube.
 */
import indexedDBService from '../modules/services/IndexedDBService.js';
import { state } from '../modules/core/AppState.js';
import * as persistence from '../modules/services/PersistenceService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';
import { applyDuplicateGroupPlan } from '../modules/features/employees/EmployeeDuplicateService.js';
import { buildDuplicateGroups, planGroupDecisions, DUPLICATE_ROLES as R } from '../modules/features/employees/DuplicateGroups.js';
import { DuplicatesScreen, renderDuplicatesView } from '../modules/ui/DuplicatesScreen.js';
import { EMPLOYEE_MERGE_REGISTRY_KEY } from '../modules/features/employees/EmployeeMergeRegistry.js';

let enqueued, snapshot;
beforeEach(() => {
    snapshot = { employees: state.employees, attendance: state.attendance };
    localStorage.clear();
    enqueued = [];
    jest.spyOn(MainSyncStore, 'enqueueDelete').mockImplementation(async (entity, id, v, opts = {}) => { enqueued.push({ id, ...opts }); });
    jest.spyOn(persistence, 'saveApplicationData').mockResolvedValue(undefined);
    indexedDBService.delete.mockClear();
    state.employees = [
        { id: 'e31', number: '031', name: 'Wilmer Exilien', projectId: 'PA', loans: [], updatedAt: 5 },
        { id: 'e4', number: '004', name: 'Wilmer Exilien', projectId: 'PA', loans: [{ id: 'L2', principal: 50 }], updatedAt: 1 },
        { id: 'e10', number: '010', name: 'Ana Ruiz', projectId: 'PA', loans: [], updatedAt: 1 },
        { id: 'e11', number: '010', name: 'Luis Mora', projectId: 'PA', loans: [], updatedAt: 1 }
    ];
    state.attendance = {
        'e31-2026-09-01': { employeeId: 'e31', date: '2026-09-01', present: true },
        'e31-2026-09-02': { employeeId: 'e31', date: '2026-09-02', present: true },
        'e4-2026-09-03': { employeeId: 'e4', date: '2026-09-03', present: true },
        'e10-2026-09-01': { employeeId: 'e10', date: '2026-09-01', present: true }
    };
});
afterEach(() => {
    state.employees = snapshot.employees;
    state.attendance = snapshot.attendance;
    document.body.innerHTML = '';
    jest.restoreAllMocks();
});

describe('applyDuplicateGroupPlan', () => {
    test('unir: la copia deja lápida con el id del empleado conservado y pasa su asistencia y préstamos', () => {
        const group = buildDuplicateGroups({ employees: state.employees, attendance: state.attendance })
            .find(g => g.reason === 'name');
        const plan = planGroupDecisions(group, group.decisions, { employees: state.employees });
        const result = applyDuplicateGroupPlan(group, plan);
        expect(result).toMatchObject({ merged: 1, renumbered: 0, deleted: 0 });
        expect(state.employees.find(e => e.id === 'e4')).toBeUndefined();
        expect(state.employees.find(e => e.id === 'e31').loans.map(l => l.id)).toEqual(['L2']);
        expect(state.attendance['e31-2026-09-03']).toMatchObject({ employeeId: 'e31' });
        expect(enqueued).toEqual([expect.objectContaining({ id: 'e4', mergedIntoId: 'e31' })]);
    });

    test('otra persona: cambia la ficha sin fusionar; una copia solo en la nube se trae antes', () => {
        const cloudOnly = { id: 'c1', number: '010', name: 'Pedro Díaz', projectId: 'PA', loans: [] };
        const group = buildDuplicateGroups({ employees: state.employees, cloudEmployees: [cloudOnly], attendance: state.attendance })
            .find(g => g.members.some(m => m.id === 'c1'));
        const decisions = { e10: { role: R.KEEP }, e11: { role: R.OTHER, number: '040' }, c1: { role: R.OTHER, number: '041' } };
        const plan = planGroupDecisions(group, decisions, { employees: state.employees });
        expect(plan.ok).toBe(true);
        expect(applyDuplicateGroupPlan(group, plan)).toMatchObject({ renumbered: 2, merged: 0 });
        expect(state.employees.find(e => e.id === 'e11').number).toBe('040');
        expect(state.employees.find(e => e.id === 'c1').number).toBe('041');
        expect(enqueued).toEqual([]);
    });

    test('eliminar: lápida sin fusión', () => {
        const group = buildDuplicateGroups({ employees: state.employees }).find(g => g.reason === 'number');
        const plan = planGroupDecisions(group, { e10: { role: R.KEEP }, e11: { role: R.DELETE } }, { employees: state.employees });
        expect(applyDuplicateGroupPlan(group, plan)).toMatchObject({ deleted: 1 });
        expect(state.employees.some(e => e.id === 'e11')).toBe(false);
        expect(enqueued).toEqual([expect.objectContaining({ id: 'e11' })]);
        expect(enqueued[0].mergedIntoId).toBeFalsy();
    });
});

function makeScreen(overrides = {}) {
    const deps = {
        peekScope: () => ({ enabled: true, defaultProjectId: 'PA' }),
        listProjects: async () => [{ id: 'PA', name: 'Torre Norte' }],
        canReadCloud: () => false,
        createSnapshot: jest.fn(async () => {}),
        applyPlan: jest.fn(applyDuplicateGroupPlan),
        persist: jest.fn(async () => {}),
        ...overrides
    };
    return { screen: new DuplicatesScreen(deps), deps };
}
const click = selector => document.querySelector(selector).click();

describe('DuplicatesScreen', () => {
    test('lista los grupos, une los seguros con un botón y guarda una vez', async () => {
        state.employees.push({ id: 'e12', number: '012', name: 'Rosa Paz', projectId: 'PA', loans: [] },
            { id: 'e13', number: '012', name: 'Rosa Paz', projectId: 'PA', loans: [] });
        const { screen, deps } = makeScreen();
        await screen.open();
        expect(document.querySelectorAll('.dup-row')).toHaveLength(3);
        expect(document.querySelector('[data-dup-action="merge-safe"]').textContent).toMatch(/Unir 1 seguro/);
        click('[data-dup-action="merge-safe"]');
        await new Promise(r => setTimeout(r, 0));
        expect(deps.createSnapshot).toHaveBeenCalledTimes(1);
        expect(deps.persist).toHaveBeenCalledTimes(1);
        expect(state.employees.filter(e => e.number === '012')).toHaveLength(1);
        expect(document.querySelectorAll('.dup-row.is-resolved')).toHaveLength(1);
    });

    test('grupo: el botón Aplicar se habilita solo cuando todo está decidido y la ficha es libre', async () => {
        const { screen, deps } = makeScreen();
        await screen.open();
        const row = [...document.querySelectorAll('.dup-row')].find(el => el.textContent.includes('Luis Mora'));
        row.click();
        const apply = () => document.querySelector('[data-dup-action="apply-group"]');
        expect(apply().disabled).toBe(true);
        expect(document.querySelector('.dup-hint').textContent).toMatch(/Luis Mora/);
        click('[data-dup-action="set-role"][data-id="e11"][data-role="other"]');
        const input = document.querySelector('[data-dup-number="e11"]');
        expect(input.value).toBe('032');
        expect(apply().disabled).toBe(false);
        input.value = '031';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(apply().disabled).toBe(true);
        expect(document.querySelector('.dup-hint').textContent).toMatch(/ya es de Wilmer/);
        const again = document.querySelector('[data-dup-number="e11"]');
        again.value = '050';
        again.dispatchEvent(new Event('input', { bubbles: true }));
        apply().click();
        await new Promise(r => setTimeout(r, 0));
        expect(deps.persist).toHaveBeenCalled();
        expect(state.employees.find(e => e.id === 'e11').number).toBe('050');
    });

    test('si la copia de seguridad falla no cambia nada y lo dice', async () => {
        const { screen, deps } = makeScreen({ createSnapshot: jest.fn(async () => { throw new Error('offline'); }) });
        await screen.open();
        const before = state.employees.length;
        [...document.querySelectorAll('.dup-row')].find(el => el.textContent.includes('Wilmer')).click();
        click('[data-dup-action="apply-group"]');
        await new Promise(r => setTimeout(r, 0));
        expect(deps.applyPlan).not.toHaveBeenCalled();
        expect(state.employees).toHaveLength(before);
        expect(document.querySelector('.dup-notice.is-bad').textContent).toMatch(/copia de seguridad/);
    });

    test('«No son duplicados» oculta el grupo de nombre en adelante', async () => {
        const { screen } = makeScreen();
        await screen.open();
        [...document.querySelectorAll('.dup-row')].find(el => el.textContent.includes('Wilmer')).click();
        click('[data-dup-action="dismiss-group"]');
        screen.close();
        const { screen: second } = makeScreen();
        await second.open();
        expect([...document.querySelectorAll('.dup-row')].some(el => el.textContent.includes('Wilmer'))).toBe(false);
    });

    test('sin duplicados muestra el estado vacío', async () => {
        state.employees = [state.employees[0]];
        const { screen } = makeScreen();
        await screen.open();
        expect(document.querySelector('.dup-h1').textContent).toBe('No hay duplicados');
    });

    test('escapa nombres y fichas', () => {
        const html = renderDuplicatesView({
            step: 'list', resolved: {}, totals: {},
            groups: buildDuplicateGroups({ employees: [
                { id: 'x1', number: '<b>1', name: '<img src=x onerror=alert(1)> Uno' },
                { id: 'x2', number: '<b>1', name: '<img src=x onerror=alert(1)> Uno' }
            ] })
        });
        expect(html).not.toMatch(/<img|<b>/);
    });
});
