import { Modal } from '../../components/Modal.js';
import { compareVersions } from '../../config/AppVersion.js';
import { escapeHTML } from '../../utils/Sanitize.js';
import {
    VOICE_RETENTION_DEFAULT_DAYS,
    VOICE_RETENTION_OPTIONS,
    isValidVoiceRetentionChoice,
    voiceRetentionLabel,
    voiceRetentionParts,
    voiceRetentionPolicy
} from './VoiceRetention.js';

export const VOICE_RETENTION_UPGRADE_VERSION = '1.7.156';
export const VOICE_RETENTION_PROMPT_STORAGE_KEY = 'sa:voiceRetentionPromptSeen';
const LEGACY_REMOVED_DAYS = new Set([2, 3, 4]);
const isSemver = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);

export function captureVoiceRetentionUpgradeContext({
    read = key => globalThis.localStorage?.getItem(key) ?? null,
    sessionRead = key => globalThis.sessionStorage?.getItem(key) ?? null,
    targetVersion = VOICE_RETENTION_UPGRADE_VERSION
} = {}) {
    let upgradedFromVersion = null;
    try {
        const receiptRaw = sessionRead('sa:updateReceipt');
        if (receiptRaw) {
            const receipt = JSON.parse(receiptRaw);
            if (receipt && isSemver(receipt.from) && compareVersions(receipt.from, targetVersion) < 0) {
                upgradedFromVersion = receipt.from;
            }
        }
    } catch (_) { /* ignore malformed receipt */ }
    if (!upgradedFromVersion) {
        try {
            const lastSeen = read('sa:lastSeenVersion');
            if (isSemver(lastSeen) && compareVersions(lastSeen, targetVersion) < 0) {
                upgradedFromVersion = lastSeen;
            }
        } catch (_) { /* storage unavailable */ }
    }
    return { upgradedFromVersion };
}

export function shouldPromptVoiceRetentionUpgrade({
    seen = null,
    upgradedFromVersion = null,
    settings = null,
    targetVersion = VOICE_RETENTION_UPGRADE_VERSION
} = {}) {
    if (seen === targetVersion) return false;
    if (isSemver(upgradedFromVersion) && compareVersions(upgradedFromVersion, targetVersion) < 0) {
        return true;
    }
    if (settings && (settings.voiceAudioRetentionDays !== undefined || settings.voiceKeepLoanAudio !== undefined)) {
        return true;
    }
    return false;
}

export function defaultCanShowVoiceRetentionPrompt(doc = globalThis.document) {
    if (!doc) return false;
    if (doc.querySelector('.modal-overlay:not([data-modal-closing]), [data-modal-overlay]:not([data-modal-closing]), #onboarding-preview-overlay, dialog[open]')) {
        return false;
    }
    if (doc.querySelector('input:focus, textarea:focus')) return false;
    return true;
}

export function createVoiceRetentionUpgradePrompt({
    getSettings,
    setAudioRetention,
    onApplied = null,
    canShow = () => defaultCanShowVoiceRetentionPrompt(),
    read = key => globalThis.localStorage?.getItem(key) ?? null,
    write = (key, value) => { globalThis.localStorage?.setItem(key, value); },
    subscribeSettings = null,
    upgradedFromVersion = null,
    notify = null,
    targetVersion = VOICE_RETENTION_UPGRADE_VERSION,
    initialDelayMs = 1200,
    pollIntervalMs = 1000,
    ModalClass = Modal
} = {}) {
    let modal = null;
    let delayTimer = null;
    let pollTimer = null;
    let unsubscribe = null;
    let decided = false;

    const readSeen = () => {
        try { return read(VOICE_RETENTION_PROMPT_STORAGE_KEY); } catch (_) { return null; }
    };
    const writeSeen = () => {
        try { write(VOICE_RETENTION_PROMPT_STORAGE_KEY, targetVersion); } catch (_) { /* ignore */ }
    };
    const clearTimers = () => {
        if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    };
    const stop = () => {
        clearTimers();
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    };
    const markSeen = () => {
        decided = true;
        writeSeen();
        stop();
    };
    const isEligible = () => !decided && shouldPromptVoiceRetentionUpgrade({
        seen: readSeen(),
        upgradedFromVersion,
        settings: getSettings?.(),
        targetVersion
    });

    function show() {
        if (modal?.isOpen || !isEligible()) return false;
        const settings = getSettings?.() || {};
        const currentPolicy = voiceRetentionPolicy(settings);
        const currentChoice = currentPolicy.keep ? currentPolicy.days : 0;
        const rawDays = Number(settings.voiceAudioRetentionDays);
        const isLegacyDays = currentPolicy.keep && LEGACY_REMOVED_DAYS.has(rawDays);
        let selectedChoice = VOICE_RETENTION_DEFAULT_DAYS;

        const content = document.createElement('div');
        content.className = 'vru-body';

        const intro = document.createElement('p');
        intro.className = 'vru-intro';
        intro.innerHTML = 'Actualizamos los plazos para conservar los audios de préstamos: <strong>1 día, 5 días, 1 semana, 15 días o 31 días</strong>. La opción predeterminada ahora es <strong>1 día</strong>.';

        const currentLine = document.createElement('p');
        currentLine.className = 'vru-current';
        if (isLegacyDays) {
            currentLine.innerHTML = `Tu configuración anterior (<strong>${escapeHTML(String(rawDays))} días</strong>) ya no está disponible y equivale temporalmente a <strong>5 días</strong>. Elige si deseas cambiar al nuevo valor predeterminado u otro plazo.`;
        } else if (currentChoice !== VOICE_RETENTION_DEFAULT_DAYS) {
            currentLine.innerHTML = `Tu configuración actual es <strong>${escapeHTML(voiceRetentionLabel(currentChoice))}</strong>. Puedes cambiar ahora al nuevo valor predeterminado o elegir otro límite.`;
        } else {
            currentLine.innerHTML = 'Tu configuración actual es <strong>1 día</strong>. Puedes conservarla o elegir cualquiera de los nuevos plazos.';
        }

        const grid = document.createElement('div');
        grid.className = 'vru-grid';
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', 'Nuevo límite para conservar audios de préstamos');
        grid.innerHTML = VOICE_RETENTION_OPTIONS.map(days => {
            const { primary, secondary } = voiceRetentionParts(days);
            const badge = days === VOICE_RETENTION_DEFAULT_DAYS ? '<span class="vru-default-badge">Por defecto</span>' : '';
            return `<button type="button" class="vru-choice" data-vru-days="${days}" aria-pressed="${selectedChoice === days}"><strong>${escapeHTML(primary)}</strong><small>${escapeHTML(secondary)}</small>${badge}</button>`;
        }).join('');

        const warning = document.createElement('p');
        warning.className = 'vru-warning';
        warning.setAttribute('role', 'status');
        warning.hidden = true;

        const footnote = document.createElement('p');
        footnote.className = 'vru-footnote';
        footnote.textContent = 'Los borradores sin confirmar duran hasta 24 horas. Puedes cambiar este ajuste en cualquier momento en Ajustes → General → Voz.';

        content.append(intro, currentLine, grid, warning, footnote);

        const primaryLabelFor = choice => {
            if (choice === 0) return 'No guardar audios';
            if (choice === currentChoice && !isLegacyDays) return `Confirmar (${voiceRetentionLabel(choice)})`;
            return `Cambiar a ${voiceRetentionLabel(choice)}`;
        };
        const secondaryLabel = currentChoice === 0
            ? 'Mantener sin guardar'
            : `Mantener ${voiceRetentionLabel(currentChoice)}`;

        let handled = false;
        const finishKeepCurrent = () => {
            if (handled) return;
            handled = true;
            markSeen();
            if (isLegacyDays) {
                Promise.resolve(setAudioRetention?.(currentPolicy.days))
                    .then(() => onApplied?.(currentPolicy.days))
                    .catch(() => {});
            }
        };
        const finishApply = async () => {
            if (handled || !isValidVoiceRetentionChoice(selectedChoice)) return;
            handled = true;
            markSeen();
            const choice = selectedChoice;
            try {
                await setAudioRetention?.(choice);
                await onApplied?.(choice);
                notify?.(
                    choice === 0
                        ? 'Conservación de audios desactivada (No guardar).'
                        : `Conservación de audios actualizada a ${voiceRetentionLabel(choice)}.`,
                    'success'
                );
            } catch (error) {
                notify?.(error?.message || 'No se pudo actualizar la conservación de audios.', 'error');
            } finally {
                modal?.close();
            }
        };

        const syncSelectionUI = () => {
            for (const btn of grid.querySelectorAll('[data-vru-days]')) {
                btn.setAttribute('aria-pressed', String(Number(btn.dataset.vruDays) === selectedChoice));
            }
            const shortens = currentPolicy.keep && (selectedChoice === 0 || selectedChoice < currentPolicy.days);
            warning.hidden = !shortens;
            warning.textContent = shortens
                ? 'Al reducir el plazo se eliminarán los audios de préstamos que superen el nuevo límite (también en otras obras). Los préstamos se conservan.'
                : '';
            const primaryBtn = modal?.element?.querySelector('[data-vru-primary]');
            if (primaryBtn) primaryBtn.textContent = primaryLabelFor(selectedChoice);
        };

        grid.addEventListener('click', event => {
            const btn = event.target.closest('[data-vru-days]');
            if (!btn) return;
            const days = Number(btn.dataset.vruDays);
            if (!isValidVoiceRetentionChoice(days)) return;
            selectedChoice = days;
            syncSelectionUI();
        });

        modal = new ModalClass({
            title: 'Nuevos límites de audio',
            subtitle: 'Conservación de grabaciones de préstamos',
            content,
            size: 'medium',
            onClose: () => {
                finishKeepCurrent();
                modal = null;
            },
            buttons: [
                {
                    text: secondaryLabel,
                    class: 'btn-secondary',
                    onClick() {
                        finishKeepCurrent();
                        this.close();
                    }
                },
                {
                    text: primaryLabelFor(selectedChoice),
                    class: 'btn-primary',
                    onClick() {
                        void finishApply();
                    }
                }
            ]
        });

        modal.open();
        if (modal.element) {
            modal.element.id = 'voice-retention-upgrade-modal';
            modal.element.classList.add('voice-retention-upgrade-modal');
            const primaryBtn = modal.element.querySelector('.btn-primary');
            if (primaryBtn) primaryBtn.dataset.vruPrimary = '';
        }
        syncSelectionUI();
        stop();
        return true;
    }

    function tryShow() {
        if (!isEligible()) {
            if (readSeen() === targetVersion) stop();
            return false;
        }
        if (!canShow()) return false;
        return show();
    }

    function schedule() {
        if (delayTimer || pollTimer || modal?.isOpen || !isEligible()) return;
        delayTimer = setTimeout(() => {
            delayTimer = null;
            if (tryShow()) return;
            if (!isEligible()) return;
            pollTimer = setInterval(() => {
                if (tryShow() || !isEligible()) clearTimers();
            }, pollIntervalMs);
        }, initialDelayMs);
    }

    function start() {
        if (readSeen() === targetVersion) return;
        if (isEligible()) {
            schedule();
            return;
        }
        if (subscribeSettings && !unsubscribe) {
            unsubscribe = subscribeSettings(() => {
                if (readSeen() === targetVersion) { stop(); return; }
                if (isEligible()) {
                    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
                    schedule();
                }
            });
        }
    }

    return { start, stop, show, tryShow, markSeen, isEligible };
}
