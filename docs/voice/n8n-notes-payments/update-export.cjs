#!/usr/bin/env node
// Offline transformation only. Never calls n8n/Gemini or activates a workflow.
const fs = require('node:fs');
const path = require('node:path');
function updateWorkflow(source) {
    const workflow = JSON.parse(JSON.stringify(source));
    const node = name => {
        const matches = workflow.nodes.filter(n => n.name === name);
        if (matches.length !== 1) throw Error('Se requiere exactamente un nodo: ' + name);
        return matches[0];
    };
    node('Preparar solicitud Gemini').parameters.jsCode = fs.readFileSync(path.join(__dirname,'prepare-request.js'),'utf8');
    node('Validar respuesta Gemini v1').parameters.jsCode = fs.readFileSync(path.join(__dirname,'validate-response.js'),'utf8');
    const assignment = node('Orden para Gemini').parameters.assignments.assignments.find(a => a.name === 'GeminiPromp');
    if (!assignment) throw Error('No se encontró GeminiPromp');
    assignment.value = fs.readFileSync(path.join(__dirname,'prompt.txt'),'utf8');
    workflow.name = 'SA Voice - notas y abonos - revisión';
    workflow.active = false;
    workflow.pinData = {};
    for (const key of ['id','versionId','activeVersionId','meta','tags']) delete workflow[key];
    return workflow;
}
module.exports = { updateWorkflow };
if (require.main === module) {
    const [, , input, output] = process.argv;
    if (!input || !output || path.resolve(input) === path.resolve(output)) throw Error('Uso: node update-export.cjs entrada.json salida-nueva.json');
    fs.writeFileSync(output, JSON.stringify(updateWorkflow(JSON.parse(fs.readFileSync(input,'utf8'))),null,2) + '\n', {flag:'wx',mode:0o600});
    console.log('Exportación de revisión creada, inactiva y sin datos fijados.');
}
