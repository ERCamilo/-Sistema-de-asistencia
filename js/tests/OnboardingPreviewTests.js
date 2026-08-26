import {
    showOnboardingPreview, closeOnboardingPreview, resetOnboardingPreview,
    launchOnboardingV2, notifyCompleted
} from '../modules/ui/onboarding/OnboardingPreview.js';
import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';

const KEY = 'onboarding-pos';
const DONE = 'onboardingCompleted';
const overlay = () => document.getElementById('onboarding-preview-overlay');

function cleanup() {
    closeOnboardingPreview();
    try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(DONE);
    } catch (e) { /* sin storage */ }
}

testRunner.addSuite('Onboarding v2 — vista previa (arnés aislado)', {
    'muestra overlay con paso de bienvenida y badge de seguridad'() {
        cleanup();
        showOnboardingPreview();
        const ov = overlay();
        testRunner.assert(!!ov, 'overlay montado en document.body');
        testRunner.assert(!!ov.querySelector('[data-od-id="od-guide-copy"]'), 'paso bienvenida renderizado');
        testRunner.assert(ov.textContent.includes('Tu obra, bajo control'), 'título del paso 1 visible');
        testRunner.assert(ov.textContent.includes('VISTA PREVIA · las acciones modifican datos reales'), 'badge refleja acciones reales');
        testRunner.assert(!!ov.querySelector('[data-act="closePreview"]'), 'botón de cierre presente');
    },
    'clic en Siguiente avanza al paso 2 de la guía'() {
        cleanup();
        showOnboardingPreview();
        overlay().querySelector('[data-act="next"]').click();
        const topbar = overlay().querySelector('[data-od-id="od-topbar"]');
        testRunner.assert(topbar.textContent.includes('2 / 6'), `contador muestra paso 2 (visto: "${topbar.textContent.trim()}")`);
    },
    'cerrar a mitad de flujo quita el overlay pero conserva onboarding-pos'() {
        cleanup();
        showOnboardingPreview();
        overlay().querySelector('[data-act="next"]').click();
        closeOnboardingPreview();
        testRunner.assertEquals(overlay(), null, 'overlay removido del DOM');
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* corrupto */ }
        testRunner.assert(saved && saved.phase === 'guide' && saved.step === 2, 'progreso del flujo conservado');
    },
    'resetOnboardingPreview limpia la clave y reabre en el paso 1'() {
        cleanup();
        localStorage.setItem(KEY, JSON.stringify({ phase: 'guide', step: 3 }));
        resetOnboardingPreview();
        testRunner.assertEquals(localStorage.getItem(KEY), null, "clave 'onboarding-pos' limpiada");
        const ov = overlay();
        testRunner.assert(!!ov && ov.textContent.includes('Tu obra, bajo control'), 'reabre en bienvenida');
    },
    'Escape cierra el arnés sin borrar el progreso'() {
        cleanup();
        showOnboardingPreview();
        overlay().querySelector('[data-act="next"]').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        testRunner.assertEquals(overlay(), null, 'overlay cerrado con Escape');
        testRunner.assert(localStorage.getItem(KEY) !== null, 'progreso conservado tras Escape');
    },
    'la sección de elección muestra las cuatro opciones reales'() {
        cleanup();
        showOnboardingPreview();
        for (let i = 0; i < 6; i++) overlay().querySelector('[data-act="next"]').click();
        const ov = overlay();
        testRunner.assert(!!ov.querySelector('[data-od-id="od-choice"]'), 'fase de elección alcanzada');
        testRunner.assertEquals(ov.querySelectorAll('[data-act="pick"]').length, 4, 'cuatro tarjetas');
        for (const v of ['scratch', 'backup', 'google', 'demo']) {
            testRunner.assert(!!ov.querySelector(`[data-act="pick"][data-v="${v}"]`), `tarjeta ${v} presente`);
        }
        testRunner.assert(ov.textContent.includes('Explorar con datos de prueba'), 'tarjeta demo visible');
    },
    'launchOnboardingV2 es alias del arnés y el badge solo aparece en modo preview'() {
        cleanup();
        testRunner.assertEquals(launchOnboardingV2, showOnboardingPreview, 'misma función');
        showOnboardingPreview({ mode: 'preview' });
        testRunner.assert(overlay().textContent.includes('VISTA PREVIA'), 'badge visible en preview');
        closeOnboardingPreview();
        launchOnboardingV2({ mode: 'live' });
        const ov = overlay();
        testRunner.assert(!ov.textContent.includes('VISTA PREVIA'), 'badge oculto en live');
        testRunner.assert(!!ov.querySelector('[data-act="closePreview"]'), 'cierre presente en live');
    },
    'completar el flujo y cerrar conserva onboardingCompleted'() {
        cleanup();
        showOnboardingPreview({ mode: 'live' });
        notifyCompleted();
        closeOnboardingPreview();
        testRunner.assertEquals(localStorage.getItem(DONE), 'true', 'flag conservado tras completar');
    },
    'reabrir con flag previo y cerrar a mitad restaura el snapshot (sin resurrección)'() {
        cleanup();
        localStorage.setItem(DONE, 'true');
        launchOnboardingV2({ mode: 'live' });
        overlay().querySelector('[data-act="next"]').click();
        closeOnboardingPreview();
        testRunner.assertEquals(localStorage.getItem(DONE), 'true', 'snapshot previo restaurado');
    },
    'usuario nuevo que cierra a mitad no queda marcado como completado'() {
        cleanup();
        showOnboardingPreview();
        overlay().querySelector('[data-act="next"]').click();
        closeOnboardingPreview();
        testRunner.assertEquals(localStorage.getItem(DONE), null, 'flag sigue ausente');
    },
    '"Saltar por ahora" marca completado, limpia progreso y cierra'() {
        cleanup();
        launchOnboardingV2({ mode: 'live' });
        for (let i = 0; i < 6; i++) overlay().querySelector('[data-act="next"]').click();
        testRunner.assert(!!overlay().querySelector('[data-od-id="od-choice"]'), 'fase de elección alcanzada');
        overlay().querySelector('[data-act="skipOnboarding"]').click();
        testRunner.assertEquals(overlay(), null, 'overlay cerrado al saltar');
        testRunner.assertEquals(localStorage.getItem(DONE), 'true', 'flag marcado por skip');
        testRunner.assertEquals(localStorage.getItem(KEY), null, 'progreso a mitad limpiado por skip');
    },
    'SettingsTestsTab presenta la guía real (sin copia de vista previa)'() {
        const html = SettingsTestsTab({ state: { settings: {} } });
        testRunner.assert(html.includes('data-settings-action="open-onboarding-preview"'), 'botón abrir');
        testRunner.assert(html.includes('data-settings-action="reset-onboarding-preview"'), 'botón reiniciar');
        testRunner.assert(!html.includes('(vista previa)'), 'sin rotular vista previa');
        testRunner.assert(html.includes('Guía de inicio'), 'título de guía real');
        testRunner.assert(html.indexOf('onboarding-preview-title') < html.indexOf('splitx-integration-title'), 'sección antes de SplitX');
    }
});
