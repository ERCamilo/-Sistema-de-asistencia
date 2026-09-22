import fs from 'fs';
import path from 'path';
import { attachProjectDialogA11y } from '../modules/features/projects/ProjectDialogA11y.js';

describe('R07 UX — accesibilidad de diálogos de proyectos', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        document.body.innerHTML = '';
    });

    test('trap de foco, Escape y retorno al disparador', () => {
        const trigger = document.createElement('button');
        trigger.textContent = 'Abrir proyectos';
        document.body.appendChild(trigger);
        trigger.focus();

        const overlay = document.createElement('div');
        overlay.innerHTML = '<section role="dialog" aria-modal="true">'
            + '<button id="first">Primero</button>'
            + '<button id="last">Último</button></section>';
        document.body.appendChild(overlay);
        const onEscape = jest.fn();
        const detach = attachProjectDialogA11y(overlay, { onEscape });
        jest.runOnlyPendingTimers();
        expect(document.activeElement.id).toBe('first');

        document.getElementById('last').focus();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', bubbles: true, cancelable: true
        }));
        expect(document.activeElement.id).toBe('first');

        document.getElementById('first').focus();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', shiftKey: true, bubbles: true, cancelable: true
        }));
        expect(document.activeElement.id).toBe('last');

        trigger.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', bubbles: true, cancelable: true
        }));
        expect(document.activeElement.id).toBe('first');
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true, cancelable: true
        }));
        expect(onEscape).toHaveBeenCalledTimes(1);

        detach();
        jest.runOnlyPendingTimers();
        expect(document.activeElement).toBe(trigger);
    });

    test('las superficies visibles de proyectos usan el helper compartido', () => {
        const read = file => fs.readFileSync(path.resolve(__dirname, file), 'utf8');
        const files = [
            '../modules/features/projects/ProjectsUI.js',
            '../modules/features/projects/ProjectListUI.js',
            '../modules/features/projects/ProjectCreateUI.js',
            '../modules/features/projects/ProjectOnboarding.js'
        ];
        for (const file of files) {
            const source = read(file);
            expect(source).toContain('attachProjectDialogA11y');
        }
    });
});
