import {
    createMiniRosterPackage,
    exportMiniRosterJSON,
    MiniAttendanceInboxStore,
    MiniAttendanceReplayConflictError,
    MINI_ROSTER_CHECKSUM_NOTICE
} from '../modules/services/MiniAttendanceInboxStore.js';

class MemoryDB {
    constructor() {
        this.stores = new Map();
        this.updates = [];
    }
    store(name) {
        if (!this.stores.has(name)) this.stores.set(name, new Map());
        return this.stores.get(name);
    }
    async get(name, key) {
        return this.store(name).get(key);
    }
    async getAll(name) {
        return [...this.store(name).values()];
    }
    async update(name, value) {
        this.updates.push(name);
        this.store(name).set(value.eventId, JSON.parse(JSON.stringify(value)));
    }
}

const expectedScope = {
    ownerUid: 'owner-1', siteId: 'obra-1', sourceId: 'mini-principal'
};
const eventId = '123e4567-e89b-42d3-a456-426614174000';
function envelope(overrides = {}) {
    return {
        schema: 'mini-attendance/v1',
        eventId,
        scope: expectedScope,
        deviceId: 'phone-1',
        clientSequence: 7,
        rosterVersion: 'roster-3',
        capturedAt: '2026-07-29T12:00:00.000Z',
        rows: [{
            sourceEmployeeId: 'mini-u1',
            number: '001',
            name: 'Ana',
            status: 'present',
            hours: 8
        }],
        ...overrides
    };
}
function raw(value = envelope()) {
    return JSON.stringify(value);
}

describe('MiniAttendanceInboxStore', () => {
    test('imports the same immutable event twice as one pending inbox item', async () => {
        const db = new MemoryDB();
        const store = new MiniAttendanceInboxStore({ db, now: () => 100 });
        const first = await store.importJSON(raw(), {
            expectedScope, currentRosterVersion: 'roster-3'
        });
        const second = await store.importJSON(raw(), {
            expectedScope, currentRosterVersion: 'roster-3'
        });

        expect(first).toMatchObject({
            outcome: 'imported',
            record: { status: 'pending', blockers: [], receivedAt: 100 }
        });
        expect(Object.isFrozen(first.record.sourceSnapshot)).toBe(true);
        expect(second.outcome).toBe('duplicate');
        expect(await store.list()).toHaveLength(1);
        expect(db.updates).toEqual(['miniAttendanceInbox']);
    });

    test('rejects a replay with different content without overwriting the source', async () => {
        const db = new MemoryDB();
        const store = new MiniAttendanceInboxStore({ db });
        await store.importJSON(raw(), { expectedScope });

        await expect(store.importJSON(raw(envelope({
            rows: [{ ...envelope().rows[0], hours: 9 }]
        })), { expectedScope })).rejects.toBeInstanceOf(MiniAttendanceReplayConflictError);
        expect((await store.get(eventId)).sourceSnapshot.rows[0].hours).toBe(8);
    });

    test('rejects invalid schema, scope, hours and unsafe fields', async () => {
        const store = new MiniAttendanceInboxStore({ db: new MemoryDB() });
        const attempts = [
            envelope({ schema: 'mini-attendance/v2' }),
            envelope({ scope: { ...expectedScope, siteId: 'otra-obra' } }),
            envelope({ rows: [{ ...envelope().rows[0], hours: 25 }] }),
            { ...envelope(), token: 'must-not-enter-SA' }
        ];

        for (const value of attempts) {
            await expect(store.importJSON(raw(value), { expectedScope })).rejects.toThrow();
        }
        expect(await store.list()).toEqual([]);
    });

    test('marks stale roster without touching canonical attendance', async () => {
        const db = new MemoryDB();
        db.store('attendance').set('sentinel', { hoursWorked: 8 });
        const store = new MiniAttendanceInboxStore({ db });
        const result = await store.importJSON(raw(), {
            expectedScope, currentRosterVersion: 'roster-4'
        });

        expect(result.record.blockers).toEqual(['stale_roster']);
        expect(db.updates).toEqual(['miniAttendanceInbox']);
        expect(db.store('attendance').get('sentinel')).toEqual({ hoursWorked: 8 });
    });

    test('exports the canonical Mini roster package without sensitive employee data', () => {
        const input = {
            scope: expectedScope,
            rosterVersion: 'roster-3',
            generatedAt: '2026-07-29T12:00:00.000Z',
            employees: [{
                id: 'sa-u1', number: '001', name: 'Ana', position: 'Ayudante',
                salary: 100, password: 'never'
            }]
        };
        const roster = createMiniRosterPackage(input);

        expect(roster.checksum).toBe('fnv1a32:8fbd3f96');
        expect(JSON.parse(exportMiniRosterJSON(input))).toEqual(roster);
        expect(roster.employees[0]).toEqual({
            id: 'sa-u1', number: '001', name: 'Ana', position: 'Ayudante'
        });
        expect(MINI_ROSTER_CHECKSUM_NOTICE).toMatch(/not an authenticity signature/);
    });
});
