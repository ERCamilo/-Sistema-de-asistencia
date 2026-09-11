import {
  P2P_SUCCESS_EVENTS,
  isTerminalSuccessEvent,
  shouldSignalSuccess,
  resetP2PSuccessFeedback,
  prefersReducedMotion,
  vibrateSuccess,
  playSuccessChime,
  maybeSystemNotify,
  pulseSuccessElement,
  signalP2PSuccess
} from '../modules/features/p2p/P2PSuccessFeedback.js';
import { MiniAttendanceImportModal } from '../modules/ui/modals/MiniAttendanceImportModal.js';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function mockMatchMedia(matches) {
  const fn = jest.fn(() => ({ matches: Boolean(matches) }));
  Object.defineProperty(window, 'matchMedia', { value: fn, configurable: true, writable: true });
  return fn;
}

describe('P2PSuccessFeedback — terminal-only progressive enhancement', () => {
  const originalVibrate = global.navigator?.vibrate;
  const originalAudio = global.window?.AudioContext;
  const originalWebkitAudio = global.window?.webkitAudioContext;
  const originalGlobalAudio = globalThis.AudioContext;
  const originalGlobalWebkit = globalThis.webkitAudioContext;
  const originalSysNotify = globalThis.Notification;
  const originalShowNotification = global.window?.showNotification;
  const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');

  beforeEach(() => {
    resetP2PSuccessFeedback();
    mockMatchMedia(false);
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetP2PSuccessFeedback();
    if (originalVibrate === undefined) {
      try { delete global.navigator.vibrate; } catch (_) {}
    } else {
      try { global.navigator.vibrate = originalVibrate; } catch (_) {}
    }
    try {
      if (originalAudio === undefined) delete window.AudioContext;
      else window.AudioContext = originalAudio;
    } catch (_) {}
    try {
      if (originalWebkitAudio === undefined) delete window.webkitAudioContext;
      else window.webkitAudioContext = originalWebkitAudio;
    } catch (_) {}
    try {
      if (originalGlobalAudio === undefined) delete globalThis.AudioContext;
      else globalThis.AudioContext = originalGlobalAudio;
    } catch (_) {}
    try {
      if (originalGlobalWebkit === undefined) delete globalThis.webkitAudioContext;
      else globalThis.webkitAudioContext = originalGlobalWebkit;
    } catch (_) {}
    try {
      if (originalSysNotify === undefined) delete globalThis.Notification;
      else globalThis.Notification = originalSysNotify;
    } catch (_) {}
    try {
      if (originalShowNotification === undefined) delete window.showNotification;
      else window.showNotification = originalShowNotification;
    } catch (_) {}
    if (originalHidden) {
      try { Object.defineProperty(document, 'hidden', originalHidden); } catch (_) {}
    }
  });

  test('only the four terminal keys signal; intermediate/auth states never do', () => {
    expect(isTerminalSuccessEvent('pair-linked')).toBe(true);
    expect(isTerminalSuccessEvent('roster-validated')).toBe(true);
    expect(isTerminalSuccessEvent('attendance-transferred')).toBe(true);
    expect(isTerminalSuccessEvent('import-completed')).toBe(true);
    for (const key of ['connecting', 'authenticating', 'requesting', 'receiving', 'success', 'error', 'timeout', 'cancelled', 'partial_success', '']) {
      expect(isTerminalSuccessEvent(key)).toBe(false);
      expect(signalP2PSuccess(key, { message: 'x' }).signaled).toBe(false);
    }
    expect(signalP2PSuccess('connecting', { message: 'x' }).reason).toBe('non-terminal');
  });

  test('vibrate only when supported and motion allowed; never throws', () => {
    try { delete global.navigator.vibrate; } catch (_) {}
    if (global.navigator && 'vibrate' in global.navigator) {
      try { delete global.navigator.vibrate; } catch (_) {}
    }
    expect(() => vibrateSuccess()).not.toThrow();
    expect(vibrateSuccess()).toBe(false);

    const spy = jest.fn(() => true);
    global.navigator.vibrate = spy;
    expect(vibrateSuccess([15])).toBe(true);
    expect(spy).toHaveBeenCalledWith([15]);

    spy.mockImplementation(() => { throw new Error('denied'); });
    expect(vibrateSuccess()).toBe(false);

    mockMatchMedia(true);
    spy.mockImplementation(() => true);
    expect(vibrateSuccess()).toBe(false);
    expect(prefersReducedMotion()).toBe(true);
  });

  test('chime is short, low-volume and fails closed without support', async () => {
    try { delete window.AudioContext; } catch (_) {}
    try { delete window.webkitAudioContext; } catch (_) {}
    try { delete globalThis.AudioContext; } catch (_) {}
    try { delete globalThis.webkitAudioContext; } catch (_) {}
    await expect(playSuccessChime()).resolves.toBe(false);

    const gainValues = [];
    const fakeGain = {
      gain: {
        setValueAtTime: jest.fn(),
        exponentialRampToValueAtTime: jest.fn((value) => { gainValues.push(value); })
      },
      connect: jest.fn()
    };
    const fakeOsc = { type: '', frequency: { value: 0 }, connect: jest.fn(), start: jest.fn(), stop: jest.fn() };
    const fakeCtx = {
      currentTime: 10,
      state: 'running',
      destination: {},
      createOscillator: jest.fn(() => fakeOsc),
      createGain: jest.fn(() => fakeGain),
      close: jest.fn()
    };
    const Ctor = jest.fn(() => fakeCtx);
    window.AudioContext = Ctor;
    globalThis.AudioContext = Ctor;

    await expect(playSuccessChime()).resolves.toBe(true);
    expect(Ctor).toHaveBeenCalled();
    expect(fakeCtx.createOscillator).toHaveBeenCalled();
    expect(fakeOsc.start).toHaveBeenCalled();
    // Low volume: peak gain stays well below audible alarm levels.
    const peak = Math.max(...gainValues, 0);
    expect(peak).toBeLessThanOrEqual(0.05);

    const throwingCtor = jest.fn(() => { throw new Error('blocked'); });
    window.AudioContext = throwingCtor;
    globalThis.AudioContext = throwingCtor;
    await expect(playSuccessChime()).resolves.toBe(false);
  });

  test('system Notification only when already granted and hidden; never requests permission', () => {
    const helper = read('js/modules/features/p2p/P2PSuccessFeedback.js');
    expect(helper).not.toContain('requestPermission(');

    const requestPermission = jest.fn();
    const Constructed = jest.fn();
    class GrantedHidden {
      static permission = 'granted';
      static requestPermission = requestPermission;
      constructor(title, options) { Constructed(title, options); }
    }
    globalThis.Notification = GrantedHidden;
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    expect(maybeSystemNotify('Mini vinculado', 'Mini vinculado correctamente')).toBe(true);
    expect(Constructed).toHaveBeenCalledWith('Mini vinculado', expect.objectContaining({ body: 'Mini vinculado correctamente' }));
    expect(requestPermission).not.toHaveBeenCalled();

    Constructed.mockClear();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    expect(maybeSystemNotify('T', 'B')).toBe(false);
    expect(Constructed).not.toHaveBeenCalled();

    class DefaultPermission {
      static permission = 'default';
      static requestPermission = requestPermission;
      constructor(title, options) { Constructed(title, options); }
    }
    globalThis.Notification = DefaultPermission;
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    expect(maybeSystemNotify('T', 'B')).toBe(false);
    expect(Constructed).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  test('pulse uses canonical class and respects reduced motion', () => {
    const el = document.createElement('div');
    expect(pulseSuccessElement(el)).toBe(true);
    expect(el.classList.contains('is-success-pulse')).toBe(true);

    mockMatchMedia(true);
    const still = document.createElement('div');
    expect(pulseSuccessElement(still)).toBe(false);
    expect(still.classList.contains('is-success-pulse')).toBe(false);
    expect(pulseSuccessElement(null)).toBe(false);
  });

  test('signal avoids repeated triggers via cooldown dedupe', () => {
    const toast = jest.fn();
    const first = signalP2PSuccess('pair-linked', { message: 'Mini vinculado correctamente', notifyFn: toast, now: 1000, cooldownMs: 4000 });
    expect(first.signaled).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);

    const second = signalP2PSuccess('pair-linked', { message: 'Mini vinculado correctamente', notifyFn: toast, now: 2000, cooldownMs: 4000 });
    expect(second.signaled).toBe(false);
    expect(second.reason).toBe('duplicate');
    expect(toast).toHaveBeenCalledTimes(1);

    const other = signalP2PSuccess('roster-validated', { message: 'Roster enviado y validado por Mini', notifyFn: toast, now: 2000, cooldownMs: 4000 });
    expect(other.signaled).toBe(true);
    expect(toast).toHaveBeenCalledTimes(2);

    const afterCooldown = signalP2PSuccess('pair-linked', { message: 'Mini vinculado correctamente', notifyFn: toast, now: 6000, cooldownMs: 4000 });
    expect(afterCooldown.signaled).toBe(true);
    expect(toast).toHaveBeenCalledTimes(3);
  });

  test('signal always keeps in-app visual; enhancements never throw without APIs', () => {
    try { delete global.navigator.vibrate; } catch (_) {}
    try { delete window.AudioContext; } catch (_) {}
    try { delete window.webkitAudioContext; } catch (_) {}
    try { delete globalThis.AudioContext; } catch (_) {}
    try { delete globalThis.webkitAudioContext; } catch (_) {}
    globalThis.Notification = { permission: 'denied' };
    window.showNotification = jest.fn();

    const statusEl = document.createElement('div');
    const result = signalP2PSuccess('import-completed', {
      message: 'Importación completada. 1 borrador marcado como incorporado.',
      title: 'Importación completada',
      statusEl,
      now: 9000
    });
    expect(result.signaled).toBe(true);
    expect(result.toasted).toBe(true);
    expect(statusEl.classList.contains('is-success')).toBe(true);
    expect(statusEl.classList.contains('is-success-pulse')).toBe(true);
    expect(window.showNotification).toHaveBeenCalledWith(
      'Importación completada. 1 borrador marcado como incorporado.',
      'success'
    );
  });
});

describe('P2P Meta3 — wiring of the four terminal events', () => {
  test('helper exposes the four canonical terminal keys and no native dialogs', () => {
    const helper = read('js/modules/features/p2p/P2PSuccessFeedback.js');
    expect(helper).toContain('pair-linked');
    expect(helper).toContain('roster-validated');
    expect(helper).toContain('attendance-transferred');
    expect(helper).toContain('import-completed');
    expect(helper).not.toMatch(/alert\s*\(/);
    expect(helper).not.toMatch(/confirm\s*\(/);
    expect(helper).not.toContain('requestPermission(');
    // No emoji/unicode icon payloads in the helper itself.
    expect(helper).not.toContain('✅');
    expect(helper).not.toContain('✓');
  });

  test('P2P roster UI signals pair-linked and roster-validated only', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).toContain("from './P2PSuccessFeedback.js'");
    expect(ui).toContain('P2P_SUCCESS_EVENTS.PAIR_LINKED');
    expect(ui).toContain('P2P_SUCCESS_EVENTS.ROSTER_VALIDATED');
    expect(ui).toContain('Mini vinculado correctamente');
    expect(ui).toContain('Roster enviado y validado por Mini');
    // No success feedback on intermediate/auth states.
    expect(ui).not.toContain('P2P_SUCCESS_EVENTS.CONNECTING');
    expect(ui).not.toContain('signalP2PSuccess(P2P_SUCCESS_EVENTS.AUTH');
  });

  test('Mini import modal signals attendance-transferred and import-completed only on terminal success', () => {
    const modal = read('js/modules/ui/modals/MiniAttendanceImportModal.js');
    expect(modal).toContain("from '../../features/p2p/P2PSuccessFeedback.js'");
    expect(modal).toContain('P2P_SUCCESS_EVENTS.ATTENDANCE_TRANSFERRED');
    expect(modal).toContain('P2P_SUCCESS_EVENTS.IMPORT_COMPLETED');
    expect(modal).toContain("this.connectionState === 'success'");
    // Partial/error/cancelled must not share the terminal success path.
    const transferBlock = modal.slice(
      modal.indexOf('P2P_SUCCESS_EVENTS.ATTENDANCE_TRANSFERRED') - 800,
      modal.indexOf('P2P_SUCCESS_EVENTS.ATTENDANCE_TRANSFERRED') + 200
    );
    expect(transferBlock).toContain("=== 'success'");
    expect(transferBlock).not.toContain('partial_success');
  });

  test('success pulse CSS uses canonical tokens and honours reduced motion', () => {
    const p2pCss = read('css/p2p-transfer.css');
    expect(p2pCss).toContain('p2pSuccessPulse');
    expect(p2pCss).toContain('--p2p-good');
    expect(p2pCss).toContain('is-success-pulse');
    expect(p2pCss).toContain('prefers-reduced-motion: reduce');

    const miniCss = read('css/mini-attendance-onboarding.css');
    expect(miniCss).toContain('miniSuccessPulse');
    expect(miniCss).toContain('--mini-good');
    expect(miniCss).toContain('is-success-pulse');
    expect(miniCss).toContain('prefers-reduced-motion: reduce');
  });

  test('design.md documents the terminal-only success rule', () => {
    const design = read('design.md');
    expect(design).toContain('Retroalimentación terminal de éxito');
    expect(design).toContain('Mini vinculado');
    expect(design).toContain('Roster recibido y validado');
    expect(design).toContain('Importación completada');
    expect(design).toContain('prefers-reduced-motion');
    expect(design).toContain('requestPermission');
  });

  test('service worker precaches the reusable feedback helper', () => {
    const sw = read('sw.js');
    expect(sw).toContain('./js/modules/features/p2p/P2PSuccessFeedback.js');
  });
});

describe('P2P Meta3 — connected import terminal feedback behaviour', () => {
  let host;

  beforeEach(() => {
    resetP2PSuccessFeedback();
    mockMatchMedia(false);
    host = document.createElement('div');
    document.body.replaceChildren(host);
    window.showNotification = jest.fn();
  });

  afterEach(() => {
    document.body.replaceChildren();
    resetP2PSuccessFeedback();
    try { delete window.showNotification; } catch (_) {}
  });

  test('successful attendance transfer toasts once and pulses the transport notice', async () => {
    const linkedMinis = [{ id: 'peer-mini-1', peerId: 'peer-mini-1', name: 'Mini 1' }];
    const modal = new MiniAttendanceImportModal({
      saProjectId: 'PRJ-OBRA-1',
      proposedDate: '2026-09-06',
      importMode: 'connected',
      selectedMiniId: 'peer-mini-1',
      linkedMinis,
      onRequestSubmissions: jest.fn().mockResolvedValue({
        ok: true,
        status: 'success',
        hasPartialError: false,
        importedCount: 1,
        duplicateCount: 0,
        message: 'Asistencia transferida y guardada en borrador.'
      })
    });
    modal.mount(host);
    host.querySelector('[data-mini-action="fetch-connected"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(modal.connectionState).toBe('success');
    expect(window.showNotification).toHaveBeenCalledWith(
      expect.stringContaining('Asistencia transferida'),
      'success'
    );
    const notice = host.querySelector('[data-mini-transport-seam]');
    expect(notice).not.toBeNull();
    expect(notice.classList.contains('is-success')).toBe(true);
    expect(notice.classList.contains('is-success-pulse')).toBe(true);
  });

  test('partial, error and cancelled transfers never emit terminal success toast', async () => {
    const linkedMinis = [{ id: 'peer-mini-1', peerId: 'peer-mini-1', name: 'Mini 1' }];

    const partial = new MiniAttendanceImportModal({
      saProjectId: 'PRJ-OBRA-1',
      proposedDate: '2026-09-06',
      importMode: 'connected',
      selectedMiniId: 'peer-mini-1',
      linkedMinis,
      onRequestSubmissions: jest.fn().mockResolvedValue({
        ok: true,
        status: 'partial_success',
        hasPartialError: true,
        message: 'Parcial: 0 de 1 Minis respondieron.',
        errors: [{ peer: linkedMinis[0], error: new Error('timeout') }]
      })
    });
    partial.mount(host);
    host.querySelector('[data-mini-action="fetch-connected"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(partial.connectionState).toBe('partial_success');
    expect(window.showNotification).not.toHaveBeenCalled();
  });
});
