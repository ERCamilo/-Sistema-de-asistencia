/**
 * Con obras activas, el arranque no intenta convertir pagos de nómina antiguos
 * en cierres sin obra (fallaba siempre con ProjectScopedGateError). Esos lotes
 * los recupera el asistente de «Datos pendientes de asignación».
 */
const fs = require('fs');
const path = require('path');

test('la migración de cierres antiguos solo corre sin obras activas', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
    const call = app.indexOf('await migrateLegacyPayrollClosures(state.employees');
    expect(call).toBeGreaterThan(-1);
    const before = app.slice(Math.max(0, call - 700), call);
    expect(before).toMatch(/if \(!isProjectsEnabled\(\)\) \{\s*try \{\s*$/);
});
