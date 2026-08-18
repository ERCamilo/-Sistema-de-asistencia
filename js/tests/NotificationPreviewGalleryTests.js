import { openSafeNotificationPreview } from '../modules/ui/NotificationPreviewGallery.js';

testRunner.addSuite("NotificationPreviewGallery — vista previa segura de notificaciones", {
    "openSafeNotificationPreview dispara toast de éxito"() {
        let called = false;
        const opened = openSafeNotificationPreview('success', {
            notification: {
                success: (msg) => { called = msg.includes('sincronizado'); }
            }
        });
        testRunner.assert(opened, 'debe devolver true para success');
        testRunner.assert(called, 'debe invocar notification.success');
    },

    "openSafeNotificationPreview dispara warning con botón reintentar"() {
        let warningCalled = false;
        const opened = openSafeNotificationPreview('warning-retry', {
            notification: {
                warning: (msg, opts) => {
                    warningCalled = true;
                    testRunner.assert(opts.actions && opts.actions.length > 0, 'debe incluir acción de reintentar');
                    testRunner.assertEquals(opts.actions[0].label, 'Reintentar');
                }
            }
        });
        testRunner.assert(opened, 'debe devolver true para warning-retry');
        testRunner.assert(warningCalled, 'debe invocar notification.warning');
    },

    "openSafeNotificationPreview dispara error, info, loading, update y stack"() {
        const spy = {
            error: jest.fn(),
            info: jest.fn(),
            loading: jest.fn().mockReturnValue({ update: jest.fn() }),
            clearAll: jest.fn()
        };
        // Mock constructor for variant 'update'
        function MockNotification(opts) {
            this.show = jest.fn();
            testRunner.assertEquals(opts.variant, 'update');
        }
        Object.assign(MockNotification, spy);

        testRunner.assert(openSafeNotificationPreview('error', { notification: MockNotification }));
        testRunner.assert(openSafeNotificationPreview('info', { notification: MockNotification }));
        testRunner.assert(openSafeNotificationPreview('loading', { notification: MockNotification }));
        testRunner.assert(openSafeNotificationPreview('update', { notification: MockNotification }));
        testRunner.assert(openSafeNotificationPreview('stack', { notification: MockNotification }));

        testRunner.assert(spy.error.mock.calls.length > 0, 'error llamado');
        testRunner.assert(spy.info.mock.calls.length > 0, 'info llamado');
        testRunner.assert(spy.loading.mock.calls.length > 0, 'loading llamado');
        testRunner.assert(spy.clearAll.mock.calls.length > 0, 'clearAll llamado en stack');
    },

    "kind desconocido devuelve false"() {
        const opened = openSafeNotificationPreview('unknown-kind', {});
        testRunner.assertEquals(opened, false, 'tipo desconocido no debe abrir nada');
    }
});
