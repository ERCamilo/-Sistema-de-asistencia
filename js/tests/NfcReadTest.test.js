import { NfcReadTest, SettingsNfcReadTestCard, nfcTestSupport, nfcTestResult } from '../modules/ui/settings/NfcReadTest.js';

let ui, readers, scan, env;
const flush = () => Promise.resolve();
beforeEach(() => {
    jest.useFakeTimers(); readers = []; scan = jest.fn().mockResolvedValue(undefined);
    env = { isSecureContext: true, NDEFReader: class { constructor() { readers.push(this); } scan(options) { this.options = options; return scan(options); } },
        navigator: { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } } };
    ui = new NfcReadTest({ env }).mount();
    ui.dialog.showModal = () => { ui.dialog.setAttribute('open', ''); };
    ui.dialog.close = () => { ui.dialog.removeAttribute('open'); ui.dialog.dispatchEvent(new Event('close')); };
    ui.open();
});
afterEach(() => { ui.destroy(); document.body.innerHTML = ''; jest.useRealTimers(); });
const read = (serialNumber = '04:00:ab:cd:ef:12:34') => readers.at(-1).onreading({ serialNumber, message: { records: [{ recordType: 'text', data: '<private tag content>' }] } });

test('requires HTTPS and an actual Web NFC API', () => {
    expect(nfcTestSupport({ isSecureContext: false, NDEFReader: class {} })).toContain('HTTPS');
    expect(nfcTestSupport({ isSecureContext: true })).toContain('Chrome en Android');
    expect(nfcTestSupport(env)).toBe('');
    delete env.NDEFReader; ui.open();
    expect(ui.node('start').disabled).toBe(true); expect(scan).not.toHaveBeenCalled();
});
test('calls scan directly from the button gesture and avoids duplicate listeners', async () => {
    ui.node('start').click();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(scan.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    await ui.start(); expect(scan).toHaveBeenCalledTimes(1);
});
test('detects UID, preserves zeroes, stops scanning and only reports NDEF types', async () => {
    await ui.start(); const signal = readers[0].options.signal; read();
    expect(ui.node('uid').textContent).toBe('0400ABCDEF1234');
    expect(ui.node('status').textContent).toContain('Compáralo');
    expect(signal.aborted).toBe(true); expect(readers[0].onreading).toBeNull();
    expect(ui.diagnostic).toEqual({ https: true, webNfc: true, status: 'uid-read', uid: '0400ABCDEF1234', serial: '04:00:ab:cd:ef:12:34', recordTypes: ['text'] });
    expect(ui.dialog.textContent).not.toContain('<private tag content>');
});
test.each(['', 'not-a-uid', '<img src=x onerror=alert(1)>', '123'])('distinguishes a tag without a valid serial: %s', async serial => {
    await ui.start(); read(serial);
    expect(ui.node('uid').textContent).toBe('No disponible');
    expect(ui.diagnostic.status).toBe('tag-without-uid');
    expect(ui.node('status').textContent).toContain('Aún no sirve');
    expect(ui.dialog.querySelector('img')).toBeNull();
});
test.each([
    ['NotAllowedError', 'No se autorizó'], ['NotReadableError', 'NFC esté encendido'],
    ['NotSupportedError', 'no admiten'], ['SecurityError', 'bloqueó NFC']
])('shows a useful scan error for %s and permits retry', async (name, text) => {
    scan.mockRejectedValueOnce(Object.assign(Error(), { name }));
    await ui.start(); expect(ui.node('error').textContent).toContain(text);
    expect(ui.node('error').hidden).toBe(false); expect(ui.reading).toBe(false);
    await ui.start(); expect(ui.node('error').hidden).toBe(true); expect(ui.reading).toBe(true);
});
test('handles a card read failure', async () => {
    await ui.start(); readers[0].onreadingerror();
    expect(ui.node('error').textContent).toContain('NDEF'); expect(ui.reading).toBe(false);
});
test('times out without claiming that the card is incompatible', async () => {
    await ui.start(); const signal = readers[0].options.signal;
    jest.advanceTimersByTime(30000);
    expect(signal.aborted).toBe(true); expect(ui.node('error').textContent).toContain('no confirma');
    expect(ui.diagnostic.error).toBe('Timeout');
});
test('stop aborts pending permission and ignores a late rejection', async () => {
    let reject; scan.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const pending = ui.start(); const signal = readers[0].options.signal;
    ui.node('stop').click(); expect(signal.aborted).toBe(true);
    reject(Object.assign(Error(), { name: 'AbortError' })); await pending;
    expect(ui.node('error').hidden).toBe(true); expect(ui.node('status').textContent).toContain('detenida');
});
test('closing and reopening rejects stale callbacks and preserves the same dialog shell', async () => {
    const dialog = ui.dialog; await ui.start(); const callback = readers[0].onreading;
    ui.close(); ui.open(); callback({ serialNumber: 'aa:bb:cc:dd' });
    expect(ui.dialog).toBe(dialog); expect(ui.node('uid').textContent).toBe('Sin leer'); expect(ui.result).toBeNull();
});
test('native close / browser back aborts the reader', async () => {
    await ui.start(); const signal = readers[0].options.signal; ui.dialog.close();
    expect(signal.aborted).toBe(true); expect(ui.reading).toBe(false);
});
test('leaving the screen stops reading', async () => {
    await ui.start(); const signal = readers[0].options.signal;
    const original = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(signal.aborted).toBe(true);
    delete document.hidden; if (original) Object.defineProperty(document, 'hidden', original);
});
test('a new scan clears the old UID and copy explicitly uses the clipboard only', async () => {
    await ui.start(); read(); ui.node('copy').click(); await flush();
    expect(env.navigator.clipboard.writeText).toHaveBeenCalledWith(JSON.stringify(ui.diagnostic, null, 2));
    await ui.start(); expect(ui.node('uid').textContent).toBe('Sin leer'); expect(ui.node('copy').disabled).toBe(true);
});
test('clipboard failure is visible', async () => {
    await ui.start(); read(); env.navigator.clipboard.writeText.mockRejectedValue(Error());
    await ui.copy(); expect(ui.node('error').textContent).toContain('captura');
});
test('only extracts serial and NDEF record types, and the entry is an explicit read-only action', () => {
    expect(nfcTestResult({ serialNumber: '00-01-AB-CD' }).uid).toBe('0001ABCD');
    const html = SettingsNfcReadTestCard(); expect(html).toContain('test-nfc-read');
    expect(html).toContain('no asocia empleados ni envía');
});
