/**
 * Modal de «Novedades» que se muestra una sola vez en cada dispositivo después
 * de actualizar la app. Lo último que se vio se guarda en el dispositivo (no
 * viaja con la sincronización): cada teléfono lo ve una vez.
 * Probado en js/tests/ReleaseNotes.test.js.
 */
import { RELEASE_NOTES } from '../config/ReleaseNotes.js';
import { Modal } from '../components/Modal.js';

export const WHATS_NEW_STORAGE_KEY = 'sa.releaseNotes.lastSeen.v1';
const MAX_ENTRIES = 5;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dmy = (iso) => String(iso || '').split('-').reverse().join('-');
const TAG_COLORS = { Nuevo: '#06b6d4', Mejora: '#10b981', Arreglo: '#f59e0b' };

/**
 * Entradas que la persona aún no vio, de la más nueva a la más vieja.
 * Sin nada guardado (instalación nueva) no hay nada pendiente.
 */
export function pendingReleaseNotes(notes = RELEASE_NOTES, lastSeenId = null, { max = MAX_ENTRIES } = {}) {
    if (!notes.length || !lastSeenId) return [];
    const at = notes.findIndex((note) => note.id === lastSeenId);
    if (at === 0) return [];
    return (at < 0 ? notes : notes.slice(0, at)).slice(0, max);
}

export function releaseNotesHTML(entries = []) {
    return `<div data-whats-new style="display:flex;flex-direction:column;gap:18px;text-align:left;">${entries.map((entry) => `
        <section data-whats-new-entry>
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">
                <strong style="font-size:1rem;color:#f4f6fa;">${esc(entry.title)}</strong>
                <span style="font-size:.75rem;color:#94a3b8;white-space:nowrap;">${esc(dmy(entry.date))}</span>
            </div>
            <ul style="list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px;">
                ${(entry.items || []).map((item) => `<li style="display:flex;gap:10px;align-items:flex-start;font-size:.88rem;line-height:1.45;color:#cbd5e1;">
                    <span data-whats-new-tag="${esc(item.tag)}" style="flex:0 0 auto;min-width:54px;text-align:center;padding:2px 8px;border-radius:999px;font-size:.68rem;font-weight:700;color:#081a24;background:${TAG_COLORS[item.tag] || '#94a3b8'};">${esc(item.tag)}</span>
                    <span>${esc(item.text)}</span></li>`).join('')}
            </ul>
        </section>`).join('')}</div>`;
}

function openModal({ title, html }) {
    return new Promise((resolve) => {
        const modal = new Modal({
            title,
            content: html,
            size: 'medium',
            onClose: () => resolve(),
            buttons: [{ text: 'Entendido', class: 'btn-primary', onClick: function () { this.close(); resolve(); } }]
        });
        modal.open();
    });
}

const defaultStorage = () => { try { return globalThis.localStorage; } catch { return null; } };
const defaultBlocked = () => typeof document !== 'undefined'
    && !!(document.getElementById('onboarding-preview-overlay') || document.querySelector('[data-modal-overlay], .modal-overlay'));

export function createWhatsNew({ notes = RELEASE_NOTES, storage = defaultStorage(), modal = openModal, isBlocked = defaultBlocked } = {}) {
    const read = () => { try { return storage?.getItem(WHATS_NEW_STORAGE_KEY) ?? null; } catch { return undefined; } };   // undefined = no se puede leer
    const write = (id) => { try { storage?.setItem(WHATS_NEW_STORAGE_KEY, id); return true; } catch { return false; } };
    const newestId = () => notes[0]?.id || null;

    return {
        /** Al abrir la app: muestra lo nuevo una sola vez. Devuelve true si lo mostró. */
        async maybeShow() {
            const newest = newestId();
            const seen = read();
            if (!newest || seen === undefined) return false;          // sin almacenamiento no se muestra en bucle
            if (seen === null) { write(newest); return false; }       // instalación nueva
            const pending = pendingReleaseNotes(notes, seen);
            if (!pending.length) return false;
            if (isBlocked()) return false;                            // se reintenta en la próxima apertura
            if (!write(newest)) return false;
            await modal({ title: 'Novedades', html: releaseNotesHTML(pending) });
            return true;
        },
        /** Botón «Ver novedades» de Configuración: las últimas, aunque ya estén vistas. */
        async showLatest() {
            if (!notes.length) return false;
            await modal({ title: 'Novedades', html: releaseNotesHTML(notes.slice(0, 3)) });
            write(newestId());
            return true;
        }
    };
}

let shared = null;
export const whatsNew = () => (shared ||= createWhatsNew());
