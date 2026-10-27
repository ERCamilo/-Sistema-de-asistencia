import { SettingsTab, initSettingsUI } from '../modules/ui/SettingsUI.js';
import { state, stateManager } from '../modules/core/AppState.js';
import { captureSettingsDraft, restoreSettingsDraft, discardSettingsDraft, refreshSettingsDraftBar } from '../modules/ui/settings/SettingsDraftBar.js';
import { clearSettingsFormErrors, refreshSettingsFormErrors } from '../modules/ui/settings/SettingsFormFeedback.js';
import { DOMDiff } from '../modules/utils/DOMDiff.js';
import { clearAppCaches } from '../modules/services/CacheManager.js';
import { getAllErrors, clearErrorLog } from '../modules/services/ErrorLog.js';
import { saveApplicationData } from '../modules/services/PersistenceService.js';
import { createSettingsSaveHarness } from './helpers/SettingsSaveHarness.js';

jest.mock('../modules/services/CacheManager.js', () => ({ clearAppCaches: jest.fn() }));
jest.mock('../modules/services/PersistenceService.js', () => ({ saveApplicationData: jest.fn() }));
const settings = { companyName: 'Empresa', regularHoursPerDay: 8, overtimeFactor: 1.5,
    holidayFactor: 2, restDayFactor: 1.5, defaultDeductionPercentage: 2, holidays: [], payPeriod: {} };
function draw(tab = 'general') {
    stateManager.batchSetState(raw => { raw.settingsActiveTab = tab; Object.assign(raw.settings, settings); });
    initSettingsUI({ state, icons: { get: () => '', getAvailableSets: () => ['unicode'] },
        currentUser: { uid: 'test', email: 'a@example.invalid' }, holidayService: { renderSettingsCalendar: () => '' } });
    document.body.innerHTML = SettingsTab();
    refreshSettingsDraftBar();
}
beforeEach(() => { clearErrorLog(); jest.useFakeTimers(); clearAppCaches.mockReset().mockResolvedValue({ deletedCaches: 1 }); saveApplicationData.mockClear(); });
afterEach(() => {
    document.querySelector('#interface-repair-modal:not([data-modal-closing]) [data-modal-close]')?.click();
    clearSettingsFormErrors(); discardSettingsDraft({}); document.body.innerHTML = '';
    delete window.showConfirm; delete window.showNotification;
    jest.clearAllTimers(); jest.useRealTimers();
});
test.each(['general', 'calendar', 'data', 'tests'])('%s no ofrece un guardado general sin cambios pendientes', tab => {
    draw(tab);
    expect(document.querySelector('#settings-screen [data-settings-action="save-settings"]')).toBeNull();
    expect(document.getElementById('settings-draft-bar').hidden).toBe(true);
});
test('un borrador ofrece un único Guardar; un automático no se revierte al descartar', () => {
    draw(); const input = document.getElementById('companyName'); input.value = 'Pendiente';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const automatic = document.getElementById('weatherEnabled'); automatic.checked = true;
    automatic.dispatchEvent(new Event('change', { bubbles: true }));
    expect(saveApplicationData).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('[data-settings-action="save-settings"]')).toHaveLength(1);
    expect(document.getElementById('settings-draft-bar').hidden).toBe(false);
    document.querySelector('[data-settings-action="discard-settings-draft"]').click();
    expect(input.value).toBe('Empresa'); expect(automatic.checked).toBe(true);
    expect(state.settings.weatherEnabled).toBe(true);
});
test('el acceso a Datos respeta un borrador pendiente', () => {
    draw();
    const input = document.getElementById('companyName'); input.value = 'Pendiente';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.changeSettingsTab = jest.fn();
    window.showConfirm = jest.fn();
    try {
        document.querySelector('.nav-tab[data-value="data"]').click();
        expect(window.showConfirm).toHaveBeenCalledTimes(1);
        expect(window.changeSettingsTab).not.toHaveBeenCalled();
        expect(input.value).toBe('Pendiente');
        window.showConfirm.mock.calls[0][0].onConfirm();
        expect(window.changeSettingsTab).toHaveBeenCalledWith('data');
        expect(input.value).toBe('Empresa');
    } finally { delete window.changeSettingsTab; }
});
test('el modo de guardado distingue incluso el checkbox de déficit del interruptor automático', () => {
    draw();
    expect(document.querySelector('label[for="companyName"] .settings-save-mode').textContent).toBe('Al guardar');
    expect(document.getElementById('showAttendanceCardDeficit').closest('label').textContent).toContain('Al guardar');
    expect(document.getElementById('weatherEnabled').closest('label').textContent).toContain('Automático');
});
test('un borrador bloquea la reparación y conserva los valores sin ofrecer descartarlos', () => {
    draw(); document.getElementById('companyName').value = 'Pendiente';
    window.showConfirm = jest.fn(); document.querySelector('[data-settings-action="clear-cache"]').click();
    expect(window.showConfirm).not.toHaveBeenCalled();
    expect(clearAppCaches).not.toHaveBeenCalled();
    expect(document.getElementById('companyName').value).toBe('Pendiente');
    expect(document.getElementById('settings-form-error').textContent).toMatch(/Guarda o descarta/);
});
test('el acceso anterior abre una única reparación segura sin limpiar ni desregistrar', () => {
    draw();
    document.querySelector('[data-settings-action="clear-cache"]').click();
    document.querySelector('[data-settings-action="clear-cache"]').click();
    expect(document.querySelectorAll('#interface-repair-modal')).toHaveLength(1);
    expect(document.querySelector('#interface-repair-modal').textContent).toMatch(/datos, fotos y comprobantes/);
    expect(clearAppCaches).not.toHaveBeenCalled();
    document.querySelector('#interface-repair-modal [data-modal-close]').click();
    expect(document.getElementById('companyName').value).toBe('Empresa');
});
test('una edición posterior al diálogo bloquea la reparación antes de guardar o renovar archivos', async () => {
    draw(); document.querySelector('[data-settings-action="clear-cache"]').click();
    document.getElementById('companyName').value = 'Edición nueva';
    document.querySelector('#interface-repair-modal .btn-primary').click();
    for(let i=0;i<10;i++)await Promise.resolve();
    expect(clearAppCaches).not.toHaveBeenCalled();expect(saveApplicationData).not.toHaveBeenCalled();
    expect(document.querySelector('#interface-repair-modal [data-release-status]').textContent).toMatch(/Guarda o cierra/);
    expect(document.getElementById('companyName').value).toBe('Edición nueva');
});
test('un guardado fallido conserva la página, permite reintentar y registra el error de reparación', async () => {
    draw(); document.querySelector('[data-settings-action="clear-cache"]').click();
    saveApplicationData.mockRejectedValueOnce(Error('synthetic disk unavailable'));
    document.querySelector('#interface-repair-modal .btn-primary').click();
    for(let i=0;i<12;i++)await Promise.resolve();
    expect(document.getElementById('companyName').value).toBe('Empresa');
    expect(document.querySelector('#interface-repair-modal [data-release-status]').textContent).toMatch(/No se pudo/);
    expect(document.querySelector('#interface-repair-modal .btn-primary').disabled).toBe(false);
    expect(clearAppCaches).not.toHaveBeenCalled();
    expect(getAllErrors()).toEqual(expect.arrayContaining([expect.objectContaining({ context: 'reparar interfaz' })]));
});
test('la validación queda junto al campo y persiste al actualizar otro ajuste', () => {
    draw('calendar'); const input = document.getElementById('overtimeFactor'); input.value = '';
    const h = createSettingsSaveHarness({ state }); h.save();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(input); expect(h.saveApplicationData).not.toHaveBeenCalled();
    const snapshot = captureSettingsDraft(); DOMDiff.patchSelf(document.getElementById('settings-screen'), SettingsTab());
    restoreSettingsDraft(snapshot); refreshSettingsFormErrors();
    expect(document.getElementById('settings-error-overtimeFactor').textContent).toMatch(/entre 1 y 5/);
    const restored = document.getElementById('overtimeFactor'); restored.value = '2';
    restored.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.getElementById('settings-error-overtimeFactor')).toBeNull();
    expect(restored.hasAttribute('aria-invalid')).toBe(false);
});
test('un ajuste remoto de otro proyecto no hereda el error anterior', () => {
    draw('calendar'); document.getElementById('overtimeFactor').value = '';
    createSettingsSaveHarness({ state }).save();
    document.getElementById('settings-screen').dataset.settingsDraftScope = 'otro-proyecto';
    refreshSettingsFormErrors();
    expect(document.getElementById('settings-error-overtimeFactor')).toBeNull();
});

test('un fallo de configuración del proyecto conserva los valores y permite volver a guardar', async () => {
    document.body.innerHTML='<input id="overtimeFactor" type="number" value="1.5">';
    document.getElementById('overtimeFactor').value='2';
    const config={...settings};
    const h=createSettingsSaveHarness({isProjectsEnabled:()=>true,payrollUIRuntime:{getCurrentView:()=>({config,projectId:'one'}),updateConfig:jest.fn().mockRejectedValue(Error('unavailable'))}});
    await h.save();
    expect(h.saveApplicationData).not.toHaveBeenCalled();
    expect(document.getElementById('overtimeFactor').value).toBe('2');
    expect(document.getElementById('settings-form-error').textContent).toMatch(/No se pudieron guardar los ajustes del proyecto/);
    h.payrollUIRuntime.updateConfig.mockResolvedValue(); await h.save();
    expect(h.saveApplicationData).toHaveBeenCalledTimes(1);
    expect(document.getElementById('settings-form-error')).toBeNull();
});

test('un error tardío del proyecto anterior no se muestra en el proyecto nuevo', async () => {
    let reject;
    const h=createSettingsSaveHarness({isProjectsEnabled:()=>true,payrollUIRuntime:{getCurrentView:()=>({config:settings,projectId:'one'}),updateConfig:()=>new Promise((_,r)=>{reject=r;})}});
    const saving=h.save();
    document.body.innerHTML='<div id="settings-screen" data-settings-draft-scope="otro-proyecto"></div>';
    reject(Error('old project failure')); await saving;
    expect(document.getElementById('settings-form-error')).toBeNull();
    expect(getAllErrors()).toEqual(expect.arrayContaining([expect.objectContaining({context:'guardar configuración del proyecto'})]));
});

test('un guardado bloqueado tiene límite y su respuesta tardía no renueva ni recarga', async () => {
    draw(); document.querySelector('[data-settings-action="clear-cache"]').click();
    let finish;
    saveApplicationData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const previousFetch = global.fetch;
    const fetcher = global.fetch = jest.fn(() => { throw Error('unexpected release request'); });
    try {
        document.querySelector('#interface-repair-modal .btn-primary').click();
        await jest.advanceTimersByTimeAsync(15001);
        expect(document.querySelector('#interface-repair-modal .btn-primary').disabled).toBe(false);
        expect(document.querySelector('#interface-repair-modal [data-release-status]').textContent).toMatch(/No se pudo/);
        finish({ localOk: true });
        for(let i=0;i<12;i++)await Promise.resolve();
        expect(fetcher).not.toHaveBeenCalled();
        expect(clearAppCaches).not.toHaveBeenCalled();
        expect(document.getElementById('companyName').value).toBe('Empresa');
    } finally { if (previousFetch) global.fetch = previousFetch; else delete global.fetch; }
});
