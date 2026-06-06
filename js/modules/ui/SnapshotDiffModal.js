/**
 * 🔍 SnapshotDiffModal.js (Snapshot UX B)
 *
 * Modal de comparación que se muestra ANTES de restaurar un snapshot.
 * Le dice al usuario exactamente qué cambia: cuántos empleados, préstamos,
 * posiciones y registros tiene cada lado, y qué se perdería si restaura.
 *
 * Reemplaza el `Modal.confirm` genérico que solo decía "vas a sobrescribir
 * todo, ¿estás seguro?" — útil contra clicks accidentales, inútil contra
 * decisiones informadas.
 *
 * Uso:
 *   SnapshotDiffModal.show(snapshotState, currentState, {
 *     snapshotMeta: { reason, reasonLabel, createdAt },
 *     onRestore: () => { ... restore logic ... }
 *   });
 */

import { computeSnapshotDiff } from '../services/SnapshotDiff.js';
import { getReasonInfo } from '../services/SnapshotReasons.js';

const MODAL_CLASS = 'snapshot-diff-modal';

function row(label, snap, curr, delta) {
    const sign = delta > 0 ? '+' : '';
    const deltaColor = delta < 0 ? '#ef4444' : (delta > 0 ? '#10b981' : '#94a3b8');
    const deltaText = delta === 0 ? '=' : `${sign}${delta}`;
    return `
        <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.3);">
            <td style="padding: 10px 12px; font-weight: 500;">${label}</td>
            <td style="padding: 10px 12px; text-align: center; color: #cbd5e1;">${snap}</td>
            <td style="padding: 10px 12px; text-align: center; color: #cbd5e1;">${curr}</td>
            <td style="padding: 10px 12px; text-align: center; color: ${deltaColor}; font-weight: 700;">${deltaText}</td>
        </tr>
    `;
}

function lostList(title, items, maxItems = 5) {
    if (!items || items.length === 0) return '';
    const visible = items.slice(0, maxItems);
    const overflow = items.length - visible.length;
    const li = visible.map(it => {
        const name = it.name || it.employeeName || it.id;
        const detail = it.amount ? ` <span style="opacity: 0.7;">($${it.amount})</span>` : '';
        return `<li style="padding: 2px 0;">${name}${detail}</li>`;
    }).join('');
    const more = overflow > 0
        ? `<li style="padding: 2px 0; opacity: 0.6; font-style: italic;">…y ${overflow} más</li>`
        : '';
    return `
        <div style="margin-top: 10px;">
            <div style="font-size: 0.78rem; color: #fca5a5; font-weight: 600; margin-bottom: 4px;">
                ${title}
            </div>
            <ul style="margin: 0; padding-left: 20px; font-size: 0.78rem; color: #fecaca;">
                ${li}${more}
            </ul>
        </div>
    `;
}

export const SnapshotDiffModal = {

    show(snapshotState, currentState, opts = {}) {
        // Si ya hay un modal abierto, no abrimos otro.
        if (document.querySelector(`.${MODAL_CLASS}`)) return;

        const diff = computeSnapshotDiff(snapshotState, currentState);
        const meta = opts.snapshotMeta || {};
        const reasonInfo = getReasonInfo(meta.reason, meta.type);

        const lossBlock = diff.willLoseData ? `
            <div class="diff-warning" data-role="warning" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 12px 14px; border-radius: 8px; margin-bottom: 18px;">
                <div style="font-weight: 700; color: #fca5a5; font-size: 0.9rem; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
                    ⚠️ Datos que se perderían al restaurar
                </div>
                <div style="font-size: 0.78rem; color: #fecaca; line-height: 1.5;">
                    Los siguientes datos existen ahora pero NO están en este snapshot.
                    Si restauras, se borrarán permanentemente (a menos que crees un snapshot nuevo antes).
                </div>
                ${lostList('Empleados', diff.lostEmployees)}
                ${lostList('Préstamos', diff.lostLoans)}
                ${lostList('Posiciones', diff.lostPositions)}
            </div>
        ` : '';

        const reasonBlock = meta.reason || meta.reasonLabel ? `
            <div style="background: rgba(30, 41, 59, 0.6); padding: 10px 12px; border-radius: 8px; margin-bottom: 16px; border-left: 3px solid ${reasonInfo.color || '#06b6d4'};">
                <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Razón del snapshot</div>
                <div style="color: #f1f5f9; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                    <span>${reasonInfo.icon || '📸'}</span>
                    <span>${reasonInfo.label || meta.reasonLabel || 'Snapshot'}</span>
                </div>
            </div>
        ` : '';

        const html = `
            <div class="${MODAL_CLASS}" style="position: fixed; inset: 0; z-index: 10005; background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center;">
                <div style="max-width: 560px; width: 90%; max-height: 88vh; overflow-y: auto; background: #1e293b; color: #f1f5f9; border-radius: 14px; padding: 22px 24px; border: 1px solid #334155; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6);">
                    <h2 style="margin: 0 0 6px 0; font-size: 1.25rem; display: flex; align-items: center; gap: 10px;">
                        🔍 Comparar antes de restaurar
                    </h2>
                    <p style="margin: 0 0 18px 0; font-size: 0.85rem; color: #94a3b8; line-height: 1.5;">
                        Así quedará tu sistema si restauras este snapshot. Revisa los cambios antes de confirmar.
                    </p>

                    ${reasonBlock}

                    <div style="background: rgba(15, 23, 42, 0.5); border-radius: 10px; overflow: hidden; border: 1px solid rgba(51, 65, 85, 0.5); margin-bottom: 18px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem;">
                            <thead style="background: rgba(30, 41, 59, 0.8);">
                                <tr>
                                    <th style="padding: 10px 12px; text-align: left; color: #94a3b8; font-weight: 600;">Categoría</th>
                                    <th style="padding: 10px 12px; text-align: center; color: #06b6d4; font-weight: 600;">Snapshot</th>
                                    <th style="padding: 10px 12px; text-align: center; color: #94a3b8; font-weight: 600;">Actual</th>
                                    <th style="padding: 10px 12px; text-align: center; color: #94a3b8; font-weight: 600;">Δ</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${row('👥 Empleados',  diff.employees.snapshot,  diff.employees.current,  diff.employees.delta)}
                                ${row('💵 Préstamos',  diff.loans.snapshot,      diff.loans.current,      diff.loans.delta)}
                                ${row('💼 Posiciones', diff.positions.snapshot,  diff.positions.current,  diff.positions.delta)}
                                ${row('📅 Registros',  diff.attendance.snapshot, diff.attendance.current, diff.attendance.delta)}
                            </tbody>
                        </table>
                    </div>

                    ${lossBlock}

                    ${diff.noChange ? `
                        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #6ee7b7; padding: 10px 12px; border-radius: 8px; margin-bottom: 18px; font-size: 0.85rem;">
                            ✅ Restaurar este snapshot no cambiaría nada — los datos coinciden con tu estado actual.
                        </div>
                    ` : ''}

                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button type="button" data-action="restore" style="padding: 12px; background: linear-gradient(135deg, #06b6d4, #0891b2); color: white; border: none; border-radius: 10px; font-weight: 700; font-size: 0.95rem; cursor: pointer;">
                            ⏪ Restaurar con red de seguridad
                        </button>
                        <button type="button" data-action="cancel" style="padding: 10px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 10px; font-weight: 500; cursor: pointer;">
                            Cancelar
                        </button>
                    </div>
                    <div style="margin-top: 12px; font-size: 0.72rem; color: #64748b; line-height: 1.5; text-align: center;">
                        "Con red" significa que crearemos un snapshot protegido de tu estado actual
                        antes de aplicar la restauración. Si algo sale mal, puedes volver atrás.
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', html);
        const modal = document.querySelector(`.${MODAL_CLASS}`);

        const close = () => { if (modal && modal.parentNode) modal.parentNode.removeChild(modal); };

        modal.querySelector('[data-action="cancel"]').addEventListener('click', () => {
            close();
            if (typeof opts.onCancel === 'function') opts.onCancel();
        });
        modal.querySelector('[data-action="restore"]').addEventListener('click', () => {
            close();
            if (typeof opts.onRestore === 'function') opts.onRestore({ diff });
        });

        // Esc cierra (sin restaurar)
        const onKey = (e) => {
            if (e.key === 'Escape') {
                document.removeEventListener('keydown', onKey);
                close();
                if (typeof opts.onCancel === 'function') opts.onCancel();
            }
        };
        document.addEventListener('keydown', onKey);

        return modal;
    }
};

export default SnapshotDiffModal;
