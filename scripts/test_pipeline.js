// Harness de prueba local: invoca los handlers de api/ directamente con req/res simulados.
// No depende de `vercel dev` (evita requerir login de Vercel para esta prueba).
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const content = fs.readFileSync(file, 'utf8');
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  });
}

loadEnv(path.join(__dirname, '..', '.env'));

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader() {},
  };
  return res;
}

async function main() {
  const projectsHandler = require('../api/projects');
  const submitHandler = require('../api/submit');

  console.log('--- TEST 1: GET /api/projects ---');
  const resProjects = mockRes();
  await projectsHandler({ method: 'GET' }, resProjects);
  console.log('status:', resProjects.statusCode);
  console.log(JSON.stringify(resProjects.body, null, 2));

  console.log('\n--- TEST 2: POST /api/submit (gasto de prueba) ---');
  const imagePath = path.join(__dirname, '..', 'test-assets', 'sample-receipt.jpg');
  const imageBase64 = fs.readFileSync(imagePath).toString('base64');

  const payload = {
    merchant: 'Restaurante La Marina',
    amount: 16.0,
    currency: 'EUR',
    date: '2026-06-20',
    category: 'restaurant',
    description: '[PRUEBA ExpenseSnap - borrar] Comida en restaurante La Marina, Vigo',
    project_id: null,
    image: imageBase64,
    mimeType: 'image/jpeg',
  };

  const resSubmit = mockRes();
  await submitHandler({ method: 'POST', body: payload }, resSubmit);
  console.log('status:', resSubmit.statusCode);
  console.log(JSON.stringify(resSubmit.body, null, 2));
}

main().catch((err) => {
  console.error('FALLO EN EL HARNESS:', err);
  process.exit(1);
});
