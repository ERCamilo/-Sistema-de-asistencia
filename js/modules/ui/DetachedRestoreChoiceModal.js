/**
 * 🧷 DetachedRestoreChoiceModal.js (M2)
 *
 * Decisión explícita al volver a iniciar sesión después de «Desconectar y
 * restaurar». Tarjetas de selección (design.md 5.5), botón primario
 * deshabilitado con el motivo en el footer (1.2) y sin confirm() nativo ni
 * emojis. Escape o cerrar = «Cerrar sesión» (lo más conservador).
 */
import { escapeHTML } from '../utils/Sanitize.js';
import { DETACHED_RESTORE_CHOICE } from '../services/DetachedRestoreGuard.js';

const OVERLAY_ID = 'detached-restore-choice';

const ICONS = {
    upload: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/></svg>',
    cloud: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19a4.5 4.5 0 0 0 0-9h-1.3A7 7 0 1 0 4 15.3"/><path d="m8 17 4 4 4-4"/><path d="M12 12v9"/></svg>',
    logout: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>'
};

export function buildDetachedRestoreOptions({ hasPettyCash = false } = {}) {
    return [
        {
            value: DETACHED_RESTORE_CHOICE.UPLOAD,
            title: 'Subir lo restaurado a esta cuenta',
            detail: 'Lo de este teléfono reemplaza los mismos registros en la nube' +
                (hasPettyCash ? ', incluida Caja Chica' : '') +
                '. Lo que solo exista en la nube se conserva.'
        },
        {
            value: DETACHED_RESTORE_CHOICE.CLOUD,
            title: 'Usar los datos de la nube',
            detail: 'Se descarta lo restaurado en este teléfono. Tu archivo de respaldo no cambia.'
        },
        {
            value: DETACHED_RESTORE_CHOICE.LOGOUT,
            title: 'Cerrar sesión',
            detail: 'Todo queda solo en este teléfono, como está ahora.'
        }
    ];
}

function card(option, selected) {
    const active = option.value === selected;
    return `
        <button type="button" role="radio" aria-checked="${active}" data-choice="${option.value}"
            style="display:flex;gap:14px;align-items:flex-start;width:100%;text-align:left;padding:16px 18px;border-radius:14px;
                   border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};background:${active ? 'var(--panel-2)' : 'transparent'};
                   color:var(--text);cursor:pointer;min-height:44px;transition:background .15s,border-color .15s;">
            <span style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:11px;
                         border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};
                         background:${active ? 'var(--accent)' : 'var(--panel-2)'};color:${active ? 'var(--on-accent)' : 'var(--text-dim)'};">
                ${ICONS[option.value]}
            </span>
            <span style="display:flex;flex-direction:column;gap:4px;">
                <strong style="font-size:14.5px;">${escapeHTML(option.title)}</strong>
                <span style="font-size:13px;color:var(--text-dim);line-height:1.45;">${escapeHTML(option.detail)}</span>
            </span>
        </button>`;
}

/**
 * @returns {Promise<string|null>} valor elegido o null si se cerró.
 */
export function askDetachedRestoreChoice({ email = '', marker = {} } = {}) {
    if (typeof document === 'undefined') return Promise.resolve(null);
    document.getElementById(OVERLAY_ID)?.remove();
    const options = buildDetachedRestoreOptions({ hasPettyCash: marker?.hasPettyCash });
    let selected = null;

    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', `${OVERLAY_ID}-title`);
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in oklch, var(--bg) 88%, transparent);';

        const render = () => {
            overlay.innerHTML = `
                <div style="width:100%;max-width:620px;border-radius:22px;background:var(--panel);border:1px solid var(--border);box-shadow:var(--shadow);overflow:hidden;color:var(--text);">
                    <div style="padding:22px 24px 8px;">
                        <div style="display:inline-flex;align-items:center;height:26px;padding:0 11px;border-radius:20px;background:var(--panel-2);border:1px solid var(--border);font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--accent);margin-bottom:14px;">Respaldo restaurado</div>
                        <h2 id="${OVERLAY_ID}-title" style="margin:0 0 6px;font-size:24px;font-weight:700;letter-spacing:-.015em;line-height:1.2;">¿Qué hacemos con lo restaurado?</h2>
                        <p style="margin:0;font-size:14px;color:var(--text-dim);line-height:1.55;">Iniciaste sesión como <b>${escapeHTML(email)}</b>. Nada se sincroniza hasta que elijas.</p>
                    </div>
                    <div role="radiogroup" aria-label="Qué hacer con lo restaurado" style="display:flex;flex-direction:column;gap:10px;padding:14px 20px 18px;">
                        ${options.map(option => card(option, selected)).join('')}
                    </div>
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 24px;border-top:1px solid var(--border);">
                        <span data-hint style="font-size:12.5px;color:var(--text-faint);">${selected ? '' : 'Elige una opción para continuar'}</span>
                        <button type="button" data-confirm ${selected ? '' : 'disabled aria-disabled="true"'}
                            style="height:42px;padding:0 18px;border-radius:10px;border:0;font-weight:600;background:var(--accent);color:var(--on-accent);cursor:pointer;${selected ? '' : 'opacity:.4;pointer-events:none;'}">Continuar</button>
                    </div>
                </div>`;
        };

        const finish = value => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(value);
        };
        const onKey = event => {
            if (event.key === 'Escape') { event.preventDefault(); finish(null); }
        };
        overlay.addEventListener('click', event => {
            const choice = event.target.closest?.('[data-choice]')?.getAttribute('data-choice');
            if (choice) {
                selected = choice;
                render();
                overlay.querySelector(`[data-choice="${choice}"]`)?.focus();
                return;
            }
            if (event.target.closest?.('[data-confirm]') && selected) finish(selected);
        });
        document.addEventListener('keydown', onKey, true);
        render();
        document.body.appendChild(overlay);
        overlay.querySelector('[data-choice]')?.focus();
    });
}

export default { askDetachedRestoreChoice, buildDetachedRestoreOptions };
