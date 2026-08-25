/**
 * OnboardingPreview.js — arnés de evaluación aislado del onboarding v2.
 * Monta un overlay fijo con renderOnboarding/handleAction sobre un estado
 * restaurado de localStorage ('onboarding-pos'), para poder recorrer el flujo
 * desde Ajustes → Tests sin tocar el estado global de la app, sin renders del
 * RenderManager y sin notificaciones. El progreso se persiste vía OnboardingCore
 * (saveProgress), así que cerrar a mitad de flujo permite retomarlo después.
 */
import { defaultState, saveProgress, restoreProgress, clearProgress } from './OnboardingCore.js';
import { renderOnboarding, handleAction } from './OnboardingView.js';

let overlayEl = null;
let st = null;
let escHandler = null;

const CHROME_HTML = '<div data-od-preview-chrome style="position:absolute;top:12px;right:14px;z-index:2;display:flex;align-items:center;gap:10px;">'
    + '<span style="display:inline-flex;align-items:center;height:26px;padding:0 11px;border-radius:20px;background:#334155;border:1px solid #475569;color:#e2e8f0;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;">VISTA PREVIA · no toca datos reales</span>'
    + '<button type="button" data-act="closePreview" aria-label="Cerrar vista previa" title="Cerrar vista previa" style="width:32px;height:32px;border-radius:50%;border:1px solid #475569;background:#1e293b;color:#94a3b8;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>'
    + '</div>';

function renderPreview() {
    if (!overlayEl || !st) return;
    overlayEl.innerHTML = CHROME_HTML + renderOnboarding(st);
}

function onOverlayClick(e) {
    if (!overlayEl || !st) return;
    const el = e.target.closest('[data-act]');
    if (!el || !overlayEl.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'closePreview') { closeOnboardingPreview(); return; }
    /* En fase 'listo', "Entrar a la app" cierra el arnés (el core ya limpió storage). */
    if (act === 'next' && st.phase === 'ready') { closeOnboardingPreview(); return; }
    handleAction(act, el, st);
    saveProgress(localStorage, st);
    renderPreview();
}

function onOverlayInput(e) {
    if (!overlayEl || !st) return;
    const el = e.target.closest('input[data-field]');
    if (!el || !overlayEl.contains(el)) return;
    handleAction('input', el, st);
    saveProgress(localStorage, st);
    renderPreview();
}

function mountOverlay() {
    overlayEl = document.createElement('div');
    overlayEl.id = 'onboarding-preview-overlay';
    overlayEl.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.86);overflow:auto;';
    document.body.appendChild(overlayEl);
    overlayEl.addEventListener('click', onOverlayClick);
    overlayEl.addEventListener('input', onOverlayInput);
    escHandler = e => { if (e.key === 'Escape') closeOnboardingPreview(); };
    document.addEventListener('keydown', escHandler);
}

function unmountOverlay() {
    if (!overlayEl) return;
    overlayEl.removeEventListener('click', onOverlayClick);
    overlayEl.removeEventListener('input', onOverlayInput);
    overlayEl.remove();
    overlayEl = null;
    if (escHandler) {
        document.removeEventListener('keydown', escHandler);
        escHandler = null;
    }
}

export function showOnboardingPreview() {
    if (overlayEl) { renderPreview(); return; }
    st = restoreProgress(localStorage, defaultState());
    mountOverlay();
    renderPreview();
}

/* Cerrar a mitad de flujo conserva 'onboarding-pos': reabrir retoma desde ahí. */
export function closeOnboardingPreview() {
    unmountOverlay();
    st = null;
}

export function resetOnboardingPreview() {
    clearProgress(localStorage);
    if (overlayEl) { st = defaultState(); renderPreview(); return; }
    showOnboardingPreview();
}

window.showOnboardingPreview = showOnboardingPreview;
window.closeOnboardingPreview = closeOnboardingPreview;
window.resetOnboardingPreview = resetOnboardingPreview;
