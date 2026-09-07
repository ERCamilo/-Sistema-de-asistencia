import fs from 'fs';
import path from 'path';

const RULES = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');
const REPOSITORY = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollClosureRepository.js'),
    'utf8'
);
const HISTORY_UI = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollHistoryUI.js'),
    'utf8'
);

describe('Payroll closure privacy boundary', () => {
    test('stores history under the authenticated owner path with explicit payroll rules', () => {
        expect(REPOSITORY).toContain("collection(db, 'users', auth.currentUser.uid, COLLECTION)");
        expect(RULES).not.toMatch(/match \/users\/\{userId\}\/\{document=\*\*\}/);
        expect(RULES).toMatch(/match \/users\/\{userId\}\/payrollClosures\/\{closureId\}/);
        expect(RULES).toContain('allow read: if isAccountOwner(userId)');
        expect(RULES).toMatch(/match \/\{document=\*\*\}[\s\S]*allow read, write: if false/);
    });

    test('escapes historical identity fields before inserting HTML', () => {
        expect(HISTORY_UI).toContain("text(closure.closedBy || 'Sin usuario')");
        expect(HISTORY_UI).toContain('text(row.employeeName)');
        expect(HISTORY_UI).toContain("text(row.employeePosition || 'Sin posición')");
    });
});
