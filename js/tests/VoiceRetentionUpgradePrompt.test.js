import {
    VOICE_RETENTION_PROMPT_STORAGE_KEY,
    VOICE_RETENTION_UPGRADE_VERSION,
    captureVoiceRetentionUpgradeContext,
    createVoiceRetentionUpgradePrompt,
    defaultCanShowVoiceRetentionPrompt,
    shouldPromptVoiceRetentionUpgrade
} from '../modules/features/voice/VoiceRetentionUpgradePrompt.js';
import { commitAutoSaveOption, commitAutoSaveSwitch } from '../modules/ui/SettingsUI.js';

function makeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        map,
        read: key => (map.has(key) ? map.get(key) : null),
        write: (key, value) => { map.set(key, String(value)); }
    };
}

function makeFixture({ settings = { voiceKeepLoanAudio: true, voiceAudioRetentionDays: '5' }, upgradedFromVersion = '1.7.155', storageInitial = {}, canShow = () => defaultCanShowVoiceRetentionPrompt(document) } = {}) {
    const storage = makeStorage(storageInitial);
    const persist = jest.fn();
    const deps = { state: { settings }, batchSetState: cb => cb(), save: persist };
    const onApplied = jest.fn().mockResolvedValue();
    const notify = jest.fn();
    const setAudioRetention = jest.fn(days => {
        if (days) commitAutoSaveOption({ name: 'voiceAudioRetentionDays', value: String(days), deps });
        commitAutoSaveSwitch({ id: 'voiceKeepLoanAudio', checked: days > 0, deps });
    });
    const prompt = createVoiceRetentionUpgradePrompt({
        getSettings: () => settings,
        setAudioRetention,
        onApplied,
        canShow,
        read: storage.read,
        write: storage.write,
        upgradedFromVersion,
        notify,
        initialDelayMs: 50,
        pollIntervalMs: 50
    });
    return { prompt, settings, storage, persist, setAudioRetention, onApplied, notify };
}

afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
});

test('captureVoiceRetentionUpgradeContext detects upgrade from updateReceipt or lastSeenVersion', () => {
    expect(captureVoiceRetentionUpgradeContext({
        read: () => '1.7.155',
        sessionRead: () => null
    })).toEqual({ upgradedFromVersion: '1.7.155' });

    expect(captureVoiceRetentionUpgradeContext({
        read: () => '1.7.156',
        sessionRead: () => JSON.stringify({ from: '1.7.154', target: '1.7.156' })
    })).toEqual({ upgradedFromVersion: '1.7.154' });

    expect(captureVoiceRetentionUpgradeContext({
        read: () => null,
        sessionRead: () => null
    })).toEqual({ upgradedFromVersion: null });

    expect(captureVoiceRetentionUpgradeContext({
        read: () => '1.7.156',
        sessionRead: () => null
    })).toEqual({ upgradedFromVersion: null });
});

test('shouldPromptVoiceRetentionUpgrade skips fresh installs and seen devices, prompts upgraded or existing configs', () => {
    expect(shouldPromptVoiceRetentionUpgrade({ seen: null, upgradedFromVersion: null, settings: {} })).toBe(false);
    expect(shouldPromptVoiceRetentionUpgrade({ seen: VOICE_RETENTION_UPGRADE_VERSION, upgradedFromVersion: '1.7.155', settings: { voiceAudioRetentionDays: '5' } })).toBe(false);
    expect(shouldPromptVoiceRetentionUpgrade({ seen: null, upgradedFromVersion: '1.7.155', settings: {} })).toBe(true);
    expect(shouldPromptVoiceRetentionUpgrade({ seen: null, upgradedFromVersion: null, settings: { voiceAudioRetentionDays: '5' } })).toBe(true);
    expect(shouldPromptVoiceRetentionUpgrade({ seen: null, upgradedFromVersion: null, settings: { voiceKeepLoanAudio: false } })).toBe(true);
});

test('popup pre-selects new 1-day default, shows all new limits and applies 1 day on confirm', async () => {
    const { prompt, settings, storage, setAudioRetention, onApplied, notify } = makeFixture();
    expect(prompt.show()).toBe(true);

    const modal = document.getElementById('voice-retention-upgrade-modal');
    expect(modal).not.toBeNull();
    const choices = [...modal.querySelectorAll('[data-vru-days]')];
    expect(choices.map(btn => btn.dataset.vruDays)).toEqual(['0', '1', '5', '7', '15', '31']);
    expect(modal.querySelector('[data-vru-days="7"]').textContent).toContain('semana');
    expect(modal.querySelector('[data-vru-days="1"]').getAttribute('aria-pressed')).toBe('true');

    const warning = modal.querySelector('.vru-warning');
    expect(warning.hidden).toBe(false);
    expect(modal.querySelector('[data-vru-primary]').textContent).toBe('Cambiar a 1 día');

    modal.querySelector('[data-vru-primary]').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(setAudioRetention).toHaveBeenCalledWith(1);
    expect(settings.voiceAudioRetentionDays).toBe('1');
    expect(settings.voiceKeepLoanAudio).toBe(true);
    expect(onApplied).toHaveBeenCalledWith(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('1 día'), 'success');
    expect(storage.map.get(VOICE_RETENTION_PROMPT_STORAGE_KEY)).toBe(VOICE_RETENTION_UPGRADE_VERSION);
    expect(prompt.show()).toBe(false);
});

test('user can choose another new limit (e.g. 1 semana or 31 días) directly in the popup', async () => {
    const { prompt, settings, setAudioRetention } = makeFixture();
    prompt.show();
    const modal = document.getElementById('voice-retention-upgrade-modal');

    modal.querySelector('[data-vru-days="7"]').click();
    expect(modal.querySelector('.vru-warning').hidden).toBe(true);
    expect(modal.querySelector('[data-vru-primary]').textContent).toBe('Cambiar a 1 semana');

    modal.querySelector('[data-vru-days="31"]').click();
    expect(modal.querySelector('[data-vru-primary]').textContent).toBe('Cambiar a 31 días');

    modal.querySelector('[data-vru-primary]').click();
    await Promise.resolve();

    expect(setAudioRetention).toHaveBeenCalledWith(31);
    expect(settings.voiceAudioRetentionDays).toBe('31');
    expect(settings.voiceKeepLoanAudio).toBe(true);
});

test('keeping current 5-day configuration leaves settings intact and marks popup seen', () => {
    const { prompt, settings, storage, setAudioRetention } = makeFixture();
    prompt.show();
    const modal = document.getElementById('voice-retention-upgrade-modal');
    const keepBtn = modal.querySelector('.btn-secondary');
    expect(keepBtn.textContent).toBe('Mantener 5 días');

    keepBtn.click();
    expect(setAudioRetention).not.toHaveBeenCalled();
    expect(settings.voiceAudioRetentionDays).toBe('5');
    expect(storage.map.get(VOICE_RETENTION_PROMPT_STORAGE_KEY)).toBe(VOICE_RETENTION_UPGRADE_VERSION);
});

test('keeping a removed legacy setting (3 days) normalizes it to 5 days without shrinking retention', async () => {
    const { prompt, settings, setAudioRetention } = makeFixture({
        settings: { voiceKeepLoanAudio: true, voiceAudioRetentionDays: '3' }
    });
    prompt.show();
    const modal = document.getElementById('voice-retention-upgrade-modal');
    expect(modal.textContent).toContain('3 días');
    expect(modal.querySelector('.btn-secondary').textContent).toBe('Mantener 5 días');

    modal.querySelector('.btn-secondary').click();
    await Promise.resolve();

    expect(setAudioRetention).toHaveBeenCalledWith(5);
    expect(settings.voiceAudioRetentionDays).toBe('5');
});

test('waits while another modal is open and shows automatically once closed', () => {
    jest.useFakeTimers();
    const blocker = document.createElement('div');
    blocker.className = 'modal-overlay';
    blocker.id = 'whats-new-modal';
    document.body.appendChild(blocker);

    const { prompt } = makeFixture();
    prompt.start();

    jest.advanceTimersByTime(200);
    expect(document.getElementById('voice-retention-upgrade-modal')).toBeNull();

    blocker.remove();
    jest.advanceTimersByTime(60);
    expect(document.getElementById('voice-retention-upgrade-modal')).not.toBeNull();
    prompt.stop();
});

test('markSeen cancels a scheduled popup when the user updates retention manually first', () => {
    jest.useFakeTimers();
    const { prompt } = makeFixture();
    prompt.start();
    prompt.markSeen();
    jest.advanceTimersByTime(200);
    expect(document.getElementById('voice-retention-upgrade-modal')).toBeNull();
});
