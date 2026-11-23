import { ProjectSetupService } from '../modules/features/projects/ProjectSetupService.js';
import { announceProjectCreated } from '../modules/features/projects/ProjectCreateUI.js';

/**
 * Blindaje contra obras repetidas: crear una obra primero se pone al día con el
 * catálogo del resto de dispositivos, así el control de nombre repetido atrapa el
 * duplicado AL CREAR (no después, cuando ya hay datos en las dos).
 */
function harness({ enabled = true, sync } = {}) {
    let rows = [{ id: 'PRJ-A', name: 'Mi obra inicial', status: 'active', schemaVersion: 1, createdAt: 1, updatedAt: 1 }];
    const order = [];
    const store = {
        listAll: jest.fn(async () => { order.push('list'); return rows.map(r => ({ ...r })); }),
        get: jest.fn(async id => rows.find(r => r.id === id) || null),
        create: jest.fn(async project => { order.push('create'); const payload = project.toJSON(); rows.push(payload); return payload; }),
        update: jest.fn()
    };
    const syncCatalog = jest.fn(sync || (async () => { order.push('sync'); return { received: 0 }; }));
    const service = new ProjectSetupService({
        store, syncCatalog,
        getScope: async () => ({ enabled, projectId: 'PRJ-A', defaultProjectId: 'PRJ-A' }),
        flags: { isEnabled: () => enabled, setEnabled: () => {} }
    });
    return { service, store, syncCatalog, order, addRemote: row => rows.push(row) };
}

describe('crear una obra revisa antes el catálogo de otros dispositivos', () => {
    test('sincroniza antes de comprobar el nombre y de crear', async () => {
        const h = harness();
        await h.service.createEmptyProject({ name: 'Torre Norte' });
        expect(h.order.slice(0, 3)).toEqual(['sync', 'list', 'create']);
        expect(h.syncCatalog).toHaveBeenCalledWith(4000);
    });

    test('una obra del mismo nombre creada en otro dispositivo se detecta al crear, y no se crea nada', async () => {
        const h = harness({ sync: async () => { h.addRemote({ id: 'PRJ-OTRO', name: 'Torre Norte', status: 'active', createdAt: 5, updatedAt: 5 }); return { received: 1 }; } });
        await expect(h.service.createEmptyProject({ name: ' torre  norte ' })).rejects.toThrow(/Ya existe una obra con el nombre/);
        expect(h.store.create).not.toHaveBeenCalled();
    });

    test('con el catálogo revisado lo indica en el resultado', async () => {
        const result = await harness().service.createEmptyProject({ name: 'Torre Norte' });
        expect(result.catalogChecked).toBe(true);
    });

    test('sin conexión o sin sesión (la sincronización no aplica) crea igual y avisa que no pudo revisar', async () => {
        const result = await harness({ sync: async () => null }).service.createEmptyProject({ name: 'Torre Norte' });
        expect(result.project.name).toBe('Torre Norte');
        expect(result.catalogChecked).toBe(false);
    });

    test('un error de la sincronización no impide crear', async () => {
        const result = await harness({ sync: async () => { throw new Error('offline'); } }).service.createEmptyProject({ name: 'Torre Norte' });
        expect(result.project.name).toBe('Torre Norte');
        expect(result.catalogChecked).toBe(false);
    });

    test('con Proyectos apagado no sincroniza ni escribe', async () => {
        const h = harness({ enabled: false });
        await expect(h.service.createEmptyProject({ name: 'Torre Norte' })).rejects.toThrow();
        expect(h.syncCatalog).not.toHaveBeenCalled();
    });

    test('un nombre inválido no gasta una sincronización', async () => {
        const h = harness();
        await expect(h.service.createEmptyProject({ name: '   ' })).rejects.toThrow();
        expect(h.syncCatalog).not.toHaveBeenCalled();
    });
});

describe('anuncio al crear una obra', () => {
    let notes, events;
    const heard = event => events.push(event.detail);
    beforeEach(() => {
        notes = [];
        events = [];
        window.showNotification = (message, type) => notes.push([type, message]);
        window.addEventListener('projects:created', heard);
    });
    afterEach(() => {
        delete window.showNotification;
        window.removeEventListener('projects:created', heard);
    });
    const result = extra => ({ project: { id: 'P', name: 'Torre' }, catalogChecked: true, ...extra });

    test('obra creada con el catálogo revisado: solo el aviso de éxito y el evento', () => {
        announceProjectCreated(result(), { currentUser: { uid: 'u' } });
        expect(notes).toEqual([['success', 'Proyecto creado: Torre']]);
        expect(events).toEqual([{ project: { id: 'P', name: 'Torre' } }]);
    });

    test('con sesión y sin poder revisar el catálogo, avisa que podría repetirse en otro dispositivo', () => {
        announceProjectCreated(result({ catalogChecked: false }), { currentUser: { uid: 'u' } });
        expect(notes[0]).toEqual(['success', 'Proyecto creado: Torre']);
        expect(notes[1][0]).toBe('info');
        expect(notes[1][1]).toMatch(/No se pudieron revisar tus otras obras/);
        expect(notes[1][1]).toMatch(/te avisaremos al sincronizar/);
    });

    test('sin sesión no inventa un aviso de conexión', () => {
        announceProjectCreated(result({ catalogChecked: false }), { currentUser: null });
        expect(notes).toEqual([['success', 'Proyecto creado: Torre']]);
    });
});
