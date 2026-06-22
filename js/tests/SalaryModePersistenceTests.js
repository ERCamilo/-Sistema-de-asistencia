/**
 * 🧪 SalaryModePersistenceTests — Los campos aditivos del modo de carga de salario
 * deben SOBREVIVIR el ciclo de serialización (toJSON -> fromJSON). Si el modelo los
 * descartara, se perderían en el próximo guardado/carga (el riesgo que motivó este test).
 */

import { Position } from '../modules/features/employees/Position.js';
import { Employee } from '../modules/features/employees/Employee.js';

testRunner.addSuite("Salario — persistencia del modo de carga (aditivo)", {

    "Position conserva salaryInputMode en el round-trip"() {
        const json = new Position({ name: 'Albañil', hourlyRate: 125, salaryInputMode: 'daily' }).toJSON();
        testRunner.assertEquals(json.salaryInputMode, 'daily', "toJSON debe incluir salaryInputMode");
        const back = Position.fromJSON(json);
        testRunner.assertEquals(back.salaryInputMode, 'daily', "fromJSON debe restaurar salaryInputMode");
    },

    "Position default = 'hourly' (datos viejos sin el campo)"() {
        const back = Position.fromJSON({ name: 'Ayudante', hourlyRate: 100 });
        testRunner.assertEquals(back.salaryInputMode, 'hourly', "ausencia -> 'hourly' (compat)");
    },

    "Position normaliza valores inválidos a 'hourly'"() {
        testRunner.assertEquals(new Position({ name: 'X', salaryInputMode: 'mensual' }).salaryInputMode, 'hourly', "valor raro -> 'hourly'");
    },

    "Employee conserva positionSalaryModes en el round-trip"() {
        const json = new Employee({ name: 'Juan', positionSalaries: { p1: 125 }, positionSalaryModes: { p1: 'daily' } }).toJSON();
        testRunner.assertEquals(json.positionSalaryModes.p1, 'daily', "toJSON debe incluir positionSalaryModes");
        const back = Employee.fromJSON(json);
        testRunner.assertEquals(back.positionSalaryModes.p1, 'daily', "fromJSON debe restaurar positionSalaryModes");
    },

    "Employee default = {} (datos viejos sin el campo)"() {
        const back = Employee.fromJSON({ name: 'Ana', positionSalaries: { p1: 100 } });
        testRunner.assert(back.positionSalaryModes && typeof back.positionSalaryModes === 'object', "ausencia -> {} (compat)");
        testRunner.assertEquals(Object.keys(back.positionSalaryModes).length, 0, "mapa vacío por defecto");
    }
});

console.log('🧪 SalaryModePersistence tests cargados.');
