/**
 * OnboardingPreview.js — arnés de evaluación aislado del onboarding v2.
 * Monta un overlay fijo con renderOnboarding/handleAction sobre un estado
 * restaurado de localStorage ('onboarding-pos'), para recorrer el flujo desde
 * Ajustes → Tests. El RENDER de la app queda aislado (nunca llama al
 * RenderManager global), pero las cuatro opciones de elección ejecutan
 * acciones REALES vía OnboardingActions con deps por defecto.
 * El progreso se persiste vía OnboardingCore (saveProgress), así que cerrar a
 * mitad de flujo permite retomarlo después.
 */
import { defaultState, saveProgress, restoreProgress, clearProgress } from './OnboardingCore.js';
import { renderOnboarding, handleAction } from './OnboardingView.js';
import { executeChoiceAction } from './OnboardingActions.js';

let overlayEl = null;
let st = null;
let escHandler = null;
let running = false;

const CHOICE_SOURCES = ['demo', 'scratch', 'backup', 'google'];
const STATUS_OK = 'Ejecutando…';

const CHROME_HTML = '<div data-od-preview-chrome style="position:absolute;top:12px;right:14px;z-index:2;display:flex;align-items:center;gap:10px;">'
    + '<span data-od-preview-status style="display:none;align-items:center;height:26px;padding:0 11px;border-radius:20px;background:#334155;border:1px solid #475569;color:#06b6d4;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;"></span>'
    + '<span style="display:inline-flex;align-items:center;height:26px;padding:0 11px;border-radius:20px;background:#334155;border:1px solid #475569;color:#e2e8f0;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;">VISTA PREVIA · las acciones modifican datos reales</span>'
    + '<button type="button" data-act="closePreview" aria-label="Cerrar vista previa" title="Cerrar vista previa" style="width:32px;height:32px;border-radius:50%;border:1px solid #475569;background:#1e293b;color:#94a3b8;font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>'
    + '</div>';

function showStatus(text) {
    if (!overlayEl) return;
    const el = overlayEl.querySelector('[data-od-preview-status]');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'inline-flex';
}

function setButtonsDisabled(disabled) {
    if (!overlayEl) return;
    overlayEl.querySelectorAll('button').forEach(b => {
        b.disabled = disabled;
        b.style.pointerEvents = disabled ? 'none' : '';
    });
}

/* Ejecuta una opción de elección con sus deps REALES. Mientras corre: botones
 * deshabilitados + texto de estado; al completar se cierra el arnés; en error
 * se muestra la línea inline del choice (state._choiceError). */
async function runChoice(value) {
    if (running || !st || !overlayEl) return;
    running = true;
    st._choiceError = null;
    st._busy = true;
    renderPreview();
    showStatus(STATUS_OK);
    setButtonsDisabled(true);
    let result;
    try {
        result = await executeChoiceAction(value, st);
    } catch (err) {
        result = { completed: false, error: String((err && err.message) || err) };
    }
    running = false;
    if (!overlayEl || !st) return; // cerrado a mitad (Escape): nada más que tocar
    st._busy = false;
    if (result && result.completed) { closeOnboardingPreview(); return; }
    st._choiceError = (result && result.error) || 'No se pudo completar la acción.';
    renderPreview();
}

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
    /* Opciones de elección: acción REAL asíncrona (deps por defecto), no solo pick(). */
    if (act === 'pick' && CHOICE_SOURCES.includes(el.dataset.v)) { runChoice(el.dataset.v); return; }
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
    running = false;
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
