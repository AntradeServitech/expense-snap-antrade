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

// Caso real reportado: ticket de supermercado con una línea "TOTAL (N ARTÍCULOS)" señuelo
// y un precio por peso (19,90 €/kg) más grande que el total real — antes esto hacía que el
// fallback heurístico devolviera 195 en vez de 23,56.
const mercadonaOcrText = `MERCADONA, S.A.
C/ Example 1, Vigo

TOTAL (8 ARTÍCULOS)

1,950 kg Plátano de Canarias
   1,99 €/kg                3,88
Pan de molde                 1,20
Leche entera 1L            195,00
Aceite de oliva 1L           5,48

TOTAL:                     23,56
TARJETA                    23,56`;

const mercadonaResult = _internal.structureWithHeuristics(mercadonaOcrText);
console.log('\n' + JSON.stringify(mercadonaResult, null, 2));

const mercadonaChecks = [
  ['amount', mercadonaResult.amount === 23.56],
  ['category', mercadonaResult.category === 'office'],
];

for (const [field, ok] of mercadonaChecks) {
  console.log(`${ok ? 'OK' : 'FALLO'} - mercadona.${field}`);
  if (!ok) allOk = false;
}

process.exit(allOk ? 0 : 1);
