/**
 * 📡 IncomingChangeModal.js (Tarea #27)
 *
 * Modal que aparece cuando un payload remoto trae cambios significant
 * (ver IncomingChangeDetector). Da contexto al usuario antes de aplicar:
 *   - Lista de cambios agrupados por severidad.
 *   - Descripción legible por cambio.
 *   - 2 botones: Aplicar todo / Rechazar.
 *
 * Diseño: singleton (no abre dos a la vez), cleanup en cualquier salida
 * (apply, reject, Escape, click X).
 */

const MODAL_CLASS = 'incoming-change-modal';

const KIND_ICONS = {
    'deletion':          '🗑️',
    'addition':          '➕',
    'scalar-divergence': '🔀',
    'array-drop':        '📉',
    'schema-mismatch':   '🔢'
};

const ENTITY_LABELS = {
    employee: 'Empleado',
    position: 'Posición',
    leader:   'Líder',
    settings: 'Configuración'
};

function renderChangeItem(change) {
    const icon = KIND_ICONS[change.kind] || '•';
    const entity = ENTITY_LABELS[change.entityType] || change.entityType || '';
    const severityColor = change.severity === 'significant' ? '#ef4444' : '#94a3b8';
    return `
        <li style="display: flex; gap: 8px; padding: 8px 10px; background: rgba(15, 23, 42, 0.5);
                   border-left: 3px solid ${severityColor}; border-radius: 6px; margin-bottom: 6px;
                   font-size: 0.82rem; color: #cbd5e1;">
            <span style="font-size: 0.95rem; line-height: 1;">${icon}</span>
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; color: #f1f5f9;">${entity}${change.entityId ? ` · ${change.entityId.substring(0, 12)}` : ''}</div>
                <div style="color: #94a3b8;">${change.description || change.kind}</div>
            </div>
        </li>
    `;
}

function renderGroup(title, items, badgeColor) {
    if (items.length === 0) return '';
    return `
        <div style="margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                <span style="display: inline-block; width: 8px; height: 8px; background: ${badgeColor}; border-radius: 50%;"></span>
                <strong style="color: ${badgeColor}; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em;">
                    ${title} (${items.length})
                </strong>
            </div>
            <ul style="list-style: none; padding: 0; margin: 0; max-height: 200px; overflow-y: auto;">
                ${items.map(renderChangeItem).join('')}
            </ul>
        </div>
    `;
}

export const IncomingChangeModal = {

    show(changes, opts = {}) {
        // Idempotente: si ya hay uno, no abrir otro.
        if (document.querySelector(`.${MODAL_CLASS}`)) return;

        const safeChanges = Array.isArray(changes) ? changes : [];
        const significant = safeChanges.filter(c => c.severity === 'significant');
        const trivial = safeChanges.filter(c => c.severity !== 'significant');

        const html = `
            <div class="${MODAL_CLASS}" style="position: fixed; inset: 0; z-index: 10010;
                 background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(6px);
                 display: flex; align-items: center; justify-content: center;">
                <div style="max-width: 560px; width: 90%; max-height: 88vh; overflow-y: auto;
                     background: #1e293b; color: #f1f5f9; border-radius: 14px;
                     padding: 22px 24px; border: 1px solid #334155;
                     box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6); position: relative;">

                    <button type="button" data-action="reject"
                            style="position: absolute; top: 12px; right: 14px; background: none;
                                   border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer;"
                            aria-label="Cerrar y rechazar">&times;</button>

                    <h2 style="margin: 0 0 6px; font-size: 1.2rem; display: flex; align-items: center; gap: 10px;">
                        📡 Cambios entrantes desde la nube
                    </h2>
                    <p style="margin: 0 0 16px; font-size: 0.85rem; color: #94a3b8; line-height: 1.5;">
                        Otro dispositivo realizó cambios. Revisa antes de aplicarlos.
                        Se detectaron <strong>${safeChanges.length}</strong> cambios
                        (<strong style="color:#ef4444;">${significant.length}</strong> que merecen revisión,
                        <strong>${trivial.length}</strong> rutinarios).
                    </p>

                    ${renderGroup('Cambios importantes', significant, '#ef4444')}
                    ${renderGroup('Cambios rutinarios', trivial, '#94a3b8')}

                    ${safeChanges.length === 0 ? `
                        <div style="text-align: center; padding: 20px; color: #94a3b8;">
                            No hay cambios para mostrar.
                        </div>
                    ` : ''}

                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 18px;">
                        <button type="button" data-action="apply"
                                style="padding: 12px; background: linear-gradient(135deg, #06b6d4, #0891b2);
                                       color: white; border: none; border-radius: 10px; font-weight: 700;
                                       cursor: pointer; font-size: 0.95rem;">
                            ✅ Aplicar cambios
                        </button>
                        <button type="button" data-action="reject"
                                style="padding: 10px; background: transparent; color: #94a3b8;
                                       border: 1px solid #334155; border-radius: 10px; cursor: pointer;">
                            ❌ Rechazar (mantener mis datos locales)
                        </button>
                    </div>
                    <div style="margin-top: 12px; font-size: 0.7rem; color: #64748b; line-height: 1.5; text-align: center;">
                        Si rechazas, los cambios entrantes se ignoran y el local se vuelve a subir.
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
        const modal = document.querySelector(`.${MODAL_CLASS}`);

        const close = () => {
            if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
            document.removeEventListener('keydown', onKey);
        };

        modal.querySelectorAll('[data-action="reject"]').forEach(btn => {
            btn.addEventListener('click', () => {
                close();
                if (typeof opts.onReject === 'function') opts.onReject();
            });
        });
        const applyBtn = modal.querySelector('[data-action="apply"]');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                close();
                if (typeof opts.onApply === 'function') opts.onApply();
            });
        }

        const onKey = (e) => {
            if (e.key === 'Escape') {
                close();
                if (typeof opts.onReject === 'function') opts.onReject();
            }
        };
        document.addEventListener('keydown', onKey);

        return modal;
    }
};

export default IncomingChangeModal;
