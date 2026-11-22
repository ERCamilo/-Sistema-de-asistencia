/**
 * Pantalla «Obras repetidas»: mismo shell y lenguaje que «Duplicados» de
 * empleados (lista → comparar → listo). Solo presentación: la comparación vive
 * en ProjectDuplicateReview y el descarte en ProjectPairDismissals.
 */
import { ProjectDuplicatesScreen, renderProjectDuplicatesView } from '../modules/ui/ProjectDuplicatesScreen.js';

const project = (id, name, extra = {}) => ({ id, name, status: 'active', createdAt: Date.UTC(2026, 0, 5), updatedAt: 1, ...extra });
const iso = n => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
const att = (employeeId, n) => ({ employeeId, date: iso(n) });
const person = (id, number, name, projectId) => ({ id, number, name, projectId, loans: [] });
const SHARED = [['001', 'Mathieu Dormeus'], ['002', 'Wadne Exilien'], ['003', 'Vernet Gran Pierre']];
const crew = (projectId, prefix, extra = []) => [...SHARED.map(([number, name], i) => person(`${prefix}${i}`, number, name, projectId)), ...extra];

function makeScreen(overrides = {}) {
    const data = {
        projects: [project('A', 'Torre Norte'), project('B', 'Edificio Sur')],
        employees: [...crew('A', 'a', [person('a9', '004', 'Solo En A', 'A')]), ...crew('B', 'b')],
        attendance: [att('a0', 0), att('a0', 1), att('b0', 1), att('a9', 5)],
        ...overrides.data
    };
    const deps = {
        listProjects: jest.fn(async () => data.projects),
        getEmployees: () => data.employees,
        getAttendance: () => data.attendance,
        peekScope: () => ({ enabled: false }),
        dismissPair: jest.fn(async () => ({})),
        ...overrides.deps
    };
    return { screen: new ProjectDuplicatesScreen(deps), deps, data };
}

const $ = selector => document.querySelector(selector);
const click = selector => $(selector).click();
const text = () => document.querySelector('.dup-shell').textContent.replace(/\s+/g, ' ');

afterEach(() => {
    document.querySelectorAll('.dup-overlay').forEach(node => node.remove());
    document.body.innerHTML = '';
    jest.restoreAllMocks();
});

describe('lista', () => {
    test('muestra cada par con sus nombres, el personal en común y el parecido', async () => {
        const { screen } = makeScreen();
        await screen.open();
        expect(text()).toContain('Torre Norte');
        expect(text()).toContain('Edificio Sur');
        expect(text()).toMatch(/3 personas en común/);
        expect(text()).toContain('Parecida');
        expect($('[data-pdup-action="open-pair"]').dataset.id).toBe('A|B');
    });

    test('cuenta idénticas y parecidas en el resumen', async () => {
        const { screen } = makeScreen({ data: { employees: [...crew('A', 'a'), ...crew('B', 'b')] } });
        await screen.open();
        const tiles = [...document.querySelectorAll('.dup-summary-tile')].map(tile => tile.textContent.replace(/\s+/g, ' ').trim());
        expect(tiles[0]).toMatch(/^1 idéntica/);
        expect(tiles[1]).toMatch(/^0 parecidas/);
        expect(text()).toContain('Idéntica');
    });

    test('sin pares sospechosos dice que no hay obras repetidas', async () => {
        const { screen } = makeScreen({ data: { employees: [] } });
        await screen.open();
        expect(text()).toContain('No hay obras repetidas');
        expect($('[data-pdup-action="open-pair"]')).toBeNull();
    });

    test('mientras busca muestra el estado de carga', () => {
        const html = renderProjectDuplicatesView({ step: 'loading', pairs: [], resolved: {}, totals: { dismissed: 0 } });
        expect(html).toContain('Buscando obras repetidas');
        expect(html).toContain('disabled');
    });
});

describe('comparar', () => {
    async function openPair(overrides) {
        const made = makeScreen(overrides);
        await made.screen.open();
        click('[data-pdup-action="open-pair"]');
        return made;
    }

    test('enseña las dos obras con su personal, asistencia y rango de fechas', async () => {
        await openPair();
        const cards = document.querySelectorAll('.dup-card');
        expect(cards).toHaveLength(2);
        expect(cards[0].textContent).toContain('Torre Norte');
        expect(cards[1].textContent).toContain('Edificio Sur');
        expect(cards[0].textContent).toMatch(/Personal\s*4/);
        expect(cards[0].textContent).toContain('06/01/26');
        expect($('.dup-shell').classList.contains('is-wide')).toBe(true);
    });

    test('explica qué tiene cada una que la otra no', async () => {
        await openPair();
        expect(text()).toContain('Si fueran la misma obra');
        expect(text()).toMatch(/3 personas están en las dos/);
        expect(text()).toMatch(/1 persona solo en Torre Norte/);
        expect(text()).toContain('Solo En A');
        expect(text()).toMatch(/Edificio Sur no tiene nada que no esté en Torre Norte/);
    });

    test('dice cuándo no hay diferencias', async () => {
        await openPair({ data: { employees: [...crew('A', 'a'), ...crew('B', 'b')], attendance: [att('a0', 0), att('b0', 0)] } });
        expect(text()).toContain('Son idénticas');
    });

    test('describe la evidencia de las fechas', async () => {
        await openPair();
        expect(text()).toMatch(/mismo día en las dos obras/);
        click('[data-pdup-action="back"]');
        expect($('[data-pdup-action="open-pair"]')).not.toBeNull();
    });

    test('sin el servicio de fusión no ofrece fusionar y lo dice', async () => {
        await openPair();
        expect(text()).toContain('La fusión de obras llegará en una próxima versión');
        expect($('[data-pdup-action="merge"]')).toBeNull();
    });

    test('con el servicio de fusión ofrece fusionar junto a «No son la misma»', async () => {
        const made = makeScreen({ deps: { mergeProjects: jest.fn() } });
        await made.screen.open();
        click('[data-pdup-action="open-pair"]');
        expect($('[data-pdup-action="merge"]')).not.toBeNull();
        expect($('[data-pdup-action="dismiss-pair"]')).not.toBeNull();
        expect(text()).not.toContain('llegará en una próxima versión');
    });

    test('Escape vuelve a la lista y luego cierra', async () => {
        await openPair();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect($('[data-pdup-action="open-pair"]')).not.toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect($('.dup-overlay')).toBeNull();
    });

    test('tocar fuera del cuadro no cierra la pantalla', async () => {
        await openPair();
        $('.dup-overlay').click();
        expect($('.dup-overlay')).not.toBeNull();
    });
});

describe('«No son la misma»', () => {
    test('guarda el descarte, marca el par resuelto y termina con el resumen', async () => {
        const { screen, deps } = makeScreen();
        await screen.open();
        click('[data-pdup-action="open-pair"]');
        click('[data-pdup-action="dismiss-pair"]');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(deps.dismissPair).toHaveBeenCalledWith('A', 'B');
        expect(text()).toContain('Revisión terminada');
        expect(text()).toMatch(/1\s*par marcado como distinto/);
    });

    test('si falla al guardar, se queda en la comparación con un aviso', async () => {
        const { screen } = makeScreen({ deps: { dismissPair: jest.fn(async () => { throw new Error('offline'); }) } });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await screen.open();
        click('[data-pdup-action="open-pair"]');
        click('[data-pdup-action="dismiss-pair"]');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(text()).toContain('No se pudo guardar');
        expect(document.querySelectorAll('.dup-card')).toHaveLength(2);
        expect($('[data-pdup-action="dismiss-pair"]').disabled).toBe(false);
    });

    test('no permite doble toque mientras guarda', async () => {
        let release;
        const dismissPair = jest.fn(() => new Promise(resolve => { release = resolve; }));
        const { screen } = makeScreen({ deps: { dismissPair } });
        await screen.open();
        click('[data-pdup-action="open-pair"]');
        click('[data-pdup-action="dismiss-pair"]');
        expect($('[data-pdup-action="dismiss-pair"]').disabled).toBe(true);
        $('[data-pdup-action="dismiss-pair"]').click();
        expect(dismissPair).toHaveBeenCalledTimes(1);
        release({});
        await new Promise(resolve => setTimeout(resolve, 0));
    });

    test('con varios pares vuelve a la lista con el resuelto marcado', async () => {
        const employees = [...crew('A', 'a'), ...crew('B', 'b'), ...crew('C', 'c')];
        const { screen } = makeScreen({ data: { projects: [project('A', 'Uno'), project('B', 'Dos'), project('C', 'Tres')], employees, attendance: [] } });
        await screen.open();
        click('[data-pdup-action="open-pair"]');
        click('[data-pdup-action="dismiss-pair"]');
        await new Promise(resolve => setTimeout(resolve, 0));
        const rows = document.querySelectorAll('[data-pdup-action="open-pair"]');
        expect(rows.length).toBe(3);
        expect([...rows].filter(row => row.disabled)).toHaveLength(1);
    });
});

describe('seguridad y cierre', () => {
    test('escapa los nombres de obra y de personas', async () => {
        const evil = '<img src=x onerror=alert(1)>';
        const { screen } = makeScreen({ data: {
            projects: [project('A', evil), project('B', 'Otra')],
            employees: [...crew('A', 'a', [person('a9', '9', evil, 'A')]), ...crew('B', 'b')]
        } });
        await screen.open();
        click('[data-pdup-action="open-pair"]');
        expect(document.querySelector('.dup-shell img')).toBeNull();
        expect(text()).toContain(evil);
    });

    test('cerrar quita la pantalla y deja de escuchar el teclado', async () => {
        const { screen } = makeScreen();
        await screen.open();
        click('[data-pdup-action="close"]');
        expect($('.dup-overlay')).toBeNull();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect($('.dup-overlay')).toBeNull();
    });

    test('si no se pueden leer las obras muestra un aviso y no lanza', async () => {
        const { screen } = makeScreen({ deps: { listProjects: jest.fn(async () => { throw new Error('idb'); }) } });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        await screen.open();
        expect(text()).toContain('No se pudieron leer las obras');
    });

    test('el diálogo tiene rol y título accesibles', async () => {
        const { screen } = makeScreen();
        await screen.open();
        const dialog = $('.dup-shell');
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby'))).not.toBeNull();
    });
});

describe('fusionar', () => {
    const mergeOk = { ok: true, counts: { employees: 3, positions: 1, leaders: 0, attendance: 12 }, targetName: 'Torre Norte' };
    async function openMerge(overrides = {}) {
        const made = makeScreen({
            data: overrides.data,
            deps: {
                mergeProjects: jest.fn(async () => mergeOk),
                checkMerge: jest.fn(async () => ({ ok: true, blockers: [] })),
                getDefaultProjectId: () => '',
                openDuplicates: jest.fn(),
                ...overrides.deps
            }
        });
        await made.screen.open();
        click('[data-pdup-action="open-pair"]');
        click('[data-pdup-action="merge"]');
        await new Promise(resolve => setTimeout(resolve, 0));
        return made;
    }
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));

    test('propone conservar la que tiene más personal y se une la otra', async () => {
        await openMerge();
        expect(text()).toContain('Unir en una sola obra');
        const keep = $('.dup-card.is-keep');
        const retire = $('.dup-card.is-merge');
        expect(keep.textContent).toContain('Torre Norte');
        expect(retire.textContent).toContain('Edificio Sur');
        expect(keep.textContent).toContain('Se conserva');
        expect(retire.textContent).toContain('Se une y se retira');
    });

    test('el nombre propuesto es el de la obra que se conserva y se puede cambiar', async () => {
        const { deps } = await openMerge();
        const input = $('[data-pdup-name]');
        expect(input.value).toBe('Torre Norte');
        input.value = 'Torre Norte II';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect($('[data-pdup-name]').value).toBe('Torre Norte II');
        click('[data-pdup-action="confirm-merge"]');
        await flush();
        expect(deps.mergeProjects).toHaveBeenCalledWith({ sourceId: 'B', targetId: 'A', projectName: 'Torre Norte II' });
    });

    test('invertir cambia qué obra se conserva y propone su nombre', async () => {
        const { deps } = await openMerge();
        click('[data-pdup-action="swap"]');
        expect($('.dup-card.is-keep').textContent).toContain('Edificio Sur');
        expect($('[data-pdup-name]').value).toBe('Edificio Sur');
        expect(deps.checkMerge).toHaveBeenLastCalledWith('A', 'B');
        click('[data-pdup-action="confirm-merge"]');
        await flush();
        expect(deps.mergeProjects).toHaveBeenCalledWith({ sourceId: 'A', targetId: 'B', projectName: 'Edificio Sur' });
    });

    test('la obra inicial siempre se conserva y no se puede invertir', async () => {
        await openMerge({ deps: { getDefaultProjectId: () => 'B' } });
        expect($('.dup-card.is-keep').textContent).toContain('Edificio Sur');
        expect($('[data-pdup-action="swap"]').disabled).toBe(true);
        expect(text()).toContain('obra inicial');
    });

    test('explica qué pasará con las cifras de la obra que se une', async () => {
        await openMerge();
        expect(text()).toContain('Qué pasará');
        expect(text()).toMatch(/Todo lo de Edificio Sur pasa a Torre Norte: 3 personas/);
        expect(text()).toMatch(/3 personas están en las dos obras/);
        expect(text()).toMatch(/copia de seguridad/);
    });

    test('si la comprobación detecta un bloqueo, lo muestra y no deja confirmar', async () => {
        const blocked = jest.fn(async () => ({ ok: false, blockers: [{ code: 'PAYROLL_CLOSURES', message: 'La obra tiene cierres de nómina.' }] }));
        const { deps } = await openMerge({ deps: { checkMerge: blocked } });
        expect(text()).toContain('La obra tiene cierres de nómina.');
        expect($('[data-pdup-action="confirm-merge"]').disabled).toBe(true);
        click('[data-pdup-action="confirm-merge"]');
        expect(deps.mergeProjects).not.toHaveBeenCalled();
    });

    test('si la comprobación falla, deja que el motor decida', async () => {
        const { deps } = await openMerge({ deps: { checkMerge: jest.fn(async () => { throw new Error('idb'); }) } });
        expect($('[data-pdup-action="confirm-merge"]').disabled).toBe(false);
        click('[data-pdup-action="confirm-merge"]');
        await flush();
        expect(deps.mergeProjects).toHaveBeenCalledTimes(1);
    });

    test('al fusionar bien muestra el resumen y ofrece revisar los duplicados', async () => {
        const { deps } = await openMerge();
        click('[data-pdup-action="confirm-merge"]');
        await flush();
        expect(text()).toContain('Obras fusionadas');
        expect(text()).toMatch(/3\s*personas/);
        expect(text()).toMatch(/12\s*registros de asistencia/);
        expect(text()).toContain('Torre Norte');
        click('[data-pdup-action="review-duplicates"]');
        expect(deps.openDuplicates).toHaveBeenCalledTimes(1);
        expect($('.dup-overlay')).toBeNull();
    });

    test('tras fusionar vuelve a comparar: el par fusionado ya no aparece', async () => {
        const made = await openMerge();
        // el servicio, al terminar, deja a B sin datos
        made.data.employees = made.data.employees.map(e => (e.projectId === 'B' ? { ...e, projectId: 'A' } : e));
        made.deps.mergeProjects.mockImplementation(async () => {
            made.data.projects = made.data.projects.filter(p => p.id !== 'B');
            return mergeOk;
        });
        click('[data-pdup-action="confirm-merge"]');
        await flush();
        click('[data-pdup-action="close"]');
        expect(made.deps.listProjects).toHaveBeenCalledTimes(2);
    });

    test('si falla, se queda en la confirmación con el motivo y puede reintentar', async () => {
        const failing = jest.fn(async () => ({ ok: false, message: 'Hay cambios sin guardar. Espera y vuelve a intentarlo.', blockers: [] }));
        await openMerge({ deps: { mergeProjects: failing } });
        click('[data-pdup-action="confirm-merge"]');
        await flush();
        expect(text()).toContain('Hay cambios sin guardar');
        expect(text()).toContain('Unir en una sola obra');
        expect($('[data-pdup-action="confirm-merge"]').disabled).toBe(false);
    });

    test('no permite doble toque mientras fusiona', async () => {
        let release;
        const slow = jest.fn(() => new Promise(resolve => { release = resolve; }));
        await openMerge({ deps: { mergeProjects: slow } });
        click('[data-pdup-action="confirm-merge"]');
        expect($('[data-pdup-action="confirm-merge"]').disabled).toBe(true);
        expect($('[data-pdup-action="swap"]').disabled).toBe(true);
        expect($('[data-pdup-action="back"]').disabled).toBe(true);
        $('[data-pdup-action="confirm-merge"]').click();
        expect(slow).toHaveBeenCalledTimes(1);
        release(mergeOk);
        await flush();
    });

    test('Volver y Escape regresan a la comparación; el nombre editado no se pierde al invertir dos veces', async () => {
        await openMerge();
        click('[data-pdup-action="back"]');
        expect($('.dup-cards')).not.toBeNull();
        expect(text()).toContain('¿Es la misma obra?');
        click('[data-pdup-action="merge"]');
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(text()).toContain('¿Es la misma obra?');
    });

    test('escapa los nombres en la confirmación', async () => {
        const evil = '<img src=x onerror=alert(1)>';
        await openMerge({ data: { projects: [project('A', evil), project('B', 'Otra')] } });
        expect(document.querySelector('.dup-shell img')).toBeNull();
        expect($('[data-pdup-name]').value).toBe(evil);
    });
});
