import { EmployeeProfileModal } from '../modules/features/profile/EmployeeProfileModal.js';

testRunner.addSuite("EmployeeProfileModal — Pestañas y cabecera responsiva", {

    "EmployeeProfileModal: renderiza correctamente el modal shell y sus pestañas"() {
        const originalShow = window.state.showEmployeeProfile;
        const originalProfile = window.state.employeeProfile;
        const originalEmployees = window.state.employees;

        // Simular un empleado en el estado
        window.state.employees = [
            { id: 'emp-123', name: 'Juan Perez', active: true, joinedAt: Date.now(), positions: [] }
        ];
        window.state.showEmployeeProfile = true;
        window.state.employeeProfile = {
            employeeId: 'emp-123',
            activeTab: 'resumen'
        };

        const html = EmployeeProfileModal();

        testRunner.assert(typeof html === 'string', 'Debe retornar un string de HTML');
        testRunner.assert(html.includes('Juan Perez'), 'Debe incluir el nombre del empleado');
        testRunner.assert(html.includes('data-app-fn="close-employee-profile"'), 'Debe incluir el botón para volver o cerrar');
        testRunner.assert(html.includes('data-app-fn="changeProfileTab"'), 'Debe incluir botones de pestañas');
        testRunner.assert(html.includes('data-arg="resumen"'), 'Debe incluir pestaña resumen');
        testRunner.assert(html.includes('data-arg="nomina"'), 'Debe incluir pestaña nomina');
        testRunner.assert(html.includes('data-arg="asistencia"'), 'Debe incluir pestaña asistencia');
        testRunner.assert(html.includes('data-arg="documentos"'), 'Debe incluir pestaña documentos');

        // Limpiar
        window.state.showEmployeeProfile = originalShow;
        window.state.employeeProfile = originalProfile;
        window.state.employees = originalEmployees;
    }
});
