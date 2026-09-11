/**
 * P2PSuccessFeedback — reusable terminal success feedback for SA P2P flows.
 *
 * Progressive enhancement, Mini intent:
 * - Always: in-app visual success (status `is-success` + `is-success-pulse` + toast
 *   via `window.showNotification`, using canonical `--good` tokens in CSS).
 * - Only if supported: `navigator.vibrate` short pulse.
 * - Only if supported/allowed: short low-volume WebAudio chime (never throws).
 * - Only when already granted and hidden: system `Notification`
 *   (NEVER calls `requestPermission`).
 * - Respects `prefers-reduced-motion` (skips pulse animation and vibration).
 * - Avoids repeated triggers via per-event cooldown dedupe.
 *
 * Terminal events only (no intermediate/auth states):
 * - `pair-linked` — Mini pairing linked.
 * - `roster-validated` — roster transfer validated by Mini.
 * - `attendance-transferred` — attendance transfer/import request completes.
 * - `import-completed` — final connected import completion.
 *
 * Preserves canonical writers and P2P protocol: this module never writes to
 * AppState and never touches transport bytes, hashes, validators, or inbox
 * staging. SVG/IconSet only; no emoji/unicode icons; no alert/confirm.
 */

export const P2P_SUCCESS_EVENTS = Object.freeze({
  PAIR_LINKED: 'pair-linked',
  ROSTER_VALIDATED: 'roster-validated',
  ATTENDANCE_TRANSFERRED: 'attendance-transferred',
  IMPORT_COMPLETED: 'import-completed'
});

const TERMINAL_KEYS = new Set(Object.values(P2P_SUCCESS_EVENTS));
const DEFAULT_COOLDOWN_MS = 4000;
const SUCCESS_PULSE_CLASS = 'is-success-pulse';
const SUCCESS_CLASS = 'is-success';

const lastSignalByKey = new Map();

export function isTerminalSuccessEvent(key) {
  return TERMINAL_KEYS.has(key);
}

export function resetP2PSuccessFeedback() {
  lastSignalByKey.clear();
}

export function shouldSignalSuccess(key, { now = Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
  if (!isTerminalSuccessEvent(key)) return false;
  const last = lastSignalByKey.get(key);
  const current = Number(now);
  const seenAt = Number.isFinite(current) ? current : Date.now();
  if (last !== undefined && seenAt - last < cooldownMs) return false;
  lastSignalByKey.set(key, seenAt);
  return true;
}

export function prefersReducedMotion() {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
    }
    if (typeof globalThis !== 'undefined' && typeof globalThis.matchMedia === 'function') {
      return Boolean(globalThis.matchMedia('(prefers-reduced-motion: reduce)')?.matches);
    }
  } catch (_) {}
  return false;
}

export function isVibrateSupported() {
  try {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  } catch (_) {
    return false;
  }
}

export function vibrateSuccess(pattern = [15]) {
  if (prefersReducedMotion()) return false;
  if (!isVibrateSupported()) return false;
  try {
    const result = navigator.vibrate(pattern);
    return result === true || result === undefined;
  } catch (_) {
    return false;
  }
}

function resolveAudioContextCtor() {
  try {
    if (typeof window !== 'undefined') {
      const ctor = window.AudioContext || window.webkitAudioContext;
      if (typeof ctor === 'function') return ctor;
    }
    if (typeof globalThis !== 'undefined') {
      const ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (typeof ctor === 'function') return ctor;
    }
  } catch (_) {}
  return null;
}

export function playSuccessChime({ frequency = 660, duration = 0.12, volume = 0.04, type = 'sine' } = {}) {
  const Ctor = resolveAudioContextCtor();
  if (!Ctor) return Promise.resolve(false);
  try {
    const ctx = new Ctor();
    const start = () => {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = frequency;
        const now = ctx.currentTime || 0;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(volume, 0.0002), now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + duration + 0.02);
        setTimeout(() => {
          try {
            if (typeof ctx.close === 'function') ctx.close();
            else if (typeof ctx.suspend === 'function') ctx.suspend();
          } catch (_) {}
        }, Math.ceil((duration + 0.1) * 1000));
        return true;
      } catch (_) {
        return false;
      }
    };
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      return Promise.resolve()
        .then(() => ctx.resume())
        .then(() => start())
        .catch(() => false);
    }
    return Promise.resolve(start());
  } catch (_) {
    return Promise.resolve(false);
  }
}

export function maybeSystemNotify(title, body) {
  try {
    const SysNotify = typeof globalThis !== 'undefined' ? globalThis.Notification : undefined;
    if (typeof SysNotify === 'undefined' || SysNotify === null) return false;
    // In SA, window.Notification is the in-app toast class (no permission).
    // Only the platform Notification has a granted permission flag.
    if (SysNotify.permission !== 'granted') return false;
    if (typeof document !== 'undefined' && document.hidden !== true) return false;
    const text = String(title || body || 'Completado');
    const detail = String(body || title || text);
    new SysNotify(text, { body: detail, silent: true });
    return true;
  } catch (_) {
    return false;
  }
}

export function pulseSuccessElement(el) {
  if (!el || !el.classList) return false;
  if (prefersReducedMotion()) return false;
  try {
    el.classList.add(SUCCESS_PULSE_CLASS);
    return true;
  } catch (_) {
    return false;
  }
}

function showInAppToast(message, type = 'success', notifyFn = null) {
  if (!message) return false;
  try {
    if (typeof notifyFn === 'function') {
      notifyFn(message, type);
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.showNotification === 'function') {
      window.showNotification(message, type);
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Single entry for terminal success feedback.
 * Always renders in-app visual (status class + pulse + toast seam);
 * vibrate/chime/system-notify are best-effort progressive enhancement.
 */
export function signalP2PSuccess(
  eventKey,
  {
    message = '',
    title = '',
    statusEl = null,
    pulseEl = null,
    toastType = 'success',
    vibratePattern = [15],
    chime = true,
    systemNotify = true,
    notifyFn = null,
    now,
    cooldownMs
  } = {}
) {
  if (!isTerminalSuccessEvent(eventKey)) {
    return { signaled: false, reason: 'non-terminal' };
  }
  const timing = {};
  if (now !== undefined) timing.now = now;
  if (cooldownMs !== undefined) timing.cooldownMs = cooldownMs;
  if (!shouldSignalSuccess(eventKey, timing)) {
    return { signaled: false, reason: 'duplicate' };
  }

  let visual = false;
  try {
    if (statusEl && statusEl.classList) {
      statusEl.classList.add(SUCCESS_CLASS);
      visual = true;
    }
  } catch (_) {}
  const pulseTarget = pulseEl || statusEl;
  let pulsed = false;
  if (pulseTarget) pulsed = pulseSuccessElement(pulseTarget);
  if (pulsed) visual = true;
  let toasted = false;
  if (message) toasted = showInAppToast(message, toastType, notifyFn);
  if (toasted) visual = true;
  // Status-only terminal views (already rendered with is-success styling)
  // still count as visual even when no element handle was passed.
  if (!statusEl && !pulseEl && !message) visual = false;
  if (!statusEl && !pulseEl && message && !toasted) visual = false;
  if ((statusEl || pulseEl) && !pulsed) visual = true;

  let vibrated = false;
  try {
    vibrated = vibrateSuccess(vibratePattern);
  } catch (_) {
    vibrated = false;
  }

  let chimeStarted = false;
  if (chime) {
    try {
      const result = playSuccessChime();
      chimeStarted = Boolean(result);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {
      chimeStarted = false;
    }
  }

  let notified = false;
  if (systemNotify) {
    try {
      notified = maybeSystemNotify(title || message, message || title);
    } catch (_) {
      notified = false;
    }
  }

  return { signaled: true, visual, pulsed, toasted, vibrated, chimeStarted, notified };
}

export default {
  P2P_SUCCESS_EVENTS,
  isTerminalSuccessEvent,
  shouldSignalSuccess,
  resetP2PSuccessFeedback,
  prefersReducedMotion,
  isVibrateSupported,
  vibrateSuccess,
  playSuccessChime,
  maybeSystemNotify,
  pulseSuccessElement,
  signalP2PSuccess
};
