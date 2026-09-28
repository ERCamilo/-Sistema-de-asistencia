/**
 * M1 contra el emulador REAL de Firestore: firestore.rules del repositorio y
 * PayrollClosureRepository real, con dos "dispositivos" (dos clientes SDK
 * independientes, mismo uid). No hay modelo en JS de las reglas: cada escritura
 * la evalúa el emulador.
 *
 * Se ejecuta con jest.emulator.config.cjs (ver cabecera). Sin
 * FIRESTORE_EMULATOR_HOST se omite.
 *
 * Cubre: entrelazados promoción/copia en ambos órdenes, copias previas al
 * cerrojo, anulados, otra obra, actualizaciones/borrados, clientes antiguos
 * (código de `main`) y el orden de despliegue (reglas antiguas + cliente nuevo).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const describeEmulator = HOST ? describe : describe.skip;
const ROOT = path.resolve(__dirname, '../../..');
const UID = 'owner-1';
const DEFAULT = 'PRJ-DEFAULT';
const OTHER = 'PRJ-OTHER';
const NEW_RULES_PROJECT = 'demo-sa-m1-new';
const OLD_RULES_PROJECT = 'demo-sa-m1-old';

// Almacenamiento mínimo para FeatureFlags / EntityProjectScope en entorno node.
if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
        getItem: key => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: key => store.delete(key),
        clear: () => store.clear()
    };
}

let sdk = null;
let firebaseApp = null;
if (HOST) {
    sdk = require('firebase/firestore');
    firebaseApp = require('firebase/app');
    globalThis.__SA_FIRESTORE_SDK__ = sdk;
    sdk.setLogLevel('silent');
}

const {
    buildPayrollClosure,
    buildPayrollClosureSnapshot,
    promoteLegacyPayrollClosure,
    voidPayrollClosure
} = require('../../modules/features/payroll/PayrollClosure.js');
const { planFinancialRecovery } = require('../../modules/features/projects/ProjectFinancialRecovery.js');

const clone = value => JSON.parse(JSON.stringify(value));
const settle = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
function deferred() {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
}

// ---------------------------------------------------------------------------
// REST del emulador (solo para reglas, limpieza y siembra/lectura con bypass)
// ---------------------------------------------------------------------------
const base = () => `http://${HOST}`;
async function rest(method, url, body, admin = true) {
    const response = await fetch(base() + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer owner' } : {}) },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    if (!response.ok && response.status !== 404) throw new Error(`${method} ${url} → ${response.status} ${text}`);
    return response.status === 404 ? null : (text ? JSON.parse(text) : {});
}
const loadRules = (project, content) => rest('PUT', `/emulator/v1/projects/${project}:securityRules`,
    { rules: { files: [{ name: 'firestore.rules', content }] } }, false);
const clearProject = project => rest('DELETE', `/emulator/v1/projects/${project}/databases/(default)/documents`, null, false);

function encode(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'string') return { stringValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } };
}
function decode(value) {
    if ('nullValue' in value) return null;
    if ('booleanValue' in value) return value.booleanValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('stringValue' in value) return value.stringValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
    if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]));
    throw new Error('valor no soportado: ' + JSON.stringify(value));
}
const docUrl = (project, docPath) => `/v1/projects/${project}/databases/(default)/documents/${docPath}`;
async function adminSet(project, docPath, data) {
    await rest('PATCH', docUrl(project, docPath), { fields: encode(data).mapValue.fields });
}
async function adminGet(project, docPath) {
    const result = await rest('GET', docUrl(project, docPath));
    return result ? decode({ mapValue: { fields: result.fields || {} } }) : null;
}
async function adminList(project, collectionPath) {
    const result = await rest('GET', docUrl(project, collectionPath) + '?pageSize=300');
    return (result?.documents || []).map(item => ({
        id: item.name.split('/').pop(),
        data: decode({ mapValue: { fields: item.fields || {} } })
    }));
}
const closuresPath = `users/${UID}/payrollClosures`;
const claimsPath = `users/${UID}/payrollClosureClaims`;

// Cuántas veces está la nómina de `sourceId` asignada a una obra.
async function assignments(project, sourceId) {
    const docs = await adminList(project, closuresPath);
    return docs.map(d => d.data).filter(c => (c.id === sourceId && c.identityKind === 'promoted-legacy')
        || c.recovery?.sourceId === sourceId);
}

// ---------------------------------------------------------------------------
// Dispositivos: SDK real conectado al emulador + módulos de la app aislados
// ---------------------------------------------------------------------------
let deviceCount = 0;
function makeDevice(project, { uid = UID, modulesRoot = path.join(ROOT, 'js/modules') } = {}) {
    const app = firebaseApp.initializeApp({ projectId: project, apiKey: 'demo-key' }, `device-${++deviceCount}`);
    const firestore = sdk.getFirestore(app);
    const [host, port] = HOST.split(':');
    sdk.connectFirestoreEmulator(firestore, host, Number(port), { mockUserToken: { sub: uid, user_id: uid } });
    let modules;
    jest.isolateModules(() => {
        modules = {
            fb: require(path.join(modulesRoot, 'data/firebase.js')),
            flags: require(path.join(modulesRoot, 'config/FeatureFlags.js')),
            scope: require(path.join(modulesRoot, 'features/projects/EntityProjectScope.js')),
            repo: require(path.join(modulesRoot, 'features/payroll/PayrollClosureRepository.js'))
        };
    });
    modules.fb.__useDevice({ firestore, uid });
    modules.flags.setProjectsEnabled(true);
    modules.scope.replaceEntityScope({ enabled: true, projectId: DEFAULT, defaultProjectId: DEFAULT });
    return { app, firestore, project, ...modules, scopeFor: projectId => ({ projectId, defaultProjectId: DEFAULT }) };
}

// Pausa la transacción de `device` tras leer el cerrojo en el primer intento.
function pauseAfterClaimRead(device) {
    const arrived = deferred();
    const release = deferred();
    device.fb.__hooks.afterTransactionGet = async ({ path: docPath, attempt }) => {
        if (attempt !== 1 || !docPath.includes('/payrollClosureClaims/')) return;
        arrived.resolve();
        await release.promise;
    };
    return { arrived: arrived.promise, release: () => release.resolve() };
}

// Copia de módulos de `main` (cliente antiguo, sin cerrojo) en un directorio temporal.
function extractMainModules() {
    try {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-main-client-'));
        const tar = execFileSync('git', ['-C', ROOT, 'archive', 'main', 'js/modules'], { maxBuffer: 64 * 1024 * 1024 });
        execFileSync('tar', ['-x', '-C', dir], { input: tar });
        return { dir, modulesRoot: path.join(dir, 'js/modules'), rules: execFileSync('git', ['-C', ROOT, 'show', 'main:firestore.rules']).toString() };
    } catch (_) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Datos sintéticos
// ---------------------------------------------------------------------------
let seq = 0;
function legacyClosure({ voided = false, rows = 2 } = {}) {
    seq += 1;
    const options = {
        periodStart: `2026-0${1 + (seq % 9)}-01`,
        periodEnd: `2026-0${1 + (seq % 9)}-15`,
        closedAt: 1000 + seq,
        rows: Array.from({ length: rows }, (_, i) => ({
            _employeeId: `e-${seq}-${i}`, _number: String(i + 1), _employeeName: `Persona ${i + 1}`,
            _brutoOriginal: 1000 + i, _loans: i % 3 === 0 ? 50 : 0, _payments: i % 5, _extraHours: i % 7,
            _positionName: 'Ayudante', _days: 12, _hours: 96, monto: 1000 + i - (i % 3 === 0 ? 50 : 0)
        }))
    };
    const closure = buildPayrollClosure({ ...options, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(options)) });
    return voided
        ? voidPayrollClosure(closure, { voidedAt: 1500 + seq, voidedBy: 'auditor', voidReason: 'Pago duplicado' })
        : closure;
}

function recoveryCopy(legacy, target) {
    const employeeIds = legacy.rows.map(row => row.employeeId);
    const plan = planFinancialRecovery({
        employees: employeeIds.map(id => ({ id, name: id, projectId: target, loans: [] })),
        projects: [{ id: DEFAULT, status: 'active' }, { id: OTHER, status: 'active' }],
        payrollClosures: [legacy], employeeIds, targetProjectId: target, timestamp: 5000
    });
    expect(plan.closures).toHaveLength(1);
    return plan.closures[0];
}

const PROMOTERS = {
    cloud: (device, legacy) => device.repo._payrollClosureRepositoryInternals.promoteLegacyCloudClosure(legacy, device.scopeFor(DEFAULT)),
    upload: (device, legacy) => device.repo._payrollClosureRepositoryInternals.saveOneScoped(
        promoteLegacyPayrollClosure(legacy, DEFAULT), device.scopeFor(DEFAULT))
};

// `main` no tiene saveRecoveredClosure: sube la copia con saveOneScoped en su obra.
function saveCopy(device, copy) {
    const api = device.repo.PayrollClosureRepository;
    return typeof api.saveRecoveredClosure === 'function'
        ? api.saveRecoveredClosure(copy)
        : (async () => {
            // El cliente antiguo exige que la obra activa sea la de la copia.
            device.scope.replaceEntityScope({ enabled: true, projectId: copy.projectId, defaultProjectId: DEFAULT });
            try {
                return await device.repo._payrollClosureRepositoryInternals.saveOneScoped(copy, device.scopeFor(copy.projectId));
            } finally {
                device.scope.replaceEntityScope({ enabled: true, projectId: DEFAULT, defaultProjectId: DEFAULT });
            }
        })();
}

async function expectDenied(promise) {
    const result = await settle(promise);
    expect(result.ok).toBe(false);
    expect(String(result.error?.code || '')).toMatch(/permission-denied/);
}

describeEmulator('firestore.rules M1 en el emulador con el repositorio real', () => {
    const newRules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    let main = null;
    const devices = [];
    const device = (project = NEW_RULES_PROJECT, options) => {
        const created = makeDevice(project, options);
        devices.push(created);
        return created;
    };

    beforeAll(async () => {
        await loadRules(NEW_RULES_PROJECT, newRules);
        main = extractMainModules();
        if (main) await loadRules(OLD_RULES_PROJECT, main.rules);
    });

    beforeEach(async () => {
        await clearProject(NEW_RULES_PROJECT);
        await clearProject(OLD_RULES_PROJECT);
    });

    afterEach(async () => {
        while (devices.length) {
            const d = devices.pop();
            d.fb.__hooks.afterTransactionGet = null;
            await sdk.terminate(d.firestore).catch(() => {});
            await firebaseApp.deleteApp(d.app).catch(() => {});
        }
    });

    afterAll(() => {
        if (main?.dir) fs.rmSync(main.dir, { recursive: true, force: true });
    });

    const matrix = [];
    for (const promoter of Object.keys(PROMOTERS)) {
        for (const target of [OTHER, DEFAULT]) {
            for (const first of ['promotion', 'copy']) {
                for (const voided of [false, true]) matrix.push([promoter, target, first, voided]);
            }
        }
    }

    test.each(matrix)('entrelazado real: promoción %s, copia en %s, confirma primero %s, anulado=%s → una sola asignación y resultado tipado', async (promoter, target, first, voided) => {
        const legacy = legacyClosure({ voided });
        await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
        const copy = recoveryCopy(legacy, target);
        const promoterDevice = device();
        const copyDevice = device();
        const promotionGate = pauseAfterClaimRead(promoterDevice);
        const copyGate = pauseAfterClaimRead(copyDevice);

        const promotion = settle(PROMOTERS[promoter](promoterDevice, legacy));
        const recovery = settle(copyDevice.repo.PayrollClosureRepository.saveRecoveredClosure(copy));
        await Promise.all([promotionGate.arrived, copyGate.arrived]);   // ambos leyeron: sin cerrojo
        if (first === 'promotion') {
            promotionGate.release();
            await promotion;
            copyGate.release();
        } else {
            copyGate.release();
            await recovery;
            promotionGate.release();
        }
        const [promotionResult, recoveryResult] = await Promise.all([promotion, recovery]);

        const winners = await assignments(NEW_RULES_PROJECT, legacy.id);
        expect(winners).toHaveLength(1);
        const claim = await adminGet(NEW_RULES_PROJECT, `${claimsPath}/${legacy.id}`);
        if (first === 'promotion') {
            expect(promotionResult.ok).toBe(true);
            expect(winners[0]).toEqual(promoteLegacyPayrollClosure(legacy, DEFAULT));
            expect(claim).toMatchObject({ kind: 'promotion', targetId: legacy.id, projectId: DEFAULT });
            expect(await adminGet(NEW_RULES_PROJECT, `${closuresPath}/${copy.id}`)).toBeNull();
            // El perdedor recibe el conflicto tipado (no un permission-denied genérico).
            expect(recoveryResult.ok).toBe(false);
            expect(recoveryResult.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
        } else {
            expect(recoveryResult).toMatchObject({ ok: true, value: { written: true } });
            expect(winners[0]).toEqual(copy);
            expect(claim).toMatchObject({ kind: 'recovery-copy', targetId: copy.id, projectId: target });
            expect(await adminGet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`)).toEqual(legacy);
            if (promoter === 'cloud') {
                expect(promotionResult).toEqual({ ok: true, value: target === DEFAULT ? copy : null });
            } else {
                expect(promotionResult.ok).toBe(false);
                expect(promotionResult.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
            }
        }
        expect(winners[0].rows).toEqual(legacy.rows);
        expect(winners[0].totals).toEqual(legacy.totals);
        expect(winners[0].status).toBe(legacy.status);
        if (voided) expect(winners[0]).toMatchObject({ voidedBy: 'auditor', voidReason: 'Pago duplicado' });
    });

    test.each(['A', 'B'])('dos copias a obras distintas a la vez: confirma primero %s y solo una reclama el origen', async winner => {
        const legacy = legacyClosure();
        await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
        const a = device();
        const b = device();
        const gateA = pauseAfterClaimRead(a);
        const gateB = pauseAfterClaimRead(b);
        const copyA = recoveryCopy(legacy, OTHER);
        const copyB = recoveryCopy(legacy, DEFAULT);
        const runA = settle(a.repo.PayrollClosureRepository.saveRecoveredClosure(copyA));
        const runB = settle(b.repo.PayrollClosureRepository.saveRecoveredClosure(copyB));
        await Promise.all([gateA.arrived, gateB.arrived]);
        const [firstGate, firstRun, secondGate] = winner === 'A' ? [gateA, runA, gateB] : [gateB, runB, gateA];
        firstGate.release();
        await firstRun;
        secondGate.release();
        const [resultA, resultB] = await Promise.all([runA, runB]);

        expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toHaveLength(1);
        const loser = winner === 'A' ? resultB : resultA;
        expect((winner === 'A' ? resultA : resultB).ok).toBe(true);
        expect(loser.ok).toBe(false);
        expect(loser.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
    });

    describe('copias creadas antes del cerrojo (sin claim)', () => {
        async function seedPreLockCopy(target) {
            const legacy = legacyClosure();
            const copy = recoveryCopy(legacy, target);
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${copy.id}`, copy);   // bypass: cliente antiguo
            return { legacy, copy };
        }

        test.each([DEFAULT, OTHER])('la promoción no duplica una copia previa en %s', async target => {
            const { legacy, copy } = await seedPreLockCopy(target);
            const d = device();
            const result = await PROMOTERS.cloud(d, legacy);
            expect(result).toEqual(target === DEFAULT ? copy : null);
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([copy]);
            expect(await adminGet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`)).toEqual(legacy);
        });

        test('la subida de un promovido local no duplica una copia previa', async () => {
            const { legacy, copy } = await seedPreLockCopy(OTHER);
            const d = device();
            const result = await settle(PROMOTERS.upload(d, legacy));
            expect(result.ok).toBe(false);
            expect(result.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([copy]);
            expect(await adminGet(NEW_RULES_PROJECT, `${claimsPath}/${legacy.id}`)).toBeNull();
        });

        test('una copia nueva hacia otra obra no se suma a una copia previa', async () => {
            const { legacy, copy } = await seedPreLockCopy(OTHER);
            const d = device();
            const second = recoveryCopy(legacy, DEFAULT);
            expect(second.id).not.toBe(copy.id);
            const result = await settle(d.repo.PayrollClosureRepository.saveRecoveredClosure(second));
            expect(result.ok).toBe(false);
            expect(result.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([copy]);
        });

        test('reintentar la misma copia previa es idempotente (sin cerrojo nuevo ni documentos)', async () => {
            const { legacy, copy } = await seedPreLockCopy(OTHER);
            const d = device();
            await expect(d.repo.PayrollClosureRepository.saveRecoveredClosure(copy)).resolves.toMatchObject({ written: false });
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([copy]);
        });
    });

    describe('anulados', () => {
        test('se anula un cierre promovido con su cerrojo y el cerrojo no cambia', async () => {
            const legacy = legacyClosure();
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            const d = device();
            const promoted = await PROMOTERS.cloud(d, legacy);
            const claim = await adminGet(NEW_RULES_PROJECT, `${claimsPath}/${legacy.id}`);
            const voided = voidPayrollClosure(promoted, { voidedAt: 9000, voidedBy: 'auditor', voidReason: 'Error de horas' });
            await expect(d.repo._payrollClosureRepositoryInternals.saveOneScoped(voided, d.scopeFor(DEFAULT)))
                .resolves.toMatchObject({ written: true });
            expect(await adminGet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`)).toMatchObject({ status: 'voided', identityKind: 'promoted-legacy' });
            expect(await adminGet(NEW_RULES_PROJECT, `${claimsPath}/${legacy.id}`)).toEqual(claim);
            // Un anulado no vuelve a cerrado.
            await expectDenied(sdk.setDoc(sdk.doc(d.firestore, closuresPath, legacy.id), promoted));
        });

        test('anular el original schema 2 después de la copia no crea otra asignación', async () => {
            const legacy = legacyClosure();
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            const d = device();
            const copy = recoveryCopy(legacy, OTHER);
            await d.repo.PayrollClosureRepository.saveRecoveredClosure(copy);
            const voided = voidPayrollClosure(legacy, { voidedAt: 9100, voidedBy: 'auditor', voidReason: 'Duplicado' });
            await sdk.setDoc(sdk.doc(d.firestore, closuresPath, legacy.id), voided);
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([copy]);
            await expect(PROMOTERS.cloud(d, voided)).resolves.toBeNull();
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([copy]);
        });
    });

    describe('reglas: otra obra, actualizaciones, borrados y otra cuenta', () => {
        async function promotedWithClaim(d) {
            const legacy = legacyClosure();
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            const promoted = await PROMOTERS.cloud(d, legacy);
            return { legacy, promoted };
        }
        const claimDoc = (d, id) => sdk.doc(d.firestore, claimsPath, id);
        const closureDoc = (d, id) => sdk.doc(d.firestore, closuresPath, id);
        const claimFor = (sourceId, kind, targetId, projectId) => ({ sourceId, kind, targetId, projectId, claimedAt: 1 });

        test('promoción con cerrojo de otra obra: DENEGADA', async () => {
            const legacy = legacyClosure();
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            const d = device();
            const batch = sdk.writeBatch(d.firestore);
            batch.set(closureDoc(d, legacy.id), promoteLegacyPayrollClosure(legacy, DEFAULT));
            batch.set(claimDoc(d, legacy.id), claimFor(legacy.id, 'promotion', legacy.id, OTHER));
            await expectDenied(batch.commit());
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([]);
        });

        test('copia con cerrojo de otra obra o de otro destino: DENEGADA', async () => {
            const legacy = legacyClosure();
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            const d = device();
            const copy = recoveryCopy(legacy, OTHER);
            for (const claim of [claimFor(legacy.id, 'recovery-copy', copy.id, DEFAULT),
                claimFor(legacy.id, 'recovery-copy', 'otro-id', OTHER),
                claimFor(legacy.id, 'promotion', copy.id, OTHER),
                { ...claimFor(legacy.id, 'recovery-copy', copy.id, OTHER), extra: true }]) {
                const batch = sdk.writeBatch(d.firestore);
                batch.set(closureDoc(d, copy.id), copy);
                batch.set(claimDoc(d, legacy.id), claim);
                await expectDenied(batch.commit());
            }
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([]);
        });

        test('la copia de un original ya promovido (sin cerrojo, promovido antes de las reglas): DENEGADA', async () => {
            const legacy = legacyClosure();
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, promoteLegacyPayrollClosure(legacy, DEFAULT));
            const d = device();
            const copy = recoveryCopy(legacy, OTHER);
            const batch = sdk.writeBatch(d.firestore);
            batch.set(closureDoc(d, copy.id), copy);
            batch.set(claimDoc(d, legacy.id), claimFor(legacy.id, 'recovery-copy', copy.id, OTHER));
            await expectDenied(batch.commit());
            const result = await settle(d.repo.PayrollClosureRepository.saveRecoveredClosure(copy));
            expect(result.error.code).toBe('PAYROLL_CLOSURE_RECOVERY_CONFLICT');
        });

        test('cerrojo: no se actualiza; no se borra con destino vivo; sí tras borrar el destino', async () => {
            const d = device();
            const { legacy } = await promotedWithClaim(d);
            await expectDenied(sdk.setDoc(claimDoc(d, legacy.id), claimFor(legacy.id, 'recovery-copy', 'x', OTHER)));
            await expectDenied(sdk.updateDoc(claimDoc(d, legacy.id), { claimedAt: 2 }));
            await expectDenied(sdk.deleteDoc(claimDoc(d, legacy.id)));
            // Borrar cierre y cerrojo en el mismo commit también está permitido (existsAfter).
            const batch = sdk.writeBatch(d.firestore);
            batch.delete(closureDoc(d, legacy.id));
            batch.delete(claimDoc(d, legacy.id));
            await expect(batch.commit()).resolves.toBeUndefined();
            expect(await adminGet(NEW_RULES_PROJECT, `${claimsPath}/${legacy.id}`)).toBeNull();
        });

        test('cierre promovido: no cambia de obra, no vuelve a schema 2, no cambia huella; updatedAt estable sí', async () => {
            const d = device();
            const { legacy, promoted } = await promotedWithClaim(d);
            await expectDenied(sdk.setDoc(closureDoc(d, legacy.id), { ...promoted, projectId: OTHER }));
            await expectDenied(sdk.setDoc(closureDoc(d, legacy.id), legacy));
            await expectDenied(sdk.setDoc(closureDoc(d, legacy.id), { ...promoted, fingerprint: 'otra' }));
            await expectDenied(sdk.setDoc(closureDoc(d, legacy.id), { ...promoted, rows: [] }));
            await expect(sdk.setDoc(closureDoc(d, legacy.id), { ...promoted, updatedAt: promoted.updatedAt + 1 })).resolves.toBeUndefined();
        });

        test('crear directamente un promovido sin original: DENEGADO', async () => {
            const legacy = legacyClosure();
            const d = device();
            const batch = sdk.writeBatch(d.firestore);
            batch.set(closureDoc(d, legacy.id), promoteLegacyPayrollClosure(legacy, DEFAULT));
            batch.set(claimDoc(d, legacy.id), claimFor(legacy.id, 'promotion', legacy.id, DEFAULT));
            await expectDenied(batch.commit());
        });

        test('otra cuenta no lee ni escribe cierres o cerrojos ajenos', async () => {
            const d = device();
            const { legacy } = await promotedWithClaim(d);
            const intruder = device(NEW_RULES_PROJECT, { uid: 'intruder' });
            await expectDenied(sdk.getDoc(sdk.doc(intruder.firestore, claimsPath, legacy.id)));
            await expectDenied(sdk.getDoc(sdk.doc(intruder.firestore, closuresPath, legacy.id)));
            await expectDenied(sdk.setDoc(sdk.doc(intruder.firestore, claimsPath, 'nuevo'), claimFor('nuevo', 'promotion', 'nuevo', DEFAULT)));
        });

        test('cierre real de 54 filas: promoción, copia y anulación aceptadas (sin límite de evaluación)', async () => {
            const d = device();
            const big = legacyClosure({ rows: 54 });
            const bigCopySource = legacyClosure({ rows: 54 });
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${big.id}`, big);
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${bigCopySource.id}`, bigCopySource);
            const promoted = await PROMOTERS.cloud(d, big);
            expect(promoted).toMatchObject({ identityKind: 'promoted-legacy', projectId: DEFAULT });
            const copy = recoveryCopy(bigCopySource, OTHER);
            await expect(d.repo.PayrollClosureRepository.saveRecoveredClosure(copy)).resolves.toMatchObject({ written: true });
            await expect(d.repo._payrollClosureRepositoryInternals.saveOneScoped(
                voidPayrollClosure(promoted, { voidedAt: 9200, voidedBy: 'a', voidReason: 'b' }), d.scopeFor(DEFAULT)))
                .resolves.toMatchObject({ written: true });
            expect((await adminGet(NEW_RULES_PROJECT, `${closuresPath}/${big.id}`)).rows).toHaveLength(54);
        });
    });

    describe('clientes antiguos y orden de despliegue', () => {
        const needsMain = () => {
            if (!main) throw new Error('No se pudo extraer `main` con git archive: no hay cliente antiguo para probar');
        };

        test('cliente antiguo (main) con reglas nuevas: no puede promover ni copiar; lo demás sigue igual', async () => {
            needsMain();
            const old = device(NEW_RULES_PROJECT, { modulesRoot: main.modulesRoot });
            const legacy = legacyClosure();
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            const oldPromotion = await settle(old.repo._payrollClosureRepositoryInternals
                .promoteLegacyCloudClosure(legacy, old.scopeFor(DEFAULT)));
            expect(oldPromotion.ok).toBe(false);
            expect(String(oldPromotion.error.code)).toMatch(/permission-denied/);
            const oldCopy = await settle(saveCopy(old, recoveryCopy(legacy, OTHER)));
            expect(oldCopy.ok).toBe(false);
            expect(String(oldCopy.error.code)).toMatch(/permission-denied/);
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toEqual([]);
            // Un cierre nativo nuevo y la anulación siguen funcionando en el cliente antiguo.
            const nativeOptions = {
                projectId: DEFAULT, periodStart: '2026-10-01', periodEnd: '2026-10-15', closedAt: 7000,
                rows: [{ _employeeId: 'n-1', _number: '1', _employeeName: 'Nativa', _brutoOriginal: 800, monto: 800 }]
            };
            const nativeClosure = buildPayrollClosure({
                ...nativeOptions, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(nativeOptions))
            });
            await expect(old.repo._payrollClosureRepositoryInternals.saveOneScoped(nativeClosure, old.scopeFor(DEFAULT)))
                .resolves.toMatchObject({ written: true });
            await expect(old.repo._payrollClosureRepositoryInternals.saveOneScoped(
                voidPayrollClosure(nativeClosure, { voidedAt: 7100, voidedBy: 'a', voidReason: 'b' }), old.scopeFor(DEFAULT)))
                .resolves.toMatchObject({ written: true });
        });

        test('antes de desplegar (reglas de main) el cliente nuevo falla cerrado sin escribir', async () => {
            needsMain();
            const d = device(OLD_RULES_PROJECT);
            const legacy = legacyClosure();
            await adminSet(OLD_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            for (const run of [
                () => PROMOTERS.cloud(d, legacy),
                () => PROMOTERS.upload(d, legacy),
                () => d.repo.PayrollClosureRepository.saveRecoveredClosure(recoveryCopy(legacy, OTHER))
            ]) {
                const result = await settle(run());
                expect(result.ok).toBe(false);
                expect(result.error.code).toBe('PAYROLL_CLOSURE_CLAIM_UNAVAILABLE');
            }
            const page = await settle(d.repo.PayrollClosureRepository.loadPage({ limit: 10, scope: d.scopeFor(DEFAULT) }));
            expect(page.ok).toBe(false);
            expect(page.error.code).toBe('PAYROLL_CLOSURE_CLAIM_UNAVAILABLE');
            expect(await adminList(OLD_RULES_PROJECT, closuresPath)).toEqual([{ id: legacy.id, data: legacy }]);
        });

        test('cliente antiguo con reglas nuevas: su historial falla mientras haya legacy sin promover y se recupera cuando un cliente nuevo lo promueve', async () => {
            needsMain();
            const legacy = legacyClosure();
            await adminSet(NEW_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            const old = device(NEW_RULES_PROJECT, { modulesRoot: main.modulesRoot });
            const before = await settle(old.repo.PayrollClosureRepository.loadPage({ limit: 10 }));
            expect(before.ok).toBe(false);
            expect(String(before.error.code)).toMatch(/permission-denied/);
            const fresh = device();
            const page = await fresh.repo.PayrollClosureRepository.loadPage({ limit: 10, scope: fresh.scopeFor(DEFAULT) });
            expect(page.items.map(item => item.id)).toEqual([legacy.id]);
            const after = await old.repo.PayrollClosureRepository.loadPage({ limit: 10 });
            expect(after.items.map(item => [item.id, item.identityKind])).toEqual([[legacy.id, 'promoted-legacy']]);
            expect(await assignments(NEW_RULES_PROJECT, legacy.id)).toHaveLength(1);
        });

        test('defecto previo en las reglas de main: anular un cierre nativo agota el límite de 1000 expresiones', async () => {
            needsMain();
            const d = device(OLD_RULES_PROJECT);
            const options = {
                projectId: DEFAULT, periodStart: '2026-11-01', periodEnd: '2026-11-15', closedAt: 7200,
                rows: [{ _employeeId: 'n-2', _number: '2', _employeeName: 'Nativa', _brutoOriginal: 700, monto: 700 }]
            };
            const native = buildPayrollClosure({ ...options, fingerprint: JSON.stringify(buildPayrollClosureSnapshot(options)) });
            await sdk.setDoc(sdk.doc(d.firestore, closuresPath, native.id), native);
            const voided = voidPayrollClosure(native, { voidedAt: 7300, voidedBy: 'a', voidReason: 'b' });
            const result = await settle(sdk.setDoc(sdk.doc(d.firestore, closuresPath, native.id), voided));
            expect(result.ok).toBe(false);
            expect(String(result.error.message)).toMatch(/1000 expressions/);
            // Con las reglas del repositorio la misma anulación se acepta.
            const fixed = device(NEW_RULES_PROJECT);
            await sdk.setDoc(sdk.doc(fixed.firestore, closuresPath, native.id), native);
            await expect(sdk.setDoc(sdk.doc(fixed.firestore, closuresPath, native.id), voided)).resolves.toBeUndefined();
        });

        test('línea base: con reglas y cliente de main la carrera duplica la nómina (por eso hay que desplegar reglas primero)', async () => {
            needsMain();
            const legacy = legacyClosure();
            await adminSet(OLD_RULES_PROJECT, `${closuresPath}/${legacy.id}`, legacy);
            const promoter = device(OLD_RULES_PROJECT, { modulesRoot: main.modulesRoot });
            const copier = device(OLD_RULES_PROJECT, { modulesRoot: main.modulesRoot });
            const copy = recoveryCopy(legacy, OTHER);
            // La copia confirma entre la consulta de copias y la transacción de la promoción.
            const originalGetDocs = promoter.fb.getDocs;
            expect(typeof originalGetDocs).toBe('function');
            const arrived = deferred();
            const release = deferred();
            promoter.fb.__hooks.afterTransactionGet = async ({ attempt }) => {
                if (attempt !== 1) return;
                arrived.resolve();
                await release.promise;
            };
            const promotion = settle(PROMOTERS.cloud(promoter, legacy));
            await arrived.promise;
            await expect(saveCopy(copier, copy)).resolves.toMatchObject({ written: true });
            release.resolve();
            await promotion;
            expect(await assignments(OLD_RULES_PROJECT, legacy.id)).toHaveLength(2);
        });
    });
});
