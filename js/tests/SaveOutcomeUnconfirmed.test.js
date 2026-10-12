import { createSaveOutcomeNotifier } from '../modules/services/SaveOutcomeNotifier.js';
const setup = () => {
    const notify = jest.fn();
    return { notify, notifier: createSaveOutcomeNotifier({ notify, setTimer: setTimeout, clearTimer: clearTimeout, cloudTimeoutMs: 100 }) };
};
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
test('sin resultado local el timeout no afirma que los datos estén guardados en este equipo', () => {
    const { notifier, notify } = setup(); notifier.recordSaveStarted({ label: 'Configuración guardada' });
    jest.advanceTimersByTime(100);
    expect(notify.mock.calls[1][0]).toMatchObject({ level: 'warning', message: expect.stringContaining('No se pudo confirmar el guardado') });
    expect(notify.mock.calls[1][0].message).not.toMatch(/solo en este equipo|Configuración guardada/);
    notifier.recordCloudResult(true); expect(notify).toHaveBeenCalledTimes(2);
});
test('local confirmado y nube pendiente se distinguen del guardado en nube confirmado', () => {
    const { notifier, notify } = setup(); notifier.recordSaveStarted({ label: 'Configuración guardada' });
    notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'Configuración guardada' });
    expect(notify.mock.calls[1][0].message).toMatch(/en este equipo.*subiendo/);
    notifier.recordCloudResult(true); expect(notify.mock.calls[2][0].message).toMatch(/guardado en la nube/);
});
test('con resultado local confirmado el timeout solo expresa que falta confirmar la nube', () => {
    const { notifier, notify } = setup(); notifier.recordLocalResult({ localOk: true, cloudExpected: true, label: 'Configuración guardada' });
    jest.advanceTimersByTime(100);
    expect(notify.mock.calls[1][0].message).toMatch(/solo en este equipo.*aún no en la nube/);
});

test('una respuesta de nube anterior no confirma una nueva escritura local pendiente', () => {
    const {notifier,notify}=setup();
    notifier.recordLocalResult({localOk:true,cloudExpected:true,label:'Guardado anterior'});
    notifier.recordSaveStarted({label:'Configuración guardada'});
    notifier.recordCloudResult(true);
    expect(notify).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(100);
    expect(notify.mock.calls[2][0].message).toMatch(/No se pudo confirmar el guardado/);
});
