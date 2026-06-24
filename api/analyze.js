// POST /api/analyze
// Recibe { image: <base64 sin prefijo>, mimeType } y extrae los datos del ticket en 2 fases:
//   1) OCR con Google Cloud Vision (texto completo del ticket).
//   2) Estructuración del texto a JSON con Claude (claude-sonnet-4-6), si ANTHROPIC_API_KEY
//      está configurada; si no, se usa un parser heurístico (regex) como respaldo.
// No escribe nada en Odoo.
const GOOGLE_VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

const STRUCTURE_SYSTEM_PROMPT = `Eres un asistente que extrae datos estructurados de texto de tickets y facturas. El texto puede estar en cualquier idioma. Devuelve SOLO un JSON válido sin markdown con esta estructura exacta:
{
  "merchant": "nombre del establecimiento",
  "amount": numero decimal,
  "currency": "codigo ISO 4217 (EUR, USD, GBP, etc)",
  "date": "YYYY-MM-DD",
  "category": "restaurant|hotel|transport|fuel|office|other",
  "description": "descripcion breve en espanol, maximo 50 caracteres",
  "confidence": "high|medium|low"
}
Si no puedes leer algun campo, usa null.`;

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BASE64_CHARS = 6_000_000; // ~4.5MB binario, margen para el límite de body de Vercel

const CATEGORY_KEYWORDS = {
  restaurant: ['restaurante', 'restaurant', 'cafe', 'café', 'bar', 'menu', 'menú', 'comida', 'pizza'],
  hotel: ['hotel', 'hostal', 'alojamiento', 'booking', 'check-in', 'check-out', 'inn', 'marriott'],
  transport: ['taxi', 'uber', 'cabify', 'metro', 'bus', 'tren', 'parking', 'aparcamiento', 'peaje', 'renfe', 'iberia', 'ryanair'],
  fuel: ['gasolina', 'gasoil', 'diesel', 'combustible', 'repsol', 'cepsa', 'bp', 'shell'],
  // Supermercados: sin categoría dedicada en Odoo todavía, se mapean a "office" (ver CLAUDE.md).
  office: ['oficina', 'papeleria', 'papelería', 'material', 'office', 'mercadona', 'carrefour', 'lidl', 'aldi', 'supermercado', 'market', 'super'],
};

const CURRENCY_SYMBOLS = { '€': 'EUR', '$': 'USD', '£': 'GBP' };
const KNOWN_CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'JPY', 'BRL', 'ARS'];

// Orden de prioridad para localizar el importe total en el texto OCR.
const TOTAL_KEYWORDS = ['total'];
const SECONDARY_AMOUNT_KEYWORDS = ['importe', 'a pagar', 'suma', 'amount', 'montant', 'gesamt', 'totale'];
const MONEY_RE = /\d{1,6}[.,]\d{2}/;

function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  return JSON.parse(cleaned);
}

async function ocrWithGoogleVision(image, apiKey) {
  const response = await fetch(`${GOOGLE_VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: image },
          // Solo DOCUMENT_TEXT_DETECTION: está pensado para texto denso (tickets/facturas) y ya
          // da el mismo fullTextAnnotation.text. Pedir también TEXT_DETECTION duplicaría el coste
          // (cada feature solicitada se factura como una unidad independiente por imagen).
          features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google Vision HTTP ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const result = data.responses && data.responses[0];
  if (result && result.error) {
    throw new Error(`Google Vision: ${result.error.message}`);
  }
  return (result && result.fullTextAnnotation && result.fullTextAnnotation.text) || '';
}

async function structureWithClaude(ocrText, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system: STRUCTURE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Texto extraído del ticket/factura (OCR):\n\n${ocrText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Claude API HTTP ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const text = (data.content && data.content[0] && data.content[0].text) || '';
  return extractJson(text);
}

function parseCurrency(text) {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  const codeMatch = text.match(new RegExp(`\\b(${KNOWN_CURRENCY_CODES.join('|')})\\b`));
  return codeMatch ? codeMatch[1] : null;
}

// Busca, en las líneas que contienen alguna de `keywords`, un importe en la misma línea
// o en la línea inmediatamente siguiente. Tickets reales suelen repetir la palabra "total"
// en líneas sin importe útil (p.ej. "TOTAL (8 ARTÍCULOS)" antes del "TOTAL: 23,56€" real),
// así que: 1) se prioriza siempre un importe en la MISMA línea que la palabra clave (más
// fiable que mirar la línea siguiente), y 2) si hay varias coincidencias se usa la ÚLTIMA,
// porque el total real suele aparecer al final, después de los importes por artículo.
function findAmountNearKeywords(lines, keywords) {
  let sameLineCandidate = null;
  let nextLineCandidate = null;

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (!keywords.some((kw) => lower.includes(kw))) continue;

    const sameLineMatch = lines[i].match(MONEY_RE);
    if (sameLineMatch) {
      sameLineCandidate = sameLineMatch[0];
      continue;
    }

    const nextLine = lines[i + 1];
    const nextLineMatch = nextLine && nextLine.match(MONEY_RE);
    if (nextLineMatch) nextLineCandidate = nextLineMatch[0];
  }

  return sameLineCandidate || nextLineCandidate;
}

function parseAmount(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // a) líneas con "total"
  let amountStr = findAmountNearKeywords(lines, TOTAL_KEYWORDS);

  // b) líneas con importe/a pagar/suma/amount/montant/gesamt/totale
  if (!amountStr) amountStr = findAmountNearKeywords(lines, SECONDARY_AMOUNT_KEYWORDS);

  // c) último recurso: el número con decimales más grande de todo el texto
  if (!amountStr) {
    const numbers = [...text.matchAll(new RegExp(MONEY_RE, 'g'))].map((m) => m[0]);
    if (numbers.length) {
      amountStr = numbers.reduce((max, cur) => {
        const toFloat = (s) => parseFloat(s.replace(',', '.'));
        return toFloat(cur) > toFloat(max) ? cur : max;
      });
    }
  }

  return amountStr ? parseFloat(amountStr.replace(',', '.')) : null;
}

function parseDate(text) {
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const euMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (euMatch) {
    let [, day, month, year] = euMatch;
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

function categoryFromKeywords(value) {
  const lower = value.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return null;
}

// Prioriza el nombre del establecimiento (más fiable, p.ej. "MERCADONA" → office) y solo
// si no encuentra nada ahí cae al texto completo del ticket.
function guessCategory(merchant, fullText) {
  return categoryFromKeywords(merchant || '') || categoryFromKeywords(fullText) || 'other';
}

function structureWithHeuristics(ocrText) {
  const lines = ocrText.split('\n').map((l) => l.trim()).filter(Boolean);
  const merchant = lines[0] || null;
  const amount = parseAmount(ocrText);
  const currency = parseCurrency(ocrText);
  const date = parseDate(ocrText);
  const category = guessCategory(merchant, ocrText);

  return {
    merchant,
    amount,
    currency: currency || 'EUR',
    date,
    category,
    description: merchant || 'Gasto (extracción automática)',
    confidence: 'low',
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const googleApiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!googleApiKey) {
    console.error('GOOGLE_VISION_API_KEY no configurada en el servidor');
    return res.status(500).json({ error: 'El análisis de tickets no está disponible ahora mismo. Inténtalo más tarde.' });
  }

  const { image, mimeType } = req.body || {};
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: 'Falta la imagen (campo "image" en base64)' });
  }
  if (!ALLOWED_MIME.includes(mimeType)) {
    return res.status(400).json({ error: `Tipo de imagen no soportado: ${mimeType}` });
  }
  if (image.length > MAX_BASE64_CHARS) {
    return res.status(413).json({ error: 'La imagen es demasiado grande. Reduce la resolución e inténtalo de nuevo.' });
  }

  let ocrText;
  try {
    ocrText = await ocrWithGoogleVision(image, googleApiKey);
  } catch (err) {
    console.error('Error Google Vision:', err.message);
    return res.status(502).json({ error: 'No se pudo analizar la imagen. Inténtalo de nuevo.', detail: err.message });
  }

  if (!ocrText.trim()) {
    return res.status(502).json({ error: 'No se detectó texto en la imagen. Prueba con otra foto, con mejor luz o más enfocada.' });
  }

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  let extracted;
  let structuredBy = 'heuristics';

  if (anthropicApiKey) {
    try {
      extracted = await structureWithClaude(ocrText, anthropicApiKey);
      structuredBy = 'claude';
    } catch (err) {
      console.error('Fallo al estructurar con Claude, usando heurísticas de respaldo:', err.message);
    }
  }

  if (!extracted) {
    extracted = structureWithHeuristics(ocrText);
  }

  res.status(200).json({ extracted, structured_by: structuredBy, ocr_text: ocrText });
};

// Expuesto solo para pruebas unitarias del parser de respaldo (scripts/test_heuristics.js).
module.exports._internal = { structureWithHeuristics };
