/**
 * Programa el modal de «Novedades» para después de que la app terminó de
 * arrancar (`app:ready`), con un respiro para no encimarse con otros avisos.
 * Probado en js/tests/ReleaseNotes.test.js.
 */
import { whatsNew } from './WhatsNew.js';

export function scheduleWhatsNew({ target = window, service = null, delayMs = 2500 } = {}) {
    const onReady = () => {
        target.removeEventListener('app:ready', onReady);
        setTimeout(() => {
            try {
                Promise.resolve((service || whatsNew()).maybeShow()).catch((error) => console.warn('whats-new', error?.name || 'Error'));
            } catch (error) { console.warn('whats-new', error?.name || 'Error'); }
        }, delayMs);
    };
    target.addEventListener('app:ready', onReady);
    return () => target.removeEventListener('app:ready', onReady);
}
