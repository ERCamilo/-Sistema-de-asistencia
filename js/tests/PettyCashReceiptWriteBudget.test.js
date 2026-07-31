import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/pettycash/PettyCashUI.js'),
    'utf8'
);

describe('Caja Chica — presupuesto de escrituras de comprobantes', () => {
    test('los borradores de lote y resultados OCR permanecen locales hasta confirmar', () => {
        expect(source).toContain("const saveMovementLocal =");
        expect(source).toMatch(/enqueueReceiptFile[\s\S]*saveMovementLocal\(movement,\s*'receipt-queue'/);
        expect(source).toMatch(/saveMovement:\s*\(movement\)\s*=>\s*saveMovementLocal\(movement,\s*'receipt-ocr'/);
    });

    test('confirmar persiste en nube el contador del proyecto y el movimiento final', () => {
        const confirmStart = source.indexOf('window.pcConfirmMovement = async');
        const confirmEnd = source.indexOf('window.pcExportExcel', confirmStart);
        const confirmSource = source.slice(confirmStart, confirmEnd);
        expect(confirmSource).toContain("saveProject(project, null, 'receipt-confirm')");
        expect(confirmSource).toContain("saveMovement(mov, 'Movimiento confirmado', 'receipt-confirm')");
    });
});
