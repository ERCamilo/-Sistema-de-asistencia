import { mountProjectCreateForm } from '../modules/features/projects/ProjectCreateUI.js';

/**
 * «¿Ya existe?»: el formulario de creación muestra las obras que ya tienes (sobre todo
 * útil sin conexión) y avisa al escribir un nombre que ya está en uso, antes de enviar.
 */
const rows = names => names.map((name, i) => ({ id: `PRJ-${i}`, name, status: 'active' }));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function mount(names, { fail = false } = {}) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const setupService = {
        store: { listAll: jest.fn(async () => { if (fail) throw new Error('idb'); return rows(names); }) },
        createEmptyProject: jest.fn(async ({ name }) => ({ project: { id: 'N', name }, catalogChecked: true, state: {} }))
    };
    const controller = mountProjectCreateForm(container, { setupService });
    return { container, setupService, controller };
}
const hint = container => container.querySelector('[data-project-create-existing]');
const type = (container, value) => {
    const input = container.querySelector('[data-project-create-name]');
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
};

afterEach(() => { document.body.innerHTML = ''; });

describe('lista de obras existentes', () => {
    test('muestra las obras que ya tienes', async () => {
        const { container } = mount(['Torre Norte', 'Edificio Sur']);
        await flush();
        expect(hint(container).hidden).toBe(false);
        expect(hint(container).textContent).toContain('Ya tienes');
        expect(hint(container).textContent).toContain('Torre Norte, Edificio Sur');
    });

    test('con más de 6, resume el resto', async () => {
        const { container } = mount(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
        await flush();
        expect(hint(container).textContent).toContain('A, B, C, D, E, F y 2 más');
    });

    test('sin obras, no muestra nada', async () => {
        const { container } = mount([]);
        await flush();
        expect(hint(container).hidden).toBe(true);
    });

    test('escapa los nombres', async () => {
        const { container } = mount(['<img src=x onerror=alert(1)>']);
        await flush();
        expect(container.querySelector('img')).toBeNull();
        expect(hint(container).textContent).toContain('<img src=x onerror=alert(1)>');
    });

    test('si no se pueden leer, el formulario sigue funcionando sin la ayuda', async () => {
        const { container, setupService } = mount(['X'], { fail: true });
        await flush();
        expect(hint(container).hidden).toBe(true);
        type(container, 'Nueva');
        container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        await flush();
        expect(setupService.createEmptyProject).toHaveBeenCalledWith({ name: 'Nueva' });
    });
});

describe('aviso al escribir un nombre ya usado', () => {
    test('avisa, sin importar mayúsculas ni espacios', async () => {
        const { container } = mount(['Torre Norte']);
        await flush();
        type(container, '  torre   NORTE ');
        expect(hint(container).textContent).toMatch(/Ya existe «Torre Norte»/);
        expect(hint(container).className).toContain('is-error');
    });

    test('al cambiar el nombre vuelve a la lista', async () => {
        const { container } = mount(['Torre Norte']);
        await flush();
        type(container, 'Torre Norte');
        type(container, 'Torre Sur');
        expect(hint(container).textContent).toContain('Ya tienes');
        expect(hint(container).className).not.toContain('is-error');
    });

    test('un nombre parecido pero distinto no avisa', async () => {
        const { container } = mount(['Torre Norte']);
        await flush();
        type(container, 'Torre Norte 2');
        expect(hint(container).textContent).toContain('Ya tienes');
    });

    test('no bloquea enviar: el servicio es quien decide', async () => {
        const { container, setupService } = mount(['Torre Norte']);
        await flush();
        type(container, 'Torre Norte');
        expect(container.querySelector('[data-project-create-submit]').disabled).toBe(false);
        container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        await flush();
        expect(setupService.createEmptyProject).toHaveBeenCalledTimes(1);
    });

    test('tras crear con éxito la lista se actualiza con la obra nueva', async () => {
        const { container, setupService } = mount(['Torre Norte']);
        await flush();
        setupService.store.listAll.mockResolvedValue(rows(['Torre Norte', 'Nueva']));
        type(container, 'Nueva');
        container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        await flush();
        await flush();
        expect(hint(container).textContent).toContain('Torre Norte, Nueva');
    });
});
