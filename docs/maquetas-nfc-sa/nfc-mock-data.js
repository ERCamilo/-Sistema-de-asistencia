/* Fake data + pure helpers for the NFC menu mockups. No network, no secrets.
   Field names follow the real contracts so the mock doubles as a data-shape check:
   - card query/associate  -> docs/integrations/nfc-webhook.md (schemaVersion 1)
   - day proposal          -> ESP32 repo backend/calculo-diario (calcularDia output)
   - corrections/settings  -> ESP32 repo backend/correcciones + supabase `settings`/`devices`/`card_assignments`
   Items flagged `//NEW` do not exist in any contract yet. */
'use strict';
window.NFCData = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TODAY = '2026-11-04';
  const DAY = '2026-11-03';

  const EMP = [
    { id: 'emp-101', number: '00101', name: 'Juan Carlos Peña Rodríguez', role: 'Albañil', color: '#5fa8d3' },
    { id: 'emp-102', number: '00102', name: 'María Altagracia Santana', role: 'Almacén', color: '#d98cb3' },
    { id: 'emp-103', number: '00103', name: 'Pedro Antonio Féliz', role: 'Plomero', color: '#9fd35f' },
    { id: 'emp-104', number: '00104', name: 'Yokasta Mercedes Díaz', role: 'Administrativa', color: '#e0b25f' },
    { id: 'emp-105', number: '00105', name: 'Rafael Ernesto Báez', role: 'Electricista', color: '#5fd3bd' },
    { id: 'emp-106', number: '00106', name: 'Luisa Fernanda Ureña', role: 'Ayudante', color: '#b38cd9' },
    { id: 'emp-107', number: '00107', name: 'Wilkin Manuel Tavárez', role: 'Maestro', color: '#d98c8c' },
    { id: 'emp-108', number: '00108', name: 'Ramona Esther De la Cruz', role: 'Limpieza', color: '#8c9bd9' },
    { id: 'emp-109', number: '00109', name: 'Domingo Rosario Vásquez', role: 'Ayudante', color: '#9ad9a6' },
  ];
  const emp = id => EMP.find(e => e.id === id);
  const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  // One current card per employee (card_assignments where hasta IS NULL).
  const ASSIGN = {
    'emp-101': { uid: '04A1B2C3', since: '2026-09-12' },
    'emp-102': { uid: '0400ABCDEF1234', since: '2026-09-12' },
    'emp-103': { uid: '04D4E5F6', since: '2026-09-14' },
    'emp-105': { uid: '04778899', since: '2026-09-20' },
    'emp-106': { uid: '04AA55EE', since: '2026-10-02' },
    'emp-107': { uid: '04123456', since: '2026-10-05' },
    'emp-108': { uid: '04FEED01', since: '2026-10-30' },
  };
  // Freed cards (estado:'libre'): no blocked state, ever.
  const FREE = [
    { uid: '04C0FFEE', lastHolder: 'emp-108', until: '2026-10-29', reason: 'perdida', lastRead: '2026-11-03 07:41' },
    { uid: '04B0B0B0', lastHolder: null, until: null, reason: null, lastRead: null },
  ];
  // Card history per employee (newest first).
  const HISTORY = {
    'emp-108': [
      { uid: '04FEED01', from: '2026-10-30', to: null, reason: null, by: 'admin@obra' },
      { uid: '04C0FFEE', from: '2026-09-12', to: '2026-10-29', reason: 'perdida', by: 'admin@obra' },
    ],
    'emp-101': [{ uid: '04A1B2C3', from: '2026-09-12', to: null, reason: null, by: 'admin@obra' }],
    'emp-102': [{ uid: '0400ABCDEF1234', from: '2026-09-12', to: null, reason: null, by: 'admin@obra' }],
    'emp-103': [{ uid: '04D4E5F6', from: '2026-09-14', to: null, reason: null, by: 'admin@obra' }],
  };
  const REASONS = { perdida: 'Perdida', reemplazo: 'Reemplazo', baja: 'Baja del empleado', error_registro: 'Error de registro', otro: 'Otro motivo' };

  // Cards the phone can "touch" in the mockup (drives the association flow).
  const TOUCH = {
    free: { label: 'Tarjeta nueva y libre', uid: '04 5A 6B 7C', result: 'disponible' },
    history: { label: 'Tarjeta libre con historial (era de Ramona)', uid: '04:C0:FF:EE', result: 'disponible', history: true },
    same: { label: 'Ya es de este empleado', uid: '04A1B2C3', result: 'mismo_empleado' },
    other: { label: 'Ocupada por otro empleado', uid: '04D4E5F6', result: 'otro_empleado' },
  };

  const DEVICES = [
    { id: 'ESP32-ENTRADA', name: 'Entrada principal', project: 'Torre Norte', lastSeen: 'hace 2 min', stale: false, firmware: '1.3.0', hasEventId: true, key: 'active', keySince: '2026-09-10', queue: 0, clock: 'ok', tapsToday: 31 },
    { id: 'ESP32-ALMACEN', name: 'Almacén', project: 'Torre Norte', lastSeen: 'hace 3 días', stale: true, firmware: '1.2.4', hasEventId: false, key: 'active', keySince: '2026-09-10', queue: 14, clock: 'drift', tapsToday: 0 },
    { id: 'ESP32-PRUEBAS', name: 'Banco de pruebas', project: null, lastSeen: 'hace 12 días', stale: true, firmware: '1.1.0', hasEventId: false, key: 'revoked', keySince: '2026-08-01', revokedAt: '2026-10-22', queue: 0, clock: 'ok', tapsToday: 0 },
  ];

  // Day proposals for DAY (shape ~ calcularDia + review state). times are local HH:MM.
  const DAYS = [
    { id: 'd1', emp: 'emp-101', inT: '07:02', outT: '17:10', reads: 2, alerts: [], photos: ['ok', 'ok'], state: 'pendiente', mini: { normal: 8, extra: 1 } },
    { id: 'd2', emp: 'emp-102', inT: '07:15', outT: '16:20', reads: 2, alerts: [], photos: ['ok', 'ok'], state: 'verificado', mini: { normal: 8, extra: 0 } },
    { id: 'd3', emp: 'emp-103', inT: '07:30', outT: null, reads: 1, alerts: ['falta_salida'], photos: ['ok'], state: 'pendiente', mini: { normal: 8, extra: 0 } },
    { id: 'd4', emp: 'emp-105', inT: '07:00', outT: null, reads: 2, alerts: ['falta_salida', 'doble_toque_fusionado'], photos: ['ok', 'ok'], state: 'pendiente', mini: null, doubleTap: ['07:00', '07:03'] },
    { id: 'd5', emp: 'emp-106', inT: '07:10', outT: '11:20', reads: 2, alerts: ['jornada_corta'], photos: ['ok', 'ok'], state: 'pendiente', mini: { normal: 3, extra: 0 } },
    { id: 'd6', emp: 'emp-107', inT: '06:58', outT: '17:00', reads: 2, alerts: ['foto_dudosa', 'sin_foto'], photos: ['ok', 'missing'], state: 'pendiente', mini: { normal: 8, extra: 1 } },
    { id: 'd7', emp: 'emp-108', inT: null, outT: null, reads: 0, alerts: ['tarjeta_desconocida'], photos: [], state: 'pendiente', mini: { normal: 8, extra: 0 }, note: 'Lectura de 04C0FFEE (tarjeta liberada) a las 07:41' },
  ];
  const PENDING_DATE = [{ id: 'p1', uid: '04FEED01', emp: 'emp-108', device: 'ESP32-ALMACEN', raw: 'REL:+4812s', received: '2026-11-03 13:22' }];
  const UNKNOWN = [
    { id: 'u1', uid: '04C0FFEE', at: '2026-11-03 07:41', device: 'ESP32-ENTRADA', photo: 'ok', last: { emp: 'emp-108', until: '2026-10-29', reason: 'perdida' } },
    { id: 'u2', uid: '04B0B0B0', at: '2026-11-03 12:05', device: 'ESP32-ENTRADA', photo: 'missing', last: null },
    { id: 'u3', uid: '04C0FFEE', at: '2026-11-02 07:38', device: 'ESP32-ENTRADA', photo: 'ok', last: { emp: 'emp-108', until: '2026-10-29', reason: 'perdida' } },
  ];

  const ALERTS = {
    falta_salida: { tone: 'warn', label: 'Falta salida', icon: 'warn' },
    jornada_corta: { tone: 'warn', label: 'Jornada corta', icon: 'warn' },
    jornada_larga: { tone: 'warn', label: 'Jornada larga', icon: 'warn' },
    tarjeta_desconocida: { tone: 'bad', label: 'Tarjeta desconocida', icon: 'unknown' },
    fecha_pendiente: { tone: 'warn', label: 'Fecha pendiente', icon: 'clock' },
    doble_toque_fusionado: { tone: 'mute', label: 'Doble toque fusionado', icon: 'repeat' },
    foto_dudosa: { tone: 'warn', label: 'Foto dudosa', icon: 'eye' },
    sin_foto: { tone: 'mute', label: 'Sin foto', icon: 'eye' },
  };

  // Defaults mirror public.settings; `//NEW` keys do not exist in the schema yet.
  const RULES_DEFAULT = {
    umbral_doble_toque_min: 5, almuerzo_min: 60, almuerzo_desde_horas: 4, jornada_horas: 8,
    retencion_fotos: 'hasta_confirmar',
    redondeo: 'media',          // NEW — OPEN decision (owner has not decided)
    extra_minimo_min: 30,       // NEW — OPEN decision
  };

  const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const fmtH = h => (Math.round(h * 100) / 100).toString().replace('.', ',');
  const fmtHM = min => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
  /** Pure mirror of the proposed conversion (calcularDia + redondeo). */
  function calc(inT, outT, rules, lunchOverrideMin) {
    if (!inT || !outT) return null;
    const range = toMin(outT) - toMin(inT);
    if (range <= 0) return { error: 'La salida debe ser posterior a la entrada.' };
    const lunch = lunchOverrideMin != null ? lunchOverrideMin : (range > rules.almuerzo_desde_horas * 60 ? rules.almuerzo_min : 0);
    const worked = Math.max(0, range - lunch) / 60;
    let rounded = worked;
    if (rules.redondeo === 'media') rounded = Math.round(worked * 2) / 2;
    if (rules.redondeo === 'hora_abajo') rounded = Math.floor(worked);
    const normal = Math.min(rounded, rules.jornada_horas);
    let extra = Math.max(0, rounded - rules.jornada_horas);
    if (extra * 60 < rules.extra_minimo_min) extra = 0;
    return { range, lunch, worked, rounded, normal, extra };
  }
  const dayLabel = '3 nov';
  return { esc, TODAY, DAY, EMP, emp, initials, ASSIGN, FREE, HISTORY, REASONS, TOUCH, DEVICES, DAYS, PENDING_DATE, UNKNOWN, ALERTS, RULES_DEFAULT, calc, fmtH, fmtHM, toMin, dayLabel };
})();
