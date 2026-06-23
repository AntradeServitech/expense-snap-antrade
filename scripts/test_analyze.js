// Prueba aislada de /api/analyze (no toca Odoo): OCR con Google Vision + estructuración
// (Claude si hay ANTHROPIC_API_KEY, si no heurísticas) sobre el ticket sintético.
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
  const analyzeHandler = require('../api/analyze');
  const imagePath = path.join(__dirname, '..', 'test-assets', 'sample-receipt.jpg');
  const imageBase64 = fs.readFileSync(imagePath).toString('base64');

  console.log('--- TEST: POST /api/analyze (Google Vision OCR + estructuración) ---');
  const res = mockRes();
  await analyzeHandler({ method: 'POST', body: { image: imageBase64, mimeType: 'image/jpeg' } }, res);
  console.log('status:', res.statusCode);
  console.log(JSON.stringify(res.body, null, 2));
}

main().catch((err) => {
  console.error('FALLO:', err);
  process.exit(1);
});
