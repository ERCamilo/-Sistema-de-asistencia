/**
 * Ajustes → «Revisión de Mini conectados»: elige entre la revisión día por día
 * (predeterminada) y la vista «Comparar con SA».
 */
import { commitAutoSaveOption } from '../modules/ui/SettingsUI.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';

function deps() {
    const st = { settings: {} };
    return { st, deps: { state: st, batchSetState: cb => cb(), save: jest.fn(), now: () => 42 } };
}

describe('miniConnectedReviewMode', () => {
    test('Ajustes guarda solo los valores válidos', () => {
        const a = deps();
        expect(commitAutoSaveOption({ name: 'miniConnectedReviewMode', value: 'compare', deps: a.deps }).committed).toBe(true);
        expect(a.st.settings).toMatchObject({ miniConnectedReviewMode: 'compare', updatedAt: 42, _isDirty: true });
        expect(a.deps.save).toHaveBeenCalled();

        const b = deps();
        expect(commitAutoSaveOption({ name: 'miniConnectedReviewMode', value: 'otra', deps: b.deps }).committed).toBe(false);
        expect(b.st.settings.miniConnectedReviewMode).toBeUndefined();
    });

    test('el importador usa día por día salvo que se elija «compare»', () => {
        expect(new MiniAttendanceImportModal({}).connectedReviewMode).toBe('daily');
        expect(new MiniAttendanceImportModal({ connectedReviewMode: 'x' }).connectedReviewMode).toBe('daily');
        expect(new MiniAttendanceImportModal({ connectedReviewMode: 'compare' }).connectedReviewMode).toBe('compare');
    });
});
