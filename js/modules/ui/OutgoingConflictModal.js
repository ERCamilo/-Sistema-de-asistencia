/**
 * Clear decision UI for choosing between this device and the cloud.
 * The host receives an action only after the second confirmation.
 */
const MODAL_CLASS = 'outgoing-conflict-modal';

const CHOICES = {
    'use-cloud': {
        title: 'Usar los datos de la nube',
        label: '📥 Usar los datos de la nube',
        summary: 'En este dispositivo, elimina y reemplaza empleados, asistencia, cargos, responsables y ajustes por los de la nube.',
        sections: [
            ['Se reemplazarán', 'Empleados, cargos, responsables, asistencia y ajustes guardados en este dispositivo.'],
            ['Se conservarán', 'Caja Chica, comprobantes y cierres de nómina guardados en este dispositivo.'],
            ['Se perderán', 'Los cambios de esos datos que todavía estén solo en este dispositivo.']
        ],
        callback: 'onUseCloud', confirm: 'Sí, usar los datos de la nube'
    },
    combine: {
        title: 'Combinar los datos',
        label: '🔀 Combinar los datos',
        summary: 'Intenta juntar empleados, asistencia, cargos y responsables de este dispositivo con los de la nube.',
        sections: [
            ['Se combinarán', 'Empleados, asistencia, cargos y responsables de este dispositivo y de la nube.'],
            ['Se conservará el cambio más reciente', 'Si el mismo dato es diferente en ambos lugares, se conservará el cambio más reciente. La versión anterior no se mantiene.'],
            ['Se conservarán', 'Caja Chica, comprobantes, cierres de nómina y ajustes de este dispositivo.']
        ],
        callback: 'onCombine', confirm: 'Sí, combinar los datos'
    },
    'use-device': {
        title: 'Usar los datos de este dispositivo',
        label: '⬆️ Usar los datos de este dispositivo',
        summary: 'Mantiene empleados, asistencia, cargos, responsables y ajustes de este dispositivo y reemplaza con ellos los de la nube. Los actuales de la nube pueden perderse.',
        sections: [
            ['Se reemplazarán', 'Empleados, cargos, responsables y asistencia guardados en la nube.'],
            ['Se conservarán', 'Caja Chica, comprobantes y cierres de nómina.'],
            ['Se perderán', 'Los datos que hoy estén solo en la nube y no estén en este dispositivo.']
        ],
        callback: 'onUseDevice', confirm: 'Sí, usar los datos de este dispositivo'
    }
};

function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function selectorMarkup(detail) {
    return `
        <h2 id="outgoing-conflict-title" style="margin:0;font-size:1.2rem;">⚠️ Este dispositivo y la nube tienen datos distintos</h2>
        <p style="margin:8px 0 16px;color:#cbd5e1;line-height:1.5;">${detail}</p>
        <p style="margin:0 0 12px;color:#94a3b8;font-size:.84rem;">Elige qué datos quieres conservar. No se hará ningún cambio hasta que lo confirmes.</p>
        <div style="display:grid;gap:9px;">
            ${Object.entries(CHOICES).map(([id, choice]) => `<button type="button" data-conflict-choice="${id}" style="text-align:left;padding:12px;border:1px solid #334155;border-radius:10px;background:#0f172a;color:#f1f5f9;cursor:pointer;"><strong>${choice.label}</strong><span style="display:block;margin-top:3px;color:#94a3b8;font-size:.8rem;">${choice.summary}</span></button>`).join('')}
        </div>
        <p style="margin:14px 0 0;color:#94a3b8;font-size:.8rem;line-height:1.45;">Si cancelas, cierras esta ventana o presionas Escape, no se harán cambios. La sincronización con la nube quedará pausada. Pulsa el botón de tu cuenta, arriba a la derecha, para reanudarla.</p>
        <button type="button" data-conflict-action="cancel" style="width:100%;margin-top:10px;padding:10px;border:0;background:transparent;color:#94a3b8;cursor:pointer;">Cancelar sin cambios</button>`;
}

function confirmationMarkup(choice) {
    return `
        <h2 id="outgoing-conflict-title" style="margin:0;font-size:1.2rem;">${choice.title}</h2>
        <p style="margin:8px 0 16px;color:#cbd5e1;line-height:1.5;">${choice.summary}</p>
        <div style="display:grid;gap:9px;max-height:42vh;overflow:auto;padding-right:3px;">
            ${choice.sections.map(([title, text]) => `<section style="border-left:3px solid #38bdf8;padding:8px 10px;background:#0f172a;border-radius:6px;"><strong>${title}</strong><div style="margin-top:3px;color:#cbd5e1;font-size:.84rem;line-height:1.45;">${text}</div></section>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:16px;">
            <button type="button" data-conflict-action="confirm" style="padding:11px;border:0;border-radius:9px;background:#0891b2;color:white;font-weight:700;cursor:pointer;">${choice.confirm}</button>
            <button type="button" data-conflict-action="back" style="padding:10px;border:1px solid #475569;border-radius:9px;background:transparent;color:#cbd5e1;cursor:pointer;">← Volver a las opciones</button>
            <button type="button" data-conflict-action="cancel" style="padding:8px;border:0;background:transparent;color:#94a3b8;cursor:pointer;">Cancelar sin cambios</button>
        </div>`;
}

function pauseForReview(syncControls) {
    if (!syncControls) return { upload: false, download: false };
    const pausedByFlow = {
        upload: !syncControls.isSyncPaused?.(),
        download: !syncControls.isDownloadPaused?.()
    };
    if (pausedByFlow.upload) void syncControls.pauseCloudUpload?.('Esperando una decisión entre este dispositivo y la nube.');
    if (pausedByFlow.download) void syncControls.pauseCloudDownload?.('Esperando una decisión entre este dispositivo y la nube.');
    return pausedByFlow;
}

async function resumeFlowPauses(syncControls, pausedByFlow) {
    if (!syncControls) return;
    if (pausedByFlow.upload) await syncControls.resumeCloudUpload?.();
    if (pausedByFlow.download) await syncControls.resumeCloudDownload?.();
}

export const OutgoingConflictModal = {
    show(options = {}) {
        const modalClass = options.preview ? `${MODAL_CLASS}--preview` : MODAL_CLASS;
        if (document.querySelector(`.${modalClass}`)) return null;
        const pausedByFlow = options.preview ? { upload: false, download: false } : pauseForReview(options.syncControls);
        const detail = escape(options.detail || 'La nube tiene datos más nuevos que este dispositivo.');
        const root = document.createElement('div');
        root.className = modalClass;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'outgoing-conflict-title');
        root.style.cssText = 'position:fixed;inset:0;z-index:10020;background:rgba(15,23,42,.92);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;';
        const panel = document.createElement('div');
        panel.style.cssText = 'width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#1e293b;color:#f1f5f9;border:1px solid #334155;border-radius:14px;padding:22px;box-shadow:0 25px 50px -12px rgba(0,0,0,.65);';
        root.appendChild(panel);
        document.body.appendChild(root);
        let selected = null;

        const close = (cancelled = false) => {
            document.removeEventListener('keydown', onKey);
            root.remove();
            if (cancelled) options.onCancel?.();
        };
        const renderSelector = () => {
            selected = null;
            panel.innerHTML = selectorMarkup(detail);
            panel.querySelector('[data-conflict-choice]')?.focus();
        };
        const renderConfirmation = (id) => {
            selected = CHOICES[id];
            panel.innerHTML = confirmationMarkup(selected);
            panel.querySelector('[data-conflict-action="confirm"]')?.focus();
        };
        const isActiveModal = () => {
            const modals = document.querySelectorAll(`.${MODAL_CLASS}, .${MODAL_CLASS}--preview`);
            return modals[modals.length - 1] === root;
        };
        const onKey = (event) => {
            if (event.key === 'Escape' && isActiveModal()) close(true);
        };
        document.addEventListener('keydown', onKey);
        root.addEventListener('click', async (event) => {
            if (event.target === root) return close(true);
            const choice = event.target.closest('[data-conflict-choice]')?.dataset.conflictChoice;
            if (choice) return renderConfirmation(choice);
            const action = event.target.closest('[data-conflict-action]')?.dataset.conflictAction;
            if (action === 'back') return renderSelector();
            if (action === 'cancel') return close(true);
            if (action === 'confirm' && selected) {
                const callback = options[selected.callback];
                close(false);
                if (typeof callback !== 'function') return;
                try {
                    const result = await callback();
                    if (result === false || result?.ok === false) return;
                    await resumeFlowPauses(options.syncControls, pausedByFlow);
                } catch (error) {
                    options.onFailure?.(error);
                }
            }
        });
        renderSelector();
        return root;
    }
};

export default OutgoingConflictModal;
