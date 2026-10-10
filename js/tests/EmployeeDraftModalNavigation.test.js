import fs from 'fs';
import path from 'path';
import { Modal } from '../modules/components/Modal.js';

let editor;
beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<button id="opener">Editar</button>';
    document.getElementById('opener').focus();
    editor = new Modal({ title: 'Editor', content: '<input id="draft" value="Local">' }).open();
    jest.advanceTimersByTime(10);
});
afterEach(() => {
    editor.close();
    jest.runAllTimers();
    document.body.innerHTML = '';
    jest.useRealTimers();
});

test('Escape closes only the discard confirmation and keeps the draft focused', async () => {
    const input = editor.element.querySelector('#draft');
    input.focus();
    const choice = Modal.confirm({ title: 'Descartar' });
    jest.advanceTimersByTime(10);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await expect(choice).resolves.toBe(false);
    jest.advanceTimersByTime(300);
    expect(editor.isOpen).toBe(true);
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('Local');
    expect(document.activeElement).toBe(input);
    expect(document.body.style.overflow).toBe('hidden');
});

test('closing the old editor while opening its replacement keeps scrolling locked and focus inside', () => {
    editor.close();
    editor = new Modal({ title: 'Recargado', content: '<input id="fresh">' }).open();
    jest.advanceTimersByTime(350);
    expect(editor.isOpen).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(editor.element.contains(document.activeElement)).toBe(true);
});


test('the application Escape handler leaves component modals to their owner', async () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'js/app.js'), 'utf8');
    const start = source.indexOf('function _handleAppKeydown');
    const end = source.indexOf('\n}', start) + 2;
    const handler = new Function(`return (${source.slice(start, end)});`)();
    window.closeModal = jest.fn();
    document.addEventListener('keydown', handler);
    try {
        const choice = Modal.confirm({ title: 'Descartar' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await expect(choice).resolves.toBe(false);
        jest.advanceTimersByTime(300);
        expect(window.closeModal).not.toHaveBeenCalled();
        expect(editor.isOpen).toBe(true);
        expect(editor.element.isConnected).toBe(true);
    } finally {
        document.removeEventListener('keydown', handler);
        delete window.closeModal;
    }
});
