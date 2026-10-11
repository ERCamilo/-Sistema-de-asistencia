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

function finishImage(viewer, event = 'load') {
    viewer.active?.pendingPhoto?.image.dispatchEvent(new Event(event));
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

    function controller({ autoLoad = true, ...options } = {}) {
        const instance = new EmployeePhotoViewerController(options);
        // jsdom does not decode Blob URLs. Simulate the browser's successful load.
        if (autoLoad) for (const method of ['open', 'retry']) {
            const action = instance[method].bind(instance);
            instance[method] = async (...args) => {
                const result = await action(...args); finishImage(instance); return result;
            };
        }
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
        expect(viewer.isOpen()).toBe(true);
        expect(document.querySelector('[data-employee-photo-viewer-status]').textContent).toMatch(/original.*reintentar/i);
        if (!outcome) expect(avatar.getAttribute('role')).toBe('button');
    });

    test('a failed original download keeps the cached avatar available for reopening', async () => {
        const avatar = mountAvatar();
        const cached = { ...record('cached', 1), optimizedBlob: null };
        await hydrateEmployeeAvatars(document, {
            photoStore: { getEmployeePhoto: jest.fn().mockResolvedValue(cached) },
            urlApi: urlApi('thumb')
        });
        const image = avatar.querySelector('img');
        const source = image.src;
        const photoStore = {
            getEmployeeOriginal: jest.fn().mockResolvedValueOnce(cached)
                .mockResolvedValueOnce(record('recovered', 1))
        };
        const viewer = controller({ photoStore, urlApi: urlApi() });
        expect(await viewer.open(avatar)).toBe(false);
        expect(image.src).toBe(source);
        expect(image.hidden).toBe(false);
        expect(avatar.hasAttribute('data-employee-photo-viewer-trigger')).toBe(true);
        const dialog = document.querySelector('[data-employee-photo-viewer]');
        expect(await viewer.retry()).toBe(true);
        expect(document.querySelector('[data-employee-photo-viewer]')).toBe(dialog);
    });

    test('image decode error keeps an explanatory viewer and revokes the failed URL', async () => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        const urls = urlApi();
        const viewer = controller({
            autoLoad: false,
            photoStore: { getEmployeePhoto: jest.fn().mockResolvedValue(record('broken')) },
            urlApi: urls
        });
        await viewer.open(avatar);

        finishImage(viewer, 'error');

        expect(viewer.isOpen()).toBe(true);
        expect(document.querySelector('[data-employee-photo-viewer-retry]').hidden).toBe(false);
        expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:full-1');
    });

    test('a single explicit retry keeps the same dialog and prevents repeated clicks during its read', async () => {
        const avatar = mountAvatar(); markInteractive(avatar);
        let complete;
        const photoStore = { getEmployeeOriginal: jest.fn().mockResolvedValueOnce(null)
            .mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })) };
        const viewer = controller({ photoStore, urlApi: urlApi(), autoLoad: false });
        const cleanup = registerEmployeePhotoViewerEvents(document, viewer);
        await viewer.open(avatar);
        const dialog = document.querySelector('[data-employee-photo-viewer]');
        const retry = dialog.querySelector('[data-employee-photo-viewer-retry]');
        retry.focus(); retry.click(); retry.click();
        expect(photoStore.getEmployeeOriginal).toHaveBeenCalledTimes(2);
        expect(retry.disabled).toBe(true);
        complete(record('recovered')); await Promise.resolve(); await Promise.resolve();
        finishImage(viewer);
        expect(document.querySelector('[data-employee-photo-viewer]')).toBe(dialog);
        expect(retry.hidden).toBe(true);
        expect(document.activeElement.dataset.employeePhotoAction).toBe('update');
        expect(dialog.querySelector('img').hidden).toBe(false);
        cleanup();
    });

    test('a failed refresh decode preserves the visible image and permits an explicit retry', async () => {
        const avatar = mountAvatar(); markInteractive(avatar);
        const urls = urlApi();
        const viewer = controller({ photoStore: {
            getEmployeeOriginal: jest.fn().mockResolvedValue(record('good')),
            getEmployeePhoto: jest.fn().mockResolvedValue(record('bad', 2)),
            refreshEmployeePhoto: jest.fn().mockResolvedValue({ status: 'updated', record: record('bad', 2) })
        }, urlApi: urls });
        await viewer.open(avatar);
        const previous = document.querySelector('[data-employee-photo-viewer-image]');
        await viewer.refresh();
        expect(document.querySelector('[data-employee-photo-viewer-image]')).toBe(previous);
        expect(urls.revokeObjectURL).not.toHaveBeenCalledWith('blob:full-1');
        const pendingUrl = viewer.active.pendingPhoto.url;
        finishImage(viewer, 'error');
        expect(document.querySelector('[data-employee-photo-viewer-image]')).toBe(previous);
        expect(previous.src).toContain('blob:full-1');
        expect(urls.revokeObjectURL).toHaveBeenCalledWith(pendingUrl);
        expect(document.querySelector('[data-employee-photo-viewer-status]').textContent).toMatch(/no se pudo mostrar/i);
        expect(document.querySelector('[data-employee-photo-viewer-retry]').hidden).toBe(false);
    });

    test('Actualizar can display a current original after an earlier missing-original error', async () => {
        const avatar = mountAvatar(); markInteractive(avatar);
        const viewer = controller({ photoStore: {
            getEmployeeOriginal: jest.fn().mockResolvedValue(null),
            getEmployeePhoto: jest.fn().mockResolvedValue(record('current')),
            refreshEmployeePhoto: jest.fn().mockResolvedValue({ status: 'current', record: record('current') })
        }, urlApi: urlApi() });
        await viewer.open(avatar); expect(await viewer.refresh()).toBe(true); finishImage(viewer);
        expect(document.querySelector('[data-employee-photo-viewer-image]').hidden).toBe(false);
        expect(document.querySelector('[data-employee-photo-viewer-retry]').hidden).toBe(true);
        expect(document.querySelector('[data-employee-photo-viewer-status]').textContent).toMatch(/ya está actualizada/i);
    });

    test('closing while an image decodes revokes its URL and ignores later load/error events', async () => {
        const avatar = mountAvatar(); markInteractive(avatar);
        const urls = urlApi();
        const viewer = controller({ photoStore: { getEmployeeOriginal: jest.fn().mockResolvedValue(record('late')) }, urlApi: urls, autoLoad: false });
        await viewer.open(avatar); const image = viewer.active.pendingPhoto.image;
        viewer.close(); image.dispatchEvent(new Event('load')); image.dispatchEvent(new Event('error'));
        expect(urls.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(viewer.isOpen()).toBe(false); expect(document.activeElement).toBe(avatar);
    });

    test('original version changing during decode explains the conflict instead of showing stale bytes', async () => {
        const avatar = mountAvatar(); markInteractive(avatar);
        const urls = urlApi();
        const viewer = controller({ photoStore: { getEmployeeOriginal: jest.fn().mockResolvedValue(record('old')) }, urlApi: urls, autoLoad: false });
        await viewer.open(avatar); avatar.dataset.employeePhotoVersion = '2'; finishImage(viewer);
        expect(viewer.isOpen()).toBe(true);
        expect(document.querySelector('[data-employee-photo-viewer-status]').textContent).toMatch(/cambió/i);
        expect(document.querySelector('[data-employee-photo-viewer-image]').hidden).toBe(true);
        expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:full-1');
    });

    test('an unavailable original while offline leaves thumbnail and announces how to recover', async () => {
        const avatar = mountAvatar(); markInteractive(avatar);
        const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const photoStore = { getEmployeeOriginal: jest.fn().mockResolvedValue({ thumbnailBlob: new Blob(['thumb']), version: 1 }) };
        const viewer = controller({ photoStore, urlApi: urlApi() });
        try {
            await viewer.open(avatar);
            expect(document.querySelector('[data-employee-photo-viewer-status]').textContent).toMatch(/Sin conexión.*vuelva la conexión/);
            await Promise.resolve(); await Promise.resolve();
            expect(photoStore.getEmployeeOriginal).toHaveBeenCalledTimes(1);
            expect(avatar.hasAttribute('data-employee-photo-viewer-trigger')).toBe(true);
        } finally { online.mockRestore(); }
    });

    test('URL creation failure stays readable and retry can recover', async () => {
        const avatar = mountAvatar(); markInteractive(avatar);
        const urls = urlApi(); urls.createObjectURL.mockImplementationOnce(() => { throw Error('Unavailable'); });
        const viewer = controller({ photoStore: { getEmployeeOriginal: jest.fn().mockResolvedValue(record('ok')) }, urlApi: urls });
        expect(await viewer.open(avatar)).toBe(false);
        expect(viewer.isOpen()).toBe(true);
        expect(await viewer.retry()).toBe(true);
        expect(document.querySelector('[data-employee-photo-viewer-image]').hidden).toBe(false);
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
        finishImage(viewer);
        expect(photoStore.refreshEmployeePhoto).toHaveBeenCalledWith('emp-1');
        expect(status.textContent).toMatch(/actualizada/i);
        expect(document.querySelector('[data-employee-photo-viewer-image]').src).toContain('blob:full-3');
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

    test.each(['pending', 'superseded'])('refresh reports %s without claiming that a saved photo was rejected', async state => {
        const avatar = mountAvatar();
        markInteractive(avatar, 1);
        const initial = record('initial', 1);
        const viewer = controller({
            photoStore: {
                getEmployeeOriginal: jest.fn().mockResolvedValue(initial),
                refreshEmployeePhoto: jest.fn().mockResolvedValue({ status: state, record: initial })
            }, urlApi: urlApi()
        });
        await viewer.open(avatar);
        const image = document.querySelector('[data-employee-photo-viewer-image]');
        const source = image.src;
        expect(await viewer.refresh()).toBe(false);
        expect(document.querySelector('[data-employee-photo-viewer-status]').textContent).not.toMatch(/no se pudo/i);
        expect(image.src).toBe(source);
        expect(viewer.isOpen()).toBe(true);
        expect(document.querySelector('[data-employee-photo-action="update"]').disabled).toBe(false);
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
