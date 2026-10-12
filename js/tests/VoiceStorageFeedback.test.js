import { VoiceMvpUI } from '../modules/features/voice/VoiceUI.js';
import { SettingsVoiceCard } from '../modules/ui/settings/SettingsVoiceCard.js';

let ui;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture({ user = { uid: 'one' }, store = {}, mount = false } = {}) {
    document.body.innerHTML = SettingsVoiceCard({ state: { settings: {} }, currentUser: user });
    const session = { user };
    const settings = { voiceKeepLoanAudio: true, voiceAudioRetentionDays: 5 };
    let onRender;
    const backing = { maintain: jest.fn().mockResolvedValue(), storageStatus: jest.fn().mockResolvedValue({ bytes: 1048576, count: 1, low: false }), close: jest.fn(), ...store };
    const adapter = { getUser: () => session.user, getSettings: () => settings, getScope: () => ({ enabled: false }),
        isEnabled: () => true, notify: jest.fn(), subscribeEnabled: cb => { onRender = cb; return () => {}; } };
    ui = new VoiceMvpUI(adapter, { store: backing, feedback: { close: jest.fn() } });
    if (mount) { ui.mount(); ui.dialog.close = jest.fn(); }
    return { session, backing, adapter, settings, render: () => onRender() };
}
afterEach(() => { if (ui?.launcher) ui.destroy(); ui = null; jest.clearAllTimers(); jest.useRealTimers(); document.body.innerHTML = ''; });
test('sin sesión da una explicación, sin lecturas ni cero ficticio', async () => {
    const { backing } = fixture({ user: null }); await ui.refreshStorageStatus();
    expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/Inicia sesión/);
    expect(backing.maintain).not.toHaveBeenCalled();
    expect(document.querySelector('[data-settings-action="manage-voice-audio"]').disabled).toBe(true);
});
test('un fallo queda inline; reintentar recupera cifras y no muestra un falso cero', async () => {
    const { backing, adapter } = fixture({ mount: true, store: { maintain: jest.fn().mockRejectedValueOnce(Error('IDB unavailable')).mockResolvedValue() } });
    await flush();
    const retry = document.querySelector('[data-voice-storage-retry]');
    expect(retry.hidden).toBe(false); expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/No se pudo consultar/);
    retry.click(); await flush();
    expect(retry.hidden).toBe(true); expect(backing.maintain).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/1.0 MiB.*1 audios/);
    expect(adapter.notify).not.toHaveBeenCalled();
});
test.each([false, true])('los renders ajenos no reinician la consulta ni el estado de carga (error=%s)', async error => {
    const { backing, render } = fixture({ mount: true, store: error ? { maintain: jest.fn().mockRejectedValue(Error('IDB')) } : {} });
    await flush(); const before = document.querySelector('[data-voice-storage-status]').textContent;
    for (let i = 0; i < 5; i++) render(); await flush();
    expect(backing.maintain).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-voice-storage-status]').textContent).toBe(before);
});
test('consultas simultáneas comparten el trabajo y una respuesta tardía no pisa otra sesión', async () => {
    let resolve;
    const { session, backing } = fixture({ store: { storageStatus: jest.fn(() => new Promise(r => { resolve = r; })) } });
    const first = ui.maintenance(), second = ui.maintenance(); expect(second).toBe(first);
    await flush(); session.user = null; await ui.refreshStorageStatus();
    resolve({ bytes: 9000000, count: 9 }); await first; await flush();
    expect(backing.maintain).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/Inicia sesión/);
    expect(ui.storage).toBeNull();
});
test('un cambio de cuenta en vuelo obtiene sus propios datos', async () => {
    let resolve;
    const { session, backing } = fixture({ store: { storageStatus: jest.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ bytes: 0, count: 0 }) } });
    const pending = ui.maintenance(); await flush(); session.user = { uid: 'two' };
    const refresh = ui.refreshStorageStatus();
    resolve({ bytes: 999, count: 9 }); await pending; await refresh; await flush();
    expect(backing.maintain).toHaveBeenLastCalledWith('two', expect.any(Object));
    expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/0 audios/);
});
test('lectura bloqueada termina en error; la respuesta tardía no sobrescribe un reintento', async () => {
    jest.useFakeTimers(); let resolve;
    const { backing } = fixture({ store: { storageStatus: jest.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ bytes: 1048576, count: 1 }) } });
    const pending = ui.refreshStorageStatus(); await flush();
    await jest.advanceTimersByTimeAsync(8000); await pending;
    expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/No se pudo consultar/);
    await ui.refreshStorageStatus({ force: true });
    resolve({ bytes: 99999999, count: 99 }); await flush();
    expect(backing.maintain).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/1.0 MiB.*1 audios/);
});
test('un cambio de retención vuelve a consultar y conserva el aviso de poco espacio', async () => {
    const { settings, backing, render } = fixture({ mount: true, store: { storageStatus: jest.fn().mockResolvedValue({ bytes: 1, count: 1, low: true }) } });
    await flush(); settings.voiceAudioRetentionDays = 2; render(); await flush();
    expect(backing.maintain).toHaveBeenLastCalledWith('one', { keep: true, days: 2 });
    expect(document.querySelector('[data-voice-storage-warning]').hidden).toBe(false);
});
test('una API sin cifras disponibles ofrece reintento, sin afirmar cero', async () => {
    fixture({ store: { storageStatus: jest.fn().mockResolvedValue(null) } }); await ui.maintenance();
    expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/No se pudo consultar/);
    expect(document.querySelector('[data-voice-storage-retry]').hidden).toBe(false);
});
test('abrir una cuenta comprueba sus audios aunque el total de espacio siga vigente', async () => {
    const record = { audio: new Blob(['audio']), projectKey: 'legacy', selectedEmployeeId: 'worker',
        completedLoanId: 'loan', registeredAt: Date.now(), createdAt: Date.now() };
    const { backing, render } = fixture({ mount: true, store: { get: jest.fn().mockResolvedValue(record) } });
    await flush();
    document.body.insertAdjacentHTML('beforeend', '<button data-voice-loan-audio="request" data-arg="worker" data-loan-id="loan" disabled>Comprobando audio…</button>');
    render(); await flush();
    expect(document.querySelector('[data-voice-loan-audio]').disabled).toBe(false);
    expect(backing.get).toHaveBeenCalledWith('one', 'request');
    expect(backing.storageStatus).toHaveBeenCalledTimes(1);
});
test('un audio de otro proyecto no queda habilitado por reutilizar el total del dispositivo', async () => {
    const { backing, adapter, render } = fixture({ mount: true, store: { get: jest.fn().mockResolvedValue({ audio: new Blob(['audio']), projectKey: 'legacy', selectedEmployeeId: 'worker', completedLoanId: 'loan', registeredAt: Date.now() }) } });
    await flush();
    adapter.getScope = () => ({ enabled: true, projectId: 'new-project' });
    document.body.insertAdjacentHTML('beforeend', '<button data-voice-loan-audio="request" data-arg="worker" data-loan-id="loan" disabled>Comprobando audio…</button>');
    render(); await flush();
    expect(document.querySelector('[data-voice-loan-audio]').textContent).toBe('Audio no disponible');
    expect(backing.storageStatus).toHaveBeenCalledTimes(1);
});
