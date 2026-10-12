// Botón flotante "Ir arriba": oculto por defecto, se habilita con el ajuste
// `scrollTopButton` (Configuración → General).
export const BACK_TO_TOP_THRESHOLD = 400;

export function shouldShowBackToTop({ enabled, scrollY } = {}) {
    return enabled === true && scrollY > BACK_TO_TOP_THRESHOLD;
}

export function syncBackToTop(doc, { enabled, scrollY } = {}) {
    const btn = doc?.getElementById?.('backToTop');
    if (!btn) return;
    const visible = shouldShowBackToTop({ enabled, scrollY });
    btn.classList.toggle('visible', visible);
    btn.hidden = enabled !== true;
    btn.setAttribute('aria-hidden', visible ? 'false' : 'true');
}
