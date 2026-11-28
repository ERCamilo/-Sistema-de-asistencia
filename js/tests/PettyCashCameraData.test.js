/**
 * Lo que la vista rápida de la cámara muestra de cada factura: los datos leídos y dónde está
 * cada uno en la foto (para los botones de acceso rápido a fecha, total y NCF).
 */
import { cameraItemData, QUICK_FIELDS } from '../modules/features/pettycash/PettyCashCameraData.js';

const money = (n) => `RD$ ${Number(n).toFixed(2)}`;

describe('cameraItemData', () => {
    test('los botones rápidos son fecha, total y NCF', () => {
        expect(QUICK_FIELDS.map(([k]) => k)).toEqual(['date', 'total', 'ncf']);
    });
    test('trae comercio, fecha de emisión, NCF, RNC, ITBIS, total y categoría', () => {
        const out = cameraItemData({
            paidTo: 'Ferretería Sol', fechaEmision: '2026-11-10', date: '2026-11-12', ncf: 'B0100000123',
            rncEmisor: '131246796', itbis: 90, amount: 590, category: 'Materiales'
        }, { money });
        expect(out).toMatchObject({
            paidTo: 'Ferretería Sol', date: '2026-11-10', ncf: 'B0100000123', rncEmisor: '131246796',
            itbis: 'RD$ 90.00', total: 'RD$ 590.00', category: 'Materiales'
        });
    });
    test('sin fecha de emisión usa la del registro; los vacíos quedan en null', () => {
        const out = cameraItemData({ date: '2026-11-12', amount: 0 }, { money });
        expect(out.date).toBe('2026-11-12');
        expect(out.total).toBeNull();
        expect(out.itbis).toBeNull();
        expect(out.ncf).toBeNull();
    });
    test('el recuadro marcado a mano gana sobre el del lector; los inválidos no se mandan', () => {
        const out = cameraItemData({
            amount: 590,
            ocrBoxes: { total: [800, 500, 850, 900], ncf: [200, 100, 250, 500], date: 'x' },
            manualBoxes: { ncf: [210, 110, 260, 510] }
        }, { money });
        expect(out.boxes).toEqual({ total: [800, 500, 850, 900], ncf: [210, 110, 260, 510] });
    });
    test('sin gasto: objeto vacío', () => {
        expect(cameraItemData(null)).toEqual({});
    });
});
