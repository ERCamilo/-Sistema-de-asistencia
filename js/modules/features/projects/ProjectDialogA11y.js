const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

function visibleFocusable(root) {
    return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(el => {
        if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
        const style = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
        return !style || (style.display !== 'none' && style.visibility !== 'hidden');
    });
}
/**
 * Accesibilidad compartida para los overlays legacy de Proyectos.
 * Mantiene el foco dentro del diálogo, soporta Escape y restaura el foco
 * al elemento que abrió el modal. Devuelve un cleanup idempotente.
 */
export function attachProjectDialogA11y(overlay, {
    onEscape = null,
    focusInitial = true
} = {}) {
    if (!overlay) return () => {};
    const dialog = overlay.querySelector('[role="dialog"]') || overlay;
    const previousFocus = typeof document !== 'undefined' ? document.activeElement : null;
    if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    let detached = false;

    const focusFirst = () => {
        const items = visibleFocusable(dialog);
        (items[0] || dialog)?.focus?.();
    };
    const onKeydown = event => {
        if (!overlay.isConnected) return;
        if (event.key === 'Escape' && typeof onEscape === 'function') {
            event.preventDefault();
            onEscape();
            return;
        }
        if (event.key !== 'Tab') return;

        const items = visibleFocusable(dialog);
        if (items.length === 0) {
            event.preventDefault();
            dialog.focus();
            return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !dialog.contains(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
            event.preventDefault();
            first.focus();
        }
    };
    document.addEventListener('keydown', onKeydown);
    if (focusInitial) setTimeout(focusFirst, 0);

    return function detachProjectDialogA11y({ restoreFocus = true } = {}) {
        if (detached) return;
        detached = true;
        document.removeEventListener('keydown', onKeydown);
        if (restoreFocus && previousFocus && typeof previousFocus.focus === 'function') {
            setTimeout(() => {
                try { previousFocus.focus(); } catch (_) {}
            }, 0);
        }
    };
}

export default { attachProjectDialogA11y };
