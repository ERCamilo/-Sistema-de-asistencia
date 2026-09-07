/**
 * F1.7 (DEP-SA-001) — vínculo 1 official Project → N PettyCashProjects.
 *
 * Cubre: helper valid/null/orphan; selector 1:N; birth ON active,
 * ON fallback/default, OFF sin own-key; backfill idempotente e inerte en
 * OFF; sin mutación de projectId en periods/movements; applyRemote preserva
 * el vínculo local ante remoto legacy pero acepta un vínculo remoto válido
 * explícito (autoridad de merge existente); huérfano visible; max-wins del
 * contador intacto.
 */

import {
    OFFICIAL_LINK_KEY,
    normalizeOfficialProjectId,
    isValidOfficialProjectId,
    hasOwnOfficialLink,
    getOfficialProjectId,
    getLinkStatus,
    isOrphan,
    selectPettyByOfficial,
    groupPettyByOfficial,
    resolveBirthOfficialId,
    stampBirthLink,
    needsBackfill,
    backfillMissingOfficialLinks
} from '../modules/features/pettycash/PettyCashOfficialLink.js';
import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import { PettyCashTab, registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';
import { Modal } from '../modules/components/Modal.js';
import { projectContext } from '../modules/features/projects/ProjectContext.js';
import { defaultProjectService } from '../modules/features/projects/DefaultProject.js';
import { state } from '../modules/core/AppState.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import indexedDBService from '../modules/services/IndexedDBService.js';

afterEach(() => {
    setProjectsEnabled(false);
    localStorage.clear();
    jest.restoreAllMocks();
});

describe('F1.7 helper — valid/null/orphan', () => {
    test('normalize recorta y nulifica vacíos/no-strings', () => {
        expect(normalizeOfficialProjectId('  PRJ-1  ')).toBe('PRJ-1');
        expect(normalizeOfficialProjectId('')).toBeNull();
        expect(normalizeOfficialProjectId('   ')).toBeNull();
        expect(normalizeOfficialProjectId(null)).toBeNull();
        expect(normalizeOfficialProjectId(undefined)).toBeNull();
        expect(normalizeOfficialProjectId(123)).toBeNull();
    });

    test('valid/null distinction', () => {
        expect(isValidOfficialProjectId('PRJ-A')).toBe(true);
        expect(isValidOfficialProjectId(null)).toBe(false);
        expect(isValidOfficialProjectId('')).toBe(false);
    });

    test('own-key presente aunque sea null; ausente ⇒ false', () => {
        expect(hasOwnOfficialLink({ id: 'p1', [OFFICIAL_LINK_KEY]: null })).toBe(true);
        expect(hasOwnOfficialLink({ id: 'p1' })).toBe(false);
        expect(hasOwnOfficialLink(null)).toBe(false);
    });

    test('getOfficialProjectId nulifica ausente/inválido', () => {
        expect(getOfficialProjectId({ id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-A' })).toBe('PRJ-A');
        expect(getOfficialProjectId({ id: 'p1' })).toBeNull();
        expect(getOfficialProjectId({ id: 'p1', [OFFICIAL_LINK_KEY]: '' })).toBeNull();
    });

    test('orphan: missing vs invalid vs linked', () => {
        expect(getLinkStatus({ id: 'p1' })).toBe('orphan-missing');
        expect(getLinkStatus({ id: 'p1', [OFFICIAL_LINK_KEY]: null })).toBe('orphan-missing');
        expect(isOrphan({ id: 'p1' })).toBe(true);
        expect(getLinkStatus({ id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-A' })).toBe('linked');
        expect(isOrphan({ id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-A' })).toBe(false);
        expect(getLinkStatus(
            { id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-A' },
            ['PRJ-A', 'PRJ-B']
        )).toBe('linked');
        expect(getLinkStatus(
            { id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-GHOST' },
            ['PRJ-A', 'PRJ-B']
        )).toBe('orphan-invalid');
        expect(isOrphan(
            { id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-GHOST' },
            ['PRJ-A', 'PRJ-B']
        )).toBe(true);
    });
});

describe('F1.7 selector 1:N', () => {
    const projects = [
        { id: 'c1', [OFFICIAL_LINK_KEY]: 'PRJ-A' },
        { id: 'c2', [OFFICIAL_LINK_KEY]: 'PRJ-A' },
        { id: 'c3', [OFFICIAL_LINK_KEY]: 'PRJ-B' },
        { id: 'c4' }
    ];

    test('un oficial agrupa N petty projects', () => {
        expect(selectPettyByOfficial(projects, 'PRJ-A').map((p) => p.id).sort())
            .toEqual(['c1', 'c2']);
        expect(selectPettyByOfficial(projects, 'PRJ-B').map((p) => p.id))
            .toEqual(['c3']);
        expect(selectPettyByOfficial(projects, 'PRJ-GHOST')).toEqual([]);
        expect(selectPettyByOfficial(projects, null)).toEqual([]);
    });

    test('groupPettyByOfficial lleva huérfanos a __orphan__', () => {
        const groups = groupPettyByOfficial(projects);
        expect(groups.get('PRJ-A')).toHaveLength(2);
        expect(groups.get('PRJ-B')).toHaveLength(1);
        expect(groups.get('__orphan__').map((p) => p.id)).toEqual(['c4']);
    });
});

describe('F1.7 birth stamping', () => {
    test('ON active vigente gana', () => {
        expect(resolveBirthOfficialId({
            activeProjectId: 'PRJ-ACTIVE',
            defaultProjectId: 'PRJ-DEFAULT'
        })).toBe('PRJ-ACTIVE');
    });

    test('ON fallback al default sólo si active no disponible', () => {
        expect(resolveBirthOfficialId({
            activeProjectId: null,
            defaultProjectId: 'PRJ-DEFAULT'
        })).toBe('PRJ-DEFAULT');
        expect(resolveBirthOfficialId({
            activeProjectId: '  ',
            defaultProjectId: 'PRJ-DEFAULT'
        })).toBe('PRJ-DEFAULT');
        expect(resolveBirthOfficialId({ activeProjectId: null, defaultProjectId: null }))
            .toBeNull();
    });

    test('OFF ⇒ sin own-key (byte-stable)', () => {
        const stamped = stampBirthLink({ id: 'p1', name: 'Obra' }, { enabled: false });
        expect(Object.prototype.hasOwnProperty.call(stamped, OFFICIAL_LINK_KEY)).toBe(false);
        expect(stamped).toEqual({ id: 'p1', name: 'Obra' });
    });

    test('ON ⇒ siempre own-key (id o null huérfano explícito)', () => {
        const withActive = stampBirthLink({ id: 'p1' }, {
            enabled: true, activeProjectId: 'PRJ-A', defaultProjectId: 'PRJ-D'
        });
        expect(withActive[OFFICIAL_LINK_KEY]).toBe('PRJ-A');

        const fallback = stampBirthLink({ id: 'p1' }, {
            enabled: true, activeProjectId: null, defaultProjectId: 'PRJ-D'
        });
        expect(fallback[OFFICIAL_LINK_KEY]).toBe('PRJ-D');

        const orphan = stampBirthLink({ id: 'p1' }, {
            enabled: true, activeProjectId: null, defaultProjectId: null
        });
        expect(Object.prototype.hasOwnProperty.call(orphan, OFFICIAL_LINK_KEY)).toBe(true);
        expect(orphan[OFFICIAL_LINK_KEY]).toBeNull();
    });

    test('needsBackfill sólo sin vínculo válido (con identidad)', () => {
        expect(needsBackfill({ id: 'a', name: 'x' })).toBe(true);
        expect(needsBackfill({ id: 'a', [OFFICIAL_LINK_KEY]: null })).toBe(true);
        expect(needsBackfill({ id: 'a', [OFFICIAL_LINK_KEY]: '' })).toBe(true);
        expect(needsBackfill({ id: 'a', [OFFICIAL_LINK_KEY]: 'PRJ-X' })).toBe(false);
        expect(needsBackfill({ name: 'sin-id' })).toBe(false);
        expect(needsBackfill(null)).toBe(false);
    });
});

describe('F1.7 backfill', () => {
    function mockIdb(records) {
        return {
            getAll: jest.fn().mockResolvedValue(records),
            batchUpdate: jest.fn().mockResolvedValue(records.length)
        };
    }

    test('OFF inerte: no toca storage', async () => {
        setProjectsEnabled(false);
        const idb = mockIdb([{ id: 'a' }]);
        const result = await backfillMissingOfficialLinks({
            defaultOfficialProjectId: 'PRJ-D',
            idb
        });
        expect(result).toEqual(expect.objectContaining({ skipped: true }));
        expect(idb.getAll).not.toHaveBeenCalled();
        expect(idb.batchUpdate).not.toHaveBeenCalled();
    });

    test('idempotente: sella faltantes, segunda corrida no escribe', async () => {
        setProjectsEnabled(true);
        const idb = mockIdb([
            { id: 'a', name: 'Legacy sin vínculo' },
            { id: 'b', name: 'Vinculada', [OFFICIAL_LINK_KEY]: 'PRJ-X' },
            { id: 'c', name: 'Null explícito', [OFFICIAL_LINK_KEY]: null }
        ]);
        const first = await backfillMissingOfficialLinks({
            defaultOfficialProjectId: 'PRJ-D',
            idb,
            yieldFn: async () => {}
        });
        expect(first).toEqual(expect.objectContaining({ skipped: false, scanned: 3, stamped: 2 }));
        expect(idb.batchUpdate).toHaveBeenCalledTimes(1);
        const written = idb.batchUpdate.mock.calls[0][1];
        expect(idb.batchUpdate.mock.calls[0][0]).toBe('pettyCashProjects');
        expect(written.map((p) => p.id).sort()).toEqual(['a', 'c']);
        written.forEach((p) => expect(p[OFFICIAL_LINK_KEY]).toBe('PRJ-D'));
        // La vinculada se deja intacta: no se reescribe.
        expect(written.find((p) => p.id === 'b')).toBeUndefined();
        // Sólo añade la key: el resto de campos se preserva.
        expect(written.find((p) => p.id === 'a')).toEqual(
            expect.objectContaining({ id: 'a', name: 'Legacy sin vínculo' })
        );

        // Segunda corrida sobre el estado ya sellado ⇒ 0 escrituras.
        idb.getAll.mockResolvedValue([
            { id: 'a', [OFFICIAL_LINK_KEY]: 'PRJ-D' },
            { id: 'b', [OFFICIAL_LINK_KEY]: 'PRJ-X' },
            { id: 'c', [OFFICIAL_LINK_KEY]: 'PRJ-D' }
        ]);
        idb.batchUpdate.mockClear();
        const second = await backfillMissingOfficialLinks({
            defaultOfficialProjectId: 'PRJ-D',
            idb,
            yieldFn: async () => {}
        });
        expect(second).toEqual(expect.objectContaining({ stamped: 0 }));
        expect(idb.batchUpdate).not.toHaveBeenCalled();
    });

    test('sin default resoluble no escribe nada', async () => {
        setProjectsEnabled(true);
        const idb = mockIdb([{ id: 'a' }]);
        const result = await backfillMissingOfficialLinks({
            defaultOfficialProjectId: null,
            idb
        });
        expect(result.stamped).toBe(0);
        expect(idb.batchUpdate).not.toHaveBeenCalled();
    });

    test('nunca toca periods/movements/outbox y cede entre chunks', async () => {
        setProjectsEnabled(true);
        const idb = mockIdb([
            { id: 'a' },
            { id: 'b' },
            { id: 'c', [OFFICIAL_LINK_KEY]: 'PRJ-X' }
        ]);
        const yieldFn = jest.fn().mockResolvedValue(undefined);
        await backfillMissingOfficialLinks({
            defaultOfficialProjectId: 'PRJ-D',
            idb,
            chunkSize: 1,
            yieldFn
        });
        const storesTouched = [
            ...idb.getAll.mock.calls.map((call) => call[0]),
            ...idb.batchUpdate.mock.calls.map((call) => call[0])
        ];
        expect(storesTouched).not.toContain('pettyCashPeriods');
        expect(storesTouched).not.toContain('pettyCashMovements');
        expect(storesTouched).not.toContain('pettyCashOutbox');
        expect(storesTouched.every((store) => store === 'pettyCashProjects')).toBe(true);
        // 2 pendientes con chunk 1 ⇒ 2 escrituras + 2 yields.
        expect(idb.batchUpdate).toHaveBeenCalledTimes(2);
        expect(yieldFn).toHaveBeenCalledTimes(2);
    });
});

describe('F1.7 applyRemote — regla aditiva estrecha (projects)', () => {
    beforeEach(() => {
        indexedDBService.getAll.mockReset().mockResolvedValue([]);
        indexedDBService.clear.mockReset().mockResolvedValue(undefined);
        indexedDBService.batchUpdate.mockReset().mockResolvedValue(0);
    });

    test('remoto legacy sin vínculo no borra el vínculo local', async () => {
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashProjects') {
                return [{ id: 'p1', name: 'Obra', [OFFICIAL_LINK_KEY]: 'PRJ-A' }];
            }
            return [];
        });
        const merged = await PettyCashStore.applyRemote(
            'projects',
            [{ id: 'p1', name: 'Obra' }]
        );
        expect(merged).toEqual([
            expect.objectContaining({ id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-A' })
        ]);
    });

    test.each([
        ['key ausente', { id: 'p1', name: 'Obra' }],
        ['null explícito', { id: 'p1', name: 'Obra', [OFFICIAL_LINK_KEY]: null }],
        ['vacío', { id: 'p1', name: 'Obra', [OFFICIAL_LINK_KEY]: '  ' }]
    ])('preserva ante remoto %s', async (_label, remote) => {
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashProjects') {
                return [{ id: 'p1', name: 'Obra', [OFFICIAL_LINK_KEY]: 'PRJ-A' }];
            }
            return [];
        });
        const merged = await PettyCashStore.applyRemote('projects', [remote]);
        expect(merged).toEqual([
            expect.objectContaining({ id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-A' })
        ]);
    });

    test('un vínculo remoto válido explícito ejerce la autoridad de merge existente', async () => {
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashProjects') {
                return [{ id: 'p1', name: 'Obra', [OFFICIAL_LINK_KEY]: 'PRJ-A' }];
            }
            return [];
        });
        const merged = await PettyCashStore.applyRemote(
            'projects',
            [{ id: 'p1', name: 'Obra', [OFFICIAL_LINK_KEY]: 'PRJ-B' }]
        );
        expect(merged).toEqual([
            expect.objectContaining({ id: 'p1', [OFFICIAL_LINK_KEY]: 'PRJ-B' })
        ]);
    });

    test('max-wins del contador sigue intacto (y convive con el vínculo)', async () => {
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashProjects') {
                return [{
                    id: 'p1', name: 'Obra', nextRecordNumber: 15,
                    [OFFICIAL_LINK_KEY]: 'PRJ-A'
                }];
            }
            return [];
        });
        const merged = await PettyCashStore.applyRemote(
            'projects',
            [{ id: 'p1', name: 'Obra', nextRecordNumber: 12 }]
        );
        expect(merged).toEqual([
            expect.objectContaining({
                id: 'p1',
                nextRecordNumber: 15,
                [OFFICIAL_LINK_KEY]: 'PRJ-A'
            })
        ]);
    });

    test('no inventa vínculos en periods/movements ni muta sus projectId', async () => {
        const period = { id: 'per1', projectId: 'p1', label: 'Q1' };
        const movement = { id: 'm1', projectId: 'p1', periodId: 'per1', amount: 10 };
        indexedDBService.getAll.mockImplementation(async (store) => {
            if (store === 'pettyCashPeriods') return [period];
            if (store === 'pettyCashMovements') return [movement];
            return [];
        });
        const mergedPeriods = await PettyCashStore.applyRemote('periods', [period]);
        expect(mergedPeriods).toEqual([expect.objectContaining({ id: 'per1', projectId: 'p1' })]);
        expect(mergedPeriods[0]).not.toHaveProperty(OFFICIAL_LINK_KEY);

        const mergedMovements = await PettyCashStore.applyRemote('movements', [movement]);
        expect(mergedMovements).toEqual([expect.objectContaining({ id: 'm1', projectId: 'p1' })]);
        expect(mergedMovements[0]).not.toHaveProperty(OFFICIAL_LINK_KEY);
    });
});

describe('F1.7 UI — vínculo visible sin filtrar', () => {
    function seedUi({ projects, selectedProjectId }) {
        state.pettyCash = {
            projects,
            periods: [{ id: 'per1', projectId: 'p1', label: 'Quincena 1', status: 'abierta', openingDate: '2026-01-01' }],
            movements: [],
            selectedProjectId,
            selectedPeriodId: 'per1',
            movementSortBy: 'recordNumber',
            movementSortDirection: 'desc',
            movementSearchQuery: '',
            receiptQueueHiddenIds: [],
            form: null,
            periodForm: null,
            editMov: null
        };
    }

    afterEach(() => {
        state.pettyCash = null;
    });

    test('OFF ⇒ sin diagnóstico (paridad legacy)', () => {
        setProjectsEnabled(false);
        seedUi({ projects: [{ id: 'p1', name: 'Obra' }], selectedProjectId: 'p1' });
        const html = PettyCashTab();
        expect(html).not.toContain('data-petty-official');
    });

    test('ON + vinculado ⇒ muestra el id oficial', () => {
        setProjectsEnabled(true);
        seedUi({
            projects: [{ id: 'p1', name: 'Obra', [OFFICIAL_LINK_KEY]: 'PRJ-A' }],
            selectedProjectId: 'p1'
        });
        const html = PettyCashTab();
        expect(html).toContain('data-petty-official-link');
        expect(html).toContain('PRJ-A');
    });

    test('ON + huérfano ⇒ aviso visible pero el historial NO se filtra', () => {
        setProjectsEnabled(true);
        seedUi({
            projects: [
                { id: 'p1', name: 'Obra huérfana' },
                { id: 'p2', name: 'Obra vinculada', [OFFICIAL_LINK_KEY]: 'PRJ-A' }
            ],
            selectedProjectId: 'p1'
        });
        const html = PettyCashTab();
        expect(html).toContain('data-petty-official-orphan');
        expect(html).toContain('huérfano');
        // Sin filtrado: ambas opciones siguen en el selector y el periodo
        // del proyecto huérfano sigue renderizado.
        expect(html).toContain('Obra huérfana');
        expect(html).toContain('Obra vinculada');
        expect(html).toContain('Quincena 1');
    });
});

describe('F1.7 birth vía pcNewProject', () => {
    function seedEmptyUi() {
        state.pettyCash = {
            projects: [],
            periods: [],
            movements: [],
            selectedProjectId: null,
            selectedPeriodId: null,
            movementSortBy: 'recordNumber',
            movementSortDirection: 'desc',
            movementSearchQuery: '',
            receiptQueueHiddenIds: [],
            form: null,
            periodForm: null,
            editMov: null
        };
    }

    beforeEach(() => {
        registerPettyCashGlobals();
        window.render = jest.fn();
        jest.spyOn(Modal, 'prompt').mockResolvedValue('Torre A');
        indexedDBService.update.mockReset().mockResolvedValue(1);
        indexedDBService.getAll.mockReset().mockResolvedValue([]);
    });

    afterEach(() => {
        state.pettyCash = null;
        delete window.render;
    });

    test('ON + active vigente ⇒ nace vinculado al active', async () => {
        setProjectsEnabled(true);
        seedEmptyUi();
        jest.spyOn(projectContext, 'getActiveProjectId').mockResolvedValue('PRJ-ACTIVE');
        jest.spyOn(defaultProjectService, 'ensureDefaultProject')
            .mockResolvedValue({ id: 'PRJ-DEFAULT' });

        await window.pcNewProject();

        const created = state.pettyCash.projects[0];
        expect(created).toBeDefined();
        expect(Object.prototype.hasOwnProperty.call(created, OFFICIAL_LINK_KEY)).toBe(true);
        expect(created[OFFICIAL_LINK_KEY]).toBe('PRJ-ACTIVE');
    });

    test('ON sin active ⇒ fallback al default canónico', async () => {
        setProjectsEnabled(true);
        seedEmptyUi();
        jest.spyOn(projectContext, 'getActiveProjectId').mockResolvedValue(null);
        jest.spyOn(defaultProjectService, 'ensureDefaultProject')
            .mockResolvedValue({ id: 'PRJ-DEFAULT' });

        await window.pcNewProject();

        const created = state.pettyCash.projects[0];
        expect(created[OFFICIAL_LINK_KEY]).toBe('PRJ-DEFAULT');
    });

    test('OFF ⇒ sin own-key aunque haya contexto disponible', async () => {
        setProjectsEnabled(false);
        seedEmptyUi();
        const activeSpy = jest.spyOn(projectContext, 'getActiveProjectId');
        const defaultSpy = jest.spyOn(defaultProjectService, 'ensureDefaultProject');

        await window.pcNewProject();

        const created = state.pettyCash.projects[0];
        expect(Object.prototype.hasOwnProperty.call(created, OFFICIAL_LINK_KEY)).toBe(false);
        expect(activeSpy).not.toHaveBeenCalled();
        expect(defaultSpy).not.toHaveBeenCalled();
    });
});
