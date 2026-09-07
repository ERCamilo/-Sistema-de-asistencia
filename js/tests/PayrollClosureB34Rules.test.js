import fs from 'fs';
import path from 'path';

const RULES = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');
const CONTRACT = fs.readFileSync(
    path.resolve(__dirname, '../../docs/fase-1/F1.6-B3-contract.md'),
    'utf8'
);

const USER_COLLECTIONS = [
    'data', 'employees', 'positions', 'leaders', 'attendance', 'snapshots',
    'projects', 'cashPeriods', 'pettyCash', 'projectRegistryV1', 'projectsV1',
    'projectAliasesV1'
];

describe('B3.4 Unit 1 Firestore Rules boundary', () => {
    test('removes the additive wildcard bypass and keeps unknown paths denied', () => {
        expect(RULES).not.toContain('match /users/{userId}/{document=**}');
        expect(RULES).toContain('match /users/{userId}/payrollClosures/{closureId}');
        expect(RULES).toMatch(/match \/\{document=\*\*\}[\s\S]*allow read, write: if false/);
        for (const collection of USER_COLLECTIONS) {
            expect(RULES).toContain(`match /users/{userId}/${collection}/{documentId}`);
        }
    });

    test('uses the authenticated path owner for unauthenticated and other-user denial', () => {
        expect(RULES).toContain('request.auth != null');
        expect(RULES).toContain('request.auth.uid == userId');
        expect(RULES).toContain('allow read: if isAccountOwner(userId)');
        expect(RULES).toContain('allow create: if isAccountOwner(userId)');
        expect(RULES).toContain('allow update: if isAccountOwner(userId)');
    });

    test('checks server-visible legacy and canonical schema shapes without client-only claims', () => {
        expect(RULES).toContain('data.schemaVersion == 2');
        expect(RULES).toContain('data.schemaVersion == 3');
        expect(RULES).toContain('isLegacyClosure(request.resource.data)');
        expect(RULES).toContain('isNativeClosure(request.resource.data)');
        expect(RULES).toContain('isCanonicalProjectId(data.projectId)');
        expect(RULES).toContain('value is string && value.size() > 0');
        expect(RULES).toContain("!value.matches('^legacy-unresolved:.*')");
        expect(RULES).toContain("data.identityKind == 'promoted-legacy'");
        expect(RULES).toContain('hasNonEmptyString(data, \'ownershipToken\')');
        expect(RULES).not.toMatch(/isProjectsEnabled|localStorage|stableToken/);
    });

    test('rejects downgrade, owner changes, invalid promotion mutations, and void reversal', () => {
        expect(RULES).toContain('resource.data.schemaVersion == request.resource.data.schemaVersion');
        expect(RULES).toContain('resource.data.id == request.resource.data.id');
        expect(RULES).toContain('resource.data.fingerprint == request.resource.data.fingerprint');
        expect(RULES).toContain('request.resource.data.projectId == resource.data.projectId');
        expect(RULES).toContain("data.status == 'voided'");
        expect(RULES).toContain("resource.data.status == 'closed'");
        expect(RULES).toContain("request.resource.data.status == 'voided'");
        expect(RULES).toContain("request.resource.data.status == 'closed'");
        expect(RULES).toContain('affectedKeys().hasOnly([');
    });

    test('documents static-only Rules evidence and the Unit 2/3 boundary', () => {
        expect(CONTRACT).toContain('B3.4 Unit 1');
        expect(CONTRACT).toContain('Runtime Rules coverage remains unavailable');
        expect(CONTRACT).toContain('B3.4 Unit 2');
        expect(CONTRACT).toContain('B3.4 Unit 3');
    });
});
