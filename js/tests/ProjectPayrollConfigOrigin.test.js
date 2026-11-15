import { inspectPayrollConfigOrigin, PAYROLL_CONFIG_ORIGIN_STATUS } from '../modules/features/projects/ProjectPayrollConfigOrigin.js';

const UID = 'account-fixture';
const PROJECT = 'obra-historica';
const fakeDoc = (_firestore, ...segments) => segments.join('/');
const missing = { exists: () => false };
const existing = value => ({ exists: () => true, data: () => value });
const options = ({
    uid = UID, sourceId = PROJECT, localProjects = [], documents = {},
    read = null, getUid = () => uid
} = {}) => {
    const readServer = read || jest.fn(async path => documents[path] ?? missing);
    return {
        args: { projectId: sourceId, getUid, createDoc: fakeDoc, firestore: {},
            localProjects, readServer },
        readServer
    };
};

describe('configuración huérfana: verificar origen desde Firestore sin mutación', () => {
    test('la obra existe en Firebase pero no en el catálogo local: recomendar sincronizar, no reasignar', async () => {
        const { args, readServer } = options({ documents: {
            'users/account-fixture/projectsV1/obra-historica': existing({
                id: PROJECT, status: 'paused', payrollConfig: { regularHoursPerDay: 9 }, updatedAt: 42
            })
        } });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result).toMatchObject({
            status: PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_PROJECT,
            projectId: PROJECT,
            remotePayrollConfig: true,
            readOnly: true
        });
        expect(readServer).toHaveBeenCalledWith('users/account-fixture/projectsV1/obra-historica');
        expect(readServer).toHaveBeenCalledTimes(3);
        expect(result).not.toHaveProperty('payrollConfig');
    });

    test('alias histórico coincide con una obra existente en Firebase', async () => {
        const { args, readServer } = options({ documents: {
            'users/account-fixture/projectAliasesV1/obra-historica': existing({ canonicalId: 'obra-recuperada' }),
            'users/account-fixture/projectsV1/obra-recuperada': existing({ id: 'obra-recuperada', status: 'active' })
        } });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result).toMatchObject({
            status: PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_ALIAS,
            projectId: PROJECT, canonicalProjectId: 'obra-recuperada',
            readOnly: true
        });
        expect(readServer).toHaveBeenCalledTimes(4);
    });

    test('un alias cuyo destino falta se reporta como inconsistente, no como obra borrada', async () => {
        const { args } = options({ documents: {
            'users/account-fixture/projectAliasesV1/obra-historica': existing({ canonicalId: 'missing-canonical' })
        } });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.BROKEN_ALIAS);
    });

    test('registro canónico identifica el origen aunque el documento de obra falte', async () => {
        const { args } = options({ documents: {
            'users/account-fixture/projectRegistryV1/default': existing({ canonicalProjectId: PROJECT })
        } });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.CANONICAL_REFERENCE);
    });

    test('sin obra, alias ni referencia canónica remota: solo sugerir revisión manual', async () => {
        const { args } = options();
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.NOT_FOUND);
        expect(result.readOnly).toBe(true);
    });

    test('obra borrada con lápida remota se distingue de ausencia remota', async () => {
        const { args } = options({ documents: {
            'users/account-fixture/projectsV1/obra-historica': existing({
                id: PROJECT, deletedAt: 123, status: 'archived'
            })
        } });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.REMOTE_TOMBSTONE);
    });

    test.each(['permission-denied', 'unavailable'])('%s no se interpreta como obra ausente', async code => {
        const { args } = options({ read: jest.fn(async () => { throw Object.assign(new Error('hidden'), { code }); }) });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.UNVERIFIED);
        expect(result.readOnly).toBe(true);
        expect(JSON.stringify(result)).not.toContain('hidden');
    });

    test('sin usuario identificado no consulta Firebase', async () => {
        const { args, readServer } = options({ uid: null });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.AUTH_REQUIRED);
        expect(readServer).not.toHaveBeenCalled();
    });

    test('si cambia la cuenta mientras se consulta, descarta el resultado remoto', async () => {
        let uid = UID;
        const { args } = options({ getUid: () => uid, read: jest.fn(async () => {
            uid = 'otra-cuenta';
            return missing;
        }) });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.ACCOUNT_CHANGED);
    });

    test('ID con barra o inseguro no se usa para construir rutas remotas', async () => {
        const { args, readServer } = options({ sourceId: 'other/escape' });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.INVALID_ID);
        expect(readServer).not.toHaveBeenCalled();
    });

    test('origen ya disponible en catálogo local no necesita asignación manual', async () => {
        const { args, readServer } = options({ localProjects: [{ id: PROJECT, name: 'Histórica' }] });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.LOCAL_PRESENT);
        expect(readServer).not.toHaveBeenCalled();
    });

    test('una respuesta malformada o parcial de Firestore nunca equivale a ausencia', async () => {
        const { args } = options({ read: jest.fn(async () => ({})) });
        const result = await inspectPayrollConfigOrigin(args);
        expect(result.status).toBe(PAYROLL_CONFIG_ORIGIN_STATUS.UNVERIFIED);
    });
});
