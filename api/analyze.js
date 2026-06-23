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
  restaurant: ['restaurante', 'restaurant', 'cafe', 'café', 'bar', 'menu', 'menú', 'comida'],
  hotel: ['hotel', 'hostal', 'alojamiento', 'booking', 'check-in', 'check-out'],
  transport: ['taxi', 'uber', 'cabify', 'metro', 'bus', 'tren', 'parking', 'aparcamiento', 'peaje'],
  fuel: ['gasolina', 'gasoil', 'diesel', 'combustible', 'repsol', 'cepsa', 'bp', 'shell'],
  office: ['oficina', 'papeleria', 'papelería', 'material', 'office'],
};

const CURRENCY_SYMBOLS = { '€': 'EUR', '$': 'USD', '£': 'GBP' };
const KNOWN_CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'JPY', 'BRL', 'ARS'];

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

function parseAmountAndCurrency(text) {
  let currency = null;
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) {
      currency = code;
      break;
    }
  }
  if (!currency) {
    const codeMatch = text.match(new RegExp(`\\b(${KNOWN_CURRENCY_CODES.join('|')})\\b`));
    if (codeMatch) currency = codeMatch[1];
  }

  // Busca un importe junto a palabras clave de total en varios idiomas.
  const totalLineRegex = /(total|importe|amount|suma|gesamt)[^\d]{0,15}(\d{1,6}([.,]\d{2})?)/i;
  const totalMatch = text.match(totalLineRegex);
  let amountStr = totalMatch ? totalMatch[2] : null;

  if (!amountStr) {
    // Respaldo: el número con decimales más grande del texto.
    const numbers = [...text.matchAll(/\d{1,6}[.,]\d{2}/g)].map((m) => m[0]);
    if (numbers.length) {
      amountStr = numbers.reduce((max, cur) => {
        const toFloat = (s) => parseFloat(s.replace(',', '.'));
        return toFloat(cur) > toFloat(max) ? cur : max;
      });
    }
  }

  const amount = amountStr ? parseFloat(amountStr.replace(',', '.')) : null;
  return { amount, currency };
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

function guessCategory(text) {
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return category;
  }
  return 'other';
}

function structureWithHeuristics(ocrText) {
  const lines = ocrText.split('\n').map((l) => l.trim()).filter(Boolean);
  const merchant = lines[0] || null;
  const { amount, currency } = parseAmountAndCurrency(ocrText);
  const date = parseDate(ocrText);
  const category = guessCategory(ocrText);

  return {
    merchant,
    amount,
    currency: currency || 'EUR',
    date,
    category,
    description: merchant ? `${merchant} (extraído sin Claude)` : 'Gasto (extraído sin Claude)',
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
    return res.status(500).json({ error: 'GOOGLE_VISION_API_KEY no configurada en el servidor' });
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
    return res.status(502).json({ error: 'Error al analizar la imagen con Google Vision', detail: err.message });
  }

  if (!ocrText.trim()) {
    return res.status(502).json({ error: 'Google Vision no detectó texto en la imagen' });
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
