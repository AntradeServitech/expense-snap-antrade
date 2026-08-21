/**
 * GET  /api/data-sheet/[token]  — Renders the client-facing data form
 * POST /api/data-sheet/[token]  — Processes the submission
 *
 * Order of operations in POST (guaranteed, regardless of PDF outcome):
 *   STEP A — Save all content fields + mark x_portal_submitted in Odoo  (CRITICAL, no inner try/catch)
 *   STEP B — Build HTML email table from submitted values               (always)
 *   STEP C — Generate PDF and attach to Odoo                           (isolated try/catch)
 *   STEP D — Send email to Jesus with table + PDF attachment if available (always)
 *
 * Token format: {payload_base64url}.{hmac_sha256_hex}
 * Payload: JSON { id: <sheet_id>, exp: <unix_seconds> }
 */

'use strict';

const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb, PageSizes } = require('pdf-lib');
const fs   = require('fs');
const path = require('path');

const LOGO_BYTES = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'logo-antrade.png')); }
  catch (_) { return null; }
})();
const { execute, searchRead } = require('../_lib/odoo.js');
const SHEET_MODEL = 'x_transfluid_data_sheet';

// ---------------------------------------------------------------------------
// Field definitions — used for form rendering AND PDF generation
// Each section contains fields with: name, ori (origin field), label, type
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

// Lookup map: field name -> field definition (for type checks during write)
const FIELD_MAP = {};
for (const sec of SECTIONS) {
  for (const f of sec.fields) {
    if (f.name) FIELD_MAP[f.name] = f;
  }
}

// Fields to read from Odoo (all non-binary value fields + all ori fields + portal fields)
function buildFieldList() {
  const fields = [
    'id', 'x_project_id', 'x_portal_submitted', 'x_portal_expires_at',
    'x_state', 'x_portal_first_viewed_at', 'x_pdf_generation_error',
  ];
  for (const sec of SECTIONS) {
    for (const f of sec.fields) {
      if (f.name) fields.push(f.name);   // value field (skips binary where name=null)
      if (f.ori)  fields.push(f.ori);    // origin field
    }
  }
  return [...new Set(fields)];
}

// ---------------------------------------------------------------------------
// Token utilities
// ---------------------------------------------------------------------------
function verifyToken(token, secret) {
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.substring(0, dot);
  const sig     = token.substring(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || !data.exp) return null;
    if (Math.floor(Date.now() / 1000) > data.exp) return null;
    return data;
  } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------
function toPdf(v) {
  if (v === null || v === undefined || v === false) return '';
  return String(v).replace(/[^ -ÿ]/g, '?').trim();
}

async function buildPdf(sheet, projectName, submission) {
  const { declarant, submittedAt, ip } = submission;

  const pdfDoc = await PDFDocument.create();
  const fontB = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontR = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const W = 595.28, H = 841.89;
  const ML = 45, MR = 45, MT = 50, MB = 45;
  const CW = W - ML - MR;
  const LINE = 14;
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

  // — Logo top-right + Title —
  if (LOGO_BYTES) {
    try {
      const logoImg = await pdfDoc.embedPng(LOGO_BYTES);
      const logoH = 36;
      const logoW = (logoImg.width / logoImg.height) * logoH;
      page.drawImage(logoImg, { x: W - MR - logoW, y: H - MT - logoH + 8, width: logoW, height: logoH });
    } catch (_) { /* logo opcional */ }
  }
  drawLine('FICHA DE DATOS TECNICOS TRANSFLUID', ML, 14, true, rgb(0.1, 0.33, 0.67));
  drawLine(`Proyecto: ${toPdf(projectName)}`, ML, 11, false, rgb(0.2, 0.2, 0.2));
  hRule(true);

  // — Metadata block —
  drawLine('DECLARACION DEL CLIENTE', ML, 10, true, rgb(0.2, 0.2, 0.2));
  drawLine(`Rellenado por: ${toPdf(declarant)}`, ML + 8, 9, false);
  drawLine(`Fecha de declaracion: ${toPdf(submittedAt)}`, ML + 8, 9, false);
  drawLine(`IP de origen: ${toPdf(ip)}`, ML + 8, 9, false);
  y -= 4;
  drawWrapped(
    'AVISO: Los datos declarados en este formulario son responsabilidad del cliente. ' +
    'Antrade Servitech SL procedera a su revision antes de la configuracion del sistema.',
    ML + 8, 8, CW - 8, false
  );
  hRule(true);

  // — Sections —
  for (const sec of SECTIONS) {
    ensureSpace(LINE * 3 + SECTION_GAP + 20);
    y -= SECTION_GAP;
    hRule(true);
    y -= 2;
    drawLine(sec.title, ML, 11, true, rgb(0.1, 0.33, 0.67));
    hRule(false);

    for (const f of sec.fields) {
      ensureSpace(LINE * 2);

      if (f.type === 'binary') {
        const provided = submission.files && submission.files[f.fileName || f.ori];
        const val = provided ? `[Archivo adjunto: ${toPdf(provided)}]` : '[No enviado - remitir por email]';
        const ori = sheet[f.ori] || '';
        const oriLabel = ori === 'known' ? '[Antrade]' : ori === 'verify' ? '[Verificar]' : '[Cliente]';
        drawLine(`${f.label} ${oriLabel}`, ML + 4, 8, true, rgb(0.3, 0.3, 0.3));
        drawLine(`  ${val}`, ML + 12, 8, false, ori === 'known' ? rgb(0.15, 0.45, 0.15) : rgb(0, 0, 0));
      } else {
        const odooVal  = f.name ? toPdf(sheet[f.name]) : '';
        const clientVal = f.name ? toPdf(submission.fields && submission.fields[f.name]) : '';
        const ori = sheet[f.ori] || '';
        const isReadOnly = (ori === 'known' || ori === 'verify') && odooVal;
        const oriLabel = ori === 'known' ? '[Antrade-confirmado]' : ori === 'verify' ? '[Antrade-verificar]' : '[Cliente]';

        drawLine(`${f.label}`, ML + 4, 8, true, rgb(0.3, 0.3, 0.3));
        if (isReadOnly) {
          drawLine(`  Referencia: ${odooVal}   ${oriLabel}`, ML + 12, 8, false, rgb(0.15, 0.45, 0.15));
        } else {
          const displayVal = clientVal || odooVal || '(no proporcionado)';
          const c = clientVal ? rgb(0, 0, 0) : rgb(0.55, 0.55, 0.55);
          drawLine(`  ${displayVal}`, ML + 12, 8, false, c);
        }
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
// Email HTML table — built from submitted values + sheet ori fields
// ---------------------------------------------------------------------------
function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildEmailTable(sheet, submittedFields, submittedFiles) {
  let html = '<hr style="border:none;border-top:2px solid #dee2e6;margin:20px 0">';
  html += '<h2 style="color:#1a56a8;font-size:1rem;margin-bottom:16px">Datos declarados por el cliente</h2>';

  for (const sec of SECTIONS) {
    html += `<h3 style="color:#333;font-size:.85rem;font-weight:700;margin:16px 0 6px;` +
            `text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #dee2e6;` +
            `padding-bottom:4px">${escHtml(sec.title)}</h3>`;
    html += '<table style="border-collapse:collapse;width:100%;font-size:12px;margin-bottom:4px">';
    html += '<thead><tr>' +
            '<th style="text-align:left;padding:5px 8px;background:#e8f0fc;border:1px solid #b6cff5;width:42%">Campo</th>' +
            '<th style="text-align:left;padding:5px 8px;background:#e8f0fc;border:1px solid #b6cff5;width:42%">Valor</th>' +
            '<th style="text-align:left;padding:5px 8px;background:#e8f0fc;border:1px solid #b6cff5;width:16%">Origen</th>' +
            '</tr></thead><tbody>';

    for (const f of sec.fields) {
      if (f.type === 'binary') {
        const noteKey = (f.ori || '').replace('_ori', '_filename');
        const fileNote = (submittedFiles && submittedFiles[f.fileName || f.ori])
          ? escHtml(submittedFiles[f.fileName || f.ori])
          : '<em style="color:#999">(a enviar por email)</em>';
        html += `<tr><td style="padding:4px 8px;border:1px solid #dee2e6;color:#555">${escHtml(f.label)}</td>` +
                `<td style="padding:4px 8px;border:1px solid #dee2e6;color:#888">[Archivo] ${fileNote}</td>` +
                `<td style="padding:4px 8px;border:1px solid #dee2e6;color:#888;font-size:11px">—</td></tr>`;
        continue;
      }

      const ori = f.ori ? (sheet[f.ori] || 'client') : 'client';
      const oriLabel = ori === 'known' ? 'Antrade' : ori === 'verify' ? 'Verificar' : 'Cliente';
      const bg = ori === 'known' ? '#f0fdf4' : ori === 'verify' ? '#fffbeb' : '#ffffff';
      const oriColor = ori === 'known' ? '#166534' : ori === 'verify' ? '#92400e' : '#6c757d';

      // Use submitted value if present, otherwise fall back to pre-filled Odoo value
      let rawVal = '';
      if (f.name && submittedFields && submittedFields[f.name] !== undefined && submittedFields[f.name] !== '') {
        rawVal = String(submittedFields[f.name]);
      } else if (f.name && sheet[f.name] !== undefined && sheet[f.name] !== false) {
        rawVal = String(sheet[f.name]);
      }
      const displayVal = rawVal || '<em style="color:#999">—</em>';
      const fontWeight = rawVal ? '500' : '300';

      html += `<tr style="background:${bg}">` +
              `<td style="padding:4px 8px;border:1px solid #dee2e6">${escHtml(f.label)}</td>` +
              `<td style="padding:4px 8px;border:1px solid #dee2e6;font-weight:${fontWeight}">${rawVal ? escHtml(rawVal) : displayVal}</td>` +
              `<td style="padding:4px 8px;border:1px solid #dee2e6;font-size:11px;color:${oriColor}">${escHtml(oriLabel)}</td>` +
              '</tr>';
    }
    html += '</tbody></table>';
  }
  return html;
}

// ---------------------------------------------------------------------------
// HTML form rendering (client-facing)
// ---------------------------------------------------------------------------
function renderReadOnly(label, value) {
  return `
  <div class="field readonly">
    <span class="field-label">${escHtml(label)}</span>
    <div class="field-value confirmed">${escHtml(value || '—')}</div>
  </div>`;
}

function renderInput(label, name, type, options, oriClass, currentValue) {
  const safeVal = (currentValue !== null && currentValue !== undefined && currentValue !== false) ? String(currentValue) : '';
  let input;
  if (type === 'selection' && options) {
    const opts = options.map(([v, t]) =>
      `<option value="${escHtml(v)}"${safeVal === v ? ' selected' : ''}>${escHtml(t)}</option>`
    ).join('');
    input = `<select name="${escHtml(name)}" class="field-input">\n        <option value="">— Seleccionar —</option>\n        ${opts}\n      </select>`;
  } else if (type === 'integer') {
    const numAttr = safeVal ? ` value="${escHtml(safeVal)}"` : '';
    input = `<input type="number" name="${escHtml(name)}" class="field-input" min="0" step="1" placeholder="Numero de palas..."${numAttr}>`;
  } else {
    const valAttr = safeVal ? ` value="${escHtml(safeVal)}"` : '';
    input = `<input type="text" name="${escHtml(name)}" class="field-input" placeholder="Introduzca el valor..."${valAttr}>`;
  }
  const cls = oriClass === 'verify' ? 'field verify-note' : 'field';
  const note = oriClass === 'verify' ? '<span class="verify-badge">Por verificar</span>' : '';
  return `
  <div class="${cls}">
    <label class="field-label">${escHtml(label)} ${note}</label>
    ${input}
  </div>`;
}

function renderBinaryNote(label, oriField) {
  return `
  <div class="field binary-note">
    <span class="field-label">${escHtml(label)}</span>
    <div class="binary-instructions">
      <strong>Archivo requerido.</strong>
      Envie este archivo por email a
      <a href="mailto:info@antradeservitech.com">info@antradeservitech.com</a>
      con el asunto del proyecto. En el campo a continuacion puede indicar el nombre del archivo adjunto.
    </div>
    <input type="text" name="${escHtml(oriField.replace('_ori','_filename'))}"
           class="field-input" placeholder="Nombre del archivo enviado por email (opcional)...">
  </div>`;
}

function renderForm(token, sheet, projectName, serialRef) {
  let sectionsHtml = '';

  for (const sec of SECTIONS) {
    let fieldsHtml = '';
    for (const f of sec.fields) {
      const oriVal = sheet[f.ori] || '';
      if (f.type === 'binary') {
        fieldsHtml += renderBinaryNote(f.label, f.ori);
      } else {
        const odooVal = f.name ? sheet[f.name] : null;
        const isReadOnly = (oriVal === 'known' || oriVal === 'verify') && odooVal;
        if (isReadOnly) {
          fieldsHtml += renderReadOnly(f.label + (oriVal === 'verify' ? ' [a verificar]' : ''), odooVal);
        } else {
          fieldsHtml += renderInput(f.label, f.name, f.type, f.options || null, oriVal, odooVal);
        }
      }
    }
    sectionsHtml += `
    <section class="form-section">
      <h2 class="section-title">${escHtml(sec.title)}</h2>
      ${fieldsHtml}
    </section>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Datos Tecnicos Transfluid — ${escHtml(serialRef)}</title>
  <style>
    :root {
      --blue: #1a56a8;
      --blue-lt: #e8f0fc;
      --green: #166534;
      --green-bg: #f0fdf4;
      --amber: #92400e;
      --amber-bg: #fffbeb;
      --gray1: #f8f9fa;
      --gray2: #e9ecef;
      --gray3: #6c757d;
      --text: #1a1a2e;
      --border: #dee2e6;
      --radius: 6px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: var(--gray1); color: var(--text); font-size: 15px; line-height: 1.5; }

    .page-header { background: var(--blue); color: #fff; padding: 24px 32px; }
    .page-header h1 { font-size: 1.3rem; font-weight: 700; letter-spacing: .02em; }
    .page-header .subtitle { opacity: .85; font-size: .9rem; margin-top: 4px; }

    .container { max-width: 780px; margin: 0 auto; padding: 24px 16px 60px; }

    .instructions-card {
      background: var(--blue-lt); border: 1px solid #b6cff5; border-radius: var(--radius);
      padding: 16px 20px; margin-bottom: 24px;
    }
    .instructions-card h2 { font-size: 1rem; color: var(--blue); margin-bottom: 8px; }
    .instructions-card p { font-size: .9rem; color: #1e3a6e; line-height: 1.6; }

    .form-section { background: #fff; border: 1px solid var(--border);
                    border-radius: var(--radius); margin-bottom: 20px; overflow: hidden; }
    .section-title { background: var(--blue); color: #fff; font-size: .9rem;
                     font-weight: 600; padding: 10px 20px; letter-spacing: .04em; }

    .field { padding: 12px 20px; border-bottom: 1px solid var(--gray2); }
    .field:last-child { border-bottom: none; }
    .field-label { display: block; font-size: .8rem; font-weight: 600;
                   color: var(--gray3); text-transform: uppercase; letter-spacing: .04em;
                   margin-bottom: 6px; }

    .field-input { width: 100%; padding: 8px 12px; border: 1px solid var(--border);
                   border-radius: 4px; font-size: .95rem; transition: border-color .15s; }
    .field-input:focus { outline: none; border-color: var(--blue);
                         box-shadow: 0 0 0 3px rgba(26,86,168,.12); }
    select.field-input { background: #fff; }

    .readonly { background: var(--gray1); }
    .field-value.confirmed { background: var(--green-bg); border: 1px solid #bbf7d0;
                              border-radius: 4px; padding: 8px 12px; font-size: .95rem;
                              color: var(--green); font-weight: 500; }

    .verify-note { background: var(--amber-bg); }
    .verify-badge { display: inline-block; background: var(--amber-bg); color: var(--amber);
                    border: 1px solid #fcd34d; border-radius: 3px; font-size: .7rem;
                    padding: 1px 6px; margin-left: 6px; vertical-align: middle; font-weight: 600; }

    .binary-note { background: #fafafe; }
    .binary-instructions { background: #eff6ff; border: 1px solid #bfdbfe;
                            border-radius: 4px; padding: 10px 14px; font-size: .85rem;
                            color: #1e40af; margin-bottom: 10px; line-height: 1.6; }
    .binary-instructions a { color: var(--blue); }

    .declarant-section { background: #fff; border: 1px solid var(--border);
                          border-radius: var(--radius); padding: 20px; margin-bottom: 24px; }
    .declarant-section h2 { font-size: 1rem; color: var(--blue); margin-bottom: 16px; font-weight: 700; }
    .declarant-section .field { padding: 0; border: none; }

    .submit-area { text-align: center; margin-top: 32px; }
    #submit-btn { background: var(--blue); color: #fff; border: none; border-radius: 6px;
                  padding: 14px 40px; font-size: 1rem; font-weight: 700; cursor: pointer;
                  letter-spacing: .02em; transition: background .15s; }
    #submit-btn:hover:not(:disabled) { background: #1547a0; }
    #submit-btn:disabled { opacity: .6; cursor: not-allowed; }
    #form-status { margin-top: 12px; font-size: .9rem; color: #c0392b; min-height: 20px; }

    #success-panel { display: none; background: var(--green-bg); border: 2px solid #86efac;
                     border-radius: var(--radius); padding: 32px; text-align: center; margin-top: 24px; }
    #success-panel h2 { color: var(--green); font-size: 1.3rem; margin-bottom: 12px; }
    #success-panel p { color: #15803d; }

    .already-submitted { background: var(--amber-bg); border: 2px solid #fcd34d;
                          border-radius: var(--radius); padding: 24px; text-align: center; }
    .already-submitted h2 { color: var(--amber); }

    @media (min-width: 600px) { .container { padding: 32px 24px 80px; } }
  </style>
  <script src="/data-sheet-form.js" defer></script>
</head>
<body>

<header class="page-header">
  <h1>Datos Tecnicos Transfluid</h1>
  <p class="subtitle">Proyecto: ${escHtml(serialRef)} — Antrade Servitech SL</p>
</header>

<div class="container">

  <div class="instructions-card">
    <h2>Instrucciones</h2>
    <p>Por favor, complete los campos marcados como editables.<br>
    Los campos con fondo verde han sido precargados por Antrade Servitech y no requieren
    su accion. Los archivos 3D (planos STEP/DXF) deben enviarse por email segun las
    indicaciones en cada campo.</p>
  </div>

  <form id="ficha-form" data-token="${escHtml(token)}" autocomplete="off">

    <div class="declarant-section">
      <h2>Identificacion del declarante</h2>
      <div class="field">
        <label class="field-label" for="declarant-name">Nombre y cargo del declarante *</label>
        <input type="text" id="declarant-name" name="__declarant"
               class="field-input" required
               placeholder="Nombre Apellido — Cargo en la empresa">
      </div>
    </div>

    ${sectionsHtml}

    <div class="submit-area">
      <button type="submit" id="submit-btn">Enviar formulario</button>
      <div id="form-status"></div>
    </div>

  </form>

  <div id="success-panel">
    <h2>Formulario enviado correctamente</h2>
    <p>Antrade Servitech recibira su declaracion de datos y se pondra en contacto
    si necesita informacion adicional. Gracias.</p>
  </div>

</div>
</body>
</html>`;
}

function renderError(title, message, code) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Error — Ficha Transfluid</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
     background:#f8f9fa;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border:1px solid #dee2e6;border-radius:8px;padding:40px;max-width:480px;text-align:center}
h1{color:#c0392b;font-size:1.3rem;margin-bottom:12px}p{color:#555;line-height:1.6}
.code{font-size:.8rem;color:#999;margin-top:20px}
</style>
</head><body>
<div class="card">
  <h1>${escHtml(title)}</h1>
  <p>${escHtml(message)}</p>
  <p class="code">Codigo ${code}</p>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const DS_SECRET = process.env.DATA_SHEET_SECRET;
  if (!DS_SECRET) {
    return res.status(500).send(renderError('Error de configuracion',
      'El servidor no esta configurado correctamente. Contacte con Antrade Servitech.', 500));
  }

  const token = req.query.token;
  if (!token) {
    return res.status(400).send(renderError('Link invalido',
      'Este enlace no es valido. Por favor, solicite un nuevo enlace a Antrade Servitech.', 400));
  }

  const payload = verifyToken(token, DS_SECRET);
  if (!payload) {
    return res.status(403).send(renderError('Link caducado o invalido',
      'Este enlace ha caducado o no es valido. Por favor, solicite un nuevo enlace a Antrade Servitech.', 403));
  }

  const sheetId = payload.id;

  // ---- GET: render form ----
  if (req.method === 'GET') {
    try {
      const fields = buildFieldList();
      const sheets = await searchRead(SHEET_MODEL, [['id', '=', sheetId]], fields);
      if (!sheets.length) {
        return res.status(404).send(renderError('Formulario no encontrado',
          'No se encontro el formulario solicitado.', 404));
      }
      const sheet = sheets[0];

      // Register first access — write once, non-blocking
      if (!sheet.x_portal_first_viewed_at) {
        const viewedAt = new Date().toISOString().replace('T', ' ').substring(0, 19);
        try {
          await execute(SHEET_MODEL, 'write', [[sheetId], { x_portal_first_viewed_at: viewedAt }]);
          sheet.x_portal_first_viewed_at = viewedAt;
        } catch (_) {}
      }

      if (sheet.x_portal_submitted) {
        // Resolve project serial for the title
        let subSerial = 'Proyecto';
        const spf = sheet.x_project_id;
        const spId = Array.isArray(spf) ? spf[0] : spf;
        if (spId) {
          try {
            const sproj = await searchRead('project.project', [['id', '=', spId]], ['name', 'x_serial_antrade']);
            if (sproj.length) subSerial = sproj[0].x_serial_antrade || sproj[0].name;
          } catch (_) {}
        }
        const dataSummary = buildEmailTable(sheet, {}, {});
        const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Formulario ya enviado — ${escHtml(subSerial)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;
  margin:0;padding:20px}
.header{background:#fff;border:2px solid #fcd34d;border-radius:8px;padding:24px 28px;
  max-width:820px;margin:0 auto 20px;text-align:center}
h1{color:#92400e;font-size:1.2rem;margin:0 0 8px}
.sub{color:#555;font-size:.9rem;line-height:1.5}
.data-wrap{max-width:820px;margin:0 auto}
</style></head><body>
<div class="header">
  <h1>Formulario ya enviado — ${escHtml(subSerial)}</h1>
  <p class="sub">Este formulario ya fue completado anteriormente.<br>
  A continuacion puede revisar los datos registrados. Para realizar correcciones,
  contacte con Antrade Servitech.</p>
</div>
<div class="data-wrap">${dataSummary}</div>
</body></html>`;
        return res.setHeader('Content-Type', 'text/html; charset=utf-8').status(200).send(html);
      }

      // Resolve project name
      let projectName = 'Proyecto desconocido';
      let serialRef = 'Proyecto';
      const pf = sheet.x_project_id;
      const pId = Array.isArray(pf) ? pf[0] : pf;
      if (pId) {
        const projs = await searchRead('project.project', [['id', '=', pId]],
          ['name', 'x_serial_antrade']);
        if (projs.length) {
          projectName = projs[0].x_serial_antrade || projs[0].name;
          serialRef = projectName;
        }
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(renderForm(token, sheet, projectName, serialRef));

    } catch (err) {
      console.error('[token].js GET error:', err);
      return res.status(500).send(renderError('Error interno',
        'Ha ocurrido un error al cargar el formulario. Por favor, intentelo de nuevo.', 500));
    }
  }

  // ---- POST: process submission ----
  if (req.method === 'POST') {
    try {
      const allFields = buildFieldList();
      const sheets = await searchRead(SHEET_MODEL, [['id', '=', sheetId]], allFields);
      if (!sheets.length) return res.status(404).json({ error: 'Sheet not found' });
      const sheet = sheets[0];

      if (sheet.x_portal_submitted) {
        return res.status(409).json({ error: 'Already submitted' });
      }

      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) { body = {}; }
      }
      body = body || {};

      const declarant = String(body.__declarant || '').trim();
      if (!declarant) {
        return res.status(400).json({ error: 'Declarant name is required' });
      }

      const now = new Date();
      const submittedAt = now.toLocaleString('es-ES', {
        timeZone: 'Europe/Madrid',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

      // Collect submitted field values and file notes
      const submittedFields = {};
      for (const sec of SECTIONS) {
        for (const f of sec.fields) {
          if (f.name && body[f.name] !== undefined) {
            submittedFields[f.name] = body[f.name];
          }
        }
      }
      const submittedFiles = {};
      for (const sec of SECTIONS) {
        for (const f of sec.fields) {
          if (f.type === 'binary') {
            const noteKey = (f.ori || '').replace('_ori', '_filename');
            if (body[noteKey]) submittedFiles[f.fileName || f.ori] = body[noteKey];
          }
        }
      }

      // Resolve project name
      let serialRef = 'Proyecto';
      const pf = sheet.x_project_id;
      const pId = Array.isArray(pf) ? pf[0] : pf;
      if (pId) {
        const projs = await searchRead('project.project', [['id', '=', pId]], ['name', 'x_serial_antrade']);
        if (projs.length) serialRef = projs[0].x_serial_antrade || projs[0].name;
      }

      // =========================================================
      // STEP A — SAVE CONTENT FIELDS TO ODOO (FIRST, CRITICAL)
      //   This write is NOT wrapped in its own try/catch.
      //   If it fails, the outer catch returns 500 and the client
      //   can retry — x_portal_submitted stays false.
      // =========================================================
      const odooWritePayload = {
        x_portal_submitted: true,
        x_state: 'client_review',
        x_pdf_generation_error: '',  // clear any prior error (empty string, not boolean false)
      };
      for (const [fname, fval] of Object.entries(submittedFields)) {
        const fdef = FIELD_MAP[fname];
        if (!fdef) continue;
        if (fdef.type === 'integer') {
          const n = parseInt(fval, 10);
          if (!isNaN(n)) odooWritePayload[fname] = n;
        } else if (fval !== null && fval !== undefined && String(fval).trim() !== '') {
          odooWritePayload[fname] = String(fval);
        }
      }
      await execute(SHEET_MODEL, 'write', [[sheetId], odooWritePayload]);
      console.log('[token].js STEP A: fields saved to Odoo, x_portal_submitted=true for sheet', sheetId);

      // =========================================================
      // STEP B — BUILD HTML EMAIL TABLE (always, uses submitted values)
      // =========================================================
      const emailTableHtml = buildEmailTable(sheet, submittedFields, submittedFiles);

      // =========================================================
      // STEP C — GENERATE PDF AND ATTACH TO ODOO (isolated, non-critical)
      //   If this fails: write x_pdf_generation_error, keep going.
      //   The data from STEP A is already safe in Odoo.
      // =========================================================
      let pdfAttachmentId = null;
      let pdfErrorMsg = null;

      try {
        const pdfBytes = await buildPdf(
          sheet,
          serialRef,
          { declarant, submittedAt, ip, fields: submittedFields, files: submittedFiles }
        );
        const pdfB64 = Buffer.from(pdfBytes).toString('base64');
        const pdfName = `FichaTF_${serialRef.replace(/[^a-zA-Z0-9_-]/g, '_')}_${now.toISOString().slice(0,10)}.pdf`;

        const attRaw = await execute('ir.attachment', 'create', [{
          name: pdfName,
          type: 'binary',
          raw: pdfB64,
          res_model: SHEET_MODEL,
          res_id: sheetId,
          mimetype: 'application/pdf',
        }]);
        pdfAttachmentId = Array.isArray(attRaw) ? attRaw[0] : attRaw;
        console.log('[token].js STEP C: PDF generated and attached, ir.attachment id=' + pdfAttachmentId);

      } catch (pdfErr) {
        pdfErrorMsg = (pdfErr.message || 'Error desconocido').substring(0, 200);
        console.error('[token].js STEP C PDF error:', pdfErr.message);
        try {
          await execute(SHEET_MODEL, 'write', [[sheetId], { x_pdf_generation_error: pdfErrorMsg }]);
        } catch (_) {}
      }

      // =========================================================
      // STEP D — SEND EMAIL TO JESUS (always, regardless of PDF)
      //   Body: pdfNote banner + full data table
      //   Attachment: PDF ir.attachment if generated (link, not copy)
      // =========================================================
      const nowLocale = now.toLocaleString('es-ES', {
        timeZone: 'Europe/Madrid',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      const pdfBanner = pdfErrorMsg
        ? '<div style="background:#fef3c7;border:1px solid #fcd34d;padding:12px 16px;border-radius:4px;margin-bottom:16px">' +
          '<strong style="color:#92400e">Aviso: PDF pendiente de regenerar — datos completos abajo</strong><br>' +
          '<span style="color:#78350f;font-size:12px">Error: ' + escHtml(pdfErrorMsg) + '</span><br>' +
          '<span style="color:#78350f;font-size:12px">Pulsa el boton "Regenerar PDF" en la ficha de Odoo para reintentarlo.</span>' +
          '</div>'
        : '<div style="background:#f0fdf4;border:1px solid #86efac;padding:12px 16px;border-radius:4px;margin-bottom:16px">' +
          '<strong style="color:#166534">PDF generado correctamente — disponible en el registro de la ficha en Odoo (ir.attachment id=' + pdfAttachmentId + ').</strong>' +
          '</div>';

      const jesusBody = (
        '<p style="margin-bottom:12px">El cliente ha completado la Ficha de Datos Tecnicos del proyecto ' +
        '<strong>' + escHtml(serialRef) + '</strong>.</p>' +
        '<p style="margin-bottom:12px">Declarante: <strong>' + escHtml(declarant) + '</strong> — ' +
        escHtml(submittedAt) + ' (IP: ' + escHtml(String(ip).split(',')[0].trim()) + ')</p>' +
        pdfBanner +
        emailTableHtml
      );

      const mailPayload = {
        subject: '[FICHA TF] ' + serialRef + ' - Datos recibidos del cliente',
        body_html: jesusBody,
        email_to: 'j.guzman@antradeservitech.com',
        auto_delete: false,
      };

      let jesusMailStatus = null;
      let jesusMailId = null;
      try {
        jesusMailId = await execute('mail.mail', 'create', [mailPayload]);
        await execute('mail.mail', 'send', [[jesusMailId]]);
        console.log('[token].js STEP D: aviso Jesus mail.mail id=' + jesusMailId + ' para ' + serialRef);

        try {
          const mailRecs = await execute('mail.mail', 'read', [[jesusMailId]],
            { fields: ['state', 'failure_reason'] });
          if (mailRecs.length && mailRecs[0].state === 'exception') {
            const reason = (mailRecs[0].failure_reason || 'desconocido').substring(0, 120);
            jesusMailStatus = 'Error correo ' + nowLocale + ': ' + reason;
            console.error('[token].js aviso Jesus mail exception:', reason);
          } else {
            jesusMailStatus = 'Enviado ' + nowLocale + (pdfErrorMsg ? ' (sin PDF adjunto — error PDF)' : ' (con PDF adjunto)');
            try { await execute('mail.mail', 'unlink', [[jesusMailId]]); } catch (_) {}
          }
        } catch (_) {
          // Record disappeared = auto_delete after successful send
          jesusMailStatus = 'Enviado ' + nowLocale + (pdfErrorMsg ? ' (sin PDF adjunto — error PDF)' : ' (con PDF adjunto)');
        }
      } catch (mailErr) {
        console.error('[token].js aviso Jesus mail.mail error:', mailErr.message);
        // mail.send() may have timed out even though Odoo delivered the email.
        // If the mail record exists and state=sent, treat it as success.
        if (jesusMailId !== null) {
          try {
            const mailRecs2 = await execute('mail.mail', 'read', [[jesusMailId]],
              { fields: ['state', 'failure_reason'] });
            if (mailRecs2.length && mailRecs2[0].state === 'sent') {
              console.log('[token].js mail actually sent despite timeout, id=' + jesusMailId);
              jesusMailStatus = 'Enviado ' + nowLocale + (pdfErrorMsg ? ' (sin PDF adjunto — error PDF)' : ' (con PDF adjunto)');
              try { await execute('mail.mail', 'unlink', [[jesusMailId]]); } catch (_) {}
            } else {
              jesusMailStatus = 'Error correo ' + nowLocale + ': ' + mailErr.message.substring(0, 100);
            }
          } catch (_) {
            jesusMailStatus = 'Error correo ' + nowLocale + ': ' + mailErr.message.substring(0, 100);
          }
        } else {
          jesusMailStatus = 'Error correo ' + nowLocale + ': ' + mailErr.message.substring(0, 100);
        }
      }

      if (jesusMailStatus) {
        try {
          await execute(SHEET_MODEL, 'write', [[sheetId], { x_last_email_status: jesusMailStatus }]);
        } catch (_) {}
      }

      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error('[token].js POST error:', err);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};
