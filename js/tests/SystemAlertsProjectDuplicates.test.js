import { SystemAlertsManager } from '../modules/components/SystemAlertsManager.js';

/**
 * Aviso de «obras repetidas» en el encabezado, junto al de empleados duplicados:
 * un botón con insignia numérica que abre la pantalla «Obras repetidas». Solo con la
 * bandera encendida, solo si hay pares sospechosos y sin recalcular en cada repintado.
 */
const person = (id, number, name, projectId) => ({ id, number, name, projectId, loans: [] });
const SHARED = [['001', 'Mathieu Dormeus'], ['002', 'Wadne Exilien'], ['003', 'Vernet Gran Pierre']];
const crew = (projectId, prefix) => SHARED.map(([number, name], i) => person(`${prefix}${i}`, number, name, projectId));
const project = (id, name, extra = {}) => ({ id, name, status: 'active', createdAt: 1, updatedAt: 1, ...extra });

function setup(overrides = {}) {
    let data = {
        projects: [project('A', 'Torre Norte'), project('B', 'Edificio Sur')],
        employees: [...crew('A', 'a'), ...crew('B', 'b')],
        attendance: {},
        defaultProjectId: 'A'
    };
    let time = 1_000_000;
    const load = jest.fn(async () => ({ ...data }));
    const options = { isEnabled: jest.fn(() => true), load, now: () => time, ...overrides };
    const manager = new SystemAlertsManager({ projectDuplicates: options });
    window.render = jest.fn();
    return {
        manager, load, options,
        setData: next => { data = { ...data, ...next }; },
        advance: ms => { time += ms; }
    };
}

let created = [];
const make = overrides => { const made = setup(overrides); created.push(made.manager); return made; };
afterEach(() => {
    created.forEach(manager => manager.dispose?.());
    created = [];
    delete window.render;
    delete window._systemAlerts;
    delete window.openProjectDuplicatesScreen;
    document.body.innerHTML = '';
});

describe('botón de obras repetidas', () => {
    test('sin bandera no aparece y ni siquiera calcula', async () => {
        const { manager, load } = make({ isEnabled: jest.fn(() => false) });
        await manager.refreshProjectHealth();
        expect(manager.renderAlertButton()).toBe('');
        expect(load).not.toHaveBeenCalled();
    });

    test('con un par sospechoso muestra el botón con la cuenta y la acción', async () => {
        const { manager } = make();
        await manager.refreshProjectHealth();
        const html = manager.renderAlertButton();
        expect(html).toContain('data-alerts-action="show-project-duplicates"');
        expect(html).toContain('>1<');
        expect(html).toMatch(/aria-label="Obras repetidas: 1 posible"/);
    });

    test('con varios pares usa el plural', async () => {
        const { manager, setData } = make();
        setData({ projects: [project('A', 'Uno'), project('B', 'Dos'), project('C', 'Tres')], employees: [...crew('A', 'a'), ...crew('B', 'b'), ...crew('C', 'c')] });
        await manager.refreshProjectHealth();
        expect(manager.renderAlertButton()).toMatch(/aria-label="Obras repetidas: 3 posibles"/);
    });

    test('sin pares sospechosos no hay botón', async () => {
        const { manager, setData } = make();
        setData({ employees: [...crew('A', 'a')] });
        await manager.refreshProjectHealth();
        expect(manager.renderAlertButton()).toBe('');
    });

    test('un par descartado con «No son la misma» deja de contar', async () => {
        const { manager, setData } = make();
        setData({ projects: [project('A', 'Torre Norte', { notSameAs: ['B'] }), project('B', 'Edificio Sur')] });
        await manager.refreshProjectHealth();
        expect(manager.renderAlertButton()).toBe('');
    });

    test('convive con el aviso de empleados duplicados', async () => {
        const { manager } = make();
        manager.currentConflicts = 2;
        await manager.refreshProjectHealth();
        const html = manager.renderAlertButton();
        expect(html).toContain('data-alerts-action="show-resolution-dialog"');
        expect(html).toContain('data-alerts-action="show-project-duplicates"');
    });
});

describe('cuándo se recalcula', () => {
    test('repinta solo cuando la cuenta cambia', async () => {
        const { manager, setData } = make();
        await manager.refreshProjectHealth();
        expect(window.render).toHaveBeenCalledTimes(1);
        await manager.refreshProjectHealth();
        expect(window.render).toHaveBeenCalledTimes(1);
        setData({ employees: [...crew('A', 'a')] });
        await manager.refreshProjectHealth();
        expect(window.render).toHaveBeenCalledTimes(2);
        expect(manager.renderAlertButton()).toBe('');
    });

    test('al repintar no recalcula más de una vez cada 30 segundos', async () => {
        const { manager, load, advance } = make();
        await manager.scheduleProjectHealth();
        await manager.scheduleProjectHealth();
        expect(load).toHaveBeenCalledTimes(1);
        advance(29_000);
        await manager.scheduleProjectHealth();
        expect(load).toHaveBeenCalledTimes(1);
        advance(2_000);
        await manager.scheduleProjectHealth();
        expect(load).toHaveBeenCalledTimes(2);
    });

    test('checkHealth (que corre en cada repintado) lo programa sin bloquear', async () => {
        const { manager, load } = make();
        expect(typeof manager.checkHealth()).toBe('boolean');
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(load).toHaveBeenCalledTimes(1);
    });

    test.each(['projects:setup-changed', 'projects:created', 'app:ready'])('el evento %s fuerza un recálculo', async eventName => {
        jest.useFakeTimers();
        try {
            const { manager, load } = make();
            await manager.scheduleProjectHealth();
            expect(load).toHaveBeenCalledTimes(1);
            window.dispatchEvent(new CustomEvent(eventName, { detail: {} }));
            jest.advanceTimersByTime(600);
            await Promise.resolve();
            expect(load).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    test('un burst de eventos se agrupa en un solo recálculo', async () => {
        jest.useFakeTimers();
        try {
            const { manager, load } = make();
            for (let i = 0; i < 5; i++) window.dispatchEvent(new CustomEvent('projects:setup-changed', { detail: {} }));
            jest.advanceTimersByTime(600);
            await Promise.resolve();
            expect(load).toHaveBeenCalledTimes(1);
            expect(manager).toBeDefined();
        } finally {
            jest.useRealTimers();
        }
    });

    test('un resultado viejo no pisa a uno más nuevo', async () => {
        const slow = { resolve: null };
        let call = 0;
        const { manager } = make({
            load: jest.fn(() => {
                call++;
                if (call === 1) return new Promise(resolve => { slow.resolve = resolve; });
                return Promise.resolve({ projects: [project('A', 'x')], employees: [], attendance: {}, defaultProjectId: '' });
            })
        });
        const first = manager.refreshProjectHealth();
        await manager.refreshProjectHealth();
        slow.resolve({
            projects: [project('A', 'Torre Norte'), project('B', 'Edificio Sur')],
            employees: [...crew('A', 'a'), ...crew('B', 'b')], attendance: {}, defaultProjectId: 'A'
        });
        await first;
        expect(manager.renderAlertButton()).toBe('');
    });

    test('si apagan la bandera, el aviso desaparece', async () => {
        const enabled = { value: true };
        const { manager } = make({ isEnabled: jest.fn(() => enabled.value) });
        await manager.refreshProjectHealth();
        expect(manager.renderAlertButton()).not.toBe('');
        enabled.value = false;
        await manager.refreshProjectHealth();
        expect(manager.renderAlertButton()).toBe('');
    });

    test('un error al leer los datos no rompe nada y quita el aviso', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const { manager, options } = make();
        await manager.refreshProjectHealth();
        options.load.mockRejectedValueOnce(new Error('idb'));
        await expect(manager.refreshProjectHealth()).resolves.not.toThrow();
        expect(manager.renderAlertButton()).toBe('');
        console.warn.mockRestore();
    });
});

describe('al pulsar el botón', () => {
    test('abre la pantalla de obras repetidas y al cerrarla vuelve a calcular', async () => {
        const { manager, load } = make();
        window._systemAlerts = manager;
        window.openProjectDuplicatesScreen = jest.fn();
        await manager.refreshProjectHealth();
        document.body.innerHTML = manager.renderAlertButton();
        document.querySelector('[data-alerts-action="show-project-duplicates"]').click();
        expect(window.openProjectDuplicatesScreen).toHaveBeenCalledTimes(1);
        const { onClose } = window.openProjectDuplicatesScreen.mock.calls[0][0];
        const before = load.mock.calls.length;
        onClose();
        await Promise.resolve();
        await Promise.resolve();
        expect(load.mock.calls.length).toBe(before + 1);
    });

    test('si la pantalla no está disponible no lanza', async () => {
        const { manager } = make();
        window._systemAlerts = manager;
        await manager.refreshProjectHealth();
        document.body.innerHTML = manager.renderAlertButton();
        expect(() => document.querySelector('[data-alerts-action="show-project-duplicates"]').click()).not.toThrow();
    });
});
