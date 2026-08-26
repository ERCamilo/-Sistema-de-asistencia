/**
 * F1.1 — Project model v1 (F0.3 + P5). Pure unit suite: state machine guards,
 * factory id/timestamps, and hasOwnProperty conditional serialization
 * (absent optionals stay absent → byte-stable payloads, same rationale as
 * Employee deletedAt).
 */

import {
    Project,
    PROJECT_STATUS,
    PROJECT_SCHEMA_VERSION
} from '../modules/features/projects/Project.js';

const OPTIONAL_KEYS = ['closedAt', 'archivedAt', 'startDate', 'endDate', 'createdBy', 'metadata'];

/** Builds a project legally parked on the requested status. */
function projectIn(status) {
    const project = Project.create({ name: 'Obra' });
    if (status === PROJECT_STATUS.CLOSED || status === PROJECT_STATUS.ARCHIVED) project.close();
    if (status === PROJECT_STATUS.ARCHIVED) project.archive();
    return project;
}

describe('Project model (F0.3 v1)', () => {
    test('create() stamps PRJ id + timestamps and defaults status/schemaVersion', () => {
        const before = Date.now();
        const project = Project.create({ name: 'Obra Centro' });

        expect(project.id).toMatch(/^PRJ-[a-z0-9]+-.{4}$/);
        expect(project.name).toBe('Obra Centro');
        expect(project.status).toBe(PROJECT_STATUS.ACTIVE);
        expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
        expect(project.createdAt).toBeGreaterThanOrEqual(before);
        // A newborn project must not look fresher than itself in LWW merges.
        expect(project.updatedAt).toBe(project.createdAt);
    });

    test('factory ids stay format-stable across many creations', () => {
        for (let i = 0; i < 25; i++) {
            expect(Project.create({ name: `P${i}` }).id).toMatch(/^PRJ-[a-z0-9]+-.{4}$/);
        }
    });

    test('create() rejects empty names', () => {
        expect(() => Project.create({ name: '   ' })).toThrow(/nombre/i);
    });

    test('valid lifecycle active→closed→active→closed→archived→closed per F0.3 §2', () => {
        const before = Date.now();
        const project = Project.create({ name: 'Ciclo' });

        project.close();
        expect(project.status).toBe(PROJECT_STATUS.CLOSED);
        expect(project.closedAt).toBeGreaterThanOrEqual(before);
        expect(project.updatedAt).toBeGreaterThanOrEqual(before);

        project.reopen();
        expect(project.status).toBe(PROJECT_STATUS.ACTIVE);
        expect(project).not.toHaveProperty('closedAt');

        project.close();
        project.archive();
        expect(project.status).toBe(PROJECT_STATUS.ARCHIVED);
        expect(project.archivedAt).toBeGreaterThanOrEqual(before);
        expect(project).toHaveProperty('closedAt');

        // archived NEVER reopens directly: unarchive lands back on closed.
        project.unarchive();
        expect(project.status).toBe(PROJECT_STATUS.CLOSED);
        expect(project).not.toHaveProperty('archivedAt');
    });

    test.each([
        ['close', 'closed'], ['close', 'archived'],
        ['reopen', 'active'], ['reopen', 'archived'],
        ['archive', 'active'], ['archive', 'archived'],
        ['unarchive', 'active'], ['unarchive', 'closed']
    ])('invalid transition %s() from %s throws descriptively', (action, from) => {
        expect(() => projectIn(from)[action]()).toThrow(new RegExp(from));
    });

    test('toJSON omits absent optionals and round-trips present ones byte-stably', () => {
        const minimalJson = Project.create({ name: 'Mínima' }).toJSON();
        for (const key of OPTIONAL_KEYS) {
            expect(minimalJson).not.toHaveProperty(key);
        }

        const full = Project.create({
            name: 'Completa',
            createdBy: 'uid-1',
            startDate: 1000,
            endDate: 2000,
            metadata: {
                notes: 'n', icon: 'hard-hat', color: '#ffffff',
                clonedFrom: { sourceProjectId: 'PRJ-abc-1234', copiedAt: 5, copiedEntities: ['employees'] }
            }
        });
        full.close();

        const revived = Project.fromJSON(JSON.parse(JSON.stringify(full.toJSON())));
        expect(revived).toEqual(full);

        const revivedMinimal = Project.fromJSON(JSON.parse(JSON.stringify(minimalJson)));
        expect(revivedMinimal.toJSON()).not.toHaveProperty('metadata');
    });

    test('P5: startDate/endDate are first-class from birth; explicit null survives', () => {
        const project = Project.create({ name: 'Fechas', startDate: 1723000000000, endDate: null });
        const json = project.toJSON();
        expect(json.startDate).toBe(1723000000000);
        expect(json).toHaveProperty('endDate', null);
    });
});

describe('Project invariant enforcement (S3)', () => {
    const base = { id: 'PRJ-rota-0000', createdAt: 1000, updatedAt: 1000 };

    test.each([
        ['closed sin closedAt', { ...base, name: 'Rota', status: 'closed' }, /closedAt/],
        ['archived sin closedAt', { ...base, name: 'Rota', status: 'archived', archivedAt: 2000 }, /closedAt/],
        ['archived sin archivedAt', { ...base, name: 'Rota', status: 'archived', closedAt: 1500 }, /archivedAt/]
    ])('fromJSON rejects malformed payload: %s', (_label, json, pattern) => {
        expect(() => Project.fromJSON(json)).toThrow(pattern);
    });

    test('create() rejects the same malformed statuses (single validation choke-point)', () => {
        expect(() => Project.create({ name: 'Rota', status: 'closed' })).toThrow(/closedAt/);
        expect(() => Project.create({ name: 'Rota', status: 'archived', archivedAt: 1 })).toThrow(/closedAt/);
    });

    test('legitimate guarded-transition projects round-trip WITHOUT throwing', () => {
        const closed = Project.create({ name: 'Cerrada' }).close();
        const revivedClosed = Project.fromJSON(JSON.parse(JSON.stringify(closed.toJSON())));
        expect(revivedClosed.status).toBe(PROJECT_STATUS.CLOSED);

        const archived = Project.create({ name: 'Archivada' }).close().archive();
        const revivedArchived = Project.fromJSON(JSON.parse(JSON.stringify(archived.toJSON())));
        expect(revivedArchived.status).toBe(PROJECT_STATUS.ARCHIVED);
    });
});

describe('metadata boundary clone (S5)', () => {
    test('caller-side mutation after create() never leaks into toJSON()', () => {
        const metadata = { notes: 'original', clonedFrom: { sourceProjectId: 'PRJ-src-1111' } };
        const project = Project.create({ name: 'Obra', metadata });
        metadata.notes = 'MUTADO';
        metadata.clonedFrom.sourceProjectId = 'PRJ-mut-2222';

        const payload = project.toJSON();
        expect(payload.metadata.notes).toBe('original');
        expect(payload.metadata.clonedFrom.sourceProjectId).toBe('PRJ-src-1111');
    });

    test('caller-side mutation of the stored JSON after fromJSON never leaks', () => {
        const stored = { name: 'Obra', metadata: { notes: 'original' } };
        const project = Project.fromJSON(stored);
        stored.metadata.notes = 'MUTADO';
        expect(project.toJSON().metadata.notes).toBe('original');
    });
});
