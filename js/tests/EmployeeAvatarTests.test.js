import fs from 'fs';
import path from 'path';
import { state } from '../modules/core/AppState.js';
import { eventBus } from '../modules/core/Events.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';
import {
    EmployeeAvatar,
    cleanupEmployeeAvatars,
    hydrateEmployeeAvatars
} from '../modules/ui/components/EmployeeAvatar.js';
import { EmployeeFloatingCard } from '../modules/ui/components/EmployeeFloatingCard.js';

const FLOATING_CARD_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/components/EmployeeFloatingCard.js'),
    'utf8'
);

function mountAvatar(employee = { id: 'emp-1', name: 'Franklin Henrriquez' }) {
    document.body.innerHTML = EmployeeAvatar(employee, { variant: 'compact' });
    return document.querySelector('[data-employee-avatar]');
}

function createUrlApi() {
    let next = 0;
    return {
        createObjectURL: jest.fn(() => `blob:employee-${++next}`),
        revokeObjectURL: jest.fn()
    };
}

describe('EmployeeAvatar rendering', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('renders a camera SVG fallback without initials and exposes button semantics', () => {
        document.body.innerHTML = EmployeeAvatar({
            id: 'emp\" onmouseover=\"alert(1)',
            name: '<img src=x onerror=alert(1)> Ana Pérez'
        });

        const avatar = document.querySelector('[data-employee-avatar]');
        expect(document.querySelector('img[src="x"]')).toBeNull();
        expect(avatar.tagName).toBe('BUTTON');
        expect(avatar.getAttribute('aria-label')).toContain('Agregar foto');
        expect(avatar.dataset.employeeId).toBe('emp\" onmouseover=\"alert(1)');
        expect(avatar.querySelector('[data-avatar-fallback] svg')).not.toBeNull();
        expect(avatar.querySelector('[data-avatar-fallback]').textContent.trim()).toBe('');
        expect(avatar.hasAttribute('data-employee-photo-acquisition-trigger')).toBe(true);
    });
});

describe('EmployeeAvatar hydration and object URL lifecycle', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('shows the cached thumbnail Blob after insertion', async () => {
        const avatar = mountAvatar();
        const blob = new Blob(['thumbnail'], { type: 'image/jpeg' });
        const photoStore = { getEmployeePhoto: jest.fn().mockResolvedValue({ thumbnailBlob: blob, version: 3 }) };
        const urlApi = createUrlApi();

        await hydrateEmployeeAvatars(document, { photoStore, urlApi });

        expect(photoStore.getEmployeePhoto).toHaveBeenCalledWith('emp-1');
        expect(urlApi.createObjectURL).toHaveBeenCalledWith(blob);
        expect(avatar.querySelector('[data-avatar-image]').getAttribute('src')).toBe('blob:employee-1');
        expect(avatar.querySelector('[data-avatar-image]').hidden).toBe(false);
        expect(avatar.querySelector('[data-avatar-fallback]').hidden).toBe(true);
    });

    test('synchronizes editor actions with photo availability', async () => {
        const avatar = mountAvatar();
        document.body.insertAdjacentHTML('beforeend', `
            <div data-employee-photo-editor-actions data-employee-id="emp-1">
                <button data-employee-photo-action="change">Agregar foto</button>
                <button data-employee-photo-action="adjust" hidden disabled>Ajustar</button>
                <button data-employee-photo-action="delete" hidden>Eliminar</button>
            </div>`);
        const photoStore = { getEmployeePhoto: jest.fn()
            .mockResolvedValueOnce({ thumbnailBlob: new Blob(['thumb'], { type: 'image/jpeg' }), version: 2 })
            .mockResolvedValueOnce(null) };
        const urls = createUrlApi();

        await hydrateEmployeeAvatars(document, { photoStore, urlApi: urls });
        const actions = document.querySelector('[data-employee-photo-editor-actions]');
        expect(actions.querySelector('[data-employee-photo-action="change"]').textContent).toBe('Reemplazar');
        expect(actions.querySelector('[data-employee-photo-action="adjust"]').hidden).toBe(false);
        expect(actions.querySelector('[data-employee-photo-action="adjust"]').disabled).toBe(true);
        expect(actions.querySelector('[data-employee-photo-action="delete"]').hidden).toBe(false);

        await hydrateEmployeeAvatars(avatar, { photoStore, urlApi: urls });
        expect(actions.querySelector('[data-employee-photo-action="change"]').textContent).toBe('Agregar foto');
        expect(actions.querySelector('[data-employee-photo-action="delete"]').hidden).toBe(true);
    });

    test.each([
        ['cache miss', null],
        ['cache read error', new Error('IndexedDB unavailable')]
    ])('keeps the camera fallback on %s', async (_label, outcome) => {
        const avatar = mountAvatar();
        const getEmployeePhoto = outcome instanceof Error
            ? jest.fn().mockRejectedValue(outcome)
            : jest.fn().mockResolvedValue(outcome);

        await hydrateEmployeeAvatars(document, {
            photoStore: { getEmployeePhoto },
            urlApi: createUrlApi()
        });

        expect(avatar.querySelector('[data-avatar-image]').hidden).toBe(true);
        expect(avatar.querySelector('[data-avatar-fallback]').hidden).toBe(false);
        expect(avatar.querySelector('[data-avatar-fallback] svg')).not.toBeNull();
        expect(avatar.hasAttribute('data-employee-photo-acquisition-trigger')).toBe(true);
    });

    test('revokes superseded and removed object URLs', async () => {
        const avatar = mountAvatar();
        const urlApi = createUrlApi();
        const photoStore = {
            getEmployeePhoto: jest.fn()
                .mockResolvedValueOnce({ thumbnailBlob: new Blob(['one'], { type: 'image/jpeg' }), version: 1 })
                .mockResolvedValueOnce({ thumbnailBlob: new Blob(['two'], { type: 'image/jpeg' }), version: 2 })
        };

        await hydrateEmployeeAvatars(document, { photoStore, urlApi });
        await hydrateEmployeeAvatars(document, { photoStore, urlApi });
        expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:employee-1');

        avatar.remove();
        cleanupEmployeeAvatars(document, { urlApi });
        expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:employee-2');
    });
});

describe('active employee floating card integration', () => {
    afterEach(() => {
        state.showFloatingCard = false;
        state.floatingCardEmployee = null;
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('renders the shared compact avatar beside the employee name', () => {
        state.showFloatingCard = true;
        state.floatingCardEmployee = { id: 'emp-1', name: 'Franklin Henrriquez', positions: [] };
        const card = new EmployeeFloatingCard({
            getFloatingCardSummary: () => ({
                employee: state.floatingCardEmployee,
                stats: { h7: 1, hw: 2, hm: 3, hp: 4, gross: 5 }
            })
        });

        document.body.innerHTML = card.render();

        expect(document.querySelector('.floating-card-header [data-employee-avatar]')).not.toBeNull();
        expect(document.querySelector('.floating-card-title').textContent).toBe('Franklin Henrriquez');
        expect(document.querySelector('.floating-card-title').textContent).not.toContain('👤');
        expect(FLOATING_CARD_SOURCE).toMatch(/eventBus\.on\(\s*['"]render:complete['"]/);
    });

    test('hydrates through the real render-complete lifecycle', async () => {
        mountAvatar();
        indexedDBService.getEmployeePhoto.mockResolvedValue({
            thumbnailBlob: new Blob(['cached'], { type: 'image/jpeg' }),
            version: 1
        });
        const originalCreate = URL.createObjectURL;
        const originalRevoke = URL.revokeObjectURL;
        URL.createObjectURL = jest.fn(() => 'blob:lifecycle');
        URL.revokeObjectURL = jest.fn();

        eventBus.emit('render:complete', { timestamp: Date.now() });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(indexedDBService.getEmployeePhoto).toHaveBeenCalledWith('emp-1');
        expect(document.querySelector('[data-avatar-image]').getAttribute('src')).toBe('blob:lifecycle');

        cleanupEmployeeAvatars(document);
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    });
});
