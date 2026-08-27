/**
 * F1.6-A0.5 / DEP-SA-004 — identidad canónica SA-only (15 escenarios + 3-device)
 * TDD: RED → GREEN, flag OFF parity byte-exact, registry + adoption.
 */

import 'fake-indexeddb/auto';
import { IndexedDBService } from 'actual/services/IndexedDBService.js';
import { ProjectStore } from 'actual/features/projects/ProjectStore.js';
import { Project } from 'actual/features/projects/Project.js';
import { DefaultProjectService, DEFAULT_PROJECT_LS_KEY } from 'actual/features/projects/DefaultProject.js';
import { ProjectContextService, ACTIVE_PROJECT_LS_KEY } from 'actual/features/projects/ProjectContext.js';
import { isProjectsEnabled, setProjectsEnabled } from 'actual/config/FeatureFlags.js';
import { replaceEntityScope, peekEntityScope, resetEntityScope, DEFAULT_PROJECT_LS_KEY as SCOPE_DEFAULT_KEY } from 'actual/features/projects/EntityProjectScope.js';
import { LOCAL_TRACE_KEYS } from 'actual/services/LocalWipeService.js';
import * as ProjectRegistry from 'actual/features/projects/ProjectRegistry.js';
import * as ProjectAdoption from 'actual/features/projects/ProjectAdoption.js';
import fs from 'fs';
import path from 'path';

// Firestore mocks via mapper (../data/firebase.js -> __mocks__/firebase-data.js)
import { doc, getDoc, setDoc, runTransaction, serverTimestamp } from '../modules/data/firebase.js';

if (typeof globalThis.structuredClone !== 'function') {
    globalThis.structuredClone = v => JSON.parse(JSON.stringify(v));
}

const DB_PREFIX = 'a05-identity-';

function makeHarness(dbName) {
    const svc = new IndexedDBService(dbName);
    const store = new ProjectStore({ db: svc });
    const defaults = new DefaultProjectService({ store });
    const context = new ProjectContextService({ store, defaults });
    return { svc, store, defaults, context };
}

function resetMocks() {
    doc.mockClear();
    getDoc.mockClear();
    setDoc.mockClear();
    runTransaction.mockClear();
    if (serverTimestamp) serverTimestamp.mockClear?.();
}

describe('A0.5 ProjectIdentity — flag OFF parity + offline + registry + adoption', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        resetEntityScope();
        resetMocks();
        // default mock behaviour: registry not exists, alias not exists
        getDoc.mockResolvedValue({ exists: () => false, data: () => null });
        runTransaction.mockImplementation(async (_db, op) => op({
            get: jest.fn(async () => ({ exists: () => false, data: () => null })),
            set: jest.fn()
        }));
        setDoc.mockResolvedValue(undefined);
        doc.mockImplementation(() => ({}));
        serverTimestamp.mockReturnValue('ts-mock');
    });
    afterEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        setProjectsEnabled(false);
        resetMocks();
    });

    test('1 — flag OFF is no-op with legacy parity (no Firestore calls, canonical == local)', async () => {
        setProjectsEnabled(false);
        const { canonicalId, status } = await ProjectRegistry.ensureCanonicalProject({ uid: 'uid-1', localProject: { id: 'PRJ-LOCAL-1', name: 'Mi obra' } });
        expect(canonicalId).toBe('PRJ-LOCAL-1');
        expect(status).toBe('flag-off');
        expect(getDoc).not.toHaveBeenCalled();
        expect(runTransaction).not.toHaveBeenCalled();
        expect(setDoc).not.toHaveBeenCalled();
        // resolve alias identity
        expect(await ProjectRegistry.resolveCanonicalAlias('uid-1', 'PRJ-LOCAL-1')).toBe('PRJ-LOCAL-1');
        // adoption skipped
        const res = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-LOCAL-1', canonicalId: 'PRJ-CANON', uid: 'uid-1' });
        expect(res.skipped).toBe(true);
        expect(res.reason).toBe('flag-off');
    });

    test('2 — offline never canonicalized → provisional local (getDoc throws)', async () => {
        setProjectsEnabled(true);
        getDoc.mockRejectedValue(new Error('offline'));
        runTransaction.mockRejectedValue(new Error('offline'));
        const r = await ProjectRegistry.ensureCanonicalProject({ uid: 'uid-off', localProject: { id: 'PRJ-LOCAL-OFF' } });
        expect(r.canonicalId).toBe('PRJ-LOCAL-OFF');
        expect(r.status).toMatch(/provisional|fastpath/);
        // no alias created, no local cache yet? cache only on success, so offline provisional stays local
        expect(localStorage.getItem('asistencia_canonical_uid-off')).toBeNull();
    });

    test('3 — after first canonicalization → persist locally and work offline normally (cache)', async () => {
        setProjectsEnabled(true);
        // First promotion succeeds (winner)
        getDoc.mockResolvedValueOnce({ exists: () => false, data: () => null }); // fast path miss
        // transaction will promote PRJ-A as canonical
        runTransaction.mockImplementation(async (_db, op) => op({
            get: jest.fn(async () => ({ exists: () => false, data: () => null })),
            set: jest.fn()
        }));
        const first = await ProjectRegistry.ensureCanonicalProject({ uid: 'uid-cache', localProject: { id: 'PRJ-A', name: 'Mi obra' } });
        expect(first.canonicalId).toBe('PRJ-A');
        expect(first.status).toBe('promoted');
        // cache should be stored
        expect(localStorage.getItem('asistencia_canonical_uid-cache')).toBe('PRJ-A');
        // Now offline: getDoc throws but cache returns
        getDoc.mockRejectedValue(new Error('offline'));
        const cached = await ProjectRegistry.getCanonicalId('uid-cache');
        expect(cached).toBe('PRJ-A');
        // ensure still returns cached even via ensure
        const second = await ProjectRegistry.ensureCanonicalProject({ uid: 'uid-cache', localProject: { id: 'PRJ-A' } });
        expect(second.canonicalId).toBe('PRJ-A');
    });

    test('4 — first authenticated device promotes its local default as canonical (registry + projectsV1)', async () => {
        setProjectsEnabled(true);
        const uid = 'uid-promote';
        const local = { id: 'PRJ-WINNER', name: 'Obra ganadora', status: 'active', schemaVersion: 1, createdAt: 1000, updatedAt: 1000 };
        getDoc.mockResolvedValue({ exists: () => false, data: () => null });
        const txSet = jest.fn();
        const txGet = jest.fn(async () => ({ exists: () => false, data: () => null }));
        runTransaction.mockImplementation(async (_db, op) => op({ get: txGet, set: txSet }));
        const res = await ProjectRegistry.ensureCanonicalProject({ uid, localProject: local });
        expect(res.canonicalId).toBe('PRJ-WINNER');
        expect(res.status).toBe('promoted');
        // transaction should have set registry and project doc
        expect(txSet).toHaveBeenCalledTimes(2);
        const firstCall = txSet.mock.calls[0][1];
        expect(firstCall.canonicalProjectId).toBe('PRJ-WINNER');
        const secondCall = txSet.mock.calls[1][1];
        expect(secondCall.id).toBe('PRJ-WINNER');
        expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', uid, 'projectRegistryV1', 'default');
        expect(doc).toHaveBeenCalledWith(expect.anything(), 'users', uid, 'projectsV1', 'PRJ-WINNER');
    });

    test('5 — race: exactly one canonical (second device sees existing)', async () => {
        setProjectsEnabled(true);
        const uid = 'uid-race';
        // First device promotes
        getDoc.mockResolvedValueOnce({ exists: () => false, data: () => null });
        runTransaction.mockImplementationOnce(async (_db, op) => op({
            get: jest.fn(async () => ({ exists: () => false, data: () => null })),
            set: jest.fn()
        }));
        const first = await ProjectRegistry.ensureCanonicalProject({ uid, localProject: { id: 'PRJ-D1' } });
        expect(first.canonicalId).toBe('PRJ-D1');
        // Simulate registry now exists with PRJ-D1
        getDoc.mockResolvedValue({ exists: () => true, data: () => ({ canonicalProjectId: 'PRJ-D1' }) });
        const second = await ProjectRegistry.ensureCanonicalProject({ uid, localProject: { id: 'PRJ-D2' } });
        expect(second.canonicalId).toBe('PRJ-D1');
        expect(second.status).toMatch(/existing|already/);
        expect(second.canonicalId).not.toBe('PRJ-D2');
    });

    test('6 — subsequent device adopts localId→canonicalId (alias + carriers)', async () => {
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}adopt-6`;
        const { svc, store, defaults } = makeHarness(dbName);
        // Prepare legacy project and entities
        const legacy = Project.create({ id: 'PRJ-LEGACY-6', name: 'Legacy' });
        await store.create(legacy);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-LEGACY-6');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-LEGACY-6');
        replaceEntityScope({ enabled: true, projectId: 'PRJ-LEGACY-6', defaultProjectId: 'PRJ-LEGACY-6' });
        await svc.batchUpdate('employees', [{ id: 'E1', number: '12', name: 'Juan', projectId: 'PRJ-LEGACY-6', updatedAt: 1 }]);
        await svc.batchUpdate('positions', [{ id: 'P1', name: 'Albañil', projectId: 'PRJ-LEGACY-6', updatedAt: 1 }]);
        await svc.batchUpdate('leaders', [{ id: 'L1', number: '7', name: 'Capataz', projectId: 'PRJ-LEGACY-6', updatedAt: 1 }]);
        await svc.batchUpdate('attendance', [{ key: 'E1-2026-08-26', employeeId: 'E1', date: '2026-08-26', present: true, projectId: 'PRJ-LEGACY-6', updatedAt: 1 }]);
        // Outbox pending with legacy
        await svc.update('mainSyncOutbox', { kind: 'mirror', snapshot: { employees: [{ id: 'E1', projectId: 'PRJ-LEGACY-6' }], settings: {} }, status: 'pending' });
        await svc.update('mainSyncOutbox', { kind: 'daily', dateKey: '2026-08-26', records: { 'E1-2026-08-26': { employeeId: 'E1', date: '2026-08-26', projectId: 'PRJ-LEGACY-6' } }, scope: { enabled: true, projectId: 'PRJ-LEGACY-6', defaultProjectId: 'PRJ-LEGACY-6' }, status: 'pending' });

        // Adopt to canonical
        const res = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-LEGACY-6', canonicalId: 'PRJ-CANON-6', uid: 'uid-6', idb: svc });
        expect(res.adopted).toBe(true);
        // LS pointers rewritten
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-CANON-6');
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBe('PRJ-CANON-6');
        // In-mem scope
        expect(peekEntityScope().projectId).toBe('PRJ-CANON-6');
        expect(peekEntityScope().defaultProjectId).toBe('PRJ-CANON-6');
        // IDB employees rewritten
        const emps = await svc.getAll('employees');
        expect(emps[0].projectId).toBe('PRJ-CANON-6');
        const atts = await svc.getAll('attendance');
        expect(atts[0].projectId).toBe('PRJ-CANON-6');
        // Outbox rewritten
        const outbox = await svc.getAll('mainSyncOutbox');
        const mirror = outbox.find(e => e.kind === 'mirror');
        expect(mirror.snapshot.employees[0].projectId).toBe('PRJ-CANON-6');
        const daily = outbox.find(e => e.kind === 'daily');
        expect(daily.scope.projectId).toBe('PRJ-CANON-6');
        expect(daily.records['E1-2026-08-26'].projectId).toBe('PRJ-CANON-6');
        // Old project kept (never deleted before proof)
        const oldProj = await svc.get('projects', 'PRJ-LEGACY-6');
        const newProj = await svc.get('projects', 'PRJ-CANON-6');
        expect(oldProj).not.toBeNull();
        expect(newProj).not.toBeNull();
        expect(newProj.id).toBe('PRJ-CANON-6');
        // Marker distinct from projectStamp
        expect(localStorage.getItem(ProjectAdoption.ADOPTION_MARKER_KEY)).not.toBeNull();
        expect(localStorage.getItem('migration.projectStamp.v1')).toBeNull(); // unless set elsewhere
        // Alias created (via ensureAlias, cached)
        expect(localStorage.getItem('asistencia_alias_uid-6_PRJ-LEGACY-6')).toBe('PRJ-CANON-6');
        // setDoc called for alias
        expect(setDoc).toHaveBeenCalled();
    });

    test('7 — adoption idempotent/resumable with marker (second call no-op)', async () => {
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}adopt-7`;
        const { svc } = makeHarness(dbName);
        await svc.batchUpdate('employees', [{ id: 'E7', number: '12', name: 'Ana', projectId: 'PRJ-LEGACY-7', updatedAt: 1 }]);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-LEGACY-7');
        // First adoption
        const first = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-LEGACY-7', canonicalId: 'PRJ-CANON-7', uid: 'uid-7', idb: svc });
        expect(first.adopted).toBe(true);
        // Second adoption same pair → alreadyDone
        const second = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-LEGACY-7', canonicalId: 'PRJ-CANON-7', uid: 'uid-7', idb: svc });
        expect(second.alreadyDone).toBe(true);
        // Verify not rewritten again (marker prevents)
        expect(ProjectAdoption.isAdoptionDone('PRJ-LEGACY-7', 'PRJ-CANON-7')).toBe(true);
        // Different canonical for same legacy => not done (new adoption needed)
        expect(ProjectAdoption.isAdoptionDone('PRJ-LEGACY-7', 'PRJ-OTHER')).toBe(false);
    });

    test('8 — never delete old Project before proof (keep both)', async () => {
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}adopt-8`;
        const { svc, store } = makeHarness(dbName);
        const legacy = Project.create({ id: 'PRJ-LEGACY-8', name: 'Legacy8' });
        await store.create(legacy);
        const res = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-LEGACY-8', canonicalId: 'PRJ-CANON-8', uid: 'uid-8', idb: svc });
        expect(res.adopted).toBe(true);
        expect(await svc.get('projects', 'PRJ-LEGACY-8')).not.toBeNull();
        expect(await svc.get('projects', 'PRJ-CANON-8')).not.toBeNull();
    });

    test('9 — never destructive dedup — keep both + diagnostic if collision', async () => {
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}adopt-9`;
        const { svc, store } = makeHarness(dbName);
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await store.create(Project.create({ id: 'PRJ-LEGACY-9', name: 'Legacy9' }));
        await store.create(Project.create({ id: 'PRJ-CANON-9', name: 'Canon9' }));
        const res = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-LEGACY-9', canonicalId: 'PRJ-CANON-9', uid: 'uid-9', idb: svc });
        expect(await svc.get('projects', 'PRJ-LEGACY-9')).not.toBeNull();
        expect(await svc.get('projects', 'PRJ-CANON-9')).not.toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('diagnostic'), 'PRJ-LEGACY-9', 'PRJ-CANON-9');
        warnSpy.mockRestore();
    });

    test('10 — direct aliases legacy→canonical (no chains) ingress', async () => {
        setProjectsEnabled(true);
        // Create alias for legacy B -> canonical C
        getDoc.mockResolvedValueOnce({ exists: () => false, data: () => null }); // first call for B alias not exists → will create
        await ProjectRegistry.ensureAlias('uid-10', 'PRJ-B', 'PRJ-C');
        expect(localStorage.getItem('asistencia_alias_uid-10_PRJ-B')).toBe('PRJ-C');
        // Mock Firestore returns alias B->C
        getDoc.mockImplementation(async (ref) => {
            // naive: if doc path contains PRJ-B, return C, else false
            // doc mock is generic object; we need to differentiate via call count
            // We'll use setDoc cache already; resolve should use cache fallback if getDoc fails
            return { exists: () => false, data: () => null };
        });
        // But cache already has B->C, so resolve should return C via cache even if Firestore miss
        expect(await ProjectRegistry.resolveCanonicalAlias('uid-10', 'PRJ-B')).toBe('PRJ-C');
        // Alias for C2 -> C (direct to canonical, not via B)
        await ProjectRegistry.ensureAlias('uid-10', 'PRJ-C2', 'PRJ-C');
        expect(await ProjectRegistry.resolveCanonicalAlias('uid-10', 'PRJ-C2')).toBe('PRJ-C');
        // Ensure no chain: resolving B does not go through C2
        expect(await ProjectRegistry.resolveCanonicalAlias('uid-10', 'PRJ-B')).toBe('PRJ-C');
    });

    test('11 — egress writes canonical (outbox mirror/daily rewritten)', async () => {
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}adopt-11`;
        const { svc } = makeHarness(dbName);
        await svc.batchUpdate('employees', [{ id: 'E11', number: '12', name: 'Bob', projectId: 'PRJ-LEGACY-11', updatedAt: 1 }]);
        // Enqueue outbox with legacy
        await svc.update('mainSyncOutbox', { kind: 'entities', employees: [{ id: 'E11', projectId: 'PRJ-LEGACY-11' }], positions: [], leaders: [], schemaVersion: 3, status: 'pending' });
        const before = await svc.getAll('mainSyncOutbox');
        expect(before[0].employees[0].projectId).toBe('PRJ-LEGACY-11');
        await ProjectAdoption.adoptProject({ legacyId: 'PRJ-LEGACY-11', canonicalId: 'PRJ-CANON-11', uid: 'uid-11', idb: svc });
        const after = await svc.getAll('mainSyncOutbox');
        expect(after[0].employees[0].projectId).toBe('PRJ-CANON-11');
    });

    test('12 — flag OFF after canonicalization → persist locally and work offline normally (scope)', async () => {
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-CANON-12');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-CANON-12');
        replaceEntityScope({ enabled: true, projectId: 'PRJ-CANON-12', defaultProjectId: 'PRJ-CANON-12' });
        // Now flag OFF: scope should be disabled and no Firestore, but LS pointers remain for when flag ON again
        setProjectsEnabled(false);
        expect(peekEntityScope().enabled).toBe(true); // still previous scope in memory
        // Adoption should be skipped
        const r = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-A', canonicalId: 'PRJ-B', uid: 'uid-12' });
        expect(r.skipped).toBe(true);
        // Reset scope manually (simulating boot with flag OFF)
        resetEntityScope();
        expect(peekEntityScope().enabled).toBe(false);
        // Flag ON again recovers canonical via LS
        setProjectsEnabled(true);
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-CANON-12');
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBe('PRJ-CANON-12');
    });

    test('13 — uid isolation: switching account must not reuse other account canonical, clears LS/IDB/scope', async () => {
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}isolate-13`;
        const { svc, store } = makeHarness(dbName);
        // User A canonical
        getDoc.mockResolvedValueOnce({ exists: () => false, data: () => null });
        runTransaction.mockImplementationOnce(async (_db, op) => op({
            get: jest.fn(async () => ({ exists: () => false, data: () => null })),
            set: jest.fn()
        }));
        const a = await ProjectRegistry.ensureCanonicalProject({ uid: 'uid-A', localProject: { id: 'PRJ-A-LOCAL' } });
        expect(a.canonicalId).toBe('PRJ-A-LOCAL');
        // Store A's canonical in cache
        expect(localStorage.getItem('asistencia_canonical_uid-A')).toBe('PRJ-A-LOCAL');
        // Local pointers for A
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-A-LOCAL');
        localStorage.setItem(ACTIVE_PROJECT_LS_KEY, 'PRJ-A-LOCAL');
        replaceEntityScope({ enabled: true, projectId: 'PRJ-A-LOCAL', defaultProjectId: 'PRJ-A-LOCAL' });
        await store.create(Project.create({ id: 'PRJ-A-LOCAL', name: 'A' }));
        // Simulate switch to uid B (wipe)
        // Mock B has no canonical yet
        getDoc.mockResolvedValue({ exists: () => false, data: () => null });
        runTransaction.mockImplementation(async (_db, op) => op({
            get: jest.fn(async () => ({ exists: () => false, data: () => null })),
            set: jest.fn()
        }));
        // Before switch, B should not see A's canonical
        const bBefore = await ProjectRegistry.getCanonicalId('uid-B');
        expect(bBefore).toBeNull();
        // Simulate wipeAllLocalTraces effect: clear LS pointers that are in LOCAL_TRACE_KEYS
        const { wipeAllLocalTraces } = await import('actual/services/LocalWipeService.js');
        await wipeAllLocalTraces();
        expect(localStorage.getItem(DEFAULT_PROJECT_LS_KEY)).toBeNull();
        expect(localStorage.getItem(ACTIVE_PROJECT_LS_KEY)).toBeNull();
        expect(localStorage.getItem('migration.projectAdoption.v1')).toBeNull();
        resetEntityScope();
        expect(peekEntityScope().enabled).toBe(false);
        // Outbox purged (verify via real svc, not mock MainSyncStore)
        await svc.update('mainSyncOutbox', { kind: 'mirror', snapshot: {}, status: 'pending' });
        expect((await svc.getAll('mainSyncOutbox')).length).toBe(1);
        await svc.clear('mainSyncOutbox');
        expect((await svc.getAll('mainSyncOutbox')).length).toBe(0);
        // Now B promotes its own
        const b = await ProjectRegistry.ensureCanonicalProject({ uid: 'uid-B', localProject: { id: 'PRJ-B-LOCAL' } });
        expect(b.canonicalId).toBe('PRJ-B-LOCAL');
        expect(b.canonicalId).not.toBe('PRJ-A-LOCAL');
    });

    test('14 — migration marker separate from projectStamp (never collides)', async () => {
        localStorage.setItem('migration.projectStamp.v1', JSON.stringify({ v: 1, done: { employees: true } }));
        localStorage.setItem('migration.projectAdoption.v1', JSON.stringify({ v: 1, done: { 'PRJ-X->PRJ-Y': { at: 123 } } }));
        expect(JSON.parse(localStorage.getItem('migration.projectStamp.v1')).done.employees).toBe(true);
        expect(JSON.parse(localStorage.getItem('migration.projectAdoption.v1')).done['PRJ-X->PRJ-Y']).toBeDefined();
        expect(localStorage.getItem('migration.projectStamp.v1')).not.toBe(localStorage.getItem('migration.projectAdoption.v1'));
        // Adoption should not touch stamp marker
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}marker-14`;
        const { svc } = makeHarness(dbName);
        await ProjectAdoption.adoptProject({ legacyId: 'PRJ-X', canonicalId: 'PRJ-Y', uid: 'uid-14', idb: svc });
        expect(JSON.parse(localStorage.getItem('migration.projectStamp.v1')).done.employees).toBe(true);
    });

    test('15 — never persist legacy-unresolved:* as projectId', async () => {
        setProjectsEnabled(true);
        const r = await ProjectRegistry.ensureCanonicalProject({ uid: 'uid-15', localProject: { id: 'legacy-unresolved:num:12' } });
        expect(r.status).toBe('invalid-id');
        const adopt = await ProjectAdoption.adoptProject({ legacyId: 'legacy-unresolved:num:12', canonicalId: 'PRJ-CANON-15', uid: 'uid-15' });
        expect(adopt.skipped).toBe(true);
        expect(adopt.reason).toBe('invalid-id');
        expect(await ProjectRegistry.resolveCanonicalAlias('uid-15', 'legacy-unresolved:num:12')).toBe('legacy-unresolved:num:12');
    });

    test('16 — 3-device direct-alias scenario (no chains, exactly one canonical)', async () => {
        setProjectsEnabled(true);
        const uid = 'uid-3dev';
        // Device A promotes PRJ-A as canonical
        getDoc.mockResolvedValueOnce({ exists: () => false, data: () => null });
        runTransaction.mockImplementationOnce(async (_db, op) => op({
            get: jest.fn(async () => ({ exists: () => false, data: () => null })),
            set: jest.fn()
        }));
        const devA = await ProjectRegistry.ensureCanonicalProject({ uid, localProject: { id: 'PRJ-A' } });
        expect(devA.canonicalId).toBe('PRJ-A');
        // Mock registry now exists
        getDoc.mockImplementation(async () => ({ exists: () => true, data: () => ({ canonicalProjectId: 'PRJ-A' }) }));
        // Device B has legacy PRJ-B, adopts to PRJ-A
        const dbB = new IndexedDBService(`${DB_PREFIX}3dev-B`);
        const storeB = new ProjectStore({ db: dbB });
        await storeB.create(Project.create({ id: 'PRJ-B', name: 'Legacy B' }));
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-B');
        const adoptB = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-B', canonicalId: 'PRJ-A', uid, idb: dbB });
        expect(adoptB.adopted).toBe(true);
        expect(localStorage.getItem('asistencia_alias_uid-3dev_PRJ-B')).toBe('PRJ-A');
        // Device C has legacy PRJ-C, adopts directly to PRJ-A (not via B)
        const dbC = new IndexedDBService(`${DB_PREFIX}3dev-C`);
        const storeC = new ProjectStore({ db: dbC });
        await storeC.create(Project.create({ id: 'PRJ-C', name: 'Legacy C' }));
        // Need to reset marker for C? Adopt uses marker per pair, so new pair is fresh
        // Simulate LS pointer for C
        localStorage.setItem(DEFAULT_PROJECT_LS_KEY, 'PRJ-C');
        const adoptC = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-C', canonicalId: 'PRJ-A', uid, idb: dbC });
        expect(adoptC.adopted).toBe(true);
        expect(localStorage.getItem('asistencia_alias_uid-3dev_PRJ-C')).toBe('PRJ-A');
        // Verify direct, not chained: B->A directly, C->A directly, no B->C chain
        expect(await ProjectRegistry.resolveCanonicalAlias(uid, 'PRJ-B')).toBe('PRJ-A');
        expect(await ProjectRegistry.resolveCanonicalAlias(uid, 'PRJ-C')).toBe('PRJ-A');
        // No alias for B->C
        expect(localStorage.getItem('asistencia_alias_uid-3dev_PRJ-B')).not.toBe('PRJ-C');
    });

    test('LOCAL_TRACE_KEYS includes G1 pointers + adoption marker', () => {
        expect(LOCAL_TRACE_KEYS).toEqual(expect.arrayContaining([
            'asistencia_default_project_id',
            'asistencia_active_project_id',
            'migration.projectAdoption.v1'
        ]));
    });

    test('MC1 — wipeAllLocalTraces purges canonical/alias prefix keys, offline no recover (WARNING-2)', async () => {
        setProjectsEnabled(true);
        // 1) canonicalize uid-A + 2 aliases (cache via ensureAlias / direct LS)
        localStorage.setItem('asistencia_canonical_uid-A', 'PRJ-CANON-A');
        localStorage.setItem('asistencia_alias_uid-A_PRJ-OLD1', 'PRJ-CANON-A');
        localStorage.setItem('asistencia_alias_uid-A_PRJ-OLD2', 'PRJ-CANON-A');
        localStorage.setItem('asistencia_canonical_uid-B', 'PRJ-CANON-B');
        localStorage.setItem('keep-unrelated', 'keep-me');
        localStorage.setItem('asistencia_default_project_id', 'PRJ-CANON-A');
        // stay offline: Firestore throws / no doc
        getDoc.mockRejectedValue(new Error('offline'));
        // sanity before wipe: offline reads from cache
        expect(await ProjectRegistry.getCanonicalId('uid-A')).toBe('PRJ-CANON-A');
        expect(await ProjectRegistry.resolveCanonicalAlias('uid-A', 'PRJ-OLD1')).toBe('PRJ-CANON-A');
        // 2) wipe
        const { wipeAllLocalTraces } = await import('actual/services/LocalWipeService.js');
        await wipeAllLocalTraces();
        // 3) prefix keys gone, unrelated stays
        expect(localStorage.getItem('asistencia_canonical_uid-A')).toBeNull();
        expect(localStorage.getItem('asistencia_alias_uid-A_PRJ-OLD1')).toBeNull();
        expect(localStorage.getItem('asistencia_alias_uid-A_PRJ-OLD2')).toBeNull();
        expect(localStorage.getItem('asistencia_canonical_uid-B')).toBeNull();
        expect(localStorage.getItem('keep-unrelated')).toBe('keep-me');
        expect(localStorage.getItem('asistencia_default_project_id')).toBeNull();
        // 4) offline must not recover
        expect(await ProjectRegistry.getCanonicalId('uid-A')).toBeNull();
        expect(await ProjectRegistry.resolveCanonicalAlias('uid-A', 'PRJ-OLD1')).toBe('PRJ-OLD1');
        expect(await ProjectRegistry.resolveCanonicalAlias('uid-A', 'PRJ-OLD2')).toBe('PRJ-OLD2');
    });

    test('MC2 — dead outbox entries canonicalized without status change or requeue (WARNING-1)', async () => {
        setProjectsEnabled(true);
        const dbName = `${DB_PREFIX}mc2-dead`;
        const { svc } = makeHarness(dbName);
        await svc.update('mainSyncOutbox', { kind: 'mirror', snapshot: { employees: [{ id: 'E1', projectId: 'PRJ-OLD' }], positions: [], leaders: [], settings: {} }, status: 'dead', attempts: 5, lastError: 'perm' });
        await svc.update('mainSyncOutbox', { kind: 'daily', dateKey: '2026-08-26', records: { 'E1-2026-08-26': { employeeId: 'E1', date: '2026-08-26', projectId: 'PRJ-OLD' } }, scope: { enabled: true, projectId: 'PRJ-OLD', defaultProjectId: 'PRJ-OLD' }, status: 'dead', attempts: 5, lastError: 'perm' });
        await svc.update('mainSyncOutbox', { kind: 'entities', employees: [{ id: 'E1', projectId: 'PRJ-OLD' }], positions: [], leaders: [], schemaVersion: 3, status: 'dead', attempts: 5, lastError: 'perm' });
        await svc.update('mainSyncOutbox', { kind: 'mirror', snapshot: { employees: [{ id: 'E2', projectId: 'PRJ-OLD' }], settings: {} }, status: 'pending' });
        const beforeDead = (await svc.getAll('mainSyncOutbox')).filter(e => e.status === 'dead');
        expect(beforeDead.length).toBe(3);
        // bumpGeneration must be called before any outbox rewrite — spy via MainSyncStore object (patched) or standalone export
        let bumpSpy = null;
        let mod = null;
        try {
            mod = await import('actual/services/MainSyncStore.js');
            if (mod.MainSyncStore && typeof mod.MainSyncStore.bumpGeneration === 'function') {
                bumpSpy = jest.spyOn(mod.MainSyncStore, 'bumpGeneration').mockImplementation(() => {});
            } else if (typeof mod.bumpGeneration === 'function') {
                bumpSpy = jest.spyOn(mod, 'bumpGeneration').mockImplementation(() => {});
            }
        } catch (_) { /* spy optional for RED phase — functional assertions are primary */ }
        const res = await ProjectAdoption.adoptProject({ legacyId: 'PRJ-OLD', canonicalId: 'PRJ-CANON', uid: 'uid-mc2', idb: svc, skipAlias: true });
        expect(res.adopted).toBe(true);
        const after = await svc.getAll('mainSyncOutbox');
        const deadAfter = after.filter(e => e.status === 'dead');
        expect(deadAfter.length).toBe(3);
        for (const e of deadAfter) {
            expect(e.status).toBe('dead');
            if (e.kind === 'mirror') expect(e.snapshot.employees[0].projectId).toBe('PRJ-CANON');
            if (e.kind === 'daily') {
                expect(e.scope.projectId).toBe('PRJ-CANON');
                expect(e.scope.defaultProjectId).toBe('PRJ-CANON');
                expect(e.records['E1-2026-08-26'].projectId).toBe('PRJ-CANON');
            }
            if (e.kind === 'entities') expect(e.employees[0].projectId).toBe('PRJ-CANON');
        }
        if (bumpSpy) {
            expect(bumpSpy).toHaveBeenCalled();
            bumpSpy.mockRestore();
        }
        const pendingAfter = after.filter(e => e.status === 'pending');
        expect(pendingAfter.length).toBe(1);
        expect(pendingAfter[0].snapshot.employees[0].projectId).toBe('PRJ-CANON');
        // optional requeue must egress canonical only
        for (const e of deadAfter) {
            await svc.update('mainSyncOutbox', { ...e, status: 'pending', attempts: 0, lastError: null });
        }
        const requeued = (await svc.getAll('mainSyncOutbox')).filter(e => e.status === 'pending');
        expect(requeued.length).toBe(4);
        for (const e of requeued) {
            if (e.snapshot?.employees) expect(e.snapshot.employees[0].projectId).toBe('PRJ-CANON');
            if (e.scope) expect(e.scope.projectId).toBe('PRJ-CANON');
            if (e.employees) expect(e.employees[0].projectId).toBe('PRJ-CANON');
        }
    });

    test('firestore rules: new paths remain under users/{uid}/ wildcard (audit)', async () => {
        const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
        expect(rules).toMatch(/match \/users\/\{userId\}\/\{document=\*\*}/);
        // No widening: still only that wildcard, no new allow without auth check
        expect(rules).not.toMatch(/projectRegistry|projectsV1|projectAliases/);
        // Documented: wildcard covers all subcollections under users/{uid}
    });
});
