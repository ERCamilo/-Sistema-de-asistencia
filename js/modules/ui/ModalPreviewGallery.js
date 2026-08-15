import { OutgoingConflictModal } from './OutgoingConflictModal.js';
import { IncomingChangeModal } from './IncomingChangeModal.js';
import { RestoreUI } from './RestoreUI.js';

const noOp = () => {};

const backupSample = {
    version: 'preview',
    data: {
        settings: { companyName: 'Empresa de ejemplo' }, employees: [{ id: 'e1' }],
        attendance: { 'e1-2026-01-01': { employeeId: 'e1', date: '2026-01-01' } }
    }
};

/** Opens real modal components with no-op callbacks; it never owns persistence. */
export function openSafeModalPreview(kind, deps = {}) {
    const outgoing = deps.outgoing || OutgoingConflictModal;
    const incoming = deps.incoming || IncomingChangeModal;
    const restore = deps.restore || RestoreUI;
    if (kind === 'outgoing-conflict') {
        outgoing.show({ preview: true, detail: 'Vista previa: la nube tiene cambios más recientes.', onUseCloud: noOp, onCombine: noOp, onUseDevice: noOp, onCancel: noOp });
        return true;
    }
    if (kind === 'incoming-changes') {
        incoming.show([{ kind: 'deletion', severity: 'significant', entityType: 'employee', entityId: 'e1', description: 'Ejemplo de cambio remoto importante.' }], { onApply: noOp, onRejectAndPause: noOp, onRejectAndReupload: noOp, onDismiss: noOp });
        return true;
    }
    if (kind === 'restore-backup') {
        restore.showComparisonModal(backupSample, backupSample.data, { onLocalRestore: noOp, onDisconnectRestore: noOp, onReplaceCloudRestore: noOp });
        return true;
    }
    return false;
}

export default { openSafeModalPreview };
