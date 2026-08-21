/**
 * POST /api/data-sheet/regenerate-pdf?secret=...
 *
 * Called by the Odoo ir.actions.server webhook from the "Regenerar PDF" button.
 * Reads the saved content fields from Odoo, builds the PDF, attaches it, and
 * clears x_pdf_generation_error.
 *
 * Odoo sends: { id: <sheet_id>, ... } in the request body.
 * Auth: ?secret=DATA_SHEET_SECRET in query string.
 */

'use strict';

const crypto = require('crypto');
const { execute, searchRead } = require('../_lib/odoo.js');

// Reuse the same PDF builder and field definitions from the token handler.
// We share code via inline copies of the essentials to keep this file self-contained
// (Vercel serverless functions cannot import sibling handlers at runtime).

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const SHEET_MODEL = 'x_transfluid_data_sheet';

// ---------------------------------------------------------------------------
// Field definitions (must match [token].js exactly)
// ---------------------------------------------------------------------------
const SECTIONS = [
  {
    id: 'tf430',
    title: 'TF7430 — Datos de Instalacion',
    fields: [
      { name: 'x_tf430_iacs_society',    ori: 'x_tf430_iacs_society_ori',    label: 'Sociedad clasificadora IACS (si/no, cual)',                    type: 'char' },
      { name: 'x_tf430_cert_required',   ori: 'x_tf430_cert_required_ori',   label: 'Certificacion requerida (tipo)',                                type: 'char' },
      { name: 'x_tf430_gearbox_model',   ori: 'x_tf430_gearbox_model_ori',   label: 'Reductora: modelo',                                            type: 'char' },
      { name: 'x_tf430_gearbox_ratio',   ori: 'x_tf430_gearbox_ratio_ori',   label: 'Reductora: relacion de reduccion',                             type: 'char' },
      { name: 'x_tf430_gearbox_mode',    ori: 'x_tf430_gearbox_mode_ori',    label: 'Reductora: modo de operacion (parallel/sequential hybrid)',     type: 'char' },
      { name: 'x_tf430_gearbox_conn',    ori: 'x_tf430_gearbox_conn_ori',    label: 'Reductora: tipo de conexion motor electrico (SAE...)',          type: 'char' },
      { name: 'x_tf430_battery_voltage', ori: 'x_tf430_battery_volt_ori',    label: 'Tension de bateria (Vdc)',                                      type: 'char' },
      { name: 'x_tf430_throttle_signal', ori: 'x_tf430_throttle_sig_ori',   label: 'Senal del acelerador (tipo y rango de voltaje)',                type: 'char' },
      { name: 'x_tf430_start_stop_pins', ori: 'x_tf430_start_stop_ori',     label: 'Pines arranque/parada del diesel (descripcion)',                type: 'char' },
      { name: null,                       ori: 'x_tf430_diesel_3d_ori',      label: 'Plano 3D del diesel/volante de inercia (archivo)',              type: 'binary', fileName: 'x_tf430_diesel_3d_plan' },
      { name: null,                       ori: 'x_tf430_gearbox_3d_ori',     label: 'Plano 3D de la reductora (archivo)',                            type: 'binary', fileName: 'x_tf430_gearbox_3d_plan' },
      { name: 'x_tf430_prop_rotation',   ori: 'x_tf430_prop_rotation_ori',   label: 'Sentido de rotacion de la helice (CW/CCW)',                     type: 'char' },
      { name: 'x_tf430_sae_interface',   ori: 'x_tf430_sae_interface_ori',   label: 'Interfaz SAE del volante (B/C)',                                type: 'selection', options: [['B','SAE B'],['C','SAE C']] },
    ],
  },
  {
    id: 'tf7324_motor',
    title: 'TF7324 — Motor Diesel',
    fields: [
      { name: 'x_7324_eng_type',         ori: 'x_7324_eng_type_ori',         label: 'Tipo de motor diesel',                                          type: 'char' },
      { name: 'x_7324_eng_power_rpm',    ori: 'x_7324_eng_power_rpm_ori',    label: 'Potencia y regimen nominal (kW @ rpm)',                         type: 'char' },
      { name: 'x_7324_eng_displacement', ori: 'x_7324_eng_displacement_ori', label: 'Cilindrada total (litros)',                                      type: 'char' },
      { name: 'x_7324_eng_firing_angle', ori: 'x_7324_eng_firing_ang_ori',  label: 'Angulo de encendido por cilindro (grados)',                      type: 'char' },
      { name: 'x_7324_eng_cycles',       ori: 'x_7324_eng_cycles_ori',       label: 'Numero de ciclos (2T / 4T)',                                     type: 'char' },
      { name: 'x_7324_eng_bore_stroke',  ori: 'x_7324_eng_bore_stroke_ori',  label: 'Diametro de cilindro y carrera del piston (mm)',                 type: 'char' },
      { name: 'x_7324_eng_conrod',       ori: 'x_7324_eng_conrod_ori',       label: 'Longitud de biela (mm)',                                         type: 'char' },
      { name: 'x_7324_eng_osc_mass',     ori: 'x_7324_eng_osc_mass_ori',     label: 'Masa oscilante piston + biela por cilindro (kg)',                type: 'char' },
      { name: 'x_7324_eng_tors_sys',     ori: 'x_7324_eng_tors_sys_ori',     label: 'Sistema amortiguacion torsional del motor (si/no, tipo)',         type: 'char' },
      { name: 'x_7324_eng_tors_iner',    ori: 'x_7324_eng_tors_iner_ori',    label: 'Inercia del sistema torsional del motor (kgm2)',                  type: 'char' },
      { name: 'x_7324_eng_crankshaft',   ori: 'x_7324_eng_crankshaft_ori',   label: 'Ciguenyal: material y propiedades elasticas',                    type: 'char' },
      { name: 'x_7324_eng_damper_type',  ori: 'x_7324_eng_damper_type_ori',  label: 'Tipo de amortiguador externo (si existe)',                       type: 'char' },
      { name: 'x_7324_eng_damper_iner',  ori: 'x_7324_eng_damper_iner_ori',  label: 'Inercia del amortiguador externo (kgm2)',                        type: 'char' },
      { name: 'x_7324_eng_damper_det',   ori: 'x_7324_eng_damper_det_ori',   label: 'Detalles constructivos del amortiguador',                        type: 'char' },
    ],
  },
  {
    id: 'tf7324_gb',
    title: 'TF7324 — Reductora',
    fields: [
      { name: 'x_7324_gb_tors_iner',    ori: 'x_7324_gb_tors_iner_ori',    label: 'Inercia sistema torsional de la reductora (kgm2)',               type: 'char' },
      { name: 'x_7324_gb_ratio',         ori: 'x_7324_gb_ratio_ori',         label: 'Relacion de reduccion',                                          type: 'char' },
      { name: 'x_7324_gb_tors_sys',      ori: 'x_7324_gb_tors_sys_ori',      label: 'Sistema amortiguacion torsional reductora (si/no)',               type: 'char' },
      { name: 'x_7324_gb_coup_basic',    ori: 'x_7324_gb_coup_basic_ori',    label: 'Acoplamiento: tipo basico',                                       type: 'char' },
      { name: 'x_7324_gb_coup_detail',   ori: 'x_7324_gb_coup_detail_ori',   label: 'Acoplamiento: detalles constructivos',                            type: 'char' },
    ],
  },
  {
    id: 'tf7324_coup',
    title: 'TF7324 — Acoplamiento Motor-Reductora',
    fields: [
      { name: 'x_7324_coup_basic',       ori: 'x_7324_coup_basic_ori',       label: 'Tipo basico de acoplamiento',                                    type: 'char' },
      { name: 'x_7324_coup_detail',      ori: 'x_7324_coup_detail_ori',       label: 'Detalles constructivos del acoplamiento',                        type: 'char' },
    ],
  },
  {
    id: 'tf7324_cardan',
    title: 'TF7324 — Eje Cardan',
    fields: [
      { name: 'x_7324_cardan_iner',      ori: 'x_7324_cardan_iner_ori',      label: 'Eje cardan: inercia (kgm2)',                                     type: 'char' },
      { name: 'x_7324_cardan_iner_sti',  ori: 'x_7324_cardan_iner_sti_ori',  label: 'Eje cardan: inercia y rigidez torsional (kgm2 / Nm/rad)',         type: 'char' },
      { name: 'x_7324_cardan_geom',      ori: 'x_7324_cardan_geom_ori',       label: 'Eje cardan: geometria (longitud, diametros)',                    type: 'char' },
    ],
  },
  {
    id: 'tf7324_tail',
    title: 'TF7324 — Eje de Cola',
    fields: [
      { name: 'x_7324_tail_iner',        ori: 'x_7324_tail_iner_ori',        label: 'Eje de cola: inercia (kgm2)',                                    type: 'char' },
      { name: 'x_7324_tail_iner_sti',    ori: 'x_7324_tail_iner_sti_ori',    label: 'Eje de cola: inercia y rigidez torsional',                       type: 'char' },
      { name: 'x_7324_tail_geom',        ori: 'x_7324_tail_geom_ori',        label: 'Eje de cola: geometria (longitud, diametros)',                    type: 'char' },
    ],
  },
  {
    id: 'tf7324_prop',
    title: 'TF7324 — Helice',
    fields: [
      { name: 'x_7324_prop_type',        ori: 'x_7324_prop_type_ori',        label: 'Tipo de helice',                                                  type: 'selection', options: [['con_tobera','Con tobera'],['sin_tobera','Sin tobera']] },
      { name: 'x_7324_prop_geom',        ori: 'x_7324_prop_geom_ori',        label: 'Geometria de la helice (diametro, paso)',                         type: 'char' },
      { name: 'x_7324_prop_power_rpm',   ori: 'x_7324_prop_power_rpm_ori',   label: 'Potencia y regimen de la helice (kW @ rpm)',                      type: 'char' },
      { name: 'x_7324_prop_blades',      ori: 'x_7324_prop_blades_ori',      label: 'Numero de palas',                                                 type: 'integer' },
      { name: 'x_7324_prop_water_iner',  ori: 'x_7324_prop_water_iner_ori',  label: 'Inercia del agua anadida (kgm2)',                                 type: 'char' },
    ],
  },
];

function buildFieldList() {
  const fields = [
    'id', 'x_project_id', 'x_portal_submitted', 'x_state',
    'x_pdf_generation_error', 'x_last_email_status',
  ];
  for (const sec of SECTIONS) {
    for (const f of sec.fields) {
      if (f.name) fields.push(f.name);
      if (f.ori)  fields.push(f.ori);
    }
  }
  return [...new Set(fields)];
}

// ---------------------------------------------------------------------------
// PDF builder (same logic as [token].js buildPdf — values come from sheet fields)
// ---------------------------------------------------------------------------
function toPdf(v) {
  if (v === null || v === undefined || v === false) return '';
  return String(v).replace(/[^ -ÿ]/g, '?').trim();
}

async function buildPdf(sheet, projectName, declarant, submittedAt) {
  const pdfDoc = await PDFDocument.create();
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const W = 595.28, H = 841.89;
  const ML = 45, MR = 45, MT = 50, MB = 45;
  const CW = W - ML - MR;
  const SECTION_GAP = 10;

  let page = pdfDoc.addPage([W, H]);
  let y = H - MT;

  function ensureSpace(needed) {
    if (y - needed < MB) {
      page = pdfDoc.addPage([W, H]);
      y = H - MT;
    }
  }

  function drawLine(text, x, size, bold, color) {
    const font = bold ? fontB : fontR;
    const c = color || rgb(0, 0, 0);
    page.drawText(toPdf(text) || ' ', { x, y, size, font, color: c });
    y -= size + 4;
  }

  function drawWrapped(text, x, size, maxW, bold) {
    const font = bold ? fontB : fontR;
    const safe = toPdf(text) || '';
    if (!safe) { y -= size + 4; return; }
    const words = safe.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(test, size) > maxW && line) {
        ensureSpace(size + 4);
        page.drawText(line, { x, y, size, font, color: rgb(0, 0, 0) });
        y -= size + 4;
        line = w;
      } else {
        line = test;
      }
    }
    if (line) {
      ensureSpace(size + 4);
      page.drawText(line, { x, y, size, font, color: rgb(0, 0, 0) });
      y -= size + 4;
    }
  }

  function hRule(thick) {
    const lw = thick ? 1 : 0.5;
    const c = thick ? rgb(0.1, 0.1, 0.1) : rgb(0.7, 0.7, 0.7);
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: lw, color: c });
    y -= 6;
  }

  drawLine('FICHA DE DATOS TECNICOS TRANSFLUID (REGENERADO)', ML, 14, true, rgb(0.1, 0.33, 0.67));
  drawLine(`Proyecto: ${toPdf(projectName)}`, ML, 11, false, rgb(0.2, 0.2, 0.2));
  hRule(true);

  drawLine('DECLARACION DEL CLIENTE', ML, 10, true, rgb(0.2, 0.2, 0.2));
  drawLine(`Rellenado por: ${toPdf(declarant)}`, ML + 8, 9, false);
  drawLine(`Fecha de declaracion: ${toPdf(submittedAt)}`, ML + 8, 9, false);
  drawLine('Documento: PDF regenerado desde datos guardados en Odoo', ML + 8, 9, false, rgb(0.6, 0.4, 0));
  y -= 4;
  drawWrapped(
    'AVISO: Este PDF ha sido regenerado automaticamente por Antrade Servitech SL ' +
    'a partir de los datos ya almacenados en Odoo. Los datos declarados por el cliente ' +
    'son responsabilidad del cliente.',
    ML + 8, 8, CW - 8, false
  );
  hRule(true);

  for (const sec of SECTIONS) {
    ensureSpace(32 + SECTION_GAP);
    y -= SECTION_GAP / 2;
    drawLine(sec.title, ML, 10, true, rgb(0.1, 0.33, 0.67));
    hRule(false);

    for (const f of sec.fields) {
      ensureSpace(28);

      if (f.type === 'binary') {
        const ori = sheet[f.ori] || '';
        const oriLabel = ori === 'known' ? '[Antrade]' : ori === 'verify' ? '[Verificar]' : '[Cliente]';
        drawLine(`${f.label} ${oriLabel}`, ML + 4, 8, true, rgb(0.3, 0.3, 0.3));
        drawLine('  [Archivo — ver adjunto o solicitar por email]', ML + 12, 8, false, rgb(0.55, 0.55, 0.55));
      } else {
        const odooVal = f.name ? toPdf(sheet[f.name]) : '';
        const ori = sheet[f.ori] || '';
        const oriLabel = ori === 'known' ? '[Antrade-confirmado]' : ori === 'verify' ? '[Antrade-verificar]' : '[Cliente]';
        drawLine(`${f.label}`, ML + 4, 8, true, rgb(0.3, 0.3, 0.3));
        const c = odooVal ? rgb(0, 0, 0) : rgb(0.55, 0.55, 0.55);
        drawLine(`  ${odooVal || '— (no proporcionado) —'}   ${oriLabel}`, ML + 12, 8, false, c);
      }
      y -= 2;
    }
  }

  y -= SECTION_GAP;
  hRule(true);
  drawLine('Documento generado automaticamente por Antrade Servitech SL', ML, 8, false, rgb(0.5, 0.5, 0.5));

  return await pdfDoc.save();
}

// ---------------------------------------------------------------------------
// Timing-safe secret validation
// ---------------------------------------------------------------------------
function validateSecret(provided, expected) {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch (_) { return false; }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const DS_SECRET = process.env.DATA_SHEET_SECRET;
  if (!DS_SECRET) return res.status(500).json({ error: 'Server misconfigured' });

  const providedSecret = req.query.secret || (req.body && req.body.secret);
  if (!validateSecret(providedSecret, DS_SECRET)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  // Odoo webhooks send { id: <record_id> } (possibly as string or number)
  const sheetId = parseInt(body.id || body.record_id, 10);
  if (!sheetId || isNaN(sheetId)) {
    return res.status(400).json({ error: 'Missing sheet id in request body' });
  }

  console.log('[regenerate-pdf] START for sheet id=' + sheetId);

  try {
    const fields = buildFieldList();
    const sheets = await searchRead(SHEET_MODEL, [['id', '=', sheetId]], fields);
    if (!sheets.length) {
      return res.status(404).json({ error: 'Sheet not found: ' + sheetId });
    }
    const sheet = sheets[0];

    if (!sheet.x_portal_submitted) {
      return res.status(409).json({ error: 'Sheet has not been submitted by the client yet — cannot regenerate PDF' });
    }

    // Resolve project name
    let serialRef = 'Proyecto';
    const pf = sheet.x_project_id;
    const pId = Array.isArray(pf) ? pf[0] : pf;
    if (pId) {
      const projs = await searchRead('project.project', [['id', '=', pId]], ['name', 'x_serial_antrade']);
      if (projs.length) serialRef = projs[0].x_serial_antrade || projs[0].name;
    }

    // Build PDF — submission.fields is empty so buildPdf uses sheet[f.name] (odooVal) exclusively
    const now = new Date();
    const nowStr = now.toLocaleString('es-ES', {
      timeZone: 'Europe/Madrid',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    const declarant = 'Antrade Servitech SL (regeneracion ' + nowStr + ')';

    const pdfBytes = await buildPdf(sheet, serialRef, declarant, nowStr);
    const pdfB64 = Buffer.from(pdfBytes).toString('base64');
    console.log('[regenerate-pdf] pdf ready: ' + pdfBytes.length + ' bytes → ' + pdfB64.length + ' b64 chars');
    const pdfName = `FichaTF_${serialRef.replace(/[^a-zA-Z0-9_-]/g, '_')}_regen_${now.toISOString().slice(0,10)}.pdf`;

    // Attach to Odoo (use 'raw' field, not 'datas', to avoid ORM base64 decode chain issues)
    const attRaw = await execute('ir.attachment', 'create', [{
      name: pdfName,
      type: 'binary',
      raw: pdfB64,
      res_model: SHEET_MODEL,
      res_id: sheetId,
      mimetype: 'application/pdf',
    }]);
    const attId = Array.isArray(attRaw) ? attRaw[0] : attRaw;
    console.log('[regenerate-pdf] PDF attached: ir.attachment id=' + attId);

    // Clear error flag and update status
    const regenStatus = 'PDF regenerado ' + nowStr;
    await execute(SHEET_MODEL, 'write', [[sheetId], {
      x_pdf_generation_error: '',
      x_last_email_status: regenStatus,
    }]);

    console.log('[regenerate-pdf] DONE for sheet id=' + sheetId + ', attachment id=' + attId);

    return res.status(200).json({
      ok: true,
      sheet_id: sheetId,
      attachment_id: attId,
      pdf_name: pdfName,
      message: 'PDF regenerado correctamente. ir.attachment id=' + attId,
    });

  } catch (err) {
    console.error('[regenerate-pdf] ERROR for sheet id=' + sheetId + ':', err.message);

    // Write the new error to Odoo so Jesús sees it in the form
    try {
      const errMsg = (err.message || 'Error desconocido').substring(0, 200);
      await execute(SHEET_MODEL, 'write', [[sheetId], { x_pdf_generation_error: errMsg }]);
    } catch (_) {}

    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
