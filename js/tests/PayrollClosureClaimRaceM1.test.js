/**
 * M1 — carrera real entre la promoción de un cierre schema 2 (mismo id) y la
 * copia de recuperación (id nuevo, recovery.sourceId) desde otro dispositivo.
 *
 * La consulta `recovery.sourceId ==` de la promoción está fuera de su
 * transacción (Firestore no admite consultas transaccionales en el cliente), así
 * que no protege. La exclusión la da el cerrojo users/{uid}/payrollClosureClaims/
 * {sourceId}: ambos caminos lo leen y lo crean en su transacción. El Firestore
 * en memoria reproduce la concurrencia optimista del SDK web: si un documento
 * leído (incluido uno inexistente) cambia antes del commit, se reintenta.
 *
 * Aquí se prueban el repositorio y el almacén reales. Las reglas se ejercitan con
 * un MODELO en JS de firestore.rules (no con el emulador, que no está disponible).
 */
import * as firebase from '../modules/data/firebase.js';
import { setProjectsEnabled } from '../modules/config/FeatureFlags.js';
import { replaceEntityScope, resetEntityScope } from '../modules/features/projects/EntityProjectScope.js';
import {
    PayrollClosureRepository,
    PAYROLL_CLOSURE_CLAIM_KIND,
    _payrollClosureRepositoryInternals as repo
} from '../modules/features/payroll/PayrollClosureRepository.js';
import {
    buildPayrollClosure,
    buildPayrollClosureSnapshot,
    promoteLegacyPayrollClosure,
    voidPayrollClosure
} from '../modules/features/payroll/PayrollClosure.js';
import { planFinancialRecovery } from '../modules/features/projects/ProjectFinancialRecovery.js';
import { classifySyncError, nextEntryState } from '../modules/services/SyncErrorClassifier.js';
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));

const UID = 'user-1';
const DEFAULT = 'PRJ-DEFAULT';
const OTHER = 'PRJ-OTHER';
const clone = value => JSON.parse(JSON.stringify(value));
const closureKey = id => `users/${UID}/payrollClosures/${id}`;
const claimKey = id => `users/${UID}/payrollClosureClaims/${id}`;
const isClaimKey = key => key.includes('/payrollClosureClaims/');
const scope = { projectId: DEFAULT, defaultProjectId: DEFAULT };

function legacyClosure({ voided = false } = {}) {
    const options = { periodStart: '2026-09-01', periodEnd: '2026-09-15', closedAt: 100,
        rows: [
            { _employeeId: 'e', _number: '1', _employeeName: 'Ana', _brutoOriginal: 1000, _loans: 100, monto: 900 },
            { _employeeId: 'f', _number: '2', _employeeName: 'Luis', _brutoOriginal: 1234.56, monto: 1234.56 }
        ] };
    const closure = buildPayrollClosure({ ...options, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(options)) });
    return voided
        ? voidPayrollClosure(closure, { voidedAt: 150, voidedBy: 'auditor', voidReason: 'Pago duplicado' })
        : closure;
}

function recoveryCopy(legacy, target) {
    const projects = [{ id: DEFAULT, status: 'active' }, { id: OTHER, status: 'active' }];
    const plan = planFinancialRecovery({
        employees: ['e', 'f'].map(id => ({ id, name: id, projectId: target, loans: [] })),
        projects, payrollClosures: [legacy], employeeIds: ['e', 'f'], targetProjectId: target, timestamp: 500
    });
    expect(plan.closures).toHaveLength(1);
    return plan.closures[0];
}

const permissionDenied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

// Modelo en JS de las reglas M1 de firestore.rules, evaluado sobre el estado
// posterior al commit (getAfter/existsAfter). Solo cubre cierres y cerrojos.
function checkRulesModel(before, after, writes) {
    for (const [key] of writes) {
        const prev = before.get(key);
        const next = after.get(key);
        if (isClaimKey(key)) {
            if (prev) throw permissionDenied();                        // update: false
            const sourceId = key.split('/').pop();
            const target = after.get(closureKey(next.targetId));
            if (next.sourceId !== sourceId || !target || target.projectId !== next.projectId) throw permissionDenied();
            if (next.kind === 'promotion') {
                if (next.targetId !== sourceId || target.identityKind !== 'promoted-legacy') throw permissionDenied();
            } else if (next.kind === 'recovery-copy') {
                const source = before.get(closureKey(sourceId));
                if (target.recovery?.sourceId !== sourceId || source?.identityKind === 'promoted-legacy') throw permissionDenied();
            } else throw permissionDenied();
            continue;
        }
        const claimOf = sourceId => after.get(claimKey(sourceId));
        if (!prev && next.recovery) {
            const claim = claimOf(next.recovery.sourceId);
            if (!claim || claim.kind !== 'recovery-copy' || claim.targetId !== next.id || claim.projectId !== next.projectId) throw permissionDenied();
        }
        if (prev && prev.schemaVersion === 2 && next.identityKind === 'promoted-legacy') {
            const claim = claimOf(next.id);
            if (!claim || claim.kind !== 'promotion' || claim.targetId !== next.id || claim.projectId !== next.projectId) throw permissionDenied();
        }
    }
}

// rulesFirst: como el emulador real, las reglas se evalúan antes que la
// precondición de las lecturas; el perdedor recibe permission-denied.
function installCloud({ denyClaims = false, enforceRules = true, rulesFirst = false } = {}) {
    const docs = new Map();
    const versions = new Map();
    const cloud = { docs, gates: {}, afterQuery: null, retries: 0, denied: 0, denyClaims, enforceRules };
    const path = ref => ref.path;
    const put = (key, data) => { docs.set(key, clone(data)); versions.set(key, (versions.get(key) || 0) + 1); };
    firebase.collection.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    firebase.doc.mockImplementation((_db, ...segments) => ({ path: segments.join('/') }));
    firebase.where.mockImplementation((field, op, value) => ({ field, op, value }));
    firebase.orderBy.mockImplementation(() => ({ type: 'orderBy' }));
    firebase.limit.mockImplementation(() => ({ type: 'limit' }));
    firebase.documentId.mockImplementation(() => '__name__');
    firebase.query.mockImplementation((ref, ...constraints) => ({ ...ref, constraints }));
    const read = key => {
        const data = docs.get(key);
        return { id: key.split('/').pop(), exists: () => data !== undefined, data: () => (data ? clone(data) : null) };
    };
    const nested = (data, field) => field.split('.').reduce((value, part) => value?.[part], data);
    firebase.getDoc.mockImplementation(async ref => read(path(ref)));
    firebase.getDocs.mockImplementation(async ref => {
        const items = [...docs.entries()].filter(([key, data]) => key.startsWith(`${ref.path}/`)
            && (ref.constraints || []).every(c => !c.field || nested(data, c.field) === c.value))
            .map(([key]) => read(key));
        // Resultado ya calculado: lo que ocurra ahora no lo ve quien consultó.
        const hook = cloud.afterQuery;
        cloud.afterQuery = null;
        if (hook) await hook();
        return { docs: items, forEach: cb => items.forEach(cb) };
    });
    firebase.runTransaction.mockImplementation(async (_db, operation) => {
        for (let attempt = 0; attempt < 5; attempt++) {
            const seen = new Map();
            const writes = [];
            const result = await operation({
                get: async ref => {
                    const key = path(ref);
                    if (cloud.denyClaims && isClaimKey(key)) throw permissionDenied();
                    seen.set(key, versions.get(key) || 0);
                    return read(key);
                },
                set: (ref, data) => writes.push([path(ref), clone(data)])
            });
            const label = writes.some(([key, data]) => !isClaimKey(key) && data.recovery) ? 'copy'
                : writes.some(([key, data]) => !isClaimKey(key) && data.identityKind === 'promoted-legacy') ? 'promotion' : null;
            const gate = label && cloud.gates[label];
            if (gate) { delete cloud.gates[label]; await gate(); }
            // Commit atómico (síncrono en JS): validar lecturas, reglas y aplicar.
            if (rulesFirst && enforceRules) {
                const after = new Map(docs);
                writes.forEach(([key, data]) => after.set(key, data));
                try { checkRulesModel(docs, after, writes); } catch (error) { cloud.denied++; throw error; }
            }
            if ([...seen].some(([key, version]) => (versions.get(key) || 0) !== version)) { cloud.retries++; continue; }
            if (cloud.denyClaims && writes.some(([key]) => isClaimKey(key))) throw permissionDenied();
            if (cloud.enforceRules) {
                const after = new Map(docs);
                writes.forEach(([key, data]) => after.set(key, data));
                checkRulesModel(docs, after, writes);
            }
            writes.forEach(([key, data]) => put(key, data));
            return result;
        }
        throw new Error('transaction retries exhausted');
    });
    cloud.put = put;
    return cloud;
}

// Cuántas veces está la nómina de `sourceId` asignada a una obra en la nube.
function assignments(cloud, sourceId) {
    const closures = [...cloud.docs.entries()].filter(([key]) => key.includes('/payrollClosures/')).map(([, v]) => v);
    return closures.filter(c => (c.id === sourceId && c.identityKind === 'promoted-legacy') || c.recovery?.sourceId === sourceId);
}

function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

// Ambas transacciones leen, llegan al commit y esperan; se liberan en `order`.
function installBarrier(cloud, order) {
    const arrived = Object.fromEntries(order.map(label => [label, deferred()]));
    const release = Object.fromEntries(order.map(label => [label, deferred()]));
    for (const label of order) {
        cloud.gates[label] = async () => { arrived[label].resolve(); await release[label].promise; };
    }
    return {
        bothArrived: Promise.all(order.map(label => arrived[label].promise)),
        release: label => release[label].resolve()
    };
}

const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));

describe('M1: cerrojo atómico promoción vs copia de recuperación', () => {
    let cloud;

    beforeEach(() => {
        firebase.auth.currentUser = { uid: UID };
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: DEFAULT, defaultProjectId: DEFAULT });
        cloud = installCloud();
    });

    afterEach(() => {
        setProjectsEnabled(false);
        resetEntityScope();
        delete firebase.auth.currentUser;
        jest.restoreAllMocks();
    });

    test.each([OTHER, DEFAULT])('reproducción del informe: la consulta de copias vuelve vacía y la copia (%s) se confirma antes de la transacción de promoción', async target => {
        const legacy = legacyClosure();
        cloud.put(closureKey(legacy.id), legacy);
        const copy = recoveryCopy(legacy, target);
        cloud.afterQuery = async () => {
            await expect(PayrollClosureRepository.saveRecoveredClosure(copy)).resolves.toMatchObject({ written: true });
        };

        const promoted = await repo.promoteLegacyCloudClosure(legacy, scope);

        expect(cloud.docs.get(closureKey(legacy.id))).toEqual(legacy);   // sigue schema 2 sin obra
        expect(assignments(cloud, legacy.id)).toEqual([copy]);
        expect(cloud.docs.get(claimKey(legacy.id))).toMatchObject({ kind: 'recovery-copy', targetId: copy.id, projectId: target });
        if (target === DEFAULT) expect(promoted).toEqual(copy);
        else expect(promoted).toBeNull();
    });

    const PROMOTERS = {
        // Historial / período en la obra por defecto.
        cloud: legacy => repo.promoteLegacyCloudClosure(legacy, scope),
        // Subida de un promovido local (cola de cierres).
        upload: legacy => repo.saveOneScoped(promoteLegacyPayrollClosure(legacy, DEFAULT), scope)
    };

    const matrix = [];
    for (const promoter of Object.keys(PROMOTERS)) {
        for (const target of [OTHER, DEFAULT]) {
            for (const first of ['promotion', 'copy']) {
                for (const voided of [false, true]) matrix.push([promoter, target, first, voided]);
            }
        }
    }

    test.each(matrix)('commits entrelazados: promoción %s, copia en %s, gana %s, anulado=%s → un solo camino', async (promoter, target, first, voided) => {
        const legacy = legacyClosure({ voided });
        cloud.put(closureKey(legacy.id), legacy);
        const copy = recoveryCopy(legacy, target);
        const barrier = installBarrier(cloud, ['promotion', 'copy']);

        const promotion = settle(PROMOTERS[promoter](legacy));
        const recovery = settle(PayrollClosureRepository.saveRecoveredClosure(copy));
        await barrier.bothArrived;                 // ambas leyeron: sin cerrojo, sin copia, original sin promover
        const second = first === 'promotion' ? 'copy' : 'promotion';
        barrier.release(first);
        await (first === 'promotion' ? promotion : recovery);
        barrier.release(second);
        const [promotionResult, recoveryResult] = await Promise.all([promotion, recovery]);

        const winners = assignments(cloud, legacy.id);
        expect(winners).toHaveLength(1);
        expect(cloud.retries).toBeGreaterThanOrEqual(1);   // el perdedor vio el cerrojo al reintentar
        const claim = cloud.docs.get(claimKey(legacy.id));
        if (first === 'promotion') {
            expect(winners[0]).toEqual(promoteLegacyPayrollClosure(legacy, DEFAULT));
            expect(claim).toMatchObject({ kind: PAYROLL_CLOSURE_CLAIM_KIND.PROMOTION, targetId: legacy.id, projectId: DEFAULT });
            expect(promotionResult.ok).toBe(true);
            expect(recoveryResult.ok).toBe(false);
            expect(recoveryResult.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
            expect(cloud.docs.has(closureKey(copy.id))).toBe(false);
        } else {
            expect(winners[0]).toEqual(copy);
            expect(claim).toMatchObject({ kind: PAYROLL_CLOSURE_CLAIM_KIND.RECOVERY_COPY, targetId: copy.id, projectId: target });
            expect(recoveryResult).toMatchObject({ ok: true, value: { written: true } });
            expect(cloud.docs.get(closureKey(legacy.id))).toEqual(legacy);
            if (promoter === 'cloud') {
                expect(promotionResult.ok).toBe(true);
                expect(promotionResult.value).toEqual(target === DEFAULT ? copy : null);
            } else {
                expect(promotionResult.ok).toBe(false);
                expect(promotionResult.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
            }
        }
        // Importes, filas, ids y auditoría de anulación intactos en el ganador.
        expect(winners[0].rows).toEqual(legacy.rows);
        expect(winners[0].totals).toEqual(legacy.totals);
        expect(winners[0].status).toBe(legacy.status);
        if (voided) expect(winners[0]).toMatchObject({ voidedAt: 150, voidedBy: 'auditor', voidReason: 'Pago duplicado' });
    });

    test.each(['first', 'second'])('dos copias hacia obras distintas a la vez: solo una reclama el origen (gana la %s)', async winner => {
        const legacy = legacyClosure();
        cloud.put(closureKey(legacy.id), legacy);
        const toOther = recoveryCopy(legacy, OTHER);
        const toDefault = recoveryCopy(legacy, DEFAULT);
        const gates = [deferred(), deferred()];
        const arrived = [deferred(), deferred()];
        let calls = 0;
        cloud.gates.copy = async function gate() {
            const index = calls++;
            if (calls < 2) cloud.gates.copy = gate;
            arrived[index].resolve();
            await gates[index].promise;
        };
        const a = settle(PayrollClosureRepository.saveRecoveredClosure(toOther));
        const b = settle(PayrollClosureRepository.saveRecoveredClosure(toDefault));
        await Promise.all(arrived.map(d => d.promise));
        const order = winner === 'first' ? [0, 1] : [1, 0];
        gates[order[0]].resolve();
        await (order[0] === 0 ? a : b);
        gates[order[1]].resolve();
        const results = await Promise.all([a, b]);

        expect(assignments(cloud, legacy.id)).toHaveLength(1);
        expect(results.filter(r => r.ok)).toHaveLength(1);
        expect(results.find(r => !r.ok).error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
    });

    test('reintentos idempotentes: el cerrojo no cambia y no aparecen documentos nuevos', async () => {
        const legacy = legacyClosure();
        cloud.put(closureKey(legacy.id), legacy);
        const copy = recoveryCopy(legacy, OTHER);
        await PayrollClosureRepository.saveRecoveredClosure(copy);
        const claim = clone(cloud.docs.get(claimKey(legacy.id)));
        const keys = [...cloud.docs.keys()].sort();

        await expect(PayrollClosureRepository.saveRecoveredClosure(copy)).resolves.toMatchObject({ written: false });
        await expect(repo.promoteLegacyCloudClosure(legacy, scope)).resolves.toBeNull();
        expect(cloud.docs.get(claimKey(legacy.id))).toEqual(claim);
        expect([...cloud.docs.keys()].sort()).toEqual(keys);

        const other = legacyClosure({ voided: true });
        cloud.put(closureKey(other.id), other);
        const first = await repo.promoteLegacyCloudClosure(other, scope);
        const otherClaim = clone(cloud.docs.get(claimKey(other.id)));
        await expect(repo.promoteLegacyCloudClosure(other, scope)).resolves.toBeNull(); // ya no es schema 2 crudo
        await expect(repo.loadByIdScoped(other.id, scope)).resolves.toEqual(first);
        expect(cloud.docs.get(claimKey(other.id))).toEqual(otherClaim);
    });

    test('un cerrojo de promoción de otra obra o de tipo desconocido bloquea ambos caminos (fail-closed)', async () => {
        const legacy = legacyClosure();
        cloud.put(closureKey(legacy.id), legacy);
        cloud.put(claimKey(legacy.id), { sourceId: legacy.id, kind: 'promotion', targetId: legacy.id, projectId: OTHER, claimedAt: 1 });
        await expect(repo.promoteLegacyCloudClosure(legacy, scope)).rejects.toMatchObject({ code: 'PAYROLL_CLOSURE_RECOVERY_CONFLICT' });
        await expect(PayrollClosureRepository.saveRecoveredClosure(recoveryCopy(legacy, DEFAULT)))
            .rejects.toMatchObject({ code: 'PAYROLL_CLOSURE_RECOVERY_CONFLICT' });
        expect(cloud.docs.get(closureKey(legacy.id))).toEqual(legacy);
        expect(assignments(cloud, legacy.id)).toHaveLength(0);
    });
});

describe('M1: reglas del cerrojo sin desplegar → ambos caminos en pausa', () => {
    let cloud;

    beforeEach(() => {
        firebase.auth.currentUser = { uid: UID };
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: DEFAULT, defaultProjectId: DEFAULT });
        cloud = installCloud({ denyClaims: true, enforceRules: false });
    });

    afterEach(() => {
        setProjectsEnabled(false);
        resetEntityScope();
        delete firebase.auth.currentUser;
        jest.restoreAllMocks();
    });

    test('promoción y copia fallan cerradas sin escribir; la cola deja la copia para «Reintentar» tras el despliegue', async () => {
        const legacy = legacyClosure();
        cloud.put(closureKey(legacy.id), legacy);
        const before = clone([...cloud.docs.entries()]);

        const promotion = await settle(repo.promoteLegacyCloudClosure(legacy, scope));
        const upload = await settle(repo.saveOneScoped(promoteLegacyPayrollClosure(legacy, DEFAULT), scope));
        const copy = await settle(PayrollClosureRepository.saveRecoveredClosure(recoveryCopy(legacy, OTHER)));

        for (const result of [promotion, upload, copy]) {
            expect(result.ok).toBe(false);
            expect(result.error).toMatchObject({ code: 'PAYROLL_CLOSURE_CLAIM_UNAVAILABLE', expectedRemoteUnavailable: true });
            expect(result.error.message).toMatch(/reglas de Firestore/);
        }
        expect(clone([...cloud.docs.entries()])).toEqual(before);
        expect(classifySyncError(copy.error)).toBe('permanent');
        expect(nextEntryState({ attempts: 0 }, copy.error, 5)).toMatchObject({ status: 'dead' });
        // El historial del período también falla cerrado (no se puede crear otro cierre encima).
        await expect(repo.loadByPeriodScoped('2026-09-01', '2026-09-15', scope))
            .rejects.toMatchObject({ code: 'PAYROLL_CLOSURE_CLAIM_UNAVAILABLE' });
    });

    test('lo ya promovido o ya copiado sigue funcionando: leer y anular no necesitan el cerrojo', async () => {
        const legacy = legacyClosure();
        const promoted = promoteLegacyPayrollClosure(legacy, DEFAULT);
        cloud.put(closureKey(promoted.id), promoted);
        await expect(repo.loadByIdScoped(promoted.id, scope)).resolves.toEqual(promoted);
        const voided = voidPayrollClosure(promoted, { voidedAt: 900, voidedBy: 'u', voidReason: 'Error' });
        await expect(repo.saveOneScoped(voided, scope)).resolves.toMatchObject({ written: true });
        expect(cloud.docs.get(closureKey(promoted.id))).toMatchObject({ status: 'voided', voidReason: 'Error' });
    });
});

describe('M1: modelo de firestore.rules frente a clientes antiguos (sin cerrojo)', () => {
    let cloud;

    beforeEach(() => {
        firebase.auth.currentUser = { uid: UID };
        cloud = installCloud();
    });

    afterEach(() => {
        delete firebase.auth.currentUser;
        jest.restoreAllMocks();
    });

    const oldClientWrite = (key, data) => firebase.runTransaction(null, async tx => {
        await tx.get({ path: key });
        tx.set({ path: key }, data);
    });

    test('una promoción o una copia sin cerrojo se rechaza; un cerrojo no se puede reescribir', async () => {
        const legacy = legacyClosure();
        cloud.put(closureKey(legacy.id), legacy);
        await expect(oldClientWrite(closureKey(legacy.id), promoteLegacyPayrollClosure(legacy, DEFAULT)))
            .rejects.toMatchObject({ code: 'permission-denied' });
        const copy = recoveryCopy(legacy, OTHER);
        await expect(oldClientWrite(closureKey(copy.id), copy)).rejects.toMatchObject({ code: 'permission-denied' });
        expect(assignments(cloud, legacy.id)).toHaveLength(0);

        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: DEFAULT, defaultProjectId: DEFAULT });
        try {
            await repo.promoteLegacyCloudClosure(legacy, scope);
            await expect(oldClientWrite(claimKey(legacy.id), { sourceId: legacy.id, kind: 'recovery-copy', targetId: copy.id, projectId: OTHER, claimedAt: 2 }))
                .rejects.toMatchObject({ code: 'permission-denied' });
            expect(assignments(cloud, legacy.id)).toHaveLength(1);
        } finally {
            setProjectsEnabled(false);
            resetEntityScope();
        }
    });
});

describe('M1: conducta observada en el emulador real (reglas antes que precondición, copias previas al cerrojo)', () => {
    let cloud;

    beforeEach(() => {
        firebase.auth.currentUser = { uid: UID };
        setProjectsEnabled(true);
        replaceEntityScope({ enabled: true, projectId: DEFAULT, defaultProjectId: DEFAULT });
        cloud = installCloud({ rulesFirst: true });
    });

    afterEach(() => {
        setProjectsEnabled(false);
        resetEntityScope();
        delete firebase.auth.currentUser;
        jest.restoreAllMocks();
    });

    test.each(['cloud', 'upload'])('gana la promoción (%s): la copia perdedora recibe el conflicto tipado, no permission-denied', async promoter => {
        const legacy = legacyClosure();
        cloud.put(closureKey(legacy.id), legacy);
        const copy = recoveryCopy(legacy, OTHER);
        const barrier = installBarrier(cloud, ['promotion', 'copy']);
        const promotion = settle(PROMOTERS_FOR_EMULATOR[promoter](legacy));
        const recovery = settle(PayrollClosureRepository.saveRecoveredClosure(copy));
        await barrier.bothArrived;
        barrier.release('promotion');
        await promotion;
        barrier.release('copy');
        const [promotionResult, recoveryResult] = await Promise.all([promotion, recovery]);

        expect(promotionResult.ok).toBe(true);
        expect(cloud.denied).toBe(1);                       // el commit perdedor fue denegado por las reglas
        expect(recoveryResult.ok).toBe(false);
        expect(recoveryResult.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
        expect(assignments(cloud, legacy.id)).toHaveLength(1);
        expect(classifySyncError(recoveryResult.error)).toBe('permanent');
    });

    test('copia previa al cerrojo: ni la subida de un promovido local ni otra copia duplican la nómina', async () => {
        const legacy = legacyClosure();
        cloud.put(closureKey(legacy.id), legacy);
        const preLock = recoveryCopy(legacy, OTHER);
        cloud.put(closureKey(preLock.id), preLock);          // subida por un cliente antiguo, sin cerrojo

        const upload = await settle(repo.saveOneScoped(promoteLegacyPayrollClosure(legacy, DEFAULT), scope));
        expect(upload.ok).toBe(false);
        expect(upload.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
        const second = await settle(PayrollClosureRepository.saveRecoveredClosure(recoveryCopy(legacy, DEFAULT)));
        expect(second.ok).toBe(false);
        expect(second.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
        await expect(PayrollClosureRepository.saveRecoveredClosure(preLock)).resolves.toMatchObject({ written: false });

        expect(assignments(cloud, legacy.id)).toEqual([preLock]);
        expect(cloud.docs.has(claimKey(legacy.id))).toBe(false);
        expect(cloud.docs.get(closureKey(legacy.id))).toEqual(legacy);
    });
});

const PROMOTERS_FOR_EMULATOR = {
    cloud: legacy => repo.promoteLegacyCloudClosure(legacy, { projectId: DEFAULT, defaultProjectId: DEFAULT }),
    upload: legacy => repo.saveOneScoped(promoteLegacyPayrollClosure(legacy, DEFAULT), { projectId: DEFAULT, defaultProjectId: DEFAULT })
};

describe('M1: contrato estático de firestore.rules (no sustituye al emulador)', () => {
    const rules = require('fs').readFileSync(require('path').resolve(__dirname, '../../firestore.rules'), 'utf8');

    test('el cerrojo es propio, inmutable y obligatorio para promover o crear una copia', () => {
        const block = rules.slice(rules.indexOf('match /users/{userId}/payrollClosureClaims/{sourceId}'));
        expect(block).toMatch(/allow read: if isAccountOwner\(userId\);/);
        expect(block).toMatch(/allow create: if isAccountOwner\(userId\) &&\s+isValidClosureClaim\(userId, sourceId\);/);
        expect(block).toMatch(/allow update: if false;/);
        expect(rules).toMatch(/allow update: if isAccountOwner\(userId\) &&\s+isAllowedClosureUpdate\(userId, closureId\);/);
        expect(rules).toMatch(/isLegacyVariant\(before\) &&\s+isLegacyPromotion\(userId, closureId, before, after\)/);
        expect(rules).toMatch(/hasClaimAfter\(userId, closureId, 'promotion', closureId,/);
        expect(rules).toMatch(/isNativeVariant\(request\.resource\.data\) &&\s+isClaimedOrPlainNativeCreate\(userId, closureId\)/);
        expect(rules).toMatch(/'recovery-copy', closureId, request\.resource\.data\.projectId/);
        expect(rules).toMatch(/isSourceNotPromoted\(userId, sourceId\)/);
        // Las actualizaciones ordinarias (anular) no exigen cerrojo.
        expect(rules).toMatch(/function isAllowedClosureUpdate\(userId, closureId\) \{[\s\S]*?\(isClosedToVoided\(\) \|\| isStableClosedUpdate\(\)\)\)\);/);
        // Conducta real (límite de 1000 expresiones, carreras, clientes antiguos):
        // js/tests/emulator/PayrollClosureClaimRules.emulator.test.js.
    });
});
