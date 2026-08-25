import { SettingsTestsTab } from '../modules/ui/settings/SettingsTestsTab.js';
import '../modules/ui/SettingsUI.js';

describe('Settings / Tests — simulación del boot loader', () => {
    beforeEach(() => {
        document.body.innerHTML = SettingsTestsTab({ state: { settings: {} } });
        window.appBootLoader = {
            startSimulation: jest.fn(() => true),
            stopSimulation: jest.fn(() => true)
        };
        window.showNotification = jest.fn();
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete window.appBootLoader;
        delete window.showNotification;
    });

    test('renderiza controles temporales sin convertirlos en configuración persistente', () => {
        const html = SettingsTestsTab({ state: { settings: {} } });

        expect(html).toContain('id="bootLoaderTestDelaySeconds"');
        expect(html).toContain('id="bootLoaderTestErrorSeconds"');
        expect(html).toContain('id="bootLoaderTestReloadEnabled"');
        expect(html).toContain('data-settings-action="start-boot-loader-test"');
        expect(html).toContain('La simulación no guarda estos valores');
        expect(html).not.toMatch(/state\.settings.*bootLoader/i);
    });

    test('lanza una simulación detenida con los tiempos actuales del formulario', () => {
        document.getElementById('bootLoaderTestDelaySeconds').value = '1.5';
        document.getElementById('bootLoaderTestErrorSeconds').value = '4';
        document.getElementById('bootLoaderTestReloadEnabled').checked = false;

        document.querySelector('[data-settings-action="start-boot-loader-test"]').click();

        expect(window.appBootLoader.startSimulation).toHaveBeenCalledWith({
            slowDelayMs: 1500,
            failureDelayMs: 4000,
            reloadEnabled: false
        });
    });

    test('rechaza tiempos inválidos sin iniciar la simulación', () => {
        document.getElementById('bootLoaderTestDelaySeconds').value = '5';
        document.getElementById('bootLoaderTestErrorSeconds').value = '3';

        document.querySelector('[data-settings-action="start-boot-loader-test"]').click();

        expect(window.appBootLoader.startSimulation).not.toHaveBeenCalled();
        expect(window.showNotification).toHaveBeenCalledWith(
            expect.stringContaining('mayor'),
            'warning'
        );
    });
});
