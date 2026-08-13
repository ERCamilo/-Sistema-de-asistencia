import { LegacyMigrator } from '../modules/utils/LegacyMigrator.js';

testRunner.addSuite('LegacyMigrator — regularHoursPerDay', {
    'normaliza strings decimales persistidos y usa el default canónico para inválidos'() {
        const decimal = LegacyMigrator.migrate({ settings: { regularHoursPerDay: '7.5' } });
        const invalid = LegacyMigrator.migrate({ settings: { regularHoursPerDay: 'invalid' } });

        testRunner.assertEquals(decimal.data.settings.regularHoursPerDay, 7.5);
        testRunner.assertEquals(invalid.data.settings.regularHoursPerDay, 8);
    },

    'el déficit de tarjetas migra apagado y conserva true explícito'() {
        const missing = LegacyMigrator.migrate({ settings: {} });
        const enabled = LegacyMigrator.migrate({ settings: { showAttendanceCardDeficit: true } });
        testRunner.assertEquals(missing.data.settings.showAttendanceCardDeficit, false);
        testRunner.assertEquals(enabled.data.settings.showAttendanceCardDeficit, true);
    }
});
