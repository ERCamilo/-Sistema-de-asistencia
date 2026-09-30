/**
 * FirebaseService.saveDailyAttendanceBatch: varias fechas en una transacción,
 * con el mismo merge LWW y recorte al alcance del remitente que la subida de
 * una sola fecha.
 */
const UID = 'u-batch';
const PA = 'PRJ-BATCH-A';
const PB = 'PRJ-BATCH-B';
const scopeA = { enabled: true, projectId: PA, defaultProjectId: PA };

async function client() {
    jest.resetModules();
    const [flags, fbd, fsMod] = await Promise.all([
        import('actual/config/FeatureFlags.js'),
        import('../data/firebase.js'),
        import('actual/services/FirebaseService.js')
    ]);
    const docs = new Map();
    const transactions = [];
    fbd.doc.mockImplementation((_db, ...segs) => ({ key: segs.join('/') }));
    fbd.runTransaction.mockImplementation(async (_db, operation) => {
        const writes = [];
        let wroteBeforeRead = false;
        await operation({
            get: async ref => {
                if (writes.length) wroteBeforeRead = true;
                const hit = docs.get(ref.key);
                return hit
                    ? { exists: () => true, data: () => JSON.parse(JSON.stringify(hit)) }
                    : { exists: () => false, data: () => null };
            },
            set: (ref, data) => writes.push([ref.key, data])
        });
        transactions.push({ writes: writes.map(w => w[0]), wroteBeforeRead });
        for (const [key, data] of writes) {
            const next = { ...(docs.get(key) || {}) };
            next.records = { ...(next.records || {}), ...data.records };
            docs.set(key, next);
        }
    });
    fbd.auth.currentUser = { uid: UID };
    flags.setProjectsEnabled(true);
    return { firebase: fsMod.default, docs, transactions };
}

const rec = (employeeId, date, projectId, updatedAt, hoursWorked) =>
    ({ employeeId, date, projectId, updatedAt, hoursWorked, present: true });

describe('FirebaseService.saveDailyAttendanceBatch', () => {
    test('escribe todas las fechas en una sola transacción, leyendo antes de escribir', async () => {
        const { firebase, docs, transactions } = await client();
        await firebase.saveDailyAttendanceBatch([
            { dateKey: '2026-09-01', records: { 'e1_2026-09-01': rec('e1', '2026-09-01', PA, 10, 8) }, scope: scopeA },
            { dateKey: '2026-09-02', records: { 'e1_2026-09-02': rec('e1', '2026-09-02', PA, 10, 6) }, scope: scopeA }
        ]);
        expect(transactions).toHaveLength(1);
        expect(transactions[0].writes).toEqual([
            `users/${UID}/attendance/2026-09-01`, `users/${UID}/attendance/2026-09-02`
        ]);
        expect(transactions[0].wroteBeforeRead).toBe(false);
        expect(docs.get(`users/${UID}/attendance/2026-09-02`).records['e1_2026-09-02'].hoursWorked).toBe(6);
    });

    test('gana el registro más reciente y no sube registros de otra obra', async () => {
        const { firebase, docs } = await client();
        const key = `users/${UID}/attendance/2026-09-01`;
        docs.set(key, { records: { 'e1_2026-09-01': rec('e1', '2026-09-01', PA, 50, 9) } });
        await firebase.saveDailyAttendanceBatch([
            { dateKey: '2026-09-01', scope: scopeA, records: {
                'e1_2026-09-01': rec('e1', '2026-09-01', PA, 10, 4),
                'e2_2026-09-01': rec('e2', '2026-09-01', PB, 99, 7)
            } },
            { dateKey: '2026-09-02', scope: scopeA, records: { 'e1_2026-09-02': rec('e1', '2026-09-02', PA, 10, 8) } }
        ]);
        const day = docs.get(key).records;
        expect(day['e1_2026-09-01'].hoursWorked).toBe(9);
        expect(day['e2_2026-09-01']).toBeUndefined();
    });

    test('rechaza fechas repetidas en el mismo lote', async () => {
        const { firebase, transactions } = await client();
        await expect(firebase.saveDailyAttendanceBatch([
            { dateKey: '2026-09-01', records: {}, scope: scopeA },
            { dateKey: '2026-09-01', records: {}, scope: scopeA }
        ])).rejects.toThrow(/fechas repetidas/);
        expect(transactions).toHaveLength(0);
    });
});
