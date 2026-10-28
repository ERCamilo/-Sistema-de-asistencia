import { buildNfcRequest, normalizeNfcUid, nfcEndpoint, normalizeNfcEndpoint, readNfcResponse, sendNfcRequest, getNfcToken, NFC_ENDPOINT, NFC_TEST_ENDPOINT } from '../modules/features/nfc/NfcCore.js';
import { readNfcPreferences, saveNfcPreferences } from '../modules/features/nfc/NfcPreferences.js';

const employee = { id: 'emp-1', number: '001', name: 'Uno', loans: [{ amount: 1000 }], salary: 800 };
const context = { ownerUid: 'owner-1', companyName: 'Prueba', projectId: 'project-1' };
const request = action => buildNfcRequest(action, { requestId: 'request-1', employee, context, cardUid: '04:00:ab:cd:ef:12:34', requestedAt: '2026-10-27T17:00:00Z' });
const reply = (req, extra = {}) => ({ ok: true, schemaVersion: 1, requestId: req.requestId, cardUid: req.cardUid, status: req.action === 'consultar' ? 'disponible' : 'registrada', employeeId: req.action === 'consultar' ? null : employee.id, registeredAt: '2026-10-27T17:00:01Z', ...extra });
afterEach(() => { localStorage.clear(); jest.useRealTimers(); });

test.each(['04 00 ab cd ef 12 34', '04:00:ab:cd:ef:12:34', '04-00-AB-CD-EF-12-34', '04\u00a000\u202fab\tcd\nef 12 34'])('normalizes UID while preserving initial zeroes: %s', value => {
    expect(normalizeNfcUid(value)).toBe('0400ABCDEF1234');
});
test.each(['', 'not-a-card', '0001', '0400ABCDEF123', '04/00/AB/CD/EF/12/34', 'GG00ABCDEF1234'])('rejects malformed UID %s', value => expect(() => normalizeNfcUid(value)).toThrow());
test('preference defaults and exact endpoints are isolated by account', () => {
    expect(readNfcPreferences('a')).toEqual({ enabled: false, mode: 'test', customUrl: '' });
    saveNfcPreferences('a', { enabled: true }); expect(readNfcPreferences('b').enabled).toBe(false);
    expect(nfcEndpoint(readNfcPreferences('a'))).toBe(NFC_TEST_ENDPOINT);
    saveNfcPreferences('a', { mode: 'production' }); expect(nfcEndpoint(readNfcPreferences('a'))).toBe(NFC_ENDPOINT);
    saveNfcPreferences('a', { mode: 'custom', customUrl: 'https://example.test/custom' });
    expect(nfcEndpoint(readNfcPreferences('a'))).toBe('https://example.test/custom');
    expect(() => saveNfcPreferences(null, { enabled: true })).toThrow('Inicia sesión');
});
test('invalid custom URL never silently selects production and storage failure is visible', () => {
    saveNfcPreferences('a', { mode: 'custom' }); expect(() => nfcEndpoint(readNfcPreferences('a'))).toThrow();
    for (const url of ['http://example.com/nfc', 'https://user:password@example.com/', 'javascript:alert(1)', 'https://example.com/#secret']) expect(() => normalizeNfcEndpoint(url)).toThrow();
    expect(() => saveNfcPreferences('a', { enabled: true }, { getItem: () => null, setItem: () => { throw Error(); } })).toThrow('No se pudo guardar');
    expect(readNfcPreferences('a', null).enabled).toBe(false);
});
test('payload contains only agreed employee data and immutable snapshot values', () => {
    const req = request('consultar'); expect(req.employee).toEqual({ id: 'emp-1', number: '001', name: 'Uno' });
    expect(req.context).toEqual(context); expect(req.source).toBe('sa-web-nfc');
    expect(JSON.stringify(req)).not.toContain('salary'); expect(JSON.stringify(req)).not.toContain('loans');
    expect(() => buildNfcRequest('wrong', { employee, context, requestId: 'x', cardUid: 'aabbccdd' })).toThrow();
});
test('response validation distinguishes availability, same employee and occupied UID', () => {
    const req = request('consultar');
    expect(readNfcResponse(reply(req), req).status).toBe('disponible');
    expect(readNfcResponse(reply(req, { status: 'mismo_empleado', employeeId: employee.id }), req).status).toBe('mismo_empleado');
    expect(readNfcResponse(reply(req, { status: 'otro_empleado', employeeId: 'emp-2' }), req).status).toBe('otro_empleado');
});
test.each([{ ok: true }, { requestId: 'other' }, { cardUid: 'other' }, { schemaVersion: 2 }, { employeeId: employee.id }, { status: 'registrada' }])('rejects generic or mismatched lookup response %j', patch => {
    const req = request('consultar'); const data = Object.keys(patch).length === 1 && patch.ok ? patch : reply(req, patch);
    expect(() => readNfcResponse(data, req)).toThrow();
});
test.each([{ employeeId: 'emp-2' }, { registeredAt: null }, { registeredAt: 'not-a-date' }, { status: 'disponible' }])('registration must confirm employee and server date: %j', patch => {
    const req = request('asociar'); expect(() => readNfcResponse(reply(req, patch), req)).toThrow();
});
test('transport sends the exact JSON and bearer token without cookies, redirects or cache', async () => {
    const req = request('asociar'); const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => reply(req) }));
    await expect(sendNfcRequest(NFC_TEST_ENDPOINT, req, { token: 'synthetic-token', fetchImpl })).resolves.toMatchObject({ status: 'registrada' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0]; expect(url).toBe(NFC_TEST_ENDPOINT);
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer synthetic-token' } });
    expect(JSON.parse(options.body)).toEqual(req); expect(options.body).not.toContain('synthetic-token');
});
test.each([[404, 'NOT_FOUND'], [409, 'CONFLICT'], [401, 'AUTH'], [403, 'AUTH'], [500, 'HTTP']])('HTTP %s has recoverable code %s', async (status, code) => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status }));
    await expect(sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { token: 'x', fetchImpl })).rejects.toMatchObject({ code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('network error and invalid JSON never report a saved association', async () => {
    await expect(sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { token: 'x', fetchImpl: async () => { throw new TypeError(); } })).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { token: 'x', fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw Error(); } }) })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const fetchImpl = jest.fn(); await expect(sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { fetchImpl })).rejects.toMatchObject({ code: 'AUTH' }); expect(fetchImpl).not.toHaveBeenCalled();
});
test('timeout aborts the request without falling back to another URL', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn((_, { signal }) => new Promise((yes, no) => signal.addEventListener('abort', () => no(Object.assign(Error(), { name: 'AbortError' })))));
    const pending = sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { token: 'x', fetchImpl, timeoutMs: 10 });
    const check = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' }); jest.advanceTimersByTime(10); await check;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('token refresh is bounded and can be cancelled even if Firebase never settles', async () => {
    jest.useFakeTimers();
    const token = getNfcToken(() => new Promise(() => {}), { timeoutMs: 10 });
    const timeout = expect(token).rejects.toMatchObject({ code: 'AUTH' }); jest.advanceTimersByTime(10); await timeout;
    const controller = new AbortController();
    const cancelled = getNfcToken(() => new Promise(() => {}), { signal: controller.signal });
    const abort = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await abort;
    expect(jest.getTimerCount()).toBe(0);
});
