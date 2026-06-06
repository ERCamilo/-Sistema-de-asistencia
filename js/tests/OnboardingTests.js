import { onboardingWizard } from '../modules/ui/Onboarding.js';

testRunner.addSuite("Onboarding — Asistente de bienvenida responsivo", {

    "renderStep: incluye las clases responsivas en lugar de padding inline rígido"() {
        // Simular el estado para el paso de bienvenida
        const originalStep = window.state.onboardingStep;
        window.state.onboardingStep = 0; // step 'welcome'

        const html = onboardingWizard.renderStep();

        testRunner.assert(typeof html === 'string', 'El onboarding debe retornar un string de HTML');
        testRunner.assert(html.includes('onboarding-step-container'), 'Debe incluir la clase de contenedor responsivo onboarding-step-container');
        testRunner.assert(html.includes('onboarding-spacing-y'), 'Debe incluir la clase de espaciado responsivo onboarding-spacing-y');
        
        // Verificar que hayamos removido los paddings fijos inline en los contenedores clave
        testRunner.assert(!html.includes('padding: 60px 40px;'), 'No debe contener padding inline rígido padding: 60px 40px;');
        testRunner.assert(!html.includes('margin-bottom: 40px;'), 'No debe contener margin-bottom inline rígido margin-bottom: 40px;');

        // Limpiar
        window.state.onboardingStep = originalStep;
    }
});
