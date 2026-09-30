import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import {
    planCatalogMerge,
    findCatalogNameDuplicates,
    syncProjectCatalog,
    projectHasLocalData
} from '../modules/features/projects/ProjectCatalogSync.js';
import { ADOPTION_MARKER_KEY } from '../modules/features/projects/ProjectAdoption.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';

if (!globalThis.structuredClone) {
    globalThis.structuredClone = x => JSON.parse(JSON.stringify(x));
}

/**
 * La lista de obras se comparte entre dispositivos: unión por id, LWW por
 * updatedAt, las obras recibidas nacen con configuración de nómina y las
 * «Mi obra» vacías que deja la adopción no se publican.
 */
const project = (id, name, updatedAt = 1, extra = {}) => ({ id, name, status: 'active', createdAt: 1, updatedAt, schemaVersion: 1, ...extra });
const snapshotOf = list => ({ forEach: fn => list.forEach(item => fn({ id: item.id, data: () => ({ ...item }) })) });

describe('planCatalogMerge', () => {
    test('une por id: lo remoto desconocido se guarda y lo local ausente se publica', () => {
        const plan = planCatalogMerge([project('A', 'Obra A')], [project('B', 'Obra B')]);
        expect(plan.storeLocal.map(p => p.id)).toEqual(['B']);
        expect(plan.publish.map(p => p.id)).toEqual(['A']);
    });
    test('gana el updatedAt más reciente y el empate no escribe', () => {
        expect(planCatalogMerge([project('A', 'Viejo', 1)], [project('A', 'Nuevo', 5)]).storeLocal[0].name).toBe('Nuevo');
        expect(planCatalogMerge([project('A', 'Nuevo', 5)], [project('A', 'Viejo', 1)]).publish[0].name).toBe('Nuevo');
        expect(planCatalogMerge([project('A', 'X', 3)], [project('A', 'X', 3)])).toEqual({ storeLocal: [], publish: [] });
    });
    test('solo publica la identidad de la obra', () => {
        const [doc] = planCatalogMerge([project('A', 'Obra', 1, { secret: 'x', closedAt: null })], []).publish;
        expect(doc).toEqual({ id: 'A', name: 'Obra', status: 'active', createdAt: 1, updatedAt: 1, schemaVersion: 1 });
    });
    test('los ids excluidos no se publican ni se guardan', () => {
        expect(planCatalogMerge([project('L', 'Mi obra')], [], { excludeIds: ['L'] })).toEqual({ storeLocal: [], publish: [] });
    });
});

test('detecta obras con el mismo nombre sin distinguir mayúsculas ni espacios', () => {
    const groups = findCatalogNameDuplicates([project('A', 'Mi obra'), project('B', ' mi  OBRA '), project('C', 'Otra')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map(item => item.id).sort()).toEqual(['A', 'B']);
});

describe('syncProjectCatalog', () => {
    let db, written;
    beforeEach(async () => {
        localStorage.clear();
        setProjectsEnabled(true);
        db = new IndexedDBService('catalog-sync-' + Math.random());
        await db.init();
        written = [];
    });
    afterEach(() => { try { db.db.close(); } catch (_) { /* ignore */ } localStorage.clear(); });
    const writeDoc = async (ref, data) => { written.push(data); };

    test('recibe una obra de otro dispositivo con la configuración de nómina de la obra por defecto', async () => {
        await db.update('projects', project('CANON', 'Mi obra 1'));
        await db.update('projectPayrollConfigs', { projectId: 'CANON', regularHoursPerDay: 9, holidays: ['2026-12-25'], schemaVersion: 1, updatedAt: 1 });
        localStorage.setItem('asistencia_default_project_id', 'CANON');

        const result = await syncProjectCatalog({ uid: 'u1', idb: db, writeDoc,
            readDocs: async () => snapshotOf([project('CANON', 'Mi obra 1'), project('OTRA', 'Torre norte', 7)]) });

        expect(result.received).toBe(1);
        expect(await db.get('projects', 'OTRA')).toMatchObject({ name: 'Torre norte', updatedAt: 7 });
        expect(await db.get('projectPayrollConfigs', 'OTRA')).toMatchObject({ projectId: 'OTRA', regularHoursPerDay: 9, holidays: ['2026-12-25'], seeded: true });
        // No se republican obras; solo se suben configuraciones que la nube no tenía.
        expect(written.every(doc => doc.payrollConfig && !doc.name)).toBe(true);
    });

    test('publica las obras locales y no pisa una configuración existente', async () => {
        await db.update('projects', project('LOCAL', 'Obra local', 4));
        await db.update('projectPayrollConfigs', { projectId: 'LOCAL', regularHoursPerDay: 10, schemaVersion: 1, updatedAt: 1 });
        await syncProjectCatalog({ uid: 'u1', idb: db, writeDoc, readDocs: async () => snapshotOf([]) });
        expect(written.filter(doc => doc.name).map(doc => doc.id)).toEqual(['LOCAL']);
        expect(written.find(doc => doc.payrollConfig)).toMatchObject({ id: 'LOCAL', payrollConfig: { regularHoursPerDay: 10 } });
        expect((await db.get('projectPayrollConfigs', 'LOCAL')).regularHoursPerDay).toBe(10);
    });

    test('retira la «Mi obra» vacía que dejó la adopción y no la publica', async () => {
        await db.update('projects', project('CANON', 'Mi obra 1'));
        await db.update('projects', project('LEGACY', 'Mi obra'));
        localStorage.setItem(ADOPTION_MARKER_KEY, JSON.stringify({ v: 1, done: { 'LEGACY->CANON': { at: 1 } } }));
        localStorage.setItem('asistencia_default_project_id', 'CANON');

        const result = await syncProjectCatalog({ uid: 'u1', idb: db, writeDoc, readDocs: async () => snapshotOf([project('CANON', 'Mi obra 1')]) });

        expect(result.removed).toEqual(['LEGACY']);
        expect(await db.get('projects', 'LEGACY')).toBeFalsy();
        expect(written).toEqual([]);
    });

    test('una obra «legacy» con datos se conserva y se publica', async () => {
        await db.update('projects', project('LEGACY', 'Mi obra'));
        await db.update('employees', { id: 'e1', name: 'Ana', projectId: 'LEGACY' });
        localStorage.setItem(ADOPTION_MARKER_KEY, JSON.stringify({ v: 1, done: { 'LEGACY->CANON': { at: 1 } } }));
        expect(await projectHasLocalData('LEGACY', { idb: db })).toBe(true);
        const result = await syncProjectCatalog({ uid: 'u1', idb: db, writeDoc, readDocs: async () => snapshotOf([]) });
        expect(result.removed).toEqual([]);
        expect(written.map(doc => doc.id)).toEqual(['LEGACY']);
    });

    test('informa obras con el mismo nombre sin borrarlas', async () => {
        await db.update('projects', project('A', 'Mi obra'));
        await db.update('employees', { id: 'e1', projectId: 'A' });
        const result = await syncProjectCatalog({ uid: 'u1', idb: db, writeDoc, readDocs: async () => snapshotOf([project('B', 'Mi obra', 2)]) });
        expect(result.duplicates).toHaveLength(1);
        expect(await db.get('projects', 'A')).toBeTruthy();
        expect(await db.get('projects', 'B')).toBeTruthy();
    });

    test('sin sesión o sin red no hace nada y no lanza', async () => {
        expect(await syncProjectCatalog({ uid: null, idb: db })).toBeNull();
        expect(await syncProjectCatalog({ uid: 'u1', idb: db, readDocs: async () => { throw new Error('offline'); } })).toBeNull();
    });
});

import { planConfigMerge, toConfigDoc } from '../modules/features/projects/ProjectCatalogSync.js';

describe('configuración de nómina por obra entre dispositivos', () => {
    const cfg = (updatedAt, extra = {}) => ({ projectId: 'O', regularHoursPerDay: 8, holidays: ['2026-12-25'], payPeriod: { periodStart: '2026-09-15', periodLength: 14 }, updatedAt, ...extra });

    test('una real gana a una semilla; entre iguales gana la más reciente', () => {
        expect(planConfigMerge(cfg(9, { seeded: true }), toConfigDoc(cfg(1)))).toBe('store');
        expect(planConfigMerge(cfg(1), toConfigDoc(cfg(9, { seeded: true })))).toBe('publish');
        expect(planConfigMerge(cfg(5), toConfigDoc(cfg(7)))).toBe('store');
        expect(planConfigMerge(cfg(7), toConfigDoc(cfg(5)))).toBe('publish');
        expect(planConfigMerge(cfg(5), toConfigDoc(cfg(5)))).toBeNull();
        expect(planConfigMerge(cfg(5), null)).toBe('publish');
        expect(planConfigMerge(null, toConfigDoc(cfg(5)))).toBe('store');
    });

    describe('sincronización', () => {
        let db, written;
        beforeEach(async () => {
            localStorage.clear();
            setProjectsEnabled(true);
            db = new IndexedDBService('catalog-config-' + Math.random());
            await db.init();
            written = [];
        });
        afterEach(() => { try { db.db.close(); } catch (_) { /* ignore */ } localStorage.clear(); });
        const writeDoc = async (ref, data, options) => { written.push({ data, options }); };

        test('un dispositivo nuevo recibe la configuración real en vez de su semilla', async () => {
            const seenEvents = [];
            const listener = event => seenEvents.push(event.detail);
            window.addEventListener('payroll-config:changed', listener);
            try {
                await db.update('projects', project('O', 'Obra', 1));
                await db.update('projectPayrollConfigs', { ...cfg(Date.now(), { seeded: true }), regularHoursPerDay: 8, holidays: [] });
                const result = await syncProjectCatalog({ uid: 'u1', idb: db, writeDoc,
                    readDocs: async () => snapshotOf([{ ...project('O', 'Obra', 1), payrollConfig: toConfigDoc(cfg(100, { regularHoursPerDay: 9 })) }]) });
                expect(result.configsReceived).toBe(1);
                const stored = await db.get('projectPayrollConfigs', 'O');
                expect(stored).toMatchObject({ regularHoursPerDay: 9, holidays: ['2026-12-25'], payPeriod: { periodStart: '2026-09-15' } });
                expect(stored.seeded).toBeUndefined();
                expect(seenEvents[0]).toMatchObject({ source: 'catalog-sync', config: { projectId: 'O' } });
                expect(written).toEqual([]);
            } finally {
                window.removeEventListener('payroll-config:changed', listener);
            }
        });

        test('la configuración editada aquí se publica con merge sin tocar el resto del documento', async () => {
            await db.update('projects', project('O', 'Obra', 1));
            await db.update('projectPayrollConfigs', cfg(500));
            await syncProjectCatalog({ uid: 'u1', idb: db, writeDoc,
                readDocs: async () => snapshotOf([{ ...project('O', 'Obra', 1), payrollConfig: toConfigDoc(cfg(100)) }]) });
            expect(written).toEqual([{ data: { id: 'O', payrollConfig: expect.objectContaining({ updatedAt: 500, seeded: false }) }, options: { merge: true } }]);
        });
    });
});
