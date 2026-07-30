import {
    buildDefaultMiniAttendanceAliasScope,
    MiniAttendanceAliasConflictError,
    MiniAttendanceAliasStore
} from '../modules/services/MiniAttendanceAliasStore.js';

class MemoryDB {
    constructor() {
        this.stores = new Map();
    }
    store(name) {
        if (!this.stores.has(name)) this.stores.set(name, new Map());
        return this.stores.get(name);
    }
    async get(name, key) {
        return this.store(name).get(key);
    }
    async atomicUpdate(entries) {
        entries.forEach(({ storeName, data }) => {
            const key = data.auditId || data.aliasId;
            this.store(storeName).set(key, JSON.parse(JSON.stringify(data)));
        });
    }
    async query(name, indexName, value) {
        return [...this.store(name).values()].filter(item => item[indexName] === value);
    }
}

const scope = { ownerUid: 'owner-a', siteId: 'site-a', sourceId: 'mini-principal' };
const employee = { id: 'e117', number: '117', name: 'Pedro Rodríguez', active: true };

describe('MiniAttendanceAliasStore', () => {
    test('persists an exact scoped number+name identity across store instances', async () => {
        const db = new MemoryDB();
        const alias = await new MiniAttendanceAliasStore({ db, now: () => 100 })
            .record({ scope, rawNumber: '017', rawName: 'Pédro', targetEmployeeId: 'e117' });
        const reloaded = new MiniAttendanceAliasStore({ db, now: () => 200 });

        await expect(reloaded.lookup({
            scope, rawNumber: '17', rawName: 'pedro', employees: [employee]
        })).resolves.toMatchObject({ status: 'remembered', alias: { aliasId: alias.aliasId } });
        await expect(reloaded.lookup({
            scope, rawNumber: '17', rawName: 'Juan', employees: [employee]
        })).resolves.toMatchObject({ status: 'missing' });
        await expect(reloaded.lookup({
            scope: { ...scope, siteId: 'site-b' },
            rawNumber: '17', rawName: 'Pedro', employees: [employee]
        })).resolves.toMatchObject({ status: 'missing' });
    });

    test('rejects missing and inactive targets as stale', async () => {
        const db = new MemoryDB();
        const store = new MiniAttendanceAliasStore({ db, now: () => 100 });
        await store.record({ scope, rawNumber: '17', rawName: 'Pedro', targetEmployeeId: 'e117' });

        await expect(store.lookup({
            scope, rawNumber: '17', rawName: 'Pedro', employees: []
        })).resolves.toMatchObject({ status: 'stale', reason: 'target_missing' });
        await expect(store.lookup({
            scope, rawNumber: '17', rawName: 'Pedro',
            employees: [{ ...employee, active: false }]
        })).resolves.toMatchObject({ status: 'stale', reason: 'target_inactive' });
    });

    test('requires explicit replacement and records revisioned audit', async () => {
        const db = new MemoryDB();
        const store = new MiniAttendanceAliasStore({ db, now: () => 100 });
        const first = await store.record({
            scope, rawNumber: '17', rawName: 'Pedro', targetEmployeeId: 'e117'
        });

        await expect(store.record({
            scope, rawNumber: '17', rawName: 'Pedro', targetEmployeeId: 'e203'
        })).rejects.toBeInstanceOf(MiniAttendanceAliasConflictError);
        const replaced = await store.record({
            scope, rawNumber: '17', rawName: 'Pedro', targetEmployeeId: 'e203'
        }, { allowReplace: true, actorUid: 'supervisor' });
        const history = await store.history(first.aliasId);

        expect(replaced).toMatchObject({ revision: 2, targetEmployeeId: 'e203', active: true });
        expect(history.map(event => event.eventType)).toEqual(['created', 'replaced']);
        expect(history[1]).toMatchObject({
            previousTargetEmployeeId: 'e117', targetEmployeeId: 'e203',
            actorUid: 'supervisor'
        });
    });

    test('forget creates a tombstone and an audit event', async () => {
        const db = new MemoryDB();
        const store = new MiniAttendanceAliasStore({ db, now: () => 100 });
        const first = await store.record({
            scope, rawNumber: '17', rawName: 'Pedro', targetEmployeeId: 'e117'
        });
        const forgotten = await store.forget({ scope, rawNumber: '17', rawName: 'Pedro' });

        expect(forgotten).toMatchObject({ revision: 2, active: false, tombstonedAt: 100 });
        await expect(store.lookup({
            scope, rawNumber: '17', rawName: 'Pedro', employees: [employee]
        })).resolves.toMatchObject({ status: 'stale', reason: 'tombstoned' });
        expect((await store.history(first.aliasId)).at(-1).eventType).toBe('forgotten');
    });

    test('lists active aliases by scope and forgets all without deleting audit history', async () => {
        const db = new MemoryDB();
        const store = new MiniAttendanceAliasStore({ db, now: () => 100 });
        await store.record({
            scope, rawNumber: '17', rawName: 'Pedro', targetEmployeeId: 'e117'
        });
        await store.record({
            scope, rawNumber: '18', rawName: 'Juana', targetEmployeeId: 'e118'
        });
        await store.record({
            scope: { ...scope, siteId: 'site-b' },
            rawNumber: '19', rawName: 'Luis', targetEmployeeId: 'e119'
        });

        await expect(store.list(scope)).resolves.toHaveLength(2);
        await expect(store.forgetAll(scope, { actorUid: 'supervisor' }))
            .resolves.toEqual({ forgottenCount: 2 });
        await expect(store.list(scope)).resolves.toEqual([]);
        await expect(store.list(scope, { includeInactive: true })).resolves.toHaveLength(2);
        expect([...db.store('miniAttendanceAliasAudit').values()]
            .filter(event => event.eventType === 'forgotten')).toHaveLength(2);
    });

    test('builds one stable default scope for online and local use', () => {
        expect(buildDefaultMiniAttendanceAliasScope('owner-a')).toEqual({
            ownerUid: 'owner-a',
            siteId: 'sa-current-site',
            sourceId: 'mini-whatsapp'
        });
        expect(buildDefaultMiniAttendanceAliasScope(null).ownerUid).toBe('local-device');
    });
});
