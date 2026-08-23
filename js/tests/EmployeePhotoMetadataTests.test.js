import {
    Employee,
    normalizeEmployeePhoto
} from '../modules/features/employees/Employee.js';
import { mergeEmployees } from '../modules/services/EmployeeMerge.js';
import {
    auth,
    getDoc,
    getDocs,
    setDoc
} from '../modules/data/firebase.js';

const EmployeeRepoModule = jest.requireActual('../modules/services/EmployeeRepository.js');
const EmployeeRepository = EmployeeRepoModule.EmployeeRepository || EmployeeRepoModule.default;

const VALID_PHOTO = {
    state: 'ready',
    revision: 'original:2026-08-22T12:00:00.000Z|thumbnail:2026-08-22T12:00:01.000Z',
    updatedAt: 1787360400000
};

describe('Employee photo metadata contract', () => {
    afterEach(() => {
        auth.currentUser = null;
        getDoc.mockReset();
        getDocs.mockReset();
        setDoc.mockReset();
    });

    test('preserves only canonical durable metadata', () => {
        const normalized = normalizeEmployeePhoto({
            ...VALID_PHOTO,
            previewDataUrl: 'data:image/jpeg;base64,temporary',
            signedUrl: 'https://storage.example/photo.jpg?token=temporary'
        });

        expect(normalized).toEqual(VALID_PHOTO);
        expect(Object.keys(normalized)).toEqual([
            'state',
            'revision',
            'updatedAt'
        ]);
    });

    test('legacy employees without photo metadata preserve field omission', () => {
        const employee = Employee.fromJSON({ id: 'employee-1', name: 'Ana' });
        const serialized = employee.toJSON();

        expect(employee.photo).toBeUndefined();
        expect(Object.prototype.hasOwnProperty.call(employee, 'photo')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(serialized, 'photo')).toBe(false);
    });

    test('explicit null photo remains an intentional removal signal', () => {
        const employee = Employee.fromJSON({ id: 'employee-1', name: 'Ana', photo: null });
        const serialized = employee.toJSON();

        expect(Object.prototype.hasOwnProperty.call(employee, 'photo')).toBe(true);
        expect(employee.photo).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(serialized, 'photo')).toBe(true);
        expect(serialized.photo).toBeNull();
    });

    test.each([
        undefined,
        null,
        {},
        { ...VALID_PHOTO, state: 'missing' },
        { ...VALID_PHOTO, revision: '' },
        { ...VALID_PHOTO, updatedAt: 'yesterday' }
    ])('malformed metadata resolves to null: %p', (value) => {
        expect(normalizeEmployeePhoto(value)).toBeNull();
    });

    test.each([
        ['data URL', 'data:image/jpeg;base64,aGVsbG8='],
        ['object URL', 'blob:https://app.example/6e74c5a0'],
        ['signed URL', 'https://storage.example/photo.jpg?token=secret'],
        ['raw base64', `iVBORw0KGgo${'A'.repeat(180)}`],
        ['Blob', new Blob(['raw-image'], { type: 'image/jpeg' })]
    ])('rejects a transient %s as the durable revision', (_label, transientValue) => {
        expect(normalizeEmployeePhoto({
            ...VALID_PHOTO,
            revision: transientValue
        })).toBeNull();
    });

    test('Employee round-trip keeps a valid descriptor and drops transient extras', () => {
        const employee = Employee.fromJSON({
            id: 'employee-1',
            name: 'Ana',
            photo: { ...VALID_PHOTO, objectUrl: 'blob:https://app.example/temporary' }
        });

        expect(employee.photo).toEqual(VALID_PHOTO);
        expect(employee.toJSON().photo).toEqual(VALID_PHOTO);
    });
});

describe('EmployeeRepository photo persistence boundary', () => {
    afterEach(() => {
        auth.currentUser = null;
        getDoc.mockReset();
        getDocs.mockReset();
        setDoc.mockReset();
    });

    test('loadAll sanitizes remote employee photo metadata', async () => {
        auth.currentUser = { uid: 'user-1' };
        getDocs.mockResolvedValueOnce({
            forEach: callback => callback({
                data: () => ({
                    id: 'employee-1',
                    name: 'Ana',
                    photo: {
                        ...VALID_PHOTO,
                        revision: 'data:image/jpeg;base64,temporary'
                    }
                })
            })
        });

        const [employee] = await EmployeeRepository.loadAll();

        expect(employee.photo).toBeNull();
    });

    test('saveOne persists only canonical photo metadata', async () => {
        auth.currentUser = { uid: 'user-1' };
        setDoc.mockResolvedValueOnce();

        await EmployeeRepository.saveOne({
            id: 'employee-1',
            name: 'Ana',
            photo: {
                ...VALID_PHOTO,
                previewDataUrl: 'data:image/jpeg;base64,temporary'
            }
        });

        const payload = setDoc.mock.calls[0][1];
        expect(payload.photo).toEqual(VALID_PHOTO);
        expect(payload.photo.previewDataUrl).toBeUndefined();
    });

    test('saveOne does not add a photo field to a legacy payload', async () => {
        auth.currentUser = { uid: 'user-1' };
        setDoc.mockResolvedValueOnce();

        await EmployeeRepository.saveOne({ id: 'employee-1', name: 'Ana' });

        const payload = setDoc.mock.calls[0][1];
        expect(Object.prototype.hasOwnProperty.call(payload, 'photo')).toBe(false);
    });

    test('savePhotoSignal persists only the lightweight signal without touching employee updatedAt', async () => {
        auth.currentUser = { uid: 'user-1' };
        setDoc.mockResolvedValueOnce();

        await EmployeeRepository.savePhotoSignal('employee-1', {
            ...VALID_PHOTO,
            signedUrl: 'https://storage.example/temporary'
        });

        expect(setDoc.mock.calls[0][1]).toEqual({ photo: VALID_PHOTO });
        expect(setDoc.mock.calls[0][1].updatedAt).toBeUndefined();
    });

    test('merge-save preserves a remote photo when a newer Employee omitted photo', async () => {
        auth.currentUser = { uid: 'user-1' };
        getDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({
                id: 'employee-1',
                name: 'Ana',
                updatedAt: 100,
                photo: VALID_PHOTO
            })
        });
        setDoc.mockResolvedValueOnce();
        const localLegacyEmployee = new Employee({
            id: 'employee-1',
            name: 'Ana updated locally',
            updatedAt: 200
        });

        await EmployeeRepository.saveOne(localLegacyEmployee, { mergeRemote: true });

        const payload = setDoc.mock.calls[0][1];
        expect(payload.name).toBe('Ana updated locally');
        expect(payload.photo).toEqual(VALID_PHOTO);
    });
});

describe('Employee photo signal merge', () => {
    test('newer photo signal wins independently from the general employee winner', () => {
        const remotePhoto = { ...VALID_PHOTO, revision: 'remote-new', updatedAt: 300 };
        const merged = mergeEmployees(
            { id: 'employee-1', name: 'Remote old scalar', updatedAt: 100, photo: remotePhoto },
            { id: 'employee-1', name: 'Local new scalar', updatedAt: 200, photo: { ...VALID_PHOTO, revision: 'local-old', updatedAt: 50 } }
        );

        expect(merged.name).toBe('Local new scalar');
        expect(merged.photo).toEqual(remotePhoto);
    });

    test('confirmed deleted signal survives a newer unrelated employee edit', () => {
        const deleted = { state: 'deleted', revision: 'deleted:400', updatedAt: 400 };
        const merged = mergeEmployees(
            { id: 'employee-1', updatedAt: 100, photo: deleted },
            { id: 'employee-1', updatedAt: 500, phone: '555-0100', photo: { ...VALID_PHOTO, updatedAt: 50 } }
        );

        expect(merged.phone).toBe('555-0100');
        expect(merged.photo).toEqual(deleted);
    });
});
