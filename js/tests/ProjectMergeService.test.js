import { mergeProjects, suggestMergeDirection, mergeFailureMessage, checkProjectMerge } from '../modules/features/projects/ProjectMergeService.js';

/**
 * Orquesta la fusión: copia de seguridad antes, el motor (una transacción),
 * cambio de obra activa si hacía falta y aviso al catálogo. Nunca lanza.
 */
const side = (id, extra = {}) => ({ id, name: id, createdAt: 100, people: 5, days: 10, ...extra });

describe('suggestMergeDirection', () => {
    test('la obra inicial se conserva, aunque sea la más nueva y la más chica', () => {
        const result = suggestMergeDirection(side('A', { createdAt: 900, people: 1 }), side('B', { createdAt: 100, people: 50 }), { defaultProjectId: 'A' });
        expect(result).toEqual({ keepId: 'A', retireId: 'B' });
    });
    test('si no, se conserva la que tiene más personal', () => {
        expect(suggestMergeDirection(side('A', { people: 3 }), side('B', { people: 8 }))).toEqual({ keepId: 'B', retireId: 'A' });
    });
    test('con el mismo personal, la que tiene más asistencia', () => {
        expect(suggestMergeDirection(side('A', { days: 4 }), side('B', { days: 40 }))).toEqual({ keepId: 'B', retireId: 'A' });
    });
    test('con todo igual, la más antigua y luego el id menor', () => {
        expect(suggestMergeDirection(side('A', { createdAt: 500 }), side('B', { createdAt: 100 }))).toEqual({ keepId: 'B', retireId: 'A' });
        expect(suggestMergeDirection(side('B'), side('A'))).toEqual({ keepId: 'A', retireId: 'B' });
    });
    test('es simétrico', () => {
        const a = side('A', { people: 2 });
        const b = side('B', { people: 7 });
        expect(suggestMergeDirection(a, b)).toEqual(suggestMergeDirection(b, a));
    });
});

describe('mergeProjects', () => {
    let calls, events, deps;
    const heard = event => events.push(event.detail);
    beforeEach(() => {
        calls = [];
        events = [];
        window.addEventListener('projects:setup-changed', heard);
        deps = {
            createSnapshot: jest.fn(async () => { calls.push('snapshot'); }),
            applyRepair: jest.fn(async () => { calls.push('repair'); return { status: 'OK', counts: { employees: 2, positions: 1, leaders: 0, attendance: 7 }, targetName: 'Torre' }; }),
            getActiveProjectId: jest.fn(() => 'OTRA'),
            setActiveProjectId: jest.fn(async () => { calls.push('switch'); })
        };
    });
    afterEach(() => window.removeEventListener('projects:setup-changed', heard));
    const run = (extra = {}) => mergeProjects({ sourceId: 'B', targetId: 'A', projectName: 'Torre', ...extra }, deps);

    test('hace la copia de seguridad antes de tocar nada y fusiona', async () => {
        const result = await run();
        expect(result).toMatchObject({ ok: true, counts: { employees: 2, attendance: 7 }, targetName: 'Torre' });
        expect(calls).toEqual(['snapshot', 'repair']);
        expect(deps.applyRepair).toHaveBeenCalledWith({ action: 'MERGE_PROJECT', sourceProjectId: 'B', targetProjectId: 'A', projectName: 'Torre' });
    });

    test('avisa al catálogo para que publique la fusión', async () => {
        await run();
        expect(events).toEqual([{ source: 'merge', projectId: 'A', mergedProjectId: 'B' }]);
    });

    test('si la obra que se une era la activa, cambia a la que se conserva después de fusionar', async () => {
        deps.getActiveProjectId = jest.fn(() => 'B');
        const result = await run();
        expect(result.ok).toBe(true);
        expect(calls).toEqual(['snapshot', 'repair', 'switch']);
        expect(deps.setActiveProjectId).toHaveBeenCalledWith('A');
    });

    test('si no se puede cambiar de obra activa, la fusión igual cuenta y se avisa', async () => {
        deps.getActiveProjectId = jest.fn(() => 'B');
        deps.setActiveProjectId = jest.fn(async () => { throw new Error('boom'); });
        const result = await run();
        expect(result).toMatchObject({ ok: true, activeSwitchFailed: true });
    });

    test('sin copia de seguridad no se fusiona nada', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        deps.createSnapshot = jest.fn(async () => { throw new Error('offline'); });
        const result = await run();
        expect(result).toMatchObject({ ok: false });
        expect(result.message).toMatch(/copia de seguridad/);
        expect(deps.applyRepair).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });

    test('un bloqueo del motor devuelve los motivos y no avisa ni cambia de obra', async () => {
        deps.getActiveProjectId = jest.fn(() => 'B');
        deps.applyRepair = jest.fn(async () => ({ status: 'CONFLICT', reason: 'Hay cierres de nómina', conflicts: [{ kind: 'PAYROLL_CLOSURES', message: 'Hay cierres de nómina', count: 2 }] }));
        const result = await run();
        expect(result).toMatchObject({ ok: false, message: 'Hay cierres de nómina' });
        expect(result.blockers).toEqual([{ kind: 'PAYROLL_CLOSURES', message: 'Hay cierres de nómina', count: 2 }]);
        expect(events).toEqual([]);
        expect(deps.setActiveProjectId).not.toHaveBeenCalled();
    });

    test('un error inesperado del motor no lanza y dice que no se cambió nada', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        deps.applyRepair = jest.fn(async () => { throw new Error('tx abort'); });
        const result = await run();
        expect(result).toMatchObject({ ok: false });
        expect(result.message).toMatch(/No se cambió nada/);
        expect(events).toEqual([]);
    });

    test('no admite dos fusiones a la vez', async () => {
        let release;
        deps.applyRepair = jest.fn(() => new Promise(resolve => { release = resolve; }));
        const first = run();
        await Promise.resolve();
        await Promise.resolve();
        const second = await run();
        expect(second).toMatchObject({ ok: false });
        expect(second.message).toMatch(/en curso/);
        release({ status: 'OK', counts: {}, targetName: 'Torre' });
        expect((await first).ok).toBe(true);
    });

    test('valida las obras antes de hacer nada', async () => {
        for (const bad of [{ sourceId: '' }, { targetId: '' }, { sourceId: 'A', targetId: 'A' }]) {
            const result = await run(bad);
            expect(result.ok).toBe(false);
        }
        expect(deps.createSnapshot).not.toHaveBeenCalled();
    });
});

describe('mergeFailureMessage', () => {
    test('resume los motivos de un bloqueo en una frase para el usuario', () => {
        expect(mergeFailureMessage([{ kind: 'PAYROLL_CLOSURES', message: 'Cierres.', count: 2 }, { kind: 'PETTY_CASH', message: 'Caja.' }])).toBe('Cierres. Caja.');
        expect(mergeFailureMessage([])).toMatch(/No se pudo/);
    });
});

describe('checkProjectMerge (comprobación sin escribir)', () => {
    const project = (id, name) => ({ id, name, status: 'active', createdAt: 1, updatedAt: 1 });
    const base = (extra = {}) => ({
        readData: async () => ({ employees: [{ id: 'e1', projectId: 'B' }], positions: [], leaders: [], attendance: [], payrollClosures: [], ...extra }),
        listProjects: async () => [project('A', 'Torre'), project('B', 'Sur')],
        protectedIds: () => ({ defaultProjectId: 'A', activeProjectId: '' })
    });

    test('una fusión posible devuelve ok sin bloqueos', async () => {
        expect(await checkProjectMerge('B', 'A', base())).toEqual({ ok: true, blockers: [] });
    });

    test('una fusión imposible devuelve los motivos con su código', async () => {
        const result = await checkProjectMerge('B', 'A', base({ payrollClosures: [{ id: 'C1', projectId: 'B', rows: [] }] }));
        expect(result.ok).toBe(false);
        expect(result.blockers.map(b => b.code)).toContain('PAYROLL_CLOSURES');
        expect(result.blockers[0].message).toEqual(expect.any(String));
    });

    test('respeta la obra inicial', async () => {
        const result = await checkProjectMerge('A', 'B', base());
        expect(result.blockers.map(b => b.code)).toEqual(['SOURCE_IS_DEFAULT']);
    });

    test('no escribe nada y deja que el error de lectura llegue a quien llama', async () => {
        await expect(checkProjectMerge('B', 'A', { ...base(), readData: async () => { throw new Error('idb'); } })).rejects.toThrow('idb');
    });
});
