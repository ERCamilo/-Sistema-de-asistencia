import FirebaseService from '../modules/services/FirebaseServiceReal.js';
import { writeBatch, deleteObject } from '../data/firebase.js';

testRunner.addSuite("FirebaseService — Sincronización y Borrado", {

    async "deleteSnapshot: invoca deleteObject para limpiar Storage"() {
        const { getDoc, auth } = await import('../data/firebase.js');
        // Reiniciar mock
        deleteObject.mockClear();
        auth.currentUser = { uid: 'user123' };

        // Mockear getDoc para simular que el snapshot existe y es externo
        getDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ isExternal: true })
        });

        const svc = FirebaseService;
        svc.user = { uid: 'user123' };

        // Simular llamada a deleteSnapshot
        await svc.deleteSnapshot('snap123');

        // Validar que se invocó deleteObject
        testRunner.assert(deleteObject.mock.calls.length > 0, "Debe llamar a deleteObject para eliminar el snapshot físico del Storage");
    },

    async "syncHistory: divide la sincronización en lotes de máximo 500 operaciones"() {
        const svc = FirebaseService;
        
        // Simular que el usuario está logueado
        // FirebaseService lee `auth.currentUser` directamente. Pero en el mock, auth está vacío por defecto.
        // Vamos a inyectar currentUser temporalmente en auth:
        const { auth } = await import('../data/firebase.js');
        auth.currentUser = { uid: 'user123' };

        // Crear un historial simulado de 1005 días (lo que requiere 3 lotes: 500, 500, 5)
        const allAttendance = {};
        for (let i = 1; i <= 1005; i++) {
            const dateKey = `2026-05-${i}`;
            allAttendance[`emp1-${dateKey}`] = {
                date: dateKey,
                employeeId: 'emp1',
                present: true,
                hoursWorked: 8
            };
        }

        // Espiar las llamadas a commit
        const mockCommit = jest.fn().mockResolvedValue(undefined);
        writeBatch.mockImplementation(() => ({
            set: jest.fn(),
            commit: mockCommit
        }));

        await svc.syncHistory(allAttendance);

        // Validar que se dividió en 3 batches
        const commitCalls = mockCommit.mock.calls.length;
        testRunner.assertEquals(commitCalls, 3, `Debe llamar a commit() exactamente 3 veces para 1005 registros. Llamadas recibidas: ${commitCalls}`);

        // Limpiar mock de writeBatch
        writeBatch.mockRestore?.();
        auth.currentUser = null;
    }
});
