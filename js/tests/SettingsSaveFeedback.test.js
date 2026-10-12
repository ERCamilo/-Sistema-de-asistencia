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
test('el acceso al detalle de almacenamiento respeta un borrador pendiente', () => {
    draw();
    const input = document.getElementById('companyName'); input.value = 'Pendiente';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.changeSettingsTab = jest.fn();
    window.showConfirm = jest.fn();
    try {
        document.querySelector('[data-settings-storage-summary] button').click();
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
test('cancelar la recarga conserva el borrador y no limpia la caché', () => {
    draw(); document.getElementById('companyName').value = 'Pendiente';
    window.showConfirm = jest.fn(); document.querySelector('[data-settings-action="clear-cache"]').click();
    expect(window.showConfirm.mock.calls[0][0].message).toMatch(/sin guardar.*descartar/i);
    expect(window.showConfirm.mock.calls[0][0].confirmText).toMatch(/Descartar/);
    expect(clearAppCaches).not.toHaveBeenCalled();
    expect(document.getElementById('companyName').value).toBe('Pendiente');
});
test('la recarga confirmada limpia una sola vez, manteniendo el borrador hasta recargar', async () => {
    draw(); document.getElementById('companyName').value = 'Pendiente';
    window.showConfirm = jest.fn(); document.querySelector('[data-settings-action="clear-cache"]').click();
    const confirm = window.showConfirm.mock.calls[0][0].onConfirm;
    await Promise.all([confirm(), confirm()]);
    expect(clearAppCaches).toHaveBeenCalledTimes(1);
    expect(document.getElementById('companyName').value).toBe('Pendiente');
    expect(jest.getTimerCount()).toBe(1); // reload is scheduled, not executed by this fixture
});
test('una edición posterior exige una nueva confirmación antes de recargar', async () => {
    draw(); window.showConfirm = jest.fn(); document.querySelector('[data-settings-action="clear-cache"]').click();
    document.getElementById('companyName').value = 'Edición nueva';
    await window.showConfirm.mock.calls[0][0].onConfirm();
    expect(clearAppCaches).not.toHaveBeenCalled(); expect(window.showConfirm).toHaveBeenCalledTimes(2);
    expect(window.showConfirm.mock.calls[1][0].message).toMatch(/sin guardar/);
});
test('sin diálogo de confirmación no se recarga un borrador', () => {
    draw(); document.getElementById('companyName').value = 'Pendiente';
    document.querySelector('[data-settings-action="clear-cache"]').click();
    expect(clearAppCaches).not.toHaveBeenCalled();
    expect(document.getElementById('settings-form-error').textContent).toMatch(/Guarda o descarta/);
});
test('un fallo de caché conserva lo editado y explica el error inline', async () => {
    draw(); document.getElementById('companyName').value = 'Pendiente';
    clearAppCaches.mockRejectedValue(Error('Cache unavailable')); window.showConfirm = jest.fn();
    document.querySelector('[data-settings-action="clear-cache"]').click();
    await window.showConfirm.mock.calls[0][0].onConfirm();
    expect(document.getElementById('companyName').value).toBe('Pendiente');
    expect(document.getElementById('settings-form-error').textContent).toMatch(/cambios pendientes se conservan/);
    expect(jest.getTimerCount()).toBe(0);
    expect(getAllErrors()).toEqual(expect.arrayContaining([expect.objectContaining({ context: 'limpiar el cache' })]));
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
