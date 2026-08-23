import fs from 'fs';
import path from 'path';
import { state } from '../modules/core/AppState.js';
import { processEmployeePhoto } from '../modules/features/employees/EmployeePhotoProcessor.js';
import { indexedDBService } from '../modules/services/IndexedDBService.js';
import { employeePhotoService } from '../modules/services/EmployeePhotoService.js';
import {
    EmployeePhotoAcquisitionController,
    EmployeePhotoAcquisitionUI,
    registerEmployeePhotoAcquisitionEvents
} from '../modules/ui/components/EmployeePhotoAcquisition.js';
import { EmployeeFloatingCard } from '../modules/ui/components/EmployeeFloatingCard.js';

const CARD_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../modules/ui/components/EmployeeFloatingCard.js'), 'utf8'
);
const STYLES_SOURCE = fs.readFileSync(
    path.resolve(__dirname, '../../css/styles.css'), 'utf8'
);

function mountUI(root = document.body) {
    root.innerHTML = `<div class="floating-card">${EmployeePhotoAcquisitionUI({
        id: 'emp-1', name: 'Franklin Henrriquez'
    })}</div>`;
    return {
        badge: root.querySelector('[data-employee-avatar]'),
        sheet: root.querySelector('[data-employee-photo-sheet]'),
        camera: root.querySelector('[data-employee-photo-input="camera"]'),
        gallery: root.querySelector('[data-employee-photo-input="gallery"]')
    };
}

function setFile(input, file) {
    Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] });
}

describe('Employee photo acquisition markup', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    test('offers take photo, gallery, and cancel actions with distinct inputs', () => {
        const { badge, sheet, camera, gallery } = mountUI();
        expect(badge.getAttribute('aria-label')).toContain('Franklin Henrriquez');
        expect(sheet.getAttribute('role')).toBe('dialog');
        expect([...sheet.querySelectorAll('button')].map(button => button.textContent.trim()))
            .toEqual(['Tomar foto', 'Elegir de la galería', 'Cancelar']);
        expect(camera.getAttribute('accept')).toBe('image/*');
        expect(camera.getAttribute('capture')).toBe('environment');
        expect(gallery.getAttribute('accept')).toBe('image/*');
        expect(gallery.hasAttribute('capture')).toBe(false);
    });

    test('escapes employee values in labels and data attributes', () => {
        document.body.innerHTML = EmployeePhotoAcquisitionUI({
            id: 'emp\" data-bad=\"yes', name: '<img src=x> Ana'
        });
        expect(document.querySelector('img[src="x"]')).toBeNull();
        expect(document.querySelector('[data-employee-photo-sheet]').dataset.employeeId)
            .toBe('emp\" data-bad=\"yes');
    });

    test('keeps the hidden action sheet out of layout despite its flex display', () => {
        expect(STYLES_SOURCE).toMatch(
            /\.employee-photo-sheet\[hidden\]\s*{\s*display:\s*none\s*;?\s*}/
        );
    });
});

describe('EmployeePhotoAcquisitionController', () => {
    afterEach(() => {
        state.showFloatingCard = false;
        document.body.innerHTML = '';
        jest.clearAllMocks();
    });

    test('opens and cancels the mobile sheet without closing the floating card', () => {
        const { badge, sheet } = mountUI();
        const controller = new EmployeePhotoAcquisitionController();
        state.showFloatingCard = true;
        controller.handleAction('open', badge);
        expect(sheet.hidden).toBe(false);
        controller.handleAction('cancel', sheet.querySelector('[data-employee-photo-action="cancel"]'));
        expect(sheet.hidden).toBe(true);
        expect(document.activeElement).toBe(badge);
        expect(state.showFloatingCard).toBe(true);
    });

    test('traps keyboard focus, closes on Escape, restores focus, and tears down dynamic sheets', () => {
        const trigger = document.createElement('button');
        trigger.dataset.employeeId = 'emp-1';
        trigger.dataset.employeeName = 'Franklin Henrriquez';
        document.body.append(trigger);
        const controller = new EmployeePhotoAcquisitionController();
        controller.handleAction('change', trigger);
        const sheet = document.querySelector('[data-employee-photo-dynamic-host] [data-employee-photo-sheet]');
        const camera = sheet.querySelector('[data-employee-photo-action="camera"]');
        const gallery = sheet.querySelector('[data-employee-photo-action="gallery"]');
        const cancel = sheet.querySelector('[data-employee-photo-action="cancel"]');
        expect(sheet.tabIndex).toBe(-1);
        expect(document.activeElement).toBe(camera);

        cancel.focus();
        controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Tab' }), sheet);
        expect(document.activeElement).toBe(camera);
        camera.focus();
        controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }), sheet);
        expect(document.activeElement).toBe(cancel);

        gallery.disabled = true;
        cancel.disabled = true;
        camera.focus();
        controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Tab' }), sheet);
        expect(document.activeElement).toBe(camera);

        controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }), sheet);
        expect(document.querySelector('[data-employee-photo-dynamic-host]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    test('contains focus on the modal fallback while processing disables every action', () => {
        const outside = document.createElement('button');
        const trigger = document.createElement('button');
        trigger.dataset.employeeId = 'emp-1';
        trigger.dataset.employeeName = 'Franklin Henrriquez';
        document.body.append(outside, trigger);
        const controller = new EmployeePhotoAcquisitionController();
        controller.handleAction('change', trigger);
        const sheet = document.querySelector('[data-employee-photo-dynamic-host] [data-employee-photo-sheet]');
        sheet.querySelectorAll('button').forEach(button => { button.disabled = true; });
        controller.processing.add(sheet);

        outside.focus();
        controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));
        expect(document.activeElement).toBe(sheet);
        controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
        expect(document.activeElement).toBe(sheet);

        controller.processing.delete(sheet);
        controller.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }), sheet);
        expect(document.querySelector('[data-employee-photo-dynamic-host]')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    test('requires confirmation before deleting remote and local variants', async () => {
        const { badge } = mountUI();
        const photoStore = { deleteEmployeePhoto: jest.fn().mockResolvedValue(true) };
        const hydrateAvatars = jest.fn().mockResolvedValue(undefined);
        const confirmDelete = jest.fn()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        const controller = new EmployeePhotoAcquisitionController({ photoStore, hydrateAvatars, confirmDelete });
        const deleteButton = document.createElement('button');
        deleteButton.dataset.employeePhotoAction = 'delete';
        deleteButton.dataset.employeeId = 'emp-1';
        deleteButton.dataset.employeeName = 'Franklin Henrriquez';
        document.body.append(deleteButton);

        controller.handleAction('delete', deleteButton);
        await Promise.resolve();
        expect(photoStore.deleteEmployeePhoto).not.toHaveBeenCalled();

        controller.handleAction('delete', deleteButton);
        await Promise.resolve();
        await Promise.resolve();

        expect(photoStore.deleteEmployeePhoto).toHaveBeenCalledWith('emp-1');
        expect(confirmDelete).toHaveBeenCalledTimes(2);
        expect(hydrateAvatars).toHaveBeenCalledWith(badge);
    });

    test('uses production cache defaults, saves processed Blobs, closes, and refreshes', async () => {
        const { badge, sheet, camera } = mountUI();
        document.body.insertAdjacentHTML('beforeend', `
            <span data-employee-avatar data-employee-id="emp-1"></span>
            <span data-employee-avatar data-employee-id="emp-unrelated"></span>`);
        const matchingAvatar = document.querySelector('[data-employee-avatar][data-employee-id="emp-1"]');
        const unrelatedAvatar = document.querySelector('[data-employee-avatar][data-employee-id="emp-unrelated"]');
        const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
        const processed = {
            thumbnailBlob: new Blob(['thumb'], { type: 'image/jpeg' }),
            optimizedBlob: new Blob(['full'], { type: 'image/jpeg' }),
            width: 640, height: 480
        };
        const processPhoto = jest.fn().mockResolvedValue(processed);
        const hydrateAvatars = jest.fn().mockResolvedValue(undefined);
        indexedDBService.replaceEmployeePhoto.mockResolvedValue({ ...processed, version: 2 });
        const controller = new EmployeePhotoAcquisitionController({ processPhoto, hydrateAvatars });
        const productionController = new EmployeePhotoAcquisitionController();
        expect(productionController.processPhoto).toBe(processEmployeePhoto);
        expect(productionController.photoStore).toBe(employeePhotoService);
        controller.handleAction('open', badge);
        setFile(camera, file);

        await controller.handleInput(camera);

        expect(processPhoto).toHaveBeenCalledWith(file);
        expect(indexedDBService.replaceEmployeePhoto).toHaveBeenCalledWith('emp-1', processed);
        expect(hydrateAvatars).toHaveBeenCalledTimes(2);
        expect(hydrateAvatars).toHaveBeenCalledWith(matchingAvatar);
        expect(hydrateAvatars).not.toHaveBeenCalledWith(document);
        expect(hydrateAvatars).not.toHaveBeenCalledWith(unrelatedAvatar);
        expect(sheet.hidden).toBe(true);
        expect(camera.value).toBe('');
    });

    test('ignores cancellation and prevents duplicate submissions while busy', async () => {
        const { badge, sheet, camera, gallery } = mountUI();
        let finish;
        const processPhoto = jest.fn(() => new Promise(resolve => { finish = resolve; }));
        const photoStore = { replaceEmployeePhoto: jest.fn().mockResolvedValue({ version: 1 }) };
        const controller = new EmployeePhotoAcquisitionController({
            processPhoto, photoStore, hydrateAvatars: jest.fn()
        });
        controller.handleAction('open', badge);
        setFile(camera, null);
        await controller.handleInput(camera);
        expect(processPhoto).not.toHaveBeenCalled();

        const file = new File(['photo'], 'same.jpg', { type: 'image/jpeg' });
        setFile(camera, file);
        setFile(gallery, file);
        const first = controller.handleInput(camera);
        const duplicate = controller.handleInput(gallery);
        expect(processPhoto).toHaveBeenCalledTimes(1);
        expect(sheet.getAttribute('aria-busy')).toBe('true');
        expect([...sheet.querySelectorAll('button')].every(button => button.disabled)).toBe(true);
        finish({ thumbnailBlob: file, optimizedBlob: file, width: 10, height: 10 });
        await Promise.all([first, duplicate]);
    });

    test('keeps the previous cache on error and permits the same file retry', async () => {
        const { badge, sheet, camera } = mountUI();
        const file = new File(['photo'], 'same.jpg', { type: 'image/jpeg' });
        const result = { thumbnailBlob: file, optimizedBlob: file, width: 10, height: 10 };
        const processPhoto = jest.fn().mockResolvedValue(result);
        const photoStore = {
            replaceEmployeePhoto: jest.fn()
                .mockRejectedValueOnce(new Error('cache write failed'))
                .mockResolvedValue({ ...result, version: 2 })
        };
        const hydrateAvatars = jest.fn();
        const controller = new EmployeePhotoAcquisitionController({ processPhoto, photoStore, hydrateAvatars });
        controller.handleAction('open', badge);
        setFile(camera, file);

        await controller.handleInput(camera);
        expect(photoStore.replaceEmployeePhoto).toHaveBeenCalledTimes(1);
        expect(hydrateAvatars).not.toHaveBeenCalled();
        expect(sheet.hidden).toBe(false);
        expect(sheet.querySelector('[data-employee-photo-error]').hidden).toBe(false);
        expect(camera.value).toBe('');

        setFile(camera, file);
        await controller.handleInput(camera);
        expect(processPhoto).toHaveBeenCalledTimes(2);
        expect(photoStore.replaceEmployeePhoto).toHaveBeenCalledTimes(2);
        expect(sheet.hidden).toBe(true);
    });

    test('a newer capture supersedes an older rerender and employeeId is immutable after start', async () => {
        const oldRoot = document.createElement('div');
        const newRoot = document.createElement('div');
        document.body.append(oldRoot, newRoot);
        const oldUI = mountUI(oldRoot);
        const newUI = mountUI(newRoot);
        const avatar = document.createElement('span');
        avatar.dataset.employeeAvatar = '';
        avatar.dataset.employeeId = 'emp-1';
        document.body.append(avatar);

        let resolveOld;
        let resolveNew;
        const oldResult = { marker: 'old' };
        const newResult = { marker: 'new' };
        const processPhoto = jest.fn(file => new Promise(resolve => {
            if (file.name === 'old.jpg') resolveOld = () => resolve(oldResult);
            else resolveNew = () => resolve(newResult);
        }));
        const photoStore = { replaceEmployeePhoto: jest.fn().mockResolvedValue({ version: 2 }) };
        const hydrateAvatars = jest.fn();
        const controller = new EmployeePhotoAcquisitionController({ processPhoto, photoStore, hydrateAvatars });
        setFile(oldUI.camera, new File(['old'], 'old.jpg', { type: 'image/jpeg' }));
        setFile(newUI.camera, new File(['new'], 'new.jpg', { type: 'image/jpeg' }));

        const oldOperation = controller.handleInput(oldUI.camera);
        oldUI.sheet.dataset.employeeId = 'emp-retargeted';
        const newOperation = controller.handleInput(newUI.camera);
        oldRoot.remove();
        resolveNew();
        await newOperation;
        resolveOld();
        await oldOperation;

        expect(photoStore.replaceEmployeePhoto).toHaveBeenCalledTimes(1);
        expect(photoStore.replaceEmployeePhoto).toHaveBeenCalledWith('emp-1', newResult);
        expect(hydrateAvatars).toHaveBeenCalledTimes(2);
        expect(hydrateAvatars).toHaveBeenCalledWith(avatar);
    });

    test('registers delegated listeners idempotently and cleans them up', () => {
        const root = document.createElement('div');
        const { badge } = mountUI(root);
        const controller = { handleAction: jest.fn(), handleInput: jest.fn() };
        const cleanup = registerEmployeePhotoAcquisitionEvents(root, controller);
        registerEmployeePhotoAcquisitionEvents(root, controller);
        badge.click();
        expect(controller.handleAction).toHaveBeenCalledTimes(1);
        expect(controller.handleAction).toHaveBeenCalledWith('open', badge);
        cleanup();
        badge.click();
        expect(controller.handleAction).toHaveBeenCalledTimes(1);
    });
});

describe('active floating card acquisition wiring', () => {
    afterEach(() => {
        state.showFloatingCard = false;
        state.floatingCardEmployee = null;
        document.body.innerHTML = '';
    });

    test('renders the shared camera fallback and action sheet through the active component', () => {
        state.showFloatingCard = true;
        state.floatingCardEmployee = { id: 'emp-1', name: 'Franklin Henrriquez', positions: [] };
        const card = new EmployeeFloatingCard({ getFloatingCardSummary: () => ({
            employee: state.floatingCardEmployee,
            stats: { h7: 1, hw: 2, hm: 3, hp: 4, gross: 5 }
        }) });
        document.body.innerHTML = card.render();
        expect(document.querySelector('.floating-card-header [data-employee-photo-acquisition-trigger] svg')).not.toBeNull();
        expect(document.querySelector('.floating-card [data-employee-photo-sheet]')).not.toBeNull();
        expect(CARD_SOURCE).toMatch(/registerEmployeePhotoAcquisitionEvents\(document\)/);
    });
});
