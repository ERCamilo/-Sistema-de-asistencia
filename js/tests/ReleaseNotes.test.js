/**
 * Novedades de cada actualización: la lista que se escribe a mano y el modal
 * que se muestra una sola vez en cada dispositivo después de actualizar.
 */
import { RELEASE_NOTES, RELEASE_TAGS } from '../modules/config/ReleaseNotes.js';
import { pendingReleaseNotes, releaseNotesHTML, createWhatsNew, WHATS_NEW_STORAGE_KEY } from '../modules/services/WhatsNew.js';

const notes = [
    { id: 'c', date: '2026-10-19', title: 'C', items: [{ tag: 'Nuevo', text: 'cosa c' }] },
    { id: 'b', date: '2026-10-10', title: 'B', items: [{ tag: 'Mejora', text: 'cosa b' }] },
    { id: 'a', date: '2026-10-01', title: 'A', items: [{ tag: 'Arreglo', text: 'cosa a' }] }
];

describe('la lista de novedades (RELEASE_NOTES)', () => {
    test('cada entrada tiene id único, fecha válida, título y entre 1 y 8 líneas con etiqueta conocida', () => {
        expect(RELEASE_NOTES.length).toBeGreaterThan(0);
        expect(new Set(RELEASE_NOTES.map((n) => n.id)).size).toBe(RELEASE_NOTES.length);
        for (const note of RELEASE_NOTES) {
            expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(note.title.trim().length).toBeGreaterThan(0);
            expect(note.items.length).toBeGreaterThanOrEqual(1);
            expect(note.items.length).toBeLessThanOrEqual(8);
            for (const item of note.items) {
                expect(RELEASE_TAGS).toContain(item.tag);
                expect(item.text.trim().length).toBeGreaterThan(5);
                expect(item.text.length).toBeLessThanOrEqual(160);
            }
        }
    });
    test('van de la más nueva a la más vieja', () => {
        const dates = RELEASE_NOTES.map((n) => n.date);
        expect([...dates].sort().reverse()).toEqual(dates);
    });
});

describe('pendingReleaseNotes', () => {
    test('instalación nueva (nada guardado): no muestra nada', () => {
        expect(pendingReleaseNotes(notes, null)).toEqual([]);
    });
    test('al día: no muestra nada', () => {
        expect(pendingReleaseNotes(notes, 'c')).toEqual([]);
    });
    test('muestra solo lo que salió después de lo último visto, de la más nueva a la más vieja', () => {
        expect(pendingReleaseNotes(notes, 'a').map((n) => n.id)).toEqual(['c', 'b']);
        expect(pendingReleaseNotes(notes, 'b').map((n) => n.id)).toEqual(['c']);
    });
    test('un id desconocido (lista recortada) muestra las más nuevas, con tope', () => {
        expect(pendingReleaseNotes(notes, 'zzz', { max: 2 }).map((n) => n.id)).toEqual(['c', 'b']);
    });
    test('tope de entradas', () => {
        expect(pendingReleaseNotes(notes, 'a', { max: 1 }).map((n) => n.id)).toEqual(['c']);
    });
});

describe('releaseNotesHTML', () => {
    test('título, fecha y cada línea con su etiqueta; todo escapado', () => {
        document.body.innerHTML = releaseNotesHTML([{ id: 'x', date: '2026-10-19', title: 'Caja <b>chica</b>', items: [{ tag: 'Nuevo', text: '<img src=x onerror=1> listo' }] }]);
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelector('[data-whats-new-entry]').textContent).toContain('Caja <b>chica</b>');
        expect(document.querySelector('[data-whats-new-entry]').textContent).toContain('19-10-2026');
        expect(document.querySelector('[data-whats-new-tag="Nuevo"]')).not.toBeNull();
    });
});

describe('createWhatsNew', () => {
    const memory = (initial = {}) => {
        const data = { ...initial };
        return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
    };
    const modalSpy = () => jest.fn().mockResolvedValue();

    test('primera vez en este dispositivo: guarda lo último y no muestra nada', async () => {
        const storage = memory(); const modal = modalSpy();
        const wn = createWhatsNew({ notes, storage, modal });
        expect(await wn.maybeShow()).toBe(false);
        expect(modal).not.toHaveBeenCalled();
        expect(storage.data[WHATS_NEW_STORAGE_KEY]).toBe('c');
    });
    test('después de actualizar: muestra lo nuevo una sola vez', async () => {
        const storage = memory({ [WHATS_NEW_STORAGE_KEY]: 'a' }); const modal = modalSpy();
        const wn = createWhatsNew({ notes, storage, modal });
        expect(await wn.maybeShow()).toBe(true);
        expect(modal).toHaveBeenCalledTimes(1);
        expect(modal.mock.calls[0][0].html).toContain('cosa c');
        expect(modal.mock.calls[0][0].html).toContain('cosa b');
        expect(storage.data[WHATS_NEW_STORAGE_KEY]).toBe('c');
        expect(await wn.maybeShow()).toBe(false);
        expect(modal).toHaveBeenCalledTimes(1);
    });
    test('si algo estorba (onboarding, otro modal) no muestra ni marca como visto', async () => {
        const storage = memory({ [WHATS_NEW_STORAGE_KEY]: 'a' }); const modal = modalSpy();
        const wn = createWhatsNew({ notes, storage, modal, isBlocked: () => true });
        expect(await wn.maybeShow()).toBe(false);
        expect(storage.data[WHATS_NEW_STORAGE_KEY]).toBe('a');
    });
    test('almacenamiento que falla: no rompe ni muestra en bucle', async () => {
        const storage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
        const modal = modalSpy();
        const wn = createWhatsNew({ notes, storage, modal });
        await expect(wn.maybeShow()).resolves.toBe(false);
        expect(modal).not.toHaveBeenCalled();
    });
    test('«Ver novedades» muestra las últimas aunque ya estén vistas', async () => {
        const storage = memory({ [WHATS_NEW_STORAGE_KEY]: 'c' }); const modal = modalSpy();
        const wn = createWhatsNew({ notes, storage, modal });
        await wn.showLatest();
        expect(modal).toHaveBeenCalledTimes(1);
        expect(modal.mock.calls[0][0].html).toContain('cosa c');
        expect(modal.mock.calls[0][0].html).toContain('cosa b');
    });
});

describe('arranque y Configuración', () => {
    test('scheduleWhatsNew espera a app:ready y pasa un momento antes de mostrar, una sola vez', () => {
        jest.useFakeTimers();
        const { scheduleWhatsNew } = require('../modules/services/WhatsNewBoot.js');
        const service = { maybeShow: jest.fn().mockResolvedValue(true) };
        const target = new EventTarget();
        scheduleWhatsNew({ target, service, delayMs: 1500 });
        jest.advanceTimersByTime(5000);
        expect(service.maybeShow).not.toHaveBeenCalled();          // aún no está lista la app
        target.dispatchEvent(new Event('app:ready'));
        jest.advanceTimersByTime(1499);
        expect(service.maybeShow).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(service.maybeShow).toHaveBeenCalledTimes(1);
        target.dispatchEvent(new Event('app:ready'));
        jest.advanceTimersByTime(5000);
        expect(service.maybeShow).toHaveBeenCalledTimes(1);
        jest.useRealTimers();
    });
    test('un error al mostrar no rompe el arranque', async () => {
        jest.useFakeTimers();
        const { scheduleWhatsNew } = require('../modules/services/WhatsNewBoot.js');
        const service = { maybeShow: jest.fn().mockRejectedValue(new Error('x')) };
        const target = new EventTarget();
        scheduleWhatsNew({ target, service, delayMs: 10 });
        target.dispatchEvent(new Event('app:ready'));
        expect(() => jest.advanceTimersByTime(10)).not.toThrow();
        jest.useRealTimers();
        await Promise.resolve();
    });
    test('Configuración tiene el botón «Ver novedades» en el pie', () => {
        const { SettingsTab, initSettingsUI } = require('../modules/ui/SettingsUI.js');
        initSettingsUI({ state: { employees: [], positions: [], settings: { companyName: 'Empresa', holidays: [], payPeriod: {} } },
            icons: { get: () => '', getAvailableSets: () => ['unicode'] }, holidayService: { renderSettingsCalendar: () => '' } });
        document.body.innerHTML = SettingsTab();
        const button = document.querySelector('[data-settings-action="show-whats-new"]');
        expect(button).not.toBeNull();
        expect(button.textContent).toContain('Ver novedades');
        document.body.innerHTML = '';
    });
});
