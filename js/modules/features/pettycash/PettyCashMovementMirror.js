export function buildMovementMirrorRequest(entry, idToken) {
    if (!entry?.id || !entry?.data) throw new Error('INVALID_MIRROR_ENTRY');
    if (!idToken) throw new Error('MISSING_ID_TOKEN');
    return {
        idToken,
        action: entry.op === 'delete' ? 'delete' : 'upsert',
        transactionId: entry.id,
        movement: entry.data
    };
}

export async function sendMovementMirror({ url, entry, idToken, fetchImpl = fetch }) {
    if (!url) throw new Error('MISSING_MIRROR_URL');
    const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMovementMirrorRequest(entry, idToken))
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || `MIRROR_HTTP_${response.status}`);
    }
    return data;
}
