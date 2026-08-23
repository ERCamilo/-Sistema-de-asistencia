import { readFileSync } from 'fs';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import {
    APP_IMAGE_POLICIES,
    AppImageValidationError,
    assertIdentityMatches,
    assertVersionedStoragePath,
    deriveVersionedStoragePath,
    parseImageFile,
    planVersionCommit,
    validateAction,
    validateAssetCoordinates
} from '../../supabase/functions/app-images/policy.js';
import {
    readBoundedJsonBody
} from '../../supabase/functions/app-images/request.js';

const JPEG_BASE64 = '/9j/2Q==';
const PNG_BASE64 = 'iVBORw0KGgo=';
const VERSION_A = '00000000-0000-4000-8000-000000000001';
const VERSION_B = '00000000-0000-4000-8000-000000000002';

if (!global.TextEncoder) global.TextEncoder = NodeTextEncoder;
if (!global.TextDecoder) global.TextDecoder = NodeTextDecoder;

function expectValidationCode(callback, code) {
    try {
        callback();
        throw new Error(`Expected validation error ${code}`);
    } catch (error) {
        expect(error).toBeInstanceOf(AppImageValidationError);
        expect(error.code).toBe(code);
    }
}

async function expectAsyncValidationCode(callback, code) {
    try {
        await callback();
        throw new Error(`Expected validation error ${code}`);
    } catch (error) {
        expect(error).toBeInstanceOf(AppImageValidationError);
        expect(error.code).toBe(code);
    }
}

function employeeCoordinates() {
    return validateAssetCoordinates({
        category: 'employee-profile',
        ownerType: 'employee',
        ownerId: 'employee_42',
        assetId: 'profile',
        variant: 'original'
    });
}

function streamRequest(chunks, contentLength = null) {
    const queue = chunks.map(chunk => new TextEncoder().encode(chunk));
    const cancel = jest.fn();
    const releaseLock = jest.fn();
    return {
        request: {
            headers: {
                get: jest.fn(name => name === 'content-length' ? contentLength : null)
            },
            body: {
                getReader: () => ({
                    read: jest.fn(async () => queue.length
                        ? { done: false, value: queue.shift() }
                        : { done: true, value: undefined }),
                    cancel,
                    releaseLock
                })
            }
        },
        cancel,
        releaseLock
    };
}

describe('Generic app image policy registry', () => {
    test('keeps destinations explicit and extensible without accepting client paths', () => {
        expect(Object.keys(APP_IMAGE_POLICIES)).toEqual([
            'employee-profile',
            'worksite-photo',
            'company-image'
        ]);
        expect(APP_IMAGE_POLICIES['employee-profile']).toMatchObject({
            ownerTypes: ['employee'],
            variants: ['thumbnail', 'original']
        });
    });

    test('validates an allowlisted coordinate tuple', () => {
        expect(validateAssetCoordinates({
            category: 'employee-profile',
            ownerType: 'employee',
            ownerId: 'employee_42',
            assetId: 'profile',
            variant: 'thumbnail',
            storageBucket: 'caller-controlled-bucket',
            storagePath: '../caller-controlled-path'
        })).toEqual({
            category: 'employee-profile',
            ownerType: 'employee',
            ownerId: 'employee_42',
            assetId: 'profile',
            variant: 'thumbnail'
        });
    });

    test.each([
        ['unknown category', { category: 'arbitrary-bucket' }, 'UNKNOWN_CATEGORY'],
        ['wrong owner type', { ownerType: 'company' }, 'INVALID_OWNER_TYPE'],
        ['unknown variant', { variant: 'raw' }, 'INVALID_VARIANT'],
        ['path traversal', { ownerId: '../another-user' }, 'INVALID_OWNER_ID'],
        ['slash in asset id', { assetId: 'folder/file' }, 'INVALID_ASSET_ID']
    ])('rejects %s', (_label, override, code) => {
        const request = {
            category: 'employee-profile',
            ownerType: 'employee',
            ownerId: 'employee_42',
            assetId: 'profile',
            variant: 'original',
            ...override
        };
        expectValidationCode(() => validateAssetCoordinates(request), code);
    });

    test('derives unique physical versions below the same logical coordinates', () => {
        const coordinates = validateAssetCoordinates({
            category: 'worksite-photo',
            ownerType: 'worksite',
            ownerId: 'site-20',
            assetId: 'inspection_2026_08_22',
            variant: 'original'
        });
        const first = deriveVersionedStoragePath('firebase_uid_123', coordinates, VERSION_A);
        const second = deriveVersionedStoragePath('firebase_uid_123', coordinates, VERSION_B);
        expect(first).toBe(
            'firebase_uid_123/worksite-photo/worksite/site-20/inspection_2026_08_22/original/versions/00000000-0000-4000-8000-000000000001'
        );
        expect(second).not.toBe(first);
        expect(assertVersionedStoragePath(first, 'firebase_uid_123', coordinates)).toBe(first);
    });

    test.each(['../uid', 'uid/other', '', 'uid with spaces'])('rejects unsafe verified uid %s', uid => {
        const coordinates = validateAssetCoordinates({
            category: 'company-image',
            ownerType: 'company',
            ownerId: 'company-1',
            assetId: 'brand',
            variant: 'logo'
        });
        expectValidationCode(
            () => deriveVersionedStoragePath(uid, coordinates, VERSION_A),
            'INVALID_AUTHENTICATED_UID'
        );
    });

    test('rejects shared, malformed, and cross-coordinate physical pointers', () => {
        const coordinates = employeeCoordinates();
        const sharedPath = 'verified-user/employee-profile/employee/employee_42/profile/original';
        const otherOwnerPath = deriveVersionedStoragePath(
            'verified-user',
            { ...coordinates, ownerId: 'employee_99' },
            VERSION_A
        );
        expectValidationCode(
            () => assertVersionedStoragePath(sharedPath, 'verified-user', coordinates),
            'INVALID_STORAGE_POINTER'
        );
        expectValidationCode(
            () => assertVersionedStoragePath(otherOwnerPath, 'verified-user', coordinates),
            'INVALID_STORAGE_POINTER'
        );
    });

    test('accepts only the three generic API actions', () => {
        expect(validateAction(undefined)).toBe('upload');
        expect(validateAction('lookup')).toBe('lookup');
        expect(validateAction('delete')).toBe('delete');
        expectValidationCode(() => validateAction('move'), 'INVALID_ACTION');
    });
});

describe('Generic app image lifecycle and concurrency model', () => {
    test('serialized pointer swaps clean only superseded versions, never the winner', () => {
        const coordinates = employeeCoordinates();
        const original = deriveVersionedStoragePath(
            'verified-user',
            coordinates,
            '00000000-0000-4000-8000-000000000000'
        );
        const first = planVersionCommit(
            'verified-user',
            coordinates,
            VERSION_A,
            original
        );
        const second = planVersionCommit(
            'verified-user',
            coordinates,
            VERSION_B,
            first.storagePath
        );

        expect(first.cleanupStoragePath).toBe(original);
        expect(second.cleanupStoragePath).toBe(first.storagePath);
        expect(second.cleanupStoragePath).not.toBe(second.storagePath);
        expect(second.storagePath).toContain(`/versions/${VERSION_B}`);
    });

    test('migration serializes swaps and makes delete compare-and-swap pointer-safe', () => {
        const migration = readFileSync(
            'supabase/migrations/202608220001_create_app_images.sql',
            'utf8'
        );
        expect(migration).toMatch(/create or replace function public\.swap_app_image_pointer/i);
        expect(migration).toMatch(/pg_advisory_xact_lock/i);
        expect(migration.match(/pg_advisory_xact_lock/gi)).toHaveLength(2);
        expect(migration).toMatch(/create or replace function public\.delete_app_image_pointer_cas/i);
        expect(migration).toMatch(/storage_path\s*=\s*p_expected_storage_path/i);
    });

    test('edge runtime reads the metadata pointer and never overwrites physical bytes', () => {
        const edgeFunction = readFileSync(
            'supabase/functions/app-images/index.ts',
            'utf8'
        );
        expect(edgeFunction).toMatch(/trustedStoragePointer\([\s\S]*assetRecord\.storage_path/i);
        expect(edgeFunction).toMatch(/"swap_app_image_pointer"/i);
        expect(edgeFunction).toMatch(/"delete_app_image_pointer_cas"/i);
        expect(edgeFunction).toMatch(/upsert:\s*false/i);
        expect(edgeFunction).not.toMatch(/\.from\("app_images"\)\s*\.upsert/i);
        const storageRemoval = edgeFunction.indexOf('storagePath,\n        "delete"');
        const pointerDelete = edgeFunction.indexOf('"delete_app_image_pointer_cas"');
        expect(storageRemoval).toBeGreaterThan(-1);
        expect(storageRemoval).toBeLessThan(pointerDelete);
        expect(edgeFunction).toMatch(/if \(!removed\)[\s\S]*STORAGE_DELETE_FAILED[\s\S]*cleanupPending:\s*true/i);
    });

    test('database size constraints match each policy limit', () => {
        const migration = readFileSync(
            'supabase/migrations/202608220001_create_app_images.sql',
            'utf8'
        );
        expect(migration).toMatch(/category = 'employee-profile'[\s\S]+5242880/i);
        expect(migration).toMatch(/category in \('worksite-photo', 'company-image'\)[\s\S]+10485760/i);
    });
});

describe('Bounded JSON request reading', () => {
    test('parses a chunked JSON body when it stays within the byte limit', async () => {
        const harness = streamRequest(['{"action":', '"lookup"}']);
        await expect(readBoundedJsonBody(harness.request, 64)).resolves.toEqual({
            action: 'lookup'
        });
        expect(harness.cancel).not.toHaveBeenCalled();
        expect(harness.releaseLock).toHaveBeenCalledTimes(1);
    });

    test('cancels and rejects a chunked body as soon as it exceeds the limit', async () => {
        const harness = streamRequest(['{"data":"', 'too-large', '"}']);
        await expectAsyncValidationCode(
            () => readBoundedJsonBody(harness.request, 12),
            'PAYLOAD_TOO_LARGE'
        );
        expect(harness.cancel).toHaveBeenCalledTimes(1);
        expect(harness.releaseLock).toHaveBeenCalledTimes(1);
    });

    test('rejects an oversized declared content length without reading the stream', async () => {
        const harness = streamRequest(['{}'], '1000');
        await expectAsyncValidationCode(
            () => readBoundedJsonBody(harness.request, 64),
            'PAYLOAD_TOO_LARGE'
        );
        expect(harness.releaseLock).not.toHaveBeenCalled();
    });

    test('still reports the size violation when stream cancellation fails', async () => {
        const harness = streamRequest(['123456789']);
        harness.cancel.mockRejectedValue(new Error('cancel failed'));
        await expectAsyncValidationCode(
            () => readBoundedJsonBody(harness.request, 4),
            'PAYLOAD_TOO_LARGE'
        );
        expect(harness.releaseLock).toHaveBeenCalledTimes(1);
    });
});

describe('Generic app image payload validation', () => {
    test('accepts a matching JPEG signature and data URL', () => {
        expect(parseImageFile(`data:image/jpeg;base64,${JPEG_BASE64}`, undefined, {
            maxBytes: 1024
        })).toMatchObject({ mimeType: 'image/jpeg' });
        expect(parseImageFile(PNG_BASE64, 'image/png', { maxBytes: 1024 }).binary)
            .toBeInstanceOf(Uint8Array);
    });

    test.each([
        ['unsupported MIME', JPEG_BASE64, 'image/gif', 'UNSUPPORTED_IMAGE_TYPE'],
        ['signature mismatch', JPEG_BASE64, 'image/png', 'IMAGE_SIGNATURE_MISMATCH'],
        [
            'data URL MIME mismatch',
            `data:image/jpeg;base64,${JPEG_BASE64}`,
            'image/webp',
            'IMAGE_MIME_MISMATCH'
        ],
        ['non-base64 content', '%%%%', 'image/jpeg', 'INVALID_IMAGE_BASE64']
    ])('rejects %s', (_label, payload, mimeType, code) => {
        expectValidationCode(
            () => parseImageFile(payload, mimeType, { maxBytes: 1024 }),
            code
        );
    });

    test('rejects decoded images over the category limit', () => {
        expectValidationCode(
            () => parseImageFile(JPEG_BASE64, 'image/jpeg', { maxBytes: 3 }),
            'IMAGE_TOO_LARGE'
        );
    });

    test('rejects a caller identity that conflicts with the verified token', () => {
        expectValidationCode(
            () => assertIdentityMatches({ firebaseUid: 'another-user' }, 'verified-user'),
            'IDENTITY_MISMATCH'
        );
        expect(assertIdentityMatches({}, 'verified-user')).toBe('verified-user');
    });

    test('uses stable validation errors', () => {
        const error = new AppImageValidationError('INVALID_ACTION');
        expect(error).toMatchObject({ name: 'AppImageValidationError', code: 'INVALID_ACTION' });
    });
});
