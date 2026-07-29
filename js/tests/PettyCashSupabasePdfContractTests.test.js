import fs from 'fs';
import path from 'path';

const MIGRATION = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/migrations/20260729105101_allow_pdf_petty_cash_receipts.sql'),
    'utf8'
);
const EDGE_FUNCTION = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/functions/petty-cash-receipt/index.ts'),
    'utf8'
);

describe('Petty cash PDF backup contract', () => {
    test('database and bucket accept private PDF originals up to 10 MB', () => {
        expect(MIGRATION).toContain("'application/pdf'");
        expect(MIGRATION).toContain('10485760');
        expect(MIGRATION).toMatch(/page_count[\s\S]*between 1 and 10/i);
        expect(MIGRATION).toMatch(/where id = 'petty-cash-receipts'/);
    });

    test('Edge Function accepts the generic file contract with image compatibility', () => {
        expect(EDGE_FUNCTION).toContain('body.fileBase64 || body.imageBase64');
        expect(EDGE_FUNCTION).toContain('["application/pdf", "pdf"]');
        expect(EDGE_FUNCTION).toContain('MAX_FILE_BYTES = 10 * 1024 * 1024');
        expect(EDGE_FUNCTION).toContain('FILE_SIGNATURE_MISMATCH');
        expect(EDGE_FUNCTION).toContain('page_count: requestedPageCount');
    });
});
