import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';
import { SettingsTab, initSettingsUI } from '../modules/ui/SettingsUI.js';
import { DOMDiff } from '../modules/utils/DOMDiff.js';
import { discardSettingsDraft } from '../modules/ui/settings/SettingsDraftBar.js';

const context = { state: { employees: [], positions: [], settings: { companyName: 'Empresa', holidays: [], payPeriod: {} } },
    icons: { get: () => '', getAvailableSets: () => ['unicode'] }, holidayService: { renderSettingsCalendar: () => '' } };
afterEach(() => { localStorage.removeItem('sa.devMode.v1'); discardSettingsDraft({}); document.body.innerHTML = ''; delete window.runBrowserTests; delete window.appBootLoader; });
test('las funciones experimentales quedan visibles y las herramientas se agrupan sin duplicar controles', () => {
    document.body.innerHTML = SettingsTestsTab(context);
    expect(document.getElementById('settings-experiments-title').textContent).toBe('Funciones en prueba');
    for (const id of ['newBottomNav', 'newReceiptCamera']) {
        expect(document.getElementById(id).closest('details')).toBeNull();
        expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
    }
    const diagnostics = document.getElementById('settings-diagnostics-tools');
    const development = document.getElementById('settings-development-tools');
    expect(diagnostics.open).toBe(false); expect(development.open).toBe(false);
    expect(diagnostics.querySelector('[data-settings-action="run-browser-tests"]')).toBeTruthy();
    expect(development.querySelector('[data-settings-action="save-splitx-url"]')).toBeTruthy();
    expect(development.querySelector('[data-settings-action="open-modal-preview"]')).toBeTruthy();
});
test('una actualización reactiva conserva las secciones abiertas y permite cerrarlas', () => {
    const root = document.createElement('div'); document.body.append(root);
    DOMDiff.apply(root, SettingsTestsTab(context));
    const section = document.getElementById('settings-development-tools'); section.open = true;
    DOMDiff.apply(root, SettingsTestsTab(context));
    expect(document.getElementById('settings-development-tools')).toBe(section);
    expect(section.open).toBe(true);
    section.open = false; DOMDiff.apply(root, SettingsTestsTab(context)); expect(section.open).toBe(false);
});
test('las herramientas conservan sus acciones reales tras desplegarse', () => {
    document.body.innerHTML = SettingsTestsTab(context);
    document.getElementById('settings-diagnostics-tools').open = true;
    window.runBrowserTests = jest.fn();
    document.querySelector('[data-settings-action="run-browser-tests"]').click();
    expect(window.runBrowserTests).toHaveBeenCalledTimes(1);
    window.appBootLoader = { startSimulation: jest.fn(() => true) };
    document.getElementById('bootLoaderTestDelaySeconds').value = '3';
    document.getElementById('bootLoaderTestErrorSeconds').value = '6';
    document.querySelector('[data-settings-action="start-boot-loader-test"]').click();
    expect(window.appBootLoader.startSimulation).toHaveBeenCalledWith({ slowDelayMs: 3000, failureDelayMs: 6000, reloadEnabled: true });
});
test('las pestañas mantienen sus claves de navegación y nombres visibles en español', () => {
    localStorage.setItem('sa.devMode.v1', '1'); context.state.settingsActiveTab = 'tests'; initSettingsUI(context);
    document.body.innerHTML = SettingsTab();
    const button = document.querySelector('[data-settings-action="change-settings-tab"][data-value="tests"]');
    expect(button.getAttribute('aria-label')).toBe('Pruebas');
    expect(button.querySelector('.tab-text').textContent.trim()).toBe('Pruebas');
    expect(button.classList.contains('active')).toBe(true);
});

test('el diagnóstico conserva los valores temporales al actualizar la pantalla', () => {
    const root=document.createElement('div');document.body.append(root);
    DOMDiff.apply(root,SettingsTestsTab(context));
    document.getElementById('settings-diagnostics-tools').open=true;
    document.getElementById('bootLoaderTestDelaySeconds').value='3';
    document.getElementById('bootLoaderTestErrorSeconds').value='6';
    document.getElementById('bootLoaderTestReloadEnabled').checked=false;
    DOMDiff.apply(root,SettingsTestsTab(context));
    expect(document.getElementById('bootLoaderTestDelaySeconds').value).toBe('3');
    expect(document.getElementById('bootLoaderTestErrorSeconds').value).toBe('6');
    expect(document.getElementById('bootLoaderTestReloadEnabled').checked).toBe(false);
});

test('el estado del dispositivo solo aparece en Datos, cerrado y después de las pestañas', () => {
    initSettingsUI(context);
    for (const tab of ['general', 'calendar', 'tests']) {
        localStorage.setItem('sa.devMode.v1', '1'); context.state.settingsActiveTab = tab;
        document.body.innerHTML = SettingsTab();
        expect(document.getElementById('settings-device-status')).toBeNull();
    }
    context.state.settingsActiveTab = 'data'; document.body.innerHTML = SettingsTab();
    const section = document.getElementById('settings-device-status');
    expect(section.open).toBe(false);
    expect(document.querySelector('.nav-tabs').compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.querySelector('[data-settings-sync-summary]')).not.toBeNull();
    expect(section.querySelector('[data-settings-sync-card]')).not.toBeNull();
});

test('el desplegable conserva abierto o cerrado durante el parcheo reactivo', () => {
    context.state.settingsActiveTab = 'data'; initSettingsUI(context);
    const root = document.createElement('div'); document.body.append(root);
    DOMDiff.apply(root, SettingsTab());
    const section = document.getElementById('settings-device-status'); section.open = true;
    DOMDiff.apply(root, SettingsTab());
    expect(document.getElementById('settings-device-status')).toBe(section);
    expect(section.open).toBe(true);
    section.open = false; DOMDiff.apply(root, SettingsTab()); expect(section.open).toBe(false);
});
