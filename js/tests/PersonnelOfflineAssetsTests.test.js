import fs from 'fs';
import path from 'path';

describe('recursos offline del rediseño de Personal', () => {
    const projectRoot = path.resolve(__dirname, '..', '..');

    test('precarga la hoja de estilos enlazada por la aplicación', () => {
        const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
        const serviceWorker = fs.readFileSync(path.join(projectRoot, 'sw.js'), 'utf8');

        expect(indexHtml).toContain('href="css/personnel.css"');
        expect(serviceWorker).toContain("'./css/personnel.css'");
    });
});
