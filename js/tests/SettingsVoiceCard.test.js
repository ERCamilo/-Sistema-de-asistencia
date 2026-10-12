/**
 * Configuración: Voz vive en General y la pestaña Tests solo aparece en
 * modo desarrollador (tocar 7 veces la versión al pie).
 */
import { initSettingsUI, SettingsTab } from '../modules/ui/SettingsUI.js';
import { SettingsVoiceCard } from '../modules/ui/settings/SettingsVoiceCard.js';
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';
import { DEV_MODE_KEY } from '../modules/ui/settings/DeveloperMode.js';

const render = (settingsActiveTab, settings = {}) => {
    initSettingsUI({
        state: { settingsActiveTab, settings: { companyName: 'Empresa', holidays: [], ...settings }, employees: [], positions: [], attendance: {}, swVersion: '1' },
        icons: { get: (name) => `[icon:${name}]`, getAvailableSets: () => ['default'] },
        holidayService: { renderSettingsCalendar: () => '' },
        get currentUser() { return null; },
        get autoSyncEnabled() { return true; },
        calculateStorageStats: () => ({ percentage: 0, usedMB: 0, available: '5MB' })
    });
    document.body.innerHTML = SettingsTab();
};
const tabs = () => [...document.querySelectorAll('.nav-tabs [data-settings-action="change-settings-tab"]')].map(b => b.dataset.value);

afterEach(() => localStorage.removeItem(DEV_MODE_KEY));

describe('Voz en Configuración → General', () => {
    test('General muestra Voz con sus interruptores; Tests ya no', () => {
        render('general', { voiceMvpEnabled: true, voiceAudioRetentionDays: 3 });
        const card = document.querySelector('[data-settings-voice]');
        expect(card).not.toBeNull();
        expect(card.querySelector('#voice-settings-title').textContent).toContain('Voz');
        expect(document.getElementById('voiceMvpEnabled').checked).toBe(true);
        expect(document.querySelector('input[name="voiceAudioRetentionDays"]:checked').value).toBe('3');
        expect(document.querySelector('[data-voice-storage-status]').textContent).toMatch(/Inicia sesión/);

        document.body.innerHTML = SettingsTestsTab({ state: { settings: {} } });
        expect(document.getElementById('voiceMvpEnabled')).toBeNull();
    });

    test('valores por defecto: audio y sonido encendidos, 5 días', () => {
        document.body.innerHTML = SettingsVoiceCard({ state: { settings: {} } });
        expect(document.getElementById('voiceMvpEnabled').checked).toBe(false);
        expect(document.getElementById('voiceKeepLoanAudio').checked).toBe(true);
        expect(document.getElementById('voiceFeedback').checked).toBe(true);
        expect(document.querySelector('input[name="voiceAudioRetentionDays"]:checked').value).toBe('5');
        expect(document.querySelector('[data-settings-action="manage-voice-audio"]').disabled).toBe(true);
    });
});

describe('Pestaña Tests detrás del modo desarrollador', () => {
    test('apagado: no hay botón Tests y una pestaña Tests guardada cae en General', () => {
        render('tests');
        expect(tabs()).toEqual(['data', 'general', 'calendar']);
        expect(document.querySelector('[data-settings-voice]')).not.toBeNull();
        expect(document.querySelector('[data-developer-mode]')).toBeNull();
        expect(document.querySelector('[data-settings-action="version-tap"]')).not.toBeNull();
    });

    test('encendido: aparece Tests con el botón para ocultarla', () => {
        localStorage.setItem(DEV_MODE_KEY, '1');
        render('tests');
        expect(tabs()).toEqual(['data', 'general', 'calendar', 'tests']);
        expect(document.querySelector('[data-developer-mode] [data-settings-action="exit-developer-mode"]')).not.toBeNull();
        expect(document.getElementById('newReceiptCamera')).not.toBeNull();
    });

    test('7 toques en la versión activan el modo y abren Tests; "Ocultar" lo apaga', () => {
        const notify = jest.fn();
        const change = jest.fn();
        window.showNotification = notify;
        window.changeSettingsTab = change;
        render('general');
        const version = document.querySelector('[data-settings-action="version-tap"]');
        for (let i = 0; i < 7; i++) version.click();
        expect(localStorage.getItem(DEV_MODE_KEY)).toBe('1');
        expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/activado/), 'success');
        expect(change).toHaveBeenLastCalledWith('tests');

        render('general');
        expect(tabs()).toContain('tests');
        document.body.insertAdjacentHTML('beforeend', '<button data-settings-action="exit-developer-mode"></button>');
        document.querySelector('[data-settings-action="exit-developer-mode"]').click();
        expect(localStorage.getItem(DEV_MODE_KEY)).toBeNull();
        expect(tabs()).not.toContain('tests');
        delete window.showNotification;
        delete window.changeSettingsTab;
    });
});
