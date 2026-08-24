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
// Logo Antrade incrustado como base64 (evita dependencia del filesystem en Vercel Lambda)
const LOGO_BYTES = Buffer.from('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', 'base64');

const SHEET_MODEL = 'x_transfluid_data_sheet';

// ---------------------------------------------------------------------------
// Field definitions (must match [token].js exactly)
// ---------------------------------------------------------------------------
const SECTIONS = [
  {
    id: 'tf430',
    title: 'TF7430 - Datos de Instalacion',
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
    title: 'TF7324 - Motor Diesel',
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
    title: 'TF7324 - Reductora',
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
    title: 'TF7324 - Acoplamiento Motor-Reductora',
    fields: [
      { name: 'x_7324_coup_basic',       ori: 'x_7324_coup_basic_ori',       label: 'Tipo basico de acoplamiento',                                    type: 'char' },
      { name: 'x_7324_coup_detail',      ori: 'x_7324_coup_detail_ori',       label: 'Detalles constructivos del acoplamiento',                        type: 'char' },
    ],
  },
  {
    id: 'tf7324_cardan',
    title: 'TF7324 - Eje Cardan',
    fields: [
      { name: 'x_7324_cardan_iner',      ori: 'x_7324_cardan_iner_ori',      label: 'Eje cardan: inercia (kgm2)',                                     type: 'char' },
      { name: 'x_7324_cardan_iner_sti',  ori: 'x_7324_cardan_iner_sti_ori',  label: 'Eje cardan: inercia y rigidez torsional (kgm2 / Nm/rad)',         type: 'char' },
      { name: 'x_7324_cardan_geom',      ori: 'x_7324_cardan_geom_ori',       label: 'Eje cardan: geometria (longitud, diametros)',                    type: 'char' },
    ],
  },
  {
    id: 'tf7324_tail',
    title: 'TF7324 - Eje de Cola',
    fields: [
      { name: 'x_7324_tail_iner',        ori: 'x_7324_tail_iner_ori',        label: 'Eje de cola: inercia (kgm2)',                                    type: 'char' },
      { name: 'x_7324_tail_iner_sti',    ori: 'x_7324_tail_iner_sti_ori',    label: 'Eje de cola: inercia y rigidez torsional',                       type: 'char' },
      { name: 'x_7324_tail_geom',        ori: 'x_7324_tail_geom_ori',        label: 'Eje de cola: geometria (longitud, diametros)',                    type: 'char' },
    ],
  },
  {
    id: 'tf7324_prop',
    title: 'TF7324 - Helice',
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
  const SECTION_GAP = 18;

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

  // Logo top-right
  if (LOGO_BYTES) {
    try {
      const logoImg = await pdfDoc.embedPng(LOGO_BYTES);
      const logoH = 36;
      const logoW = (logoImg.width / logoImg.height) * logoH;
      page.drawImage(logoImg, { x: W - MR - logoW, y: H - MT - logoH + 8, width: logoW, height: logoH });
    } catch (_) { /* logo opcional */ }
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
    ensureSpace(50 + SECTION_GAP);
    y -= SECTION_GAP;
    hRule(true);
    y -= 2;
    drawLine(sec.title, ML, 11, true, rgb(0.1, 0.33, 0.67));
    hRule(false);

    for (const f of sec.fields) {
      ensureSpace(28);

      if (f.type === 'binary') {
        const ori = sheet[f.ori] || '';
        const oriLabel = ori === 'known' ? '[Antrade]' : ori === 'verify' ? '[Verificar]' : '[Cliente]';
        drawLine(`${f.label} ${oriLabel}`, ML + 4, 8, true, rgb(0.3, 0.3, 0.3));
        drawLine('  [Archivo - ver adjunto o solicitar por email]', ML + 12, 8, false, rgb(0.55, 0.55, 0.55));
      } else {
        const odooVal = f.name ? toPdf(sheet[f.name]) : '';
        const ori = sheet[f.ori] || '';
        const oriLabel = ori === 'known' ? '[Antrade-confirmado]' : ori === 'verify' ? '[Antrade-verificar]' : '[Cliente]';
        drawLine(`${f.label}`, ML + 4, 8, true, rgb(0.3, 0.3, 0.3));
        const c = odooVal ? rgb(0, 0, 0) : rgb(0.55, 0.55, 0.55);
        drawLine(`  ${odooVal || '(no proporcionado)'}   ${oriLabel}`, ML + 12, 8, false, c);
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
