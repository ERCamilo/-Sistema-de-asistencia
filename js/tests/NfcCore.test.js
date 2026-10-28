import { buildNfcRequest, normalizeNfcUid, nfcEndpoint, normalizeNfcEndpoint, readNfcResponse, sendNfcRequest, NFC_ENDPOINT, NFC_TEST_ENDPOINT } from '../modules/features/nfc/NfcCore.js';
import { readNfcPreferences, saveNfcPreferences, NFC_PREFS_PREFIX, NFC_PREFS_KEY } from '../modules/features/nfc/NfcPreferences.js';

const employee = { id: 'emp-1', number: '001', name: 'Uno', loans: [{ amount: 1000 }], salary: 800 };
const context = { companyName: 'Prueba', projectId: 'project-1' };
const request = action => buildNfcRequest(action, { requestId: 'request-1', employee, context, cardUid: '04:00:ab:cd:ef:12:34', requestedAt: '2026-10-27T17:00:00Z' });
const reply = (req, extra = {}) => ({ ok: true, schemaVersion: 1, requestId: req.requestId, cardUid: req.cardUid, status: req.action === 'consultar' ? 'disponible' : 'registrada', employeeId: req.action === 'consultar' ? null : employee.id, registeredAt: '2026-10-27T17:00:01Z', ...extra });
afterEach(() => { localStorage.clear(); jest.useRealTimers(); });

test.each(['04 00 ab cd ef 12 34', '04:00:ab:cd:ef:12:34', '04-00-AB-CD-EF-12-34', '04\u00a000\u202fab\tcd\nef 12 34'])('normalizes UID while preserving initial zeroes: %s', value => {
    expect(normalizeNfcUid(value)).toBe('0400ABCDEF1234');
});
test.each(['', 'not-a-card', '0001', '0400ABCDEF123', '04/00/AB/CD/EF/12/34', 'GG00ABCDEF1234'])('rejects malformed UID %s', value => expect(() => normalizeNfcUid(value)).toThrow());
test('preferences work without a user and survive a new reader instance on this browser', () => {
    expect(readNfcPreferences()).toEqual({ enabled: false, mode: 'test', customUrl: '' });
    saveNfcPreferences({ enabled: true });
    expect(readNfcPreferences().enabled).toBe(true);
    expect(nfcEndpoint(readNfcPreferences())).toBe(NFC_TEST_ENDPOINT);
    saveNfcPreferences({ mode: 'production' }); expect(nfcEndpoint(readNfcPreferences())).toBe(NFC_ENDPOINT);
    saveNfcPreferences({ mode: 'custom', customUrl: 'https://example.test/custom' });
    expect(nfcEndpoint(readNfcPreferences())).toBe('https://example.test/custom');
    expect(JSON.parse(localStorage.getItem(NFC_PREFS_KEY)).enabled).toBe(true);
});
test('legacy account preferences do not silently activate production in the no-login MVP', () => {
    localStorage.setItem(NFC_PREFS_PREFIX+'old-account', JSON.stringify({ enabled:true, mode:'production' }));
    expect(readNfcPreferences()).toEqual({ enabled:false, mode:'test', customUrl:'' });
});
test('invalid custom URL never silently selects production and storage failure is visible', () => {
    saveNfcPreferences({ mode: 'custom' }); expect(() => nfcEndpoint(readNfcPreferences())).toThrow();
    for (const url of ['http://example.com/nfc', 'https://user:password@example.com/', 'javascript:alert(1)', 'https://example.com/#secret']) expect(() => normalizeNfcEndpoint(url)).toThrow();
    expect(() => saveNfcPreferences({ enabled: true }, { getItem: () => null, setItem: () => { throw Error(); } })).toThrow('No se pudo guardar');
    expect(readNfcPreferences(null).enabled).toBe(false);
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
test('transport sends JSON without authentication, cookies, redirects or cache', async () => {
    const req = request('asociar'); const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => reply(req) }));
    await expect(sendNfcRequest(NFC_TEST_ENDPOINT, req, { token: 'legacy-token-must-not-be-sent', fetchImpl })).resolves.toMatchObject({ status: 'registrada' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0]; expect(url).toBe(NFC_TEST_ENDPOINT);
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(options.body)).toEqual(req); expect(options.headers).not.toHaveProperty('Authorization');
    expect(options.body).not.toContain('legacy-token-must-not-be-sent'); expect(req.context).not.toHaveProperty('ownerUid');
});
test.each([[404, 'NOT_FOUND'], [409, 'CONFLICT'], [401, 'ACCESS'], [403, 'ACCESS'], [500, 'HTTP']])('HTTP %s has recoverable code %s', async (status, code) => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status }));
    await expect(sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { fetchImpl })).rejects.toMatchObject({ code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('network error and invalid JSON never report a saved association', async () => {
    await expect(sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { fetchImpl: async () => { throw new TypeError(); } })).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw Error(); } }) })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
test('timeout aborts the request without falling back to another URL', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn((_, { signal }) => new Promise((yes, no) => signal.addEventListener('abort', () => no(Object.assign(Error(), { name: 'AbortError' })))));
    const pending = sendNfcRequest(NFC_TEST_ENDPOINT, request('asociar'), { fetchImpl, timeoutMs: 10 });
    const check = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' }); jest.advanceTimersByTime(10); await check;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('legacy Firebase account metadata is not sent to the webhook', () => {
    const req = buildNfcRequest('asociar', { employee, context:{...context,ownerUid:'legacy-user'}, requestId:'req-no-auth', cardUid:'0400abcd' });
    expect(req.context).toEqual(context);
    expect(JSON.stringify(req)).not.toContain('legacy-user');
});
