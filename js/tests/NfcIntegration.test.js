import { NfcIntegration } from '../modules/features/nfc/NfcIntegration.js';
import { NfcReadTest } from '../modules/ui/settings/NfcReadTest.js';
import { NfcEmployeeEntry, NfcSettingsFields } from '../modules/features/nfc/NfcViews.js';
import { readNfcPreferences, saveNfcPreferences } from '../modules/features/nfc/NfcPreferences.js';
import { NFC_TEST_ENDPOINT, NFC_ENDPOINT } from '../modules/features/nfc/NfcCore.js';
import { DOMDiff } from '../modules/utils/DOMDiff.js';
import { EmployeeModal } from '../modules/ui/modals/EmployeeModal.js';
import * as EmployeesUI from '../modules/features/employees/EmployeesUI.js';
import { employeePhotoService } from '../modules/services/EmployeePhotoService.js';

let ui, reader, adapter, employees, scope, user, owner, proceed, send, check, next, state;
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => {
    localStorage.clear(); next = 0; user = { uid: 'owner-1' }; owner = 'owner-1'; proceed = true;
    scope = { enabled: true, projectId: 'p1' };
    employees = [{ id: 'e1', key: 'e1', number: '001', name: 'Uno', active: true, positions: ['job'], hireDate: '2026-01-01' }, { id: 'e2', key: 'e2', number: '002', name: 'Dos', active: true, positions: ['job'], hireDate: '2026-01-01' }];
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    reader = new NfcReadTest({ env: { isSecureContext: true, NDEFReader: class { async scan() {} } } }).mount();
    send = jest.fn(async (_, req) => req.action === 'consultar' ? { status: 'disponible', employeeId: null } : { status: 'registrada', employeeId: req.employee.id, registeredAt: '2026-10-27T18:00:00Z' });
    adapter = { getUser: () => user, getDataOwner: () => owner, canProceed: () => proceed, getScope: () => scope, getEmployees: () => employees, getCompanyName: () => 'Empresa ficticia',
        getToken: jest.fn(async () => 'synthetic-token'), render: jest.fn(), notify: jest.fn(), subscribeData: callback => { check = callback; return jest.fn(); } };
    saveNfcPreferences(user.uid, { enabled: true });
    ui = new NfcIntegration(adapter, { reader, send, requestId: () => `req-${++next}` }).mount();
    state = { employees, positions: [{ id: 'job', name: 'Puesto', hourlyRate: 100, active: true }], leaders: [], attendance: {}, settings: { regularHoursPerDay: 8, overtimeFactor: 1, holidayFactor: 2, holidays: [], payPeriod: {} } };
});
afterEach(() => { ui.destroy(); reader.destroy(); localStorage.clear(); document.body.innerHTML = ''; jest.restoreAllMocks(); });
const open = () => { ui.open('e1'); expect(reader.dialog.open).toBe(true); };
const scanCard = async () => { await reader.start(); reader.reader.onreading({ serialNumber: '04 00 ab cd ef 12 34', message: { records: [] } }); await flush(); };

test('same modal supports diagnosis and enrollment, and diagnosis never sends requests', async () => {
    const shell = reader.dialog; open(); await scanCard(); expect(send).toHaveBeenCalledTimes(1);
    reader.open(); expect(reader.dialog).toBe(shell); expect(ui.context).toBeNull();
    await reader.start(); reader.reader.onreading({ serialNumber: '04:00:ab:cd:ef:12:34', message: { records: [] } }); await flush();
    expect(send).toHaveBeenCalledTimes(1); expect(reader.node('enrollment').hidden).toBe(true);
});
test('lookup follows physical reading, and registration needs an explicit confirmation', async () => {
    open(); expect(send).not.toHaveBeenCalled(); await scanCard();
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][1].action).toBe('consultar');
    expect(reader.node('register').hidden).toBe(false);
    reader.node('register').click(); await flush();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toBe(NFC_TEST_ENDPOINT);
    expect(send.mock.calls[1][1]).toMatchObject({ action: 'asociar', cardUid: '0400ABCDEF1234', employee: { id: 'e1', number: '001', name: 'Uno' }, context: { ownerUid: 'owner-1', projectId: 'p1' } });
    expect(reader.node('enrollment').textContent).toContain('confirmado por el webhook');
    expect(reader.node('register').hidden).toBe(true);
});
test.each(['mismo_empleado', 'otro_empleado'])('%s prevents a redundant or conflicting save', async status => {
    send.mockResolvedValue({ status, employeeId: status === 'mismo_empleado' ? 'e1' : 'e2' });
    open(); await scanCard(); await ui.submit('register');
    expect(send).toHaveBeenCalledTimes(1); expect(reader.node('register').hidden).toBe(true);
    expect(reader.node('enrollment').textContent).toContain(status === 'mismo_empleado' ? 'ya está asociada' : 'otro empleado');
});
test('a failed registration retries the identical payload, request ID and endpoint', async () => {
    open(); await scanCard(); send.mockRejectedValueOnce(Object.assign(Error('Respuesta perdida'), { code: 'TIMEOUT' }));
    await ui.submit('register'); const first = send.mock.calls[1];
    expect(reader.node('enrollment').textContent).toContain('Puede haberse guardado');
    expect(reader.node('retry').textContent).toBe('Reintentar registro');
    await ui.submit('retry');
    expect(send.mock.calls[2][0]).toBe(first[0]); expect(send.mock.calls[2][1]).toBe(first[1]);
    expect(send.mock.calls[2][1].requestId).toBe(first[1].requestId);
    expect(reader.node('enrollment').textContent).toContain('confirmado por el webhook');
});
test('HTTP conflict removes save until availability is checked again', async () => {
    open(); await scanCard(); send.mockRejectedValueOnce(Object.assign(Error('Conflicto'), { code: 'CONFLICT' }));
    await ui.submit('register'); expect(reader.node('register').hidden).toBe(true);
    await ui.submit('retry'); expect(send.mock.calls.at(-1)[1].action).toBe('consultar');
    expect(reader.node('register').hidden).toBe(false);
});
test('double touch sends a single register request', async () => {
    open(); await scanCard(); const pending = deferred(); send.mockImplementationOnce(() => pending.promise);
    const a = ui.submit('register'); const b = ui.submit('register'); await flush();
    expect(send).toHaveBeenCalledTimes(2); expect(reader.node('start').disabled).toBe(true);
    pending.resolve({ status: 'registrada', employeeId: 'e1', registeredAt: '2026-10-27T18:00:00Z' }); await Promise.all([a,b]);
});
test.each(['account','owner','project','employee','delete','disabled','destination','wipe'])('late result cannot cross a change in %s', async kind => {
    open(); const pending = deferred(); send.mockImplementationOnce(() => pending.promise);
    const work = ui.readCard({ uid: '0400ABCDEF1234' }); await flush();
    const signal = send.mock.calls[0][2].signal;
    if (kind === 'account') user = { uid: 'other' };
    if (kind === 'owner') owner = 'other';
    if (kind === 'project') scope = { enabled: true, projectId: 'p2' };
    if (kind === 'employee') employees[0].name = 'Nombre cambiado';
    if (kind === 'delete') employees[0].deletedAt = Date.now();
    if (kind === 'disabled') saveNfcPreferences('owner-1', { enabled: false });
    if (kind === 'destination') saveNfcPreferences('owner-1', { mode: 'production' });
    if (kind === 'wipe') proceed = false;
    check(); expect(signal.aborted).toBe(true);
    pending.resolve({ status: 'disponible', employeeId: null }); await work;
    expect(reader.dialog.open).toBe(false); expect(ui.context).toBeNull();
});
test('token resolution in a changed session does not send anything', async () => {
    open(); const token = deferred(); adapter.getToken.mockImplementationOnce(() => token.promise);
    const work = ui.readCard({ uid: '0400ABCDEF1234' });
    user = { uid: 'other' }; check(); token.resolve('synthetic-token'); await work;
    expect(send).not.toHaveBeenCalled();
});
test('opening a second employee invalidates callbacks from the first', async () => {
    open(); const pending = deferred(); send.mockImplementationOnce(() => pending.promise);
    const work = ui.readCard({ uid: '0400ABCDEF1234' }); await flush(); ui.open('e2');
    pending.resolve({ status: 'disponible', employeeId: null }); await work;
    expect(reader.node('enrollment').textContent).toContain('Dos'); expect(reader.node('register').hidden).toBe(true);
});
test('settings choose Test, Production and custom explicitly, without a request', async () => {
    document.body.insertAdjacentHTML('beforeend', `<div id="fields">${NfcSettingsFields()}</div>`);
    const draw = () => DOMDiff.apply(document.getElementById('fields'), NfcSettingsFields());
    const select = document.querySelector('[data-nfc-setting="mode"]'); select.value = 'production'; select.dispatchEvent(new Event('change', { bubbles: true })); draw();
    expect(readNfcPreferences(user.uid).mode).toBe('production'); open(); expect(ui.context.endpoint).toBe(NFC_ENDPOINT); reader.close();
    ui.setting('mode', 'custom'); draw();
    const input = document.querySelector('[data-nfc-setting="customUrl"]'); input.value = 'https://custom.example.test/nfc';
    document.querySelector('[data-nfc-setting-action="save-url"]').click(); draw();
    open(); expect(ui.context.endpoint).toBe('https://custom.example.test/nfc');
    expect(send).not.toHaveBeenCalled();
});
test('an unfinished custom URL survives a reactive settings patch only within the same account', () => {
    document.body.insertAdjacentHTML('beforeend', `<div id="fields">${NfcSettingsFields()}</div>`);
    document.querySelector('[data-nfc-setting="customUrl"]').value = 'https://draft.example.test/nfc';
    DOMDiff.apply(document.getElementById('fields'), NfcSettingsFields());
    expect(document.querySelector('[data-nfc-setting="customUrl"]').value).toBe('https://draft.example.test/nfc');
    user = { uid: 'other' }; DOMDiff.apply(document.getElementById('fields'), NfcSettingsFields());
    expect(document.querySelector('[data-nfc-setting="customUrl"]').value).toBe('');
});
test('off by default and activation changes only the NFC entry, preserving the employee draft', async () => {
    jest.spyOn(employeePhotoService, 'getEmployeePhoto').mockResolvedValue(null);
    EmployeesUI.init({ state, render: jest.fn(), saveToLocalStorage: jest.fn(), services: {} });
    const host = document.createElement('div'); document.body.append(host);
    saveNfcPreferences(user.uid, { enabled: false }); EmployeeModal.open('e1', { inlineHost: host });
    expect(host.querySelector('[data-nfc-employee]')).toBeNull();
    const name = host.querySelector('#empName'); name.value = 'Borrador sin guardar';
    saveNfcPreferences(user.uid, { enabled: true });
    const button = host.querySelector('[data-nfc-employee]'); expect(button.dataset.nfcEmployee).toBe('e1');
    button.click(); await scanCard(); expect(send.mock.calls[0][1].employee.name).toBe('Uno');
    reader.close(); expect(host.querySelector('#empName')).toBe(name); expect(name.value).toBe('Borrador sin guardar');
    saveNfcPreferences(user.uid, { enabled: false }); expect(host.querySelector('[data-nfc-employee]')).toBeNull();
    expect(host.querySelector('#empName')).toBe(name); expect(name.value).toBe('Borrador sin guardar');
});
test('a new employee cannot enroll before saving', () => {
    const host = document.createElement('div'); host.innerHTML = NfcEmployeeEntry(null); document.body.append(host);
    expect(host.querySelector('[data-nfc-employee]').disabled).toBe(true);
    ui.open('not-saved'); expect(reader.dialog.open).toBe(false); expect(send).not.toHaveBeenCalled();
});
test('replacing the underlying editor invalidates the request even when the employee still exists', async () => {
    const host = document.createElement('div'); host.innerHTML = NfcEmployeeEntry(employees[0]); document.body.append(host);
    host.querySelector('[data-nfc-employee]').click();
    const pending = deferred(); send.mockImplementationOnce(() => pending.promise);
    const work = ui.readCard({ uid: '0400ABCDEF1234' }); await flush();
    const signal = send.mock.calls[0][2].signal;
    host.innerHTML = NfcEmployeeEntry(employees[1]); check();
    expect(reader.dialog.open).toBe(false); expect(signal.aborted).toBe(true);
    pending.resolve({ status: 'disponible', employeeId: null }); await work;
    expect(host.querySelector('[data-nfc-employee]').dataset.nfcEmployee).toBe('e2');
});
