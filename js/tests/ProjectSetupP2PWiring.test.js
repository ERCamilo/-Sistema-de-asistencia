const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('official project setup is reachable from Settings and registered by app', () => {
    const general = read('js/modules/ui/settings/SettingsGeneralTab.js');
    const settings = read('js/modules/ui/SettingsUI.js');
    const app = read('js/app.js');
    expect(general).toContain('data-settings-action="open-project-setup"');
    expect(general).toContain('Configurar proyecto');
    expect(settings).toMatch(/'open-project-setup': \(\) => guardSettingsDraftOnLeave\(\{[\s\S]*openProjectSetupModal/);
    expect(app).toContain("registerProjectSetupGlobals");
    const projectsUi = read('js/modules/features/projects/ProjectsUI.js');
    expect(projectsUi).toContain('window.getProjectSetupState = () => projectSetupService.getState()');
    expect(app).toContain("./modules/features/projects/ProjectsUI.js");
    const sw = read('sw.js');
    expect(sw).toContain('./js/modules/features/projects/ProjectsUI.js');
    expect(sw).toContain('./js/modules/features/projects/ProjectSetupService.js');
});

test('setup UI requires explicit activation and explains the existing additive migration', () => {
    const ui = read('js/modules/features/projects/ProjectsUI.js');
    expect(ui).toContain('Activar Proyectos y preparar el proyecto actual');
    expect(ui).toContain('asociará de forma aditiva los datos actuales');
    expect(ui).toContain('No se creará un identificador a partir del nombre de la empresa');
    expect(ui).toContain("projectSetupService.activate({ uid: window.currentUser?.uid || null })");
    expect(ui).not.toContain('Project.create(');
});

test('P2P shows canonical active project and blocks all UI send entrypoints until setup is ready', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).toContain("getProjectSetupState()");
    expect(ui).not.toContain("../projects/ProjectSetupService.js");
    expect(ui).toContain('Proyecto a enviar');
    expect(ui).toContain('data-configure-project');
    expect(ui).toContain("projectState.ready ? '' : 'disabled aria-disabled=\"true\"");
    expect(ui).toContain("if (!projectState.ready)");
    expect(ui).toContain("Configura un proyecto activo antes de enviar el roster.");
    expect(ui).toContain('Proyecto: <strong>${esc(projectState.activeProject?.name || projectState.activeProjectId)}</strong>');
});

test('export boundary still revalidates canonical EntityScope at send time', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).toContain('const scope = await getEntityScope();');
    expect(ui).toContain('const saProjectId = resolveSaMiniRosterScope(scope);');
    expect(ui).toMatch(/sendRosterOnChannel[\s\S]*await buildRosterText\(includeSalary\)/);
});

test('project changes refresh an open P2P home instead of keeping stale readiness', () => {
    const ui = read('js/modules/features/p2p/P2PRosterUI.js');
    expect(ui).toContain("window.addEventListener('projects:setup-changed'");
    expect(ui).toContain("if (modal()) renderHome()");
});
