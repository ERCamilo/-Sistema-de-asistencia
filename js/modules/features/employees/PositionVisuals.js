const SVG_PATHS = {
    'hard-hat': '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><path d="M2.5 15h19v3h-19z"/><path d="M9 4v7M15 4v7"/>',
    hammer: '<path d="m14 4 6 6-3 3-6-6z"/><path d="m12 8-8 8a2 2 0 0 0 3 3l8-8"/>',
    nails: '<path d="m5 3 16 16M3 5l4-4M19 21l2-2"/><path d="m19 3-16 16M17 1l4 4M3 19l2 2"/>',
    pickaxe: '<path d="M3 7c5-4 13-4 18 0"/><path d="m12 5-1 16"/><path d="m9 5 3 3 3-3"/>',
    shovel: '<path d="m14 3 3 3-9 9-3-3z"/><path d="m6 13-2 2a4 4 0 0 0 5 5l2-2"/><path d="m15 5 3-3 4 4-3 3"/>',
    wheelbarrow: '<path d="M3 5h3l2 10h9l4-7H7"/><path d="M8 15h10M10 15l-2 4M17 15l2 4"/><circle cx="7" cy="20" r="2"/>',
    trowel: '<path d="m4 19 9-3-6-6z"/><path d="m10 13 5-5"/><path d="m14 9 3-3a2 2 0 0 1 3 3l-3 3z"/>',
    drill: '<path d="M3 7h12v7H3z"/><path d="M15 9h5l2 2-2 2h-5"/><path d="m7 14 2 7h4l-1-7"/><path d="M5 10h3"/>',
    jackhammer: '<path d="M8 4h8v4H8zM10 8v8h4V8M9 11H6M15 11h3M12 16v6M10 19h4"/>',
    wrench: '<path d="M14 6a5 5 0 0 0-7 6L2 17l5 5 5-5a5 5 0 0 0 6-7l-3 3-4-4z"/>',
    screwdriver: '<path d="M9 3h6v8H9zM12 11v10M9 21h6"/><path d="M10 6h4"/>',
    pliers: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="m10 10 4 11M14 10 10 21M8 5l4-3 4 3"/>',
    saw: '<path d="M3 6h13l5 5-5 5H3z"/><path d="m5 16 2 3 2-3 2 3 2-3 2 3 2-3"/><circle cx="16" cy="11" r="1.5"/>',
    axe: '<path d="m13 3 7 3-2 7-7-3z"/><path d="m13 9-7 12"/><path d="m8 17 3 2"/>',
    crane: '<path d="M5 22V3h3v19M2 22h9M8 5h13M17 5v5M14 10h6l-1 4h-4z"/><path d="m8 5 7 5M5 10h3"/>',
    excavator: '<path d="M5 17h12l3 3H5a3 3 0 0 1 0-6h8"/><path d="M7 14V8h7l3 6"/><path d="m14 8 3-5 4 2-4 7"/><circle cx="7" cy="17" r="1"/><circle cx="15" cy="17" r="1"/>',
    tractor: '<path d="M4 15V9h8v6M8 9V5h6l3 5v5h3l2 3H4"/><circle cx="7" cy="18" r="3"/><circle cx="18" cy="18" r="2"/><path d="M12 7h3M2 18h2"/>',
    'cement-mixer': '<path d="m7 5 9-2 3 6-7 6-6-4z"/><path d="M9 14 6 20M15 13l3 7M4 20h16"/><circle cx="7" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M18 8h3v4"/>',
    truck: '<path d="M2 6h12v11H2zM14 10h4l4 4v3h-8z"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
    forklift: '<path d="M4 6h8v10H4zM12 10h4v6h-4M18 4v14h4"/><circle cx="7" cy="19" r="2"/><circle cx="16" cy="19" r="2"/>',
    bricks: '<path d="M3 5h8v5H3zM13 5h8v5h-8zM3 12h5v5H3zM10 12h8v5h-8zM20 12h1v5h-1zM5 19h8v3H5zM15 19h6v3h-6z"/>',
    ladder: '<path d="M7 2 5 22M17 2l2 20M7 6h10M6 10h12M6 14h12M5 18h14"/>',
    'tape-measure': '<path d="M4 6h11a5 5 0 0 1 5 5v7H4z"/><circle cx="10" cy="12" r="3"/><path d="M20 14h2v6h-8v-2"/>',
    toolbox: '<path d="M3 8h18v12H3zM8 8V5h8v3M3 13h18"/><path d="M10 12h4v3h-4z"/>',
    'safety-vest': '<path d="M8 3h8l2 5 3 2-3 11H6L3 10l3-2z"/><path d="M9 3v5h6V3M6 13h12M12 8v13"/>',
    cone: '<path d="m9 3-5 16h16L15 3z"/><path d="M2 19h20v3H2zM7 12h10"/>',
    electrical: '<path d="m13 2-8 12h7l-1 8 8-12h-7z"/>',
    plumbing: '<path d="M4 3v5a4 4 0 0 0 4 4h8a4 4 0 0 1 4 4v5"/><path d="M2 3h4M18 21h4"/><circle cx="12" cy="12" r="2"/>',
    'paint-roller': '<path d="M3 4h13v6H3zM16 7h3v5h-7v4M12 16v6"/><path d="M9 16h6"/>',
    welding: '<path d="M5 3h14l-1 12-6 6-6-6z"/><path d="M8 7h8v5H8zM3 8l-2-2M21 8l2-2M12 1V0"/>',
    ruler: '<path d="m4 17 13-13 4 4L8 21z"/><path d="m14 7 3 3M11 10l2 2M8 13l3 3"/>',
    blueprint: '<path d="M4 3h16v18H4z"/><path d="M8 7h8v4H8zM8 15h3M14 15h2M8 18h8"/>',
    crew: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 21v-2a6 6 0 0 1 12 0v2M14 21v-1a5 5 0 0 1 8-4"/>',
    supervisor: '<path d="M12 2 4 5v6c0 5 3 9 8 11 5-2 8-6 8-11V5z"/><path d="m8 12 3 3 5-6"/>',
    building: '<path d="M4 22V5l8-3 8 3v17M2 22h20"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M11 22v-4h2v4"/>',
    box: '<path d="m3 7 9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>',
    briefcase: '<path d="M3 7h18v13H3zM8 7V4h8v3M3 12h18"/><path d="M10 11h4v3h-4z"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    badge: '<path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>'
};

const UI_SVG_PATHS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5v1"/>',
    calendar: '<path d="M4 5h16v16H4zM8 3v4M16 3v4M4 10h16"/>',
    leader: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
};

export const POSITION_ICON_OPTIONS = [
    { value: 'hard-hat', label: 'Casco', category: 'heavy', keywords: 'seguridad construcción obra' },
    { value: 'hammer', label: 'Martillo', category: 'heavy', keywords: 'carpintería herramienta golpe' },
    { value: 'nails', label: 'Clavos', category: 'heavy', keywords: 'clavo fijación carpintería herramienta' },
    { value: 'pickaxe', label: 'Pico', category: 'heavy', keywords: 'excavación minería tierra' },
    { value: 'shovel', label: 'Pala', category: 'heavy', keywords: 'excavación tierra obra' },
    { value: 'wheelbarrow', label: 'Carretilla', category: 'heavy', keywords: 'acarreo carga material construcción' },
    { value: 'trowel', label: 'Palustre', category: 'heavy', keywords: 'albañilería cemento mortero llana cuchara' },
    { value: 'drill', label: 'Taladro', category: 'heavy', keywords: 'perforación herramienta' },
    { value: 'jackhammer', label: 'Martillo neumático', category: 'heavy', keywords: 'demolición concreto pavimento herramienta' },
    { value: 'wrench', label: 'Llave', category: 'heavy', keywords: 'mecánica reparación herramienta' },
    { value: 'screwdriver', label: 'Destornillador', category: 'heavy', keywords: 'tornillo montaje herramienta' },
    { value: 'pliers', label: 'Alicates', category: 'heavy', keywords: 'pinza corte cable herramienta' },
    { value: 'saw', label: 'Sierra', category: 'heavy', keywords: 'corte carpintería madera' },
    { value: 'axe', label: 'Hacha', category: 'heavy', keywords: 'corte madera herramienta' },
    { value: 'crane', label: 'Grúa', category: 'heavy', keywords: 'maquinaria carga construcción' },
    { value: 'excavator', label: 'Excavadora', category: 'heavy', keywords: 'maquinaria pesada tierra' },
    { value: 'tractor', label: 'Tractor', category: 'heavy', keywords: 'maquinaria pesada campo movimiento tierra' },
    { value: 'cement-mixer', label: 'Mezcladora', category: 'heavy', keywords: 'cemento hormigón concreto maquinaria' },
    { value: 'truck', label: 'Camión', category: 'heavy', keywords: 'transporte carga conductor' },
    { value: 'forklift', label: 'Montacargas', category: 'heavy', keywords: 'almacén carga operador' },
    { value: 'bricks', label: 'Mampostería', category: 'heavy', keywords: 'albañil bloque ladrillo pared' },
    { value: 'ladder', label: 'Escalera', category: 'heavy', keywords: 'altura acceso construcción' },
    { value: 'tape-measure', label: 'Cinta métrica', category: 'heavy', keywords: 'medición metro herramienta' },
    { value: 'toolbox', label: 'Caja de herramientas', category: 'heavy', keywords: 'equipo reparación mantenimiento' },
    { value: 'safety-vest', label: 'Chaleco de seguridad', category: 'heavy', keywords: 'protección visibilidad obra seguridad' },
    { value: 'cone', label: 'Señalización', category: 'heavy', keywords: 'seguridad vial tránsito' },
    { value: 'electrical', label: 'Electricidad', category: 'trades', keywords: 'electricista voltaje energía' },
    { value: 'plumbing', label: 'Plomería', category: 'trades', keywords: 'tubería agua instalación' },
    { value: 'paint-roller', label: 'Pintura', category: 'trades', keywords: 'pintor rodillo acabado' },
    { value: 'welding', label: 'Soldadura', category: 'trades', keywords: 'soldador metal máscara' },
    { value: 'ruler', label: 'Medición', category: 'trades', keywords: 'regla medida terminación' },
    { value: 'blueprint', label: 'Planos', category: 'trades', keywords: 'arquitectura diseño técnico' },
    { value: 'crew', label: 'Cuadrilla', category: 'management', keywords: 'equipo personal ayudante' },
    { value: 'supervisor', label: 'Supervisión', category: 'management', keywords: 'líder encargado capataz gerente' },
    { value: 'building', label: 'Edificación', category: 'management', keywords: 'obra edificio proyecto' },
    { value: 'box', label: 'Materiales', category: 'management', keywords: 'almacén inventario paquete' },
    { value: 'briefcase', label: 'Administración', category: 'management', keywords: 'oficina puesto trabajo' },
    { value: 'cog', label: 'Operación', category: 'management', keywords: 'máquina técnico proceso' },
    { value: 'badge', label: 'Especialidad', category: 'management', keywords: 'destacado experto estrella' }
];

const POSITION_ICON_NAMES = new Set(POSITION_ICON_OPTIONS.map(option => option.value));
const LEGACY_ICON_MAP = {
    personnel: 'crew',
    settings: 'wrench',
    package: 'box',
    layers: 'bricks',
    zap: 'electrical',
    shield: 'supervisor',
    target: 'ruler',
    activity: 'cog',
    home: 'building',
    grid: 'blueprint',
    star: 'badge'
};

export function resolvePositionIcon(position = {}) {
    if (POSITION_ICON_NAMES.has(position.icon)) return position.icon;
    if (LEGACY_ICON_MAP[position.icon]) return LEGACY_ICON_MAP[position.icon];

    const name = String(position.name || '').toLowerCase();
    if (/albañil|mampost|ladrill|bloque/.test(name)) return 'bricks';
    if (/tractor/.test(name)) return 'tractor';
    if (/carretill/.test(name)) return 'wheelbarrow';
    if (/mezcl|hormig|concret/.test(name)) return 'cement-mixer';
    if (/demolici[oó]n|martillo neum[aá]tico/.test(name)) return 'jackhammer';
    if (/electr|volt|energ/.test(name)) return 'electrical';
    if (/carpint|madera/.test(name)) return 'saw';
    if (/pint/.test(name)) return 'paint-roller';
    if (/sold/.test(name)) return 'welding';
    if (/plom|tuber/.test(name)) return 'plumbing';
    if (/gerente|capataz|supervisor|encargado/.test(name)) return 'supervisor';
    if (/operador|mec[aá]nic|t[eé]cnic/.test(name)) return 'cog';
    if (/ayudante|auxiliar|asistente/.test(name)) return 'crew';
    if (/almac[eé]n|material/.test(name)) return 'box';
    return 'hard-hat';
}

export function resolveLeaderIcon(leader = {}) {
    if (POSITION_ICON_NAMES.has(leader.icon)) return leader.icon;
    if (LEGACY_ICON_MAP[leader.icon]) return LEGACY_ICON_MAP[leader.icon];
    return 'supervisor';
}

export function renderPositionIconSvg(icon, { size = 24, className = '' } = {}) {
    const resolved = POSITION_ICON_NAMES.has(icon) ? icon : 'hard-hat';
    const safeSize = Number.isFinite(Number(size)) ? Math.max(12, Math.min(64, Number(size))) : 24;
    const safeClass = String(className).replace(/[^a-z0-9_-]/gi, '');
    return `<svg class="position-svg-icon ${safeClass}" width="${safeSize}" height="${safeSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG_PATHS[resolved]}</svg>`;
}

export function renderPositionUiSvg(icon, { size = 16, className = '' } = {}) {
    const resolved = UI_SVG_PATHS[icon] ? icon : 'search';
    const safeSize = Number.isFinite(Number(size)) ? Math.max(12, Math.min(40, Number(size))) : 16;
    const safeClass = String(className).replace(/[^a-z0-9_-]/gi, '');
    return `<svg class="position-ui-icon ${safeClass}" width="${safeSize}" height="${safeSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_SVG_PATHS[resolved]}</svg>`;
}

export function safePositionColor(color, fallback = '#06b6d4') {
    return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : fallback;
}
