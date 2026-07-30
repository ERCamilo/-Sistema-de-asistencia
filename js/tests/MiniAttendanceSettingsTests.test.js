import '../modules/ui/SettingsUI.js';
import { miniAttendanceAliasStore } from '../modules/services/MiniAttendanceAliasStore.js';

describe('Mini attendance remembered-match settings', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        delete window.showConfirm;
        delete window.showNotification;
        delete window.currentUser;
        document.body.replaceChildren();
        localStorage.clear();
    });

    test('confirms and forgets every alias in the current offline-capable scope', async () => {
        const forgetAll = jest.spyOn(miniAttendanceAliasStore, 'forgetAll')
            .mockResolvedValue({ forgottenCount: 3 });
        window.currentUser = { uid: 'supervisor-a' };
        window.showConfirm = jest.fn();
        window.showNotification = jest.fn();
        const button = document.createElement('button');
        button.dataset.settingsAction = 'clear-mini-attendance-aliases';
        document.body.append(button);

        button.click();
        expect(window.showConfirm).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Borrar coincidencias de Mini',
            message: expect.stringContaining('No se borrarán empleados ni asistencias'),
            confirmText: 'Sí, borrar coincidencias'
        }));
        await window.showConfirm.mock.calls[0][0].onConfirm();

        expect(forgetAll).toHaveBeenCalledWith({
            ownerUid: 'supervisor-a',
            siteId: 'sa-current-site',
            sourceId: 'mini-whatsapp'
        }, { actorUid: 'supervisor-a' });
        expect(window.showNotification).toHaveBeenCalledWith(
            '3 coincidencia(s) de Mini eliminada(s).',
            'success'
        );
    });
});
