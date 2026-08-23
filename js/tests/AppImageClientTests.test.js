import { AppImageClient } from '../modules/services/AppImageClient.js';

const coordinates = {
    category: 'employee-profile',
    ownerType: 'employee',
    ownerId: 'emp-1',
    assetId: 'profile',
    variant: 'thumbnail'
};

function jsonResponse(body, status = 200) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    });
}

describe('AppImageClient', () => {
    test('gets a fresh token for every generic action and never returns the signed URL', async () => {
        const getIdToken = jest.fn()
            .mockResolvedValueOnce('token-upload')
            .mockResolvedValueOnce('token-lookup')
            .mockResolvedValueOnce('token-delete');
        const fetchImpl = jest.fn()
            .mockImplementationOnce(() => jsonResponse({ ok: true, asset: { id: 'asset-1' } }))
            .mockImplementationOnce(() => jsonResponse({
                ok: true,
                asset: { id: 'asset-1', mimeType: 'image/webp', uploadedAt: '2026-08-22T12:00:00Z' },
                signedUrl: 'https://signed.invalid/private',
                expiresIn: 600
            }))
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                blob: async () => new Blob(['remote'], { type: 'image/webp' })
            })
            .mockImplementationOnce(() => jsonResponse({ ok: true, deleted: true }));
        const client = new AppImageClient({
            endpoint: 'https://n8n.example/webhook/app-images',
            getIdToken,
            fetchImpl
        });

        await client.upload(coordinates, new Blob(['image'], { type: 'image/webp' }), 'profile.webp');
        const downloaded = await client.lookupAndDownload(coordinates);
        await client.delete(coordinates);

        expect(getIdToken).toHaveBeenCalledTimes(3);
        const uploadBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(uploadBody).toMatchObject({ action: 'upload', idToken: 'token-upload', ...coordinates });
        expect(uploadBody.fileBase64).toBeTruthy();
        expect(downloaded.blob).toBeInstanceOf(Blob);
        expect(JSON.stringify(downloaded)).not.toContain('signed.invalid');
        expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({
            action: 'lookup', idToken: 'token-lookup', ...coordinates
        });
        expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toMatchObject({
            action: 'delete', idToken: 'token-delete', ...coordinates
        });
    });

    test('rejects invalid coordinates before fetching', async () => {
        const fetchImpl = jest.fn();
        const client = new AppImageClient({
            endpoint: 'https://n8n.example/webhook/app-images',
            getIdToken: async () => 'token',
            fetchImpl
        });
        await expect(client.lookup({ ...coordinates, ownerId: '../employee' })).rejects.toThrow();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    test('binds the fetch implementation to the global receiver (native fetch contract)', async () => {
        // Regression: storing globalThis.fetch as an instance method made
        // `this.fetchImpl(...)` invoke the native fetch with the client as
        // receiver -> "Illegal invocation" -> every request died silently.
        let receiver = null;
        const fetchImpl = function (...args) {
            receiver = this; // native fetch requires `this` to be the global object
            return jsonResponse({ ok: true, asset: { id: 'asset-1' } });
        };
        const client = new AppImageClient({
            endpoint: 'https://n8n.example/webhook/app-images',
            getIdToken: async () => 'token',
            fetchImpl
        });

        await client.lookup(coordinates);

        expect(receiver).toBe(globalThis);
    });
});
