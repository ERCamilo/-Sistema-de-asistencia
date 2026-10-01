/**
 * Caja chica por obra: la lista sigue a la obra activa, sin esconder en
 * silencio las cajas de otras obras.
 */
import { filterCajasByObra, pickCajaForObra, cajaObraRelation } from '../modules/features/pettycash/PettyCashObraFilter.js';
import { PettyCashTab, registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';
import { OFFICIAL_LINK_KEY } from '../modules/features/pettycash/PettyCashOfficialLink.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

const caja = (id, obra) => (obra === undefined ? { id, name: `Caja ${id}` } : { id, name: `Caja ${id}`, [OFFICIAL_LINK_KEY]: obra });
const cajas = [caja('a1', 'OBRA-A'), caja('b1', 'OBRA-B'), caja('x1'), caja('a2', 'OBRA-A'), caja('z1', 'OBRA-BORRADA')];
const known = ['OBRA-A', 'OBRA-B'];

describe('filtro de cajas por obra', () => {
    test('relación: propia, de otra obra o sin obra (incluye obra inexistente)', () => {
        expect(cajaObraRelation(cajas[0], 'OBRA-A', known)).toBe('own');
        expect(cajaObraRelation(cajas[1], 'OBRA-A', known)).toBe('other');
        expect(cajaObraRelation(cajas[2], 'OBRA-A', known)).toBe('orphan');
        expect(cajaObraRelation(cajas[4], 'OBRA-A', known)).toBe('orphan');
    });

    test('con obra activa lista sus cajas y las sin obra, y cuenta las ocultas', () => {
        const view = filterCajasByObra(cajas, { obraId: 'OBRA-A', knownObraIds: known });
        expect(view.visible.map(item => item.id)).toEqual(['a1', 'x1', 'a2', 'z1']);
        expect(view).toMatchObject({ hiddenCount: 1, scoped: true });
    });

    test('"ver todas" y la caja seleccionada de otra obra siguen visibles', () => {
        expect(filterCajasByObra(cajas, { obraId: 'OBRA-A', knownObraIds: known, showAll: true }).visible).toHaveLength(5);
        expect(filterCajasByObra(cajas, { obraId: 'OBRA-A', knownObraIds: known, selectedId: 'b1' }).visible.map(item => item.id)).toContain('b1');
    });

    test('sin obra activa no filtra nada', () => {
        expect(filterCajasByObra(cajas, {})).toEqual({ visible: cajas, hiddenCount: 0, scoped: false });
    });

    test('al cambiar de obra elige su caja; conserva la actual si ya es de la obra', () => {
        expect(pickCajaForObra(cajas, 'a1', { obraId: 'OBRA-B', knownObraIds: known })).toBe('b1');
        expect(pickCajaForObra(cajas, 'a2', { obraId: 'OBRA-A', knownObraIds: known })).toBe('a2');
        expect(pickCajaForObra([caja('b1', 'OBRA-B'), caja('x1')], 'b1', { obraId: 'OBRA-A', knownObraIds: known })).toBe('x1');
        expect(pickCajaForObra([caja('b1', 'OBRA-B')], 'b1', { obraId: 'OBRA-A', knownObraIds: known })).toBeNull();
    });
});

describe('pantalla de caja chica con obra activa', () => {
    const seed = selectedProjectId => {
        state.pettyCash = {
            projects: [caja('a1', 'OBRA-A'), caja('b1', 'OBRA-B')],
            periods: [
                { id: 'pa', projectId: 'a1', label: 'Periodo A', status: 'abierta', openingDate: '2026-09-01' },
                { id: 'pb', projectId: 'b1', label: 'Periodo B', status: 'abierta', openingDate: '2026-09-01' }
            ],
            movements: [], selectedProjectId, selectedPeriodId: null,
            movementSortBy: 'recordNumber', movementSortDirection: 'desc', movementSearchQuery: '',
            receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
        };
    };

    beforeEach(() => {
        setProjectsEnabled(true);
        registerPettyCashGlobals();
        window.render = jest.fn();
    });

    afterEach(() => {
        state.pettyCash = null;
        resetEntityScope();
        setProjectsEnabled(false);
        delete window.render;
    });

    test('al entrar en la obra B pasa a su caja y ofrece ver las demás', () => {
        replaceEntityScope({ enabled: true, projectId: 'OBRA-B' });
        seed('a1');
        const html = PettyCashTab();
        expect(state.pettyCash.selectedProjectId).toBe('b1');
        expect(html).toContain('Periodo B');
        expect(html).not.toContain('>Caja a1<');
        expect(html).toContain('Ver cajas de todas las obras (1 más)');

        window.pcToggleAllObras();
        expect(PettyCashTab()).toContain('Caja a1 (');
    });

    test('obra sin caja: mensaje propio, sin perder las cajas de otras obras', () => {
        replaceEntityScope({ enabled: true, projectId: 'OBRA-C' });
        seed('a1');
        const html = PettyCashTab();
        expect(state.pettyCash.selectedProjectId).toBeNull();
        expect(html).toContain('Esta obra todavía no tiene caja chica');
        expect(html).toContain('Ver cajas de todas las obras (2 más)');
    });
});
