// Prueba unitaria del parser heurístico de respaldo (sin Google Vision ni Claude),
// usando el texto que se esperaría como salida de OCR para test-assets/sample-receipt.jpg.
const { _internal } = require('../api/analyze');

const sampleOcrText = `Restaurante La Marina
CIF B12345678
Calle Mayor 10, Vigo

Fecha: 20/06/2026
Ticket #00231

1x Menu del dia        12,50
1x Cafe                 1,50
1x Agua                 2,00

TOTAL:           16,00 EUR

Gracias por su visita`;

const result = _internal.structureWithHeuristics(sampleOcrText);
console.log(JSON.stringify(result, null, 2));

const checks = [
  ['merchant', result.merchant === 'Restaurante La Marina'],
  ['amount', result.amount === 16.0],
  ['currency', result.currency === 'EUR'],
  ['date', result.date === '2026-06-20'],
  ['category', result.category === 'restaurant'],
];

let allOk = true;
for (const [field, ok] of checks) {
  console.log(`${ok ? 'OK' : 'FALLO'} - ${field}`);
  if (!ok) allOk = false;
}
process.exit(allOk ? 0 : 1);
