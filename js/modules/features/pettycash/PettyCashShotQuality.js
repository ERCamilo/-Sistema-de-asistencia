/**
 * ¿La foto sirve para leerla? Mide nitidez y luz de una vista reducida de la toma
 * y avisa en el momento, mientras todavía se puede repetir.
 *
 *  - nitidez: el borde más fuerte (percentil 98 del gradiente) respecto al contraste
 *    de la imagen: la letra enfocada tiene bordes bruscos; movida o fuera de foco, no;
 *  - luz: promedio de gris; contraste: rango entre los percentiles 2 y 98.
 *
 * Los umbrales son iniciales y conservadores (avisar solo cuando es claro): las cifras
 * de cada foto se guardan en el diagnóstico de la cámara para ajustarlos con uso real.
 * Probado en js/tests/PettyCashShotQuality.test.js.
 */
export const QUALITY_SIZE = 480;          // ancho de la vista reducida que se mide
export const DARK_BELOW = 65;             // promedio de gris (0–255) por debajo del cual hay poca luz
export const FLAT_BELOW = 30;             // contraste por debajo del cual no hay nada que leer
export const BLURRY_BELOW = 0.25;        // nitidez relativa por debajo de la cual está borrosa (texto nítido ≈ 0.5–1)

const gray = (data, i) => data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
const percentile = (hist, total, p) => {
    const target = total * p;
    let acc = 0;
    for (let v = 0; v < hist.length; v++) { acc += hist[v]; if (acc >= target) return v; }
    return hist.length - 1;
};

/** @param {{data:Uint8ClampedArray|number[], width:number, height:number}} image RGBA */
export function measureShot(image) {
    const { data, width, height } = image || {};
    if (!data || !(width > 2) || !(height > 2)) return { sharpness: 0, brightness: 0, contrast: 0 };
    const g = new Float32Array(width * height);
    const lum = new Uint32Array(256);
    let sum = 0;
    for (let p = 0, i = 0; p < g.length; p++, i += 4) {
        const v = gray(data, i);
        g[p] = v;
        sum += v;
        lum[Math.max(0, Math.min(255, Math.round(v)))]++;
    }
    const grad = new Uint32Array(256);
    let n = 0;
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const p = y * width + x;
            const gx = g[p + 1] - g[p];
            const gy = g[p + width] - g[p];
            grad[Math.min(255, Math.round(Math.max(Math.abs(gx), Math.abs(gy))))]++;
            n++;
        }
    }
    const contrast = percentile(lum, g.length, 0.98) - percentile(lum, g.length, 0.02);
    const edge = percentile(grad, n, 0.98);
    return { sharpness: contrast > 0 ? edge / contrast : 0, brightness: sum / g.length, contrast };
}

const HINTS = {
    dark: 'Hay poca luz: usa la linterna o acércate a una luz y repite la foto.',
    flat: 'Se ve muy poco contraste: acerca la factura, que esté bien iluminada, y repite la foto.',
    blurry: 'La foto salió borrosa: sostén el teléfono firme, espera a que enfoque y repítela.'
};

/** @returns {{ok:boolean, issues:string[], hint:string|null}} */
export function assessShot(measure) {
    const m = measure || {};
    const issues = [];
    if (m.brightness < DARK_BELOW) issues.push('dark');
    else if (m.contrast < FLAT_BELOW) issues.push('flat');
    else if (m.sharpness < BLURRY_BELOW) issues.push('blurry');
    return { ok: issues.length === 0, issues, hint: issues.length ? HINTS[issues[0]] : null };
}

/**
 * Mide una toma de la cámara (lienzo/mapa de bits + recorte) sin consumirla:
 * dibuja una copia pequeña. Una toma que no se puede dibujar (Blob) no se mide.
 * @returns {{measure:object, assessment:object}|null}
 */
export function assessCapturedShot(shot, { doc = globalThis.document } = {}) {
    const source = shot?.source;
    const crop = shot?.crop;
    if (!source || !crop || !doc || typeof source === 'string' || source instanceof Blob) return null;
    const w = Math.min(QUALITY_SIZE, crop.sw);
    const h = Math.max(1, Math.round(crop.sh * (w / crop.sw)));
    const canvas = doc.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext?.('2d');
    if (!ctx?.getImageData) return null;
    ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
    const measure = measureShot(ctx.getImageData(0, 0, w, h));
    return { measure, assessment: assessShot(measure) };
}
