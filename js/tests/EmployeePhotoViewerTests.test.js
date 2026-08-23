import fs from 'fs';
import path from 'path';
import { indexedDBService } from '../modules/services/IndexedDBService.js';
import { employeePhotoService } from '../modules/services/EmployeePhotoService.js';
import {
    EmployeeAvatar,
    cleanupEmployeeAvatars,
    hydrateEmployeeAvatars
} from '../modules/ui/components/EmployeeAvatar.js';
import {
    EmployeePhotoViewerController,
    registerEmployeePhotoViewerEvents
} from '../modules/ui/components/EmployeePhotoViewer.js';
import {
    EmployeePhotoAcquisitionController,
    registerEmployeePhotoAcquisitionEvents
} from '../modules/ui/components/EmployeePhotoAcquisition.js';

const CARD_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/components/EmployeeFloatingCard.js'), 'utf8'
);

const employee = { id: 'emp-1', name: 'Franklin Henrriquez' };

function urlApi(prefix = 'full') {
    let next = 0;
    return {
        createObjectURL: jest.fn(() => `blob:${prefix}-${++next}`),
        revokeObjectURL: jest.fn()
    };
}

function mountAvatar(value = employee) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = EmployeeAvatar(value, { variant: 'compact' });
    document.body.append(wrapper);
    return wrapper.querySelector('[data-employee-avatar]');
}

function markInteractive(avatar, version = 1) {
    avatar.dataset.employeePhotoViewerTrigger = '';
    avatar.dataset.employeePhotoVersion = String(version);
    avatar.setAttribute('role', 'button');
    avatar.tabIndex = 0;
}

function record(marker, version = 1) {
    return {
        thumbnailBlob: new Blob([`thumb-${marker}`], { type: 'image/jpeg' }),
        optimizedBlob: new Blob([`full-${marker}`], { type: 'image/jpeg' }),
        version
    };
}

describe('EmployeeAvatar viewer eligibility', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        cleanupEmployeeAvatars(document);
        jest.clearAllMocks();
    });

    test('becomes an accessible viewer control only after a cached thumbnail is hydrated', async () => {
        const avatar = mountAvatar();
        expect(avatar.tagName).toBe('BUTTON');
        expect(avatar.hasAttribute('data-employee-photo-acquisition-trigger')).toBe(true);
        expect(avatar.hasAttribute('data-employee-photo-viewer-trigger')).toBe(false);

        await hydrateEmployeeAvatars(document, {
            photoStore: { getEmployeePhoto: jest.fn().mockResolvedValue(record('one', 7)) },
            urlApi: urlApi('thumb')
        });

        expect(avatar.getAttribute('role')).toBe('button');
        expect(avatar.tabIndex).toBe(0);
        expect(avatar.dataset.employeePhotoVersion).toBe('7');
        expect(avatar.getAttribute('aria-label')).toBe('Ver foto de Franklin Henrriquez');
        expect(avatar.hasAttribute('data-employee-photo-acquisition-trigger')).toBe(false);
    });

    test('cache miss keeps the camera control and never enables the viewer', async () => {
        const avatar = mountAvatar();
        await hydrateEmployeeAvatars(document, {
            photoStore: { getEmployeePhoto: jest.fn().mockResolvedValue(null) },
            urlApi: urlApi('thumb')
        });
        expect(avatar.tagName).toBe('BUTTON');
        expect(avatar.hasAttribute('data-employee-photo-viewer-trigger')).toBe(false);
        expect(avatar.hasAttribute('data-employee-photo-acquisition-trigger')).toBe(true);
        expect(avatar.querySelector('[data-avatar-fallback]').hidden).toBe(false);
    });
});

describe('EmployeePhotoViewerController', () => {
    const controllers = [];

    afterEach(() => {
        controllers.forEach(controller => controller.close({ restoreFocus: false }));
        controllers.length = 0;
        document.body.innerHTML = '';
        cleanupEmployeeAvatars(document);
        jest.clearAllMocks();
    });

    function controller(options = {}) {
        const instance = new EmployeePhotoViewerController(options);
        controllers.push(instance);
        return instance;
    }

    test('production cache default opens optimizedBlob with accessible dialog and cleans its URL', async () => {
        const avatar = mountAvatar();
        markInteractive(avatar, 3);
        const cached = record('primary', 3);
        indexedDBService.getEmployeePhoto.mockResolvedValue(cached);
        const urls = urlApi();
        const viewer = controller({ urlApi: urls });

        await viewer.open(avatar);

        expect(viewer.photoStore).toBe(employeePhotoService);
        expect(indexedDBService.getEmployeePhoto).toHaveBeenCalledWith('emp-1');
        expect(urls.createObjectURL.mock.calls[0][0]).toBe(cached.optimizedBlob);
        expect(urls.createObjectURL.mock.calls[0][0]).not.toBe(cached.thumbnailBlob);
        const dialog = document.querySelector('[data-employee-photo-viewer]');
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-label')).toBe('Foto de Franklin Henrriquez');
        expect(dialog.querySelector('img').alt).toBe('Foto de Franklin Henrriquez');
        expect([...dialog.querySelectorAll('[data-employee-photo-action]')].map(button => button.textContent.trim()))
            .toEqual(expect.arrayContaining(['Cambiar', 'Actualizar', 'Eliminar']));
        expect(dialog.querySelector('[data-employee-photo-action="update"]').disabled).toBe(false);
        expect(document.activeElement).toBe(dialog.querySelector('button[data-employee-photo-viewer-close]'));

        const replacement = mountAvatar({ id: 'emp-2', name: 'Beto Dos' });
        markInteractive(replacement, 4);
        indexedDBService.getEmployeePhoto.mockResolvedValueOnce(record('replacement', 4));
        await viewer.open(replacement);
        expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:full-1');

        viewer.close();
        expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:full-2');
        expect(document.querySelector('[data-employee-photo-viewer]')).toBeNull();
        expect(document.activeElement).toBe(replacement);
    });

    test.each([
        ['cache miss', null],
        ['cache error', new Error('IndexedDB read failed')]
    ])('%s never creates a full-image URL', async (_label, outcome) => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        const getEmployeePhoto = outcome instanceof Error
            ? jest.fn().mockRejectedValue(outcome)
            : jest.fn().mockResolvedValue(outcome);
        const urls = urlApi();
        const viewer = controller({ photoStore: { getEmployeePhoto }, urlApi: urls });

        await viewer.open(avatar);

        expect(urls.createObjectURL).not.toHaveBeenCalled();
        expect(document.querySelector('[data-employee-photo-viewer]')).toBeNull();
        if (!outcome) expect(avatar.getAttribute('role')).toBe('button');
    });

    test('image decode error closes the viewer and revokes the created URL', async () => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        const urls = urlApi();
        const viewer = controller({
            photoStore: { getEmployeePhoto: jest.fn().mockResolvedValue(record('broken')) },
            urlApi: urls
        });
        await viewer.open(avatar);

        document.querySelector('[data-employee-photo-viewer-image]')
            .dispatchEvent(new Event('error'));

        expect(document.querySelector('[data-employee-photo-viewer]')).toBeNull();
        expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:full-1');
    });

    test('Actualizar revalidates the cloud photo in place and reports updated, current, and error states', async () => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        const initial = record('initial', 1);
        const refreshed = record('refreshed', 2);
        const photoStore = {
            getEmployeeOriginal: jest.fn().mockResolvedValue(initial),
            getEmployeePhoto: jest.fn().mockResolvedValue(refreshed),
            refreshEmployeePhoto: jest.fn()
                .mockResolvedValueOnce({ status: 'updated', record: refreshed })
                .mockResolvedValueOnce({ status: 'current', record: refreshed })
                .mockResolvedValueOnce({ status: 'error', record: refreshed })
        };
        const urls = urlApi();
        const viewer = controller({ photoStore, urlApi: urls });
        const unregister = registerEmployeePhotoViewerEvents(document, viewer);
        await viewer.open(avatar);
        const update = document.querySelector('[data-employee-photo-action="update"]');
        const status = document.querySelector('[data-employee-photo-viewer-status]');

        update.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(photoStore.refreshEmployeePhoto).toHaveBeenCalledWith('emp-1');
        expect(status.textContent).toMatch(/actualizada/i);
        expect(document.querySelector('[data-employee-photo-viewer-image]').src).toContain('blob:full-2');
        expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:full-1');
        expect(avatar.dataset.employeePhotoVersion).toBe('2');

        update.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(status.textContent).toMatch(/ya está actualizada/i);

        update.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(status.textContent).toMatch(/no se pudo actualizar/i);
        expect(viewer.isOpen()).toBe(true);
        unregister();
    });

    test('close button, backdrop, Escape, and inside clicks have correct focus behavior', async () => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        const viewer = controller({
            photoStore: { getEmployeePhoto: jest.fn().mockResolvedValue(record('paths')) },
            urlApi: urlApi()
        });
        const unregister = registerEmployeePhotoViewerEvents(document, viewer);

        avatar.click();
        await Promise.resolve();
        await Promise.resolve();
        let dialog = document.querySelector('[data-employee-photo-viewer]');
        dialog.querySelector('[data-employee-photo-viewer-content]').click();
        expect(document.querySelector('[data-employee-photo-viewer]')).toBe(dialog);
        dialog.querySelector('[data-employee-photo-viewer-backdrop]').click();
        expect(document.activeElement).toBe(avatar);

        avatar.click();
        await Promise.resolve();
        await Promise.resolve();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('[data-employee-photo-viewer]')).toBeNull();

        avatar.click();
        await Promise.resolve();
        await Promise.resolve();
        dialog = document.querySelector('[data-employee-photo-viewer]');
        dialog.querySelector('[data-employee-photo-viewer-close]').click();
        expect(document.querySelector('[data-employee-photo-viewer]')).toBeNull();
        unregister();
    });

    test('traps Tab and Shift+Tab inside the viewer, including one-focusable safety', async () => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        const viewer = controller({
            photoStore: { getEmployeePhoto: jest.fn().mockResolvedValue(record('focus')) },
            urlApi: urlApi()
        });
        const unregister = registerEmployeePhotoViewerEvents(document, viewer);
        await viewer.open(avatar);
        const dialog = document.querySelector('[data-employee-photo-viewer]');
        const close = dialog.querySelector('button[data-employee-photo-viewer-close]');
        const change = dialog.querySelector('[data-employee-photo-action="change"]');
        const remove = dialog.querySelector('[data-employee-photo-action="delete"]');

        remove.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(document.activeElement).toBe(close);

        close.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
        expect(document.activeElement).toBe(remove);

        change.disabled = true;
        remove.disabled = true;
        close.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(document.activeElement).toBe(close);
        unregister();
    });

    test('restores the original avatar after viewer Change is cancelled or closed with Escape', async () => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        const viewer = controller({
            photoStore: { getEmployeePhoto: jest.fn().mockResolvedValue(record('change-origin')) },
            urlApi: urlApi()
        });
        const acquisition = new EmployeePhotoAcquisitionController();
        const unregisterAcquisition = registerEmployeePhotoAcquisitionEvents(document, acquisition);
        const unregisterViewer = registerEmployeePhotoViewerEvents(document, viewer);

        await viewer.open(avatar);
        document.querySelector('[data-employee-photo-action="change"]').click();
        let sheet = document.querySelector('[data-employee-photo-dynamic-host] [data-employee-photo-sheet]');
        expect(viewer.isOpen()).toBe(false);
        sheet.querySelector('[data-employee-photo-action="cancel"]').click();
        expect(document.activeElement).toBe(avatar);

        await viewer.open(avatar);
        document.querySelector('[data-employee-photo-action="change"]').click();
        sheet = document.querySelector('[data-employee-photo-dynamic-host] [data-employee-photo-sheet]');
        sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.querySelector('[data-employee-photo-dynamic-host]')).toBeNull();
        expect(document.activeElement).toBe(avatar);

        await viewer.open(avatar);
        document.querySelector('[data-employee-photo-action="change"]').click();
        sheet = document.querySelector('[data-employee-photo-dynamic-host] [data-employee-photo-sheet]');
        sheet.click();
        expect(document.querySelector('[data-employee-photo-dynamic-host]')).toBeNull();
        expect(document.activeElement).toBe(avatar);

        unregisterViewer();
        unregisterAcquisition();
    });

    test('switching employees suppresses an older async result and revokes replacement URLs', async () => {
        const first = mountAvatar({ id: 'emp-1', name: 'Ana Uno' });
        const second = mountAvatar({ id: 'emp-2', name: 'Beto Dos' });
        markInteractive(first, 1);
        markInteractive(second, 2);
        const resolvers = {};
        const photoStore = { getEmployeePhoto: jest.fn(id => new Promise(resolve => { resolvers[id] = resolve; })) };
        const urls = urlApi();
        const viewer = controller({ photoStore, urlApi: urls });

        const older = viewer.open(first);
        const newer = viewer.open(second);
        resolvers['emp-2'](record('new', 2));
        await newer;
        resolvers['emp-1'](record('old', 1));
        await older;

        expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-employee-photo-viewer] img').alt).toBe('Foto de Beto Dos');
        viewer.close();
        expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:full-1');
    });

    test('close, avatar rerender, and cache-version change suppress pending images', async () => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        let resolveRead;
        const photoStore = { getEmployeePhoto: jest.fn(() => new Promise(resolve => { resolveRead = resolve; })) };
        const urls = urlApi();
        const viewer = controller({ photoStore, urlApi: urls });

        const closed = viewer.open(avatar);
        viewer.close();
        resolveRead(record('closed', 1));
        await closed;
        expect(urls.createObjectURL).not.toHaveBeenCalled();

        const rerendered = viewer.open(avatar);
        avatar.remove();
        resolveRead(record('detached', 1));
        await rerendered;
        expect(urls.createObjectURL).not.toHaveBeenCalled();

        const current = mountAvatar();
        markInteractive(current, 1);
        const replaced = viewer.open(current);
        current.dataset.employeePhotoVersion = '2';
        resolveRead(record('stale-version', 1));
        await replaced;
        expect(urls.createObjectURL).not.toHaveBeenCalled();
    });

    test('delegated registration is idempotent and removable', () => {
        const root = document.createElement('div');
        const avatar = document.createElement('span');
        avatar.dataset.employeePhotoViewerTrigger = '';
        root.append(avatar);
        const fake = { open: jest.fn(), close: jest.fn(), isOpen: jest.fn(() => false) };
        const cleanup = registerEmployeePhotoViewerEvents(root, fake);
        registerEmployeePhotoViewerEvents(root, fake);
        avatar.click();
        expect(fake.open).toHaveBeenCalledTimes(1);
        cleanup();
        avatar.click();
        expect(fake.open).toHaveBeenCalledTimes(1);
    });
});

describe('active floating-card viewer wiring', () => {
    test('registers the production viewer without replacing the camera acquisition action', () => {
        expect(CARD_SOURCE).toMatch(/registerEmployeePhotoViewerEvents\(document\)/);
        expect(CARD_SOURCE).toMatch(/EmployeePhotoAcquisitionUI/);
    });
});
