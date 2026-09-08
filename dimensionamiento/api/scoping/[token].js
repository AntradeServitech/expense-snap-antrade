'use strict';

const crypto = require('crypto');
const { execute, searchRead } = require('../_lib/odoo');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const SHEET_MODEL = 'x_project_scoping_sheet';
const JESUS_EMAIL = 'j.guzman@antradeservitech.com';
const TOTAL_STEPS = 6;

// ── Token verification ────────────────────────────────────────────────────────

function verifyToken(token, secret) {
  const lastDot = token.lastIndexOf('.');
  if (lastDot < 1) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  let ok = false;
  try {
    ok = sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) { ok = false; }
  if (!ok) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.id || !data.exp) return null;
    if (Math.floor(Date.now() / 1000) > data.exp) return null;
    return data;
  } catch (_) { return null; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bool(v) { return v === 'yes' || v === true || v === 'true'; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function numInt(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }

// ── Email table ───────────────────────────────────────────────────────────────

function buildEmailTable(fields) {
  const rows = fields.map(([label, value]) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555;white-space:nowrap;font-size:13px">${esc(label)}</td>` +
    `<td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px">${esc(String(value ?? '—'))}</td></tr>`
  ).join('');
  return `<table style="border-collapse:collapse;width:100%;font-family:sans-serif">${rows}</table>`;
}

// ── PDF builder ───────────────────────────────────────────────────────────────

async function buildPdf(data, declarant, ip) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.051, 0.106, 0.165);
  const gold = rgb(0.788, 0.659, 0.298);

  const addPage = () => {
    const p = pdfDoc.addPage([595, 842]);
    p.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: navy });
    p.drawText('ANTRADE SERVITECH SL', { x: 40, y: 812, size: 13, font: bold, color: rgb(1, 1, 1) });
    p.drawText('Dimensionamiento Inicial de Proyecto', { x: 40, y: 794, size: 9, font, color: gold });
    return p;
  };

  const page = addPage();
  page.drawText(`Declarado por: ${declarant || '—'}   |   IP: ${ip}   |   ${new Date().toLocaleString('es-ES')}`,
    { x: 40, y: 775, size: 8, font, color: rgb(0.9, 0.9, 0.9) });
  page.drawLine({ start: { x: 40, y: 762 }, end: { x: 555, y: 762 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });

  const propMap = { parallel: 'Híbrido en Paralelo', series: 'Híbrido en Serie', electric: 'Eléctrico Puro' };
  const catMap = { armador: 'Armador', astillero: 'Astillero', integrador: 'Integrador', usuario_final: 'Usuario Final' };
  const appMap = { commercial: 'Comercial', pleasure: 'Recreo', fishing: 'Pesca', patrol: 'Patrullero', ferry: 'Ferry', other: 'Otro' };
  const hullMap = { mono: 'Monocasco', catamaran: 'Catamarán', trimaran: 'Trimarán' };
  const yn = v => bool(v) ? 'Sí' : 'No';

  const fields = [
    ['Proyecto', data.x_project_name],
    ['Buque', data.x_vessel_name],
    ['País de instalación', data.x_installation_country],
    ['Categoría del cliente', catMap[data.x_client_category] || data.x_client_category],
    ['Sociedad de clasificación', bool(data.x_has_classification) ? (data.x_class_society_name || '—') : 'No aplica'],
    ['Tipo de aprobación', bool(data.x_has_classification) ? (data.x_class_society_type === 'mandatory' ? 'Obligatoria' : 'Consulta') : '—'],
    ['Retrofit', yn(data.x_vessel_retrofit)],
    ['Propulsión original', data.x_prop_original || '—'],
    ['Tipo de casco', hullMap[data.x_hull_type] || data.x_hull_type || '—'],
    ['Aplicación', appMap[data.x_application] || data.x_application || '—'],
    ['Modelo buque', data.x_vessel_model || '—'],
    ['Eslora de flotación (m)', data.x_waterline_length],
    ['Desplazamiento máx. (t)', data.x_max_displacement],
    ['Sistema de propulsión', propMap[data.x_propulsion_type] || data.x_propulsion_type || '—'],
  ];

  if (data.x_propulsion_type === 'parallel') {
    fields.push(
      ['Fabricante diesel', data.x_diesel_manufacturer || '—'],
      ['Modelo diesel', data.x_diesel_model || '—'],
      ['Potencia diesel (kW)', data.x_diesel_power_kw],
      ['RPM diesel', data.x_diesel_rpm],
      ['Fabricante reductora', data.x_gearbox_manufacturer || '—'],
      ['Modelo reductora', data.x_gearbox_model || '—'],
      ['Relación reducción', data.x_gearbox_ratio || '—'],
      ['Salida reductora', data.x_gearbox_output || '—'],
      ['Tipo reductora', data.x_gearbox_type || '—'],
      ['V. crucero diesel (kn)', data.x_par_diesel_cruise_kn],
      ['V. máxima diesel (kn)', data.x_par_diesel_max_kn],
      ['V. crucero eléctrico (kn)', data.x_par_elec_cruise_kn],
      ['V. máxima eléctrico (kn)', data.x_par_elec_max_kn],
    );
  } else if (data.x_propulsion_type === 'series') {
    fields.push(
      ['Fabricante diesel', data.x_diesel_manufacturer || '—'],
      ['Modelo diesel', data.x_diesel_model || '—'],
      ['Potencia diesel (kW)', data.x_diesel_power_kw],
      ['RPM diesel', data.x_diesel_rpm],
      ['Fabricante reductora', data.x_gearbox_manufacturer || '—'],
      ['Modelo reductora', data.x_gearbox_model || '—'],
      ['Relación reducción', data.x_gearbox_ratio || '—'],
      ['Salida reductora', data.x_gearbox_output || '—'],
      ['Tipo reductora', data.x_gearbox_type || '—'],
      ['Potencia generador (kW)', data.x_ser_generator_kw],
      ['Velocidad crucero (kn)', data.x_cruise_speed_kn],
      ['Velocidad máxima (kn)', data.x_max_speed_kn],
    );
  } else if (data.x_propulsion_type === 'electric') {
    fields.push(
      ['Velocidad crucero (kn)', data.x_cruise_speed_kn],
      ['Velocidad máxima (kn)', data.x_max_speed_kn],
      ['Autonomía estimada (h)', data.x_ele_autonomy_h],
    );
  }

  fields.push(
    ['Generador a bordo', yn(data.x_charge_generator)],
    ['Potencia generador (kW)', bool(data.x_charge_generator) ? (data.x_charge_gen_power || '—') : '—'],
    ['Carga en puerto', yn(data.x_charge_port)],
    ['Panel solar', yn(data.x_charge_solar)],
    ['Declarado por', declarant || '—'],
  );

  let y = 748;
  let currentPage = page;
  const lineH = 17;

  for (const [label, value] of fields) {
    if (y < 60) {
      currentPage = addPage();
      y = 748;
    }
    currentPage.drawText(String(label) + ':', { x: 40, y, size: 9, font: bold, color: navy });
    currentPage.drawText(String(value ?? '—'), { x: 220, y, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
    y -= lineH;
  }

  return pdfDoc.save();
}

// ── HTML Wizard ───────────────────────────────────────────────────────────────

function renderWizard(sheet, token) {
  const pre = (v) => esc(v || '');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Antrade — Dimensionamiento de Proyecto</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap" rel="stylesheet"/>
<style>
:root{--navy:#0d1b2a;--gold:#c9a84c;--gold-lt:#e8d8a0;--off:#f4f6f9;--wh:#ffffff;--text:#1a2332;--muted:#6b7a8d;--border:#dde3ec;--err:#c0392b}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',system-ui,sans-serif;background:var(--off);color:var(--text);min-height:100vh;display:flex;flex-direction:column}
.hdr{background:var(--navy);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;box-shadow:0 2px 12px rgba(0,0,0,.3)}
.brand{color:#fff;font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-weight:600;letter-spacing:.02em}
.brand span{color:var(--gold);font-style:italic}
.lang-wrap{display:flex;gap:3px;background:rgba(255,255,255,.08);border-radius:6px;padding:3px}
.lang-btn{border:none;background:transparent;color:rgba(255,255,255,.6);font-size:.72rem;font-weight:700;padding:4px 11px;border-radius:4px;cursor:pointer;letter-spacing:.06em;transition:.18s}
.lang-btn.on{background:var(--gold);color:var(--navy)}
.prog-wrap{background:var(--navy);padding:0 24px 14px}
.prog-top{display:flex;justify-content:space-between;color:rgba(255,255,255,.55);font-size:.72rem;margin-bottom:7px}
.prog-top strong{color:var(--gold)}
.prog-bar{height:3px;background:rgba(255,255,255,.12);border-radius:2px}
.prog-fill{height:100%;background:var(--gold);border-radius:2px;transition:width .4s ease}
main{flex:1;max-width:740px;width:100%;margin:0 auto;padding:24px 16px 100px}
.step{display:none}.step.on{display:block}
.step-eye{font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin-bottom:5px}
.step-h{font-family:'Cormorant Garamond',serif;font-size:1.85rem;font-weight:600;color:var(--navy);line-height:1.2;margin-bottom:5px}
.step-sub{color:var(--muted);font-size:.88rem;margin-bottom:24px}
.card{background:var(--wh);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:14px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:540px){.row{grid-template-columns:1fr}}
.f{margin-bottom:14px}.f:last-child{margin-bottom:0}
label{display:block;font-size:.78rem;font-weight:600;color:var(--navy);margin-bottom:5px}
.req{color:var(--err);margin-left:2px}
input,select{width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:.88rem;color:var(--text);background:var(--off);outline:none;transition:.18s}
input:focus,select:focus{border-color:var(--gold);background:var(--wh);box-shadow:0 0 0 3px rgba(201,168,76,.14)}
input.bad,select.bad{border-color:var(--err)}
.hint{font-size:.72rem;color:var(--muted);margin-top:3px}
.rg{display:flex;flex-direction:column;gap:7px}
.ri{display:flex;align-items:flex-start;gap:9px;cursor:pointer;padding:10px 12px;border:1px solid var(--border);border-radius:7px;background:var(--off);transition:.15s;user-select:none}
.ri:hover{border-color:var(--gold)}
.ri input{margin-top:3px;accent-color:var(--gold);flex-shrink:0;width:auto}
.ri .rl{cursor:pointer;font-size:.88rem;margin:0;font-weight:400;color:var(--text);flex:1;min-width:0}
.ri .rl strong{display:block;font-weight:600;font-size:.83rem;color:var(--navy)}
#s3 .ri .rl,#s5 .ri .rl{overflow-wrap:break-word;word-break:break-word}
.ri.sel{border-color:var(--gold);background:#fffbee}
.cond{display:none}.cond.on{display:block}
.sec-lbl{font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding-bottom:7px;border-bottom:1px solid var(--border);margin-bottom:14px}
.parallel-alert{background:#fff8e0;border-left:4px solid var(--gold);padding:11px 15px;border-radius:0 7px 7px 0;margin-bottom:14px;font-size:.83rem;color:#6b4c00}
.rev-tbl{width:100%;border-collapse:collapse;font-size:.82rem}
.rev-tbl th{text-align:left;padding:7px 11px;background:var(--navy);color:#fff;font-size:.72rem;letter-spacing:.05em}
.rev-tbl td{padding:7px 11px;border-bottom:1px solid var(--border);overflow-wrap:break-word;word-break:break-word}
.rev-tbl tr:nth-child(even) td{background:#f9fafb}
.rev-tbl td:first-child{color:var(--muted);width:46%}
.step-err{background:#fdf2f0;border:1px solid #e8b4af;border-radius:7px;padding:10px 14px;color:var(--err);font-size:.83rem;margin-bottom:14px;display:none}
.nav{position:fixed;bottom:0;left:0;right:0;background:var(--wh);border-top:1px solid var(--border);padding:11px 22px;display:flex;justify-content:space-between;align-items:center;z-index:200}
.btn{padding:10px 22px;border-radius:7px;font-family:'DM Sans',sans-serif;font-size:.88rem;font-weight:600;cursor:pointer;border:none;transition:.18s}
.btn-bk{background:transparent;color:var(--navy);border:1px solid var(--border)}
.btn-bk:hover{background:var(--off)}
.btn-nx{background:var(--navy);color:#fff}.btn-nx:hover{background:#1a3050}
.btn-sb{background:var(--gold);color:var(--navy)}.btn-sb:hover{background:var(--gold-lt)}
.btn:disabled{opacity:.4;cursor:default;pointer-events:none}
.spin{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:sp .7s linear infinite;vertical-align:middle;margin-right:7px}
@keyframes sp{to{transform:rotate(360deg)}}
.ok-screen{display:none;text-align:center;padding:64px 20px;flex-direction:column;align-items:center}
.ok-screen.on{display:flex}
.ok-icon{width:70px;height:70px;background:var(--navy);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 22px}
.ok-h{font-family:'Cormorant Garamond',serif;font-size:1.9rem;font-weight:600;color:var(--navy);margin-bottom:10px}
.ok-p{color:var(--muted);max-width:460px;line-height:1.65;font-size:.9rem}
</style>
</head>
<body>

<header class="hdr">
  <div class="brand">Antrade <span>Servitech</span></div>
  <div class="lang-wrap">
    <button class="lang-btn on" id="btn-es" onclick="setLang('es')">ES</button>
    <button class="lang-btn" id="btn-en" onclick="setLang('en')">EN</button>
  </div>
</header>

<div class="prog-wrap">
  <div class="prog-top"><span data-t="step_of"></span><strong id="step-ctr">1 / ${TOTAL_STEPS}</strong></div>
  <div class="prog-bar"><div class="prog-fill" id="prog" style="width:${Math.round(100/TOTAL_STEPS)}%"></div></div>
</div>

<main id="wizard">

<!-- STEP 1 -->
<section class="step on" id="s1">
  <div class="step-eye" data-t="s1_eye"></div>
  <h1 class="step-h" data-t="s1_h"></h1>
  <p class="step-sub" data-t="s1_sub"></p>
  <div class="step-err" id="e1"></div>
  <div class="card">
    <div class="row">
      <div class="f"><label data-t="l_proj"></label><input type="text" name="x_project_name" value="${pre(sheet.x_project_name)}"/></div>
      <div class="f"><label data-t="l_vessel"></label><input type="text" name="x_vessel_name" value="${pre(sheet.x_vessel_name)}"/></div>
    </div>
    <div class="f"><label data-t="l_country"></label><input type="text" name="x_installation_country" value="${pre(sheet.x_installation_country)}"/></div>
    <div class="f">
      <label data-t="l_cat"></label>
      <div class="rg">
        <label class="ri"><input type="radio" name="x_client_category" value="armador"/><span class="rl"><strong data-t="cat_arm"></strong><span data-t="cat_arm_d"></span></span></label>
        <label class="ri"><input type="radio" name="x_client_category" value="astillero"/><span class="rl"><strong data-t="cat_ast"></strong><span data-t="cat_ast_d"></span></span></label>
        <label class="ri"><input type="radio" name="x_client_category" value="disenador"/><span class="rl"><strong data-t="cat_dis"></strong><span data-t="cat_dis_d"></span></span></label>
        <label class="ri"><input type="radio" name="x_client_category" value="integrador"/><span class="rl"><strong data-t="cat_int"></strong><span data-t="cat_int_d"></span></span></label>
        <label class="ri"><input type="radio" name="x_client_category" value="otro"/><span class="rl"><strong data-t="cat_ot"></strong><span data-t="cat_ot_d"></span></span></label>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="f">
      <label data-t="l_class"></label>
      <div class="rg">
        <label class="ri"><input type="radio" name="x_has_classification" value="yes"/><span class="rl" data-t="class_y"></span></label>
        <label class="ri"><input type="radio" name="x_has_classification" value="no"/><span class="rl" data-t="class_n"></span></label>
      </div>
    </div>
    <div class="cond" id="c-class">
      <div class="row" style="margin-top:11px">
        <div class="f"><label data-t="l_class_name"></label><input type="text" name="x_class_society_name" placeholder="DNV, Bureau Veritas…"/></div>
        <div class="f">
          <label data-t="l_class_type"></label>
          <select name="x_class_society_type">
            <option value="" data-t="sel"></option>
            <option value="mandatory" data-t="class_mand"></option>
            <option value="advisory" data-t="class_adv"></option>
          </select>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- STEP 2 -->
<section class="step" id="s2">
  <div class="step-eye" data-t="s2_eye"></div>
  <h1 class="step-h" data-t="s2_h"></h1>
  <p class="step-sub" data-t="s2_sub"></p>
  <div class="step-err" id="e2"></div>
  <div class="card">
    <div class="f">
      <label data-t="l_retrofit"></label>
      <div class="rg">
        <label class="ri"><input type="radio" name="x_vessel_retrofit" value="yes"/><span class="rl" data-t="ret_y"></span></label>
        <label class="ri"><input type="radio" name="x_vessel_retrofit" value="no"/><span class="rl" data-t="ret_n"></span></label>
      </div>
    </div>
    <div class="f" style="margin-top:11px">
      <label data-t="l_prop_orig"></label>
      <select name="x_prop_original">
        <option value="" data-t="sel"></option>
        <option value="motor" data-t="po_motor"></option>
        <option value="sail" data-t="po_sail"></option>
        <option value="mixed" data-t="po_mixed"></option>
      </select>
    </div>
  </div>
  <div class="card">
    <div class="row">
      <div class="f">
        <label data-t="l_hull"></label>
        <select name="x_hull_type">
          <option value="" data-t="sel"></option>
          <option value="mono" data-t="h_mono"></option>
          <option value="catamaran" data-t="h_cat"></option>
          <option value="trimaran" data-t="h_tri"></option>
        </select>
      </div>
      <div class="f">
        <label data-t="l_app"></label>
        <select name="x_application">
          <option value="" data-t="sel"></option>
          <option value="commercial" data-t="a_com"></option>
          <option value="pleasure" data-t="a_plea"></option>
          <option value="fishing" data-t="a_fish"></option>
          <option value="patrol" data-t="a_pat"></option>
          <option value="ferry" data-t="a_ferry"></option>
          <option value="other" data-t="a_other"></option>
        </select>
      </div>
    </div>
    <div class="f"><label data-t="l_model"></label><input type="text" name="x_vessel_model"/></div>
  </div>
  <div class="card">
    <div class="row">
      <div class="f">
        <label><span data-t="l_lwl"></span><span class="req">*</span></label>
        <input type="number" id="f-lwl" name="x_waterline_length" min="0" step="0.01" placeholder="0.00"/>
        <p class="hint" data-t="h_lwl"></p>
      </div>
      <div class="f">
        <label><span data-t="l_disp"></span><span class="req">*</span></label>
        <input type="number" id="f-disp" name="x_max_displacement" min="0" step="0.1" placeholder="0.00"/>
        <p class="hint" data-t="h_disp"></p>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="f">
      <label><span data-t="l_prop_lines"></span><span class="req">*</span></label>
      <select name="x_prop_lines" id="f-prop-lines">
        <option value="" data-t="sel"></option>
        <option value="1" data-t="pl_1"></option>
        <option value="2" data-t="pl_2"></option>
      </select>
    </div>
  </div>
</section>

<!-- STEP 3 -->
<section class="step" id="s3">
  <div class="step-eye" data-t="s3_eye"></div>
  <h1 class="step-h" data-t="s3_h"></h1>
  <p class="step-sub" data-t="s3_sub"></p>
  <div class="step-err" id="e3"></div>
  <div class="card">
    <div class="rg">
      <label class="ri"><input type="radio" name="x_propulsion_type" value="parallel"/><span class="rl"><strong data-t="pt_par"></strong><span data-t="pt_par_d"></span></span></label>
      <label class="ri"><input type="radio" name="x_propulsion_type" value="series"/><span class="rl"><strong data-t="pt_ser"></strong><span data-t="pt_ser_d"></span></span></label>
      <label class="ri"><input type="radio" name="x_propulsion_type" value="electric"/><span class="rl"><strong data-t="pt_ele"></strong><span data-t="pt_ele_d"></span></span></label>
    </div>
  </div>
</section>

<!-- STEP 4 -->
<section class="step" id="s4">
  <div class="step-eye" data-t="s4_eye"></div>
  <h1 class="step-h" data-t="s4_h"></h1>
  <p class="step-sub" data-t="s4_sub"></p>
  <div class="step-err" id="e4"></div>

  <!-- Diesel + Reductora (shared: parallel + series) -->
  <div class="cond" id="c-diesel">
    <div class="card">
      <div class="sec-lbl" data-t="sec_diesel"></div>
      <div class="row">
        <div class="f"><label data-t="l_diesel_mfr"></label><input type="text" name="x_diesel_manufacturer"/></div>
        <div class="f"><label data-t="l_diesel_mdl"></label><input type="text" name="x_diesel_model"/></div>
      </div>
      <div class="row">
        <div class="f"><label data-t="l_diesel_kw"></label><input type="number" name="x_diesel_power_kw" min="0" step="0.1" placeholder="kW"/></div>
        <div class="f"><label data-t="l_diesel_rpm"></label><input type="number" name="x_diesel_rpm" min="0" step="1" placeholder="rpm"/></div>
      </div>
    </div>
    <div class="card">
      <div class="sec-lbl" data-t="sec_gearbox"></div>
      <div class="row">
        <div class="f"><label data-t="l_gb_mfr"></label><input type="text" name="x_gearbox_manufacturer"/></div>
        <div class="f"><label data-t="l_gb_mdl"></label><input type="text" name="x_gearbox_model"/></div>
      </div>
      <div class="row">
        <div class="f"><label data-t="l_gb_ratio"></label><input type="text" name="x_gearbox_ratio"/></div>
        <div class="f">
          <label data-t="l_gb_output"></label>
          <select name="x_gearbox_output">
            <option value="" data-t="sel"></option>
            <option value="straight" data-t="go_str"></option>
            <option value="angle" data-t="go_ang"></option>
            <option value="vdrive" data-t="go_vdr"></option>
          </select>
        </div>
      </div>
      <div class="f" style="max-width:280px">
        <label data-t="l_gb_type"></label>
        <select name="x_gearbox_type">
          <option value="" data-t="sel"></option>
          <option value="mechanical" data-t="gt_mec"></option>
          <option value="electric" data-t="gt_ele"></option>
        </select>
      </div>
    </div>
  </div>

  <div class="cond" id="c-par">
    <div class="card">
      <div class="sec-lbl" data-t="sec_par_speeds"></div>
      <div class="row">
        <div class="f"><label data-t="l_par_d_cruise"></label><input type="number" name="x_par_diesel_cruise_kn" min="0" step="0.1" placeholder="kn"/></div>
        <div class="f"><label data-t="l_par_d_max"></label><input type="number" name="x_par_diesel_max_kn" min="0" step="0.1" placeholder="kn"/></div>
      </div>
      <div class="row">
        <div class="f"><label data-t="l_par_e_cruise"></label><input type="number" name="x_par_elec_cruise_kn" min="0" step="0.1" placeholder="kn"/></div>
        <div class="f"><label data-t="l_par_e_max"></label><input type="number" name="x_par_elec_max_kn" min="0" step="0.1" placeholder="kn"/></div>
      </div>
    </div>
  </div>

  <div class="cond" id="c-ser">
    <div class="card">
      <div class="sec-lbl" data-t="sec_gen"></div>
      <div class="f" style="max-width:280px"><label data-t="l_gen_kw"></label><input type="number" name="x_ser_generator_kw" min="0" step="0.1" placeholder="kW"/></div>
    </div>
    <div class="card">
      <div class="sec-lbl" data-t="sec_speeds"></div>
      <div class="row">
        <div class="f"><label data-t="l_cruise_kn"></label><input type="number" name="x_cruise_speed_kn" min="0" step="0.1" placeholder="kn"/></div>
        <div class="f"><label data-t="l_max_kn"></label><input type="number" name="x_max_speed_kn" min="0" step="0.1" placeholder="kn"/></div>
      </div>
    </div>
  </div>

  <div class="cond" id="c-ele">
    <div class="card">
      <div class="sec-lbl" data-t="sec_speeds"></div>
      <div class="row">
        <div class="f"><label data-t="l_cruise_kn"></label><input type="number" name="x_cruise_speed_kn" min="0" step="0.1" placeholder="kn"/></div>
        <div class="f"><label data-t="l_max_kn"></label><input type="number" name="x_max_speed_kn" min="0" step="0.1" placeholder="kn"/></div>
      </div>
      <div class="f" style="max-width:280px"><label data-t="l_autonomy_h"></label><input type="number" name="x_ele_autonomy_h" min="0" step="0.1" placeholder="h"/></div>
    </div>
  </div>
</section>

<!-- STEP 5 -->
<section class="step" id="s5">
  <div class="step-eye" data-t="s5_eye"></div>
  <h1 class="step-h" data-t="s5_h"></h1>
  <p class="step-sub" data-t="s5_sub"></p>
  <div class="step-err" id="e5"></div>
  <div class="cond on" id="c-chg-gen">
  <div class="card">
    <div class="f">
      <label id="lbl-gen-std" data-t="l_chg_gen"></label>
      <label id="lbl-gen-ele" data-t="l_chg_gen_ele" style="display:none"></label>
      <div class="rg">
        <label class="ri"><input type="radio" name="x_charge_generator" value="yes"/><span class="rl" data-t="yn_y"></span></label>
        <label class="ri"><input type="radio" name="x_charge_generator" value="no"/><span class="rl" data-t="yn_n"></span></label>
      </div>
    </div>
    <div class="cond" id="c-genpow" style="margin-top:10px">
      <div class="f" style="max-width:240px"><label data-t="l_chg_genpow"></label><input type="number" name="x_charge_gen_power" min="0" step="0.1" placeholder="kW"/></div>
    </div>
  </div>
  </div>
  <div class="card">
    <div class="f">
      <label data-t="l_shore"></label>
      <div class="rg">
        <label class="ri"><input type="radio" name="x_charge_port" value="yes"/><span class="rl" data-t="shore_d"></span></label>
        <label class="ri"><input type="radio" name="x_charge_port" value="no"/><span class="rl" data-t="yn_n"></span></label>
      </div>
    </div>
    <div class="f" style="margin-top:11px">
      <label data-t="l_solar"></label>
      <div class="rg">
        <label class="ri"><input type="radio" name="x_charge_solar" value="yes"/><span class="rl" data-t="solar_d"></span></label>
        <label class="ri"><input type="radio" name="x_charge_solar" value="no"/><span class="rl" data-t="yn_n"></span></label>
      </div>
    </div>
  </div>
</section>

<!-- STEP 6 -->
<section class="step" id="s6">
  <div class="step-eye" data-t="s6_eye"></div>
  <h1 class="step-h" data-t="s6_h"></h1>
  <p class="step-sub" data-t="s6_sub"></p>
  <div class="step-err" id="e6"></div>
  <div class="card">
    <div class="f">
      <label><span data-t="l_decl"></span><span class="req">*</span></label>
      <input type="text" id="f-decl" name="x_declarant"/>
      <p class="hint" data-t="h_decl"></p>
    </div>
  </div>
  <div class="card">
    <div class="sec-lbl" data-t="rev_lbl"></div>
    <table class="rev-tbl"><thead><tr><th data-t="col_f"></th><th data-t="col_v"></th></tr></thead><tbody id="rev-body"></tbody></table>
  </div>
  <div style="background:#eef2ff;border-left:3px solid #4c6ef5;border-radius:0 7px 7px 0;padding:11px 15px;font-size:.78rem;color:#3b5bdb;margin-top:4px">
    <span data-t="sbm_note"></span>
  </div>
</section>

</main>

<div class="ok-screen" id="ok">
  <div class="ok-icon">
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  </div>
  <h2 class="ok-h" data-t="ok_h"></h2>
  <p class="ok-p" data-t="ok_p"></p>
</div>

<div class="nav" id="nav">
  <button class="btn btn-bk" id="btn-bk" onclick="goBack()" data-t="btn_bk"></button>
  <button class="btn btn-nx" id="btn-nx" onclick="goNext()" data-t="btn_nx"></button>
</div>

<script>
const TOKEN = ${JSON.stringify(token)};
const STEPS = ${TOTAL_STEPS};
let cur = 1, lang = localStorage.getItem('scoping_lang') || 'es';

const TR = {
es:{
  step_of:'Paso', s1_eye:'Paso 1 de 6', s1_h:'Identificación del Proyecto', s1_sub:'Información general del proyecto y del cliente',
  s2_eye:'Paso 2 de 6', s2_h:'Datos del Buque', s2_sub:'Características principales de la embarcación',
  s3_eye:'Paso 3 de 6', s3_h:'Sistema de Propulsión', s3_sub:'Seleccione el tipo de sistema eléctrico o híbrido',
  s4_eye:'Paso 4 de 6', s4_h:'Detalles del Sistema', s4_sub:'Especificaciones técnicas del sistema seleccionado',
  s5_eye:'Paso 5 de 6', s5_h:'Infraestructura de Recarga', s5_sub:'Fuentes de energía para la carga del sistema',
  s6_eye:'Paso 6 de 6', s6_h:'Revisión y Envío', s6_sub:'Verifique los datos antes de enviar',
  l_proj:'Nombre del Proyecto', l_vessel:'Nombre del Buque', l_country:'País de Instalación', l_cat:'Categoría del Cliente',
  cat_arm:'Armador', cat_arm_d:' — Propietario/operador del buque',
  cat_ast:'Astillero', cat_ast_d:' — Constructor o reparador naval',
  cat_dis:'Diseñador', cat_dis_d:' — Empresa de ingeniería/diseño naval',
  cat_int:'Integrador', cat_int_d:' — Empresa integradora del sistema',
  cat_ot:'Otro', cat_ot_d:' — Otro tipo de cliente',
  l_class:'¿Requiere aprobación de sociedad de clasificación?',
  class_y:'Sí, requiere clasificación', class_n:'No aplica',
  l_class_name:'Sociedad de Clasificación', l_class_type:'Tipo de Aprobación',
  class_mand:'Obligatoria (Type Approval)', class_adv:'Consulta / Asesoramiento',
  sel:'— Seleccionar —',
  l_retrofit:'¿Instalación en buque existente (retrofit)?',
  ret_y:'Sí, retrofit en buque existente', ret_n:'No, buque de nueva construcción',
  l_prop_orig:'Propulsión original del buque',
  po_motor:'Motor diésel', po_sail:'Vela', po_mixed:'Mixto (motor + vela)',
  l_hull:'Tipo de casco', h_mono:'Monocasco', h_cat:'Catamarán', h_tri:'Trimarán',
  l_app:'Aplicación', a_com:'Comercial', a_plea:'Recreo / Placer', a_fish:'Pesca', a_pat:'Patrullero', a_ferry:'Ferry', a_other:'Otro',
  l_model:'Modelo / Clase del buque (opcional)',
  l_lwl:'Eslora de flotación', h_lwl:'En metros',
  l_disp:'Desplazamiento máximo', h_disp:'En toneladas métricas',
  l_prop_lines:'Número de líneas de propulsión', pl_1:'1 línea', pl_2:'2 líneas',
  pt_par:'Híbrido en Paralelo', pt_par_d:' — Motor eléctrico + motor diésel en el mismo eje',
  pt_ser:'Híbrido en Serie', pt_ser_d:' — Generador diesel + motor eléctrico independiente',
  pt_ele:'Eléctrico Puro', pt_ele_d:' — Solo propulsión eléctrica con baterías',
  par_notice:'⚡ Sistema híbrido en paralelo — nuestro equipo técnico lo revisará con prioridad.',
  sec_diesel:'Motor diesel', sec_gearbox:'Reductora',
  l_diesel_mfr:'Fabricante motor diesel', l_diesel_mdl:'Modelo motor diesel',
  l_diesel_kw:'Potencia motor diesel (kW)', l_diesel_rpm:'RPM motor diesel',
  l_gb_mfr:'Fabricante reductora', l_gb_mdl:'Modelo reductora',
  l_gb_ratio:'Relación de reducción',
  l_gb_output:'Salida de reductora', go_str:'Recta', go_ang:'Angular', go_vdr:'V-Drive',
  l_gb_type:'Tipo de reductora', gt_mec:'Mecánica', gt_ele:'Eléctrica',
  sec_par_speeds:'Velocidades en modo paralelo',
  l_par_d_cruise:'V. crucero diesel (kn)', l_par_d_max:'V. máxima diesel (kn)',
  l_par_e_cruise:'V. crucero eléctrico (kn)', l_par_e_max:'V. máxima eléctrico (kn)',
  sec_gen:'Generador serie', l_gen_kw:'Potencia generador serie (kW)',
  sec_speeds:'Velocidades',
  l_cruise_kn:'Velocidad de crucero (kn)', l_max_kn:'Velocidad máxima (kn)',
  l_autonomy_h:'Autonomía estimada (horas)',
  l_chg_gen:'¿El buque dispondrá de generador auxiliar para carga?',
  l_chg_genpow:'Potencia del generador auxiliar (kW)',
  l_shore:'Carga en puerto (shore power)', shore_d:'Sí — conectado a la red eléctrica del puerto',
  l_solar:'Panel solar fotovoltaico', solar_d:'Sí — instalación de paneles solares para carga auxiliar',
  yn_y:'Sí', yn_n:'No',
  l_decl:'Nombre y cargo de quien completa el formulario', h_decl:'Quedará registrado en el documento generado',
  rev_lbl:'Resumen de datos introducidos', col_f:'Campo', col_v:'Valor',
  sbm_note:'Al enviar, generaremos el resumen técnico y notificaremos a nuestro equipo. Recibirá una confirmación por correo.',
  btn_bk:'Anterior', btn_nx:'Siguiente', btn_sb:'Enviar Formulario', submitting:'Enviando…',
  ok_h:'Formulario enviado', ok_p:'Hemos recibido sus datos. Nuestro equipo técnico los revisará y se pondrá en contacto en los próximos días.',
  err_cat:'Seleccione la categoría del cliente.', err_lwl:'Indique la eslora de flotación.',
  err_disp:'Indique el desplazamiento máximo.', err_proplines:'Seleccione el número de líneas de propulsión.',
  err_prop:'Seleccione el tipo de sistema de propulsión.',
  err_s4_par:'Para híbrido en paralelo, indique fabricante, modelo y potencia del diesel, ratio de reductora, y velocidades crucero/máxima en modo eléctrico.',
  err_s4_ser:'Para híbrido en serie, indique la potencia del generador y las velocidades de crucero y máxima.',
  err_s4_ele:'Para eléctrico puro, indique la velocidad de crucero, velocidad máxima y autonomía estimada.',
  l_chg_gen_ele:'¿Dispondrá el buque de un generador de emergencia?',
  err_decl:'Indique su nombre y cargo antes de enviar.', err_srv:'Error al enviar. Por favor, inténtelo de nuevo.',
},
en:{
  step_of:'Step', s1_eye:'Step 1 of 6', s1_h:'Project Identification', s1_sub:'General project and client information',
  s2_eye:'Step 2 of 6', s2_h:'Vessel Data', s2_sub:'Main characteristics of the vessel',
  s3_eye:'Step 3 of 6', s3_h:'Propulsion System', s3_sub:'Select the electric or hybrid propulsion type',
  s4_eye:'Step 4 of 6', s4_h:'System Details', s4_sub:'Technical specifications of the selected system',
  s5_eye:'Step 5 of 6', s5_h:'Charging Infrastructure', s5_sub:'Available energy sources for system charging',
  s6_eye:'Step 6 of 6', s6_h:'Review & Submit', s6_sub:'Please verify your data before submitting',
  l_proj:'Project Name', l_vessel:'Vessel Name', l_country:'Installation Country', l_cat:'Client Category',
  cat_arm:'Shipowner', cat_arm_d:' — Vessel owner / operator',
  cat_ast:'Shipyard', cat_ast_d:' — Builder or repairer',
  cat_dis:'Designer', cat_dis_d:' — Naval engineering / design company',
  cat_int:'Integrator', cat_int_d:' — System integration company',
  cat_ot:'Other', cat_ot_d:' — Other client type',
  l_class:'Does the project require classification society approval?',
  class_y:'Yes, classification required', class_n:'Not applicable',
  l_class_name:'Classification Society', l_class_type:'Approval Type',
  class_mand:'Mandatory (Type Approval)', class_adv:'Advisory / Consulting',
  sel:'— Select —',
  l_retrofit:'Is this a retrofit on an existing vessel?',
  ret_y:'Yes, retrofit on existing vessel', ret_n:'No, new build',
  l_prop_orig:'Original vessel propulsion',
  po_motor:'Diesel engine', po_sail:'Sail', po_mixed:'Mixed (engine + sail)',
  l_hull:'Hull type', h_mono:'Monohull', h_cat:'Catamaran', h_tri:'Trimaran',
  l_app:'Application', a_com:'Commercial', a_plea:'Leisure / Pleasure', a_fish:'Fishing', a_pat:'Patrol', a_ferry:'Ferry', a_other:'Other',
  l_model:'Vessel Model / Class (optional)',
  l_lwl:'Flotation waterline', h_lwl:'In metres',
  l_disp:'Maximum displacement', h_disp:'In metric tonnes',
  l_prop_lines:'Number of propulsion lines', pl_1:'1 line', pl_2:'2 lines',
  pt_par:'Parallel Hybrid', pt_par_d:' — Electric motor + diesel engine on the same shaft',
  pt_ser:'Series Hybrid', pt_ser_d:' — Diesel generator + independent electric motor',
  pt_ele:'Full Electric', pt_ele_d:' — Battery-only electric propulsion',
  par_notice:'⚡ Parallel hybrid system — our technical team will review this project with priority.',
  sec_diesel:'Diesel engine', sec_gearbox:'Gearbox',
  l_diesel_mfr:'Diesel engine manufacturer', l_diesel_mdl:'Diesel engine model',
  l_diesel_kw:'Diesel engine power (kW)', l_diesel_rpm:'Diesel engine RPM',
  l_gb_mfr:'Gearbox manufacturer', l_gb_mdl:'Gearbox model',
  l_gb_ratio:'Reduction ratio',
  l_gb_output:'Gearbox output', go_str:'Straight', go_ang:'Angular', go_vdr:'V-Drive',
  l_gb_type:'Gearbox type', gt_mec:'Mechanical', gt_ele:'Electric',
  sec_par_speeds:'Parallel mode speeds',
  l_par_d_cruise:'Diesel cruise speed (kn)', l_par_d_max:'Diesel max speed (kn)',
  l_par_e_cruise:'Electric cruise speed (kn)', l_par_e_max:'Electric max speed (kn)',
  sec_gen:'Series generator', l_gen_kw:'Series generator power (kW)',
  sec_speeds:'Speeds',
  l_cruise_kn:'Cruise speed (kn)', l_max_kn:'Maximum speed (kn)',
  l_autonomy_h:'Estimated autonomy (hours)',
  l_chg_gen:'Will the vessel have an auxiliary generator for charging?',
  l_chg_genpow:'Auxiliary generator power (kW)',
  l_shore:'Shore power charging', shore_d:'Yes — connected to marina power grid',
  l_solar:'Solar PV panels', solar_d:'Yes — solar panels for auxiliary charging',
  yn_y:'Yes', yn_n:'No',
  l_decl:'Name and position of person completing the form', h_decl:'This will be recorded in the generated document',
  rev_lbl:'Summary of entered data', col_f:'Field', col_v:'Value',
  sbm_note:'On submission, we will generate a technical summary and notify our team. You will receive a confirmation by email.',
  btn_bk:'Back', btn_nx:'Next', btn_sb:'Submit Form', submitting:'Submitting…',
  ok_h:'Form submitted', ok_p:'We have received your data. Our technical team will review it and contact you within the next few days.',
  err_cat:'Please select the client category.', err_lwl:'Please enter the waterline length.',
  err_disp:'Please enter the maximum displacement.', err_proplines:'Please select the number of propulsion lines.',
  err_prop:'Please select the propulsion system type.',
  err_s4_par:'For parallel hybrid, please enter the diesel engine manufacturer, model and power, gearbox ratio, and electric cruise/max speeds.',
  err_s4_ser:'For series hybrid, please enter the generator power and cruise/maximum speeds.',
  err_s4_ele:'For full electric, please enter cruise speed, maximum speed and estimated autonomy.',
  l_chg_gen_ele:'Will the vessel have an emergency generator?',
  err_decl:'Please enter your name and position before submitting.', err_srv:'Submission error. Please try again.',
}
};

function t(k){ return (TR[lang]&&TR[lang][k])||TR.es[k]||k; }

function applyLang(){
  document.querySelectorAll('[data-t]').forEach(el=>{
    const k=el.getAttribute('data-t'), v=t(k);
    if(el.tagName==='OPTION'&&!el.value){ el.textContent=v; return; }
    if(el.tagName==='INPUT'||el.tagName==='SELECT') return;
    el.textContent=v;
  });
  document.getElementById('btn-es').classList.toggle('on',lang==='es');
  document.getElementById('btn-en').classList.toggle('on',lang==='en');
  document.documentElement.lang=lang;
  const nx=document.getElementById('btn-nx');
  if(cur===STEPS){ nx.textContent=t('btn_sb'); nx.className='btn btn-sb'; }
  else { nx.textContent=t('btn_nx'); nx.className='btn btn-nx'; }
}
function setLang(l){ lang=l; localStorage.setItem('scoping_lang',l); applyLang(); }

// Radio highlight + conditionals
document.querySelectorAll('.ri input[type=radio]').forEach(inp=>{
  inp.addEventListener('change',()=>{
    inp.closest('.rg').querySelectorAll('.ri').forEach(r=>r.classList.remove('sel'));
    inp.closest('.ri').classList.add('sel');
    cond();
  });
});

function cond(){
  const v=(n)=>{ const el=document.querySelector('input[name='+n+']:checked'); return el?el.value:''; };
  // class detail
  toggle('c-class', v('x_has_classification')==='yes');
  // gen power
  toggle('c-genpow', v('x_charge_generator')==='yes');
  // step 4 sections
  const pt = v('x_propulsion_type');
  toggle('c-diesel', pt==='parallel' || pt==='series');
  toggle('c-par', pt==='parallel');
  toggle('c-ser', pt==='series');
  toggle('c-ele', pt==='electric');
  // step 5 generator: hidden for series (intrinsic); label swapped for electric
  toggle('c-chg-gen', pt!=='series');
  const lblStd=document.getElementById('lbl-gen-std');
  const lblEle=document.getElementById('lbl-gen-ele');
  if(lblStd) lblStd.style.display = pt==='electric' ? 'none' : '';
  if(lblEle) lblEle.style.display = pt==='electric' ? '' : 'none';
}
function toggle(id, show){ const el=document.getElementById(id); if(el) el.classList.toggle('on',show); }

function progress(){
  document.getElementById('step-ctr').textContent=cur+' / '+STEPS;
  document.getElementById('prog').style.width=Math.round((cur/STEPS)*100)+'%';
}
function nav(){
  document.getElementById('btn-bk').style.visibility=cur===1?'hidden':'visible';
  const nx=document.getElementById('btn-nx');
  if(cur===STEPS){ nx.textContent=t('btn_sb'); nx.className='btn btn-sb'; }
  else { nx.textContent=t('btn_nx'); nx.className='btn btn-nx'; }
}
function showStep(n){
  document.querySelectorAll('.step').forEach(s=>s.classList.remove('on'));
  const el=document.getElementById('s'+n); if(el) el.classList.add('on');
  cur=n; progress(); nav(); window.scrollTo(0,0);
  if(n===STEPS) buildReview();
}
function showErr(stepN, msg){
  const el=document.getElementById('e'+stepN);
  if(el){ el.textContent=msg; el.style.display='block'; }
}
function hideErr(stepN){ const el=document.getElementById('e'+stepN); if(el) el.style.display='none'; }

function validate(n){
  hideErr(n);
  const v=(name)=>{ const el=document.querySelector('input[name='+name+']:checked'); return el?el.value:''; };
  const req=(name,numeric)=>{
    const el=document.querySelector('input[name="'+name+'"],select[name="'+name+'"]');
    if(!el) return true;
    const ok=numeric?(el.value!==''&&parseFloat(el.value)>0):(el.value.trim()!=='');
    el.classList.toggle('bad',!ok); return ok;
  };
  if(n===1 && !v('x_client_category')){ showErr(1,t('err_cat')); return false; }
  if(n===2){
    const lwl=document.getElementById('f-lwl'), dsp=document.getElementById('f-disp');
    if(!lwl.value||parseFloat(lwl.value)<=0){ lwl.classList.add('bad'); showErr(2,t('err_lwl')); return false; }
    lwl.classList.remove('bad');
    if(!dsp.value||parseFloat(dsp.value)<=0){ dsp.classList.add('bad'); showErr(2,t('err_disp')); return false; }
    dsp.classList.remove('bad');
    const pl=document.getElementById('f-prop-lines');
    if(!pl||!pl.value){ if(pl) pl.classList.add('bad'); showErr(2,t('err_proplines')); return false; }
    pl.classList.remove('bad');
  }
  if(n===3 && !v('x_propulsion_type')){ showErr(3,t('err_prop')); return false; }
  if(n===4){
    const pt=v('x_propulsion_type');
    if(pt==='parallel'){
      const ok=req('x_diesel_manufacturer')&&req('x_diesel_model')&&req('x_diesel_power_kw',true)
        &&req('x_gearbox_ratio')&&req('x_par_elec_cruise_kn',true)&&req('x_par_elec_max_kn',true);
      if(!ok){ showErr(4,t('err_s4_par')); return false; }
    } else if(pt==='series'){
      const ok=req('x_ser_generator_kw',true)&&req('x_cruise_speed_kn',true)&&req('x_max_speed_kn',true);
      if(!ok){ showErr(4,t('err_s4_ser')); return false; }
    } else if(pt==='electric'){
      const ok=req('x_cruise_speed_kn',true)&&req('x_max_speed_kn',true)&&req('x_ele_autonomy_h',true);
      if(!ok){ showErr(4,t('err_s4_ele')); return false; }
    }
  }
  if(n===STEPS){
    const d=document.getElementById('f-decl');
    if(!d.value.trim()){ d.classList.add('bad'); showErr(STEPS,t('err_decl')); return false; }
    d.classList.remove('bad');
  }
  return true;
}

function goNext(){ if(cur===STEPS){ submit(); return; } if(validate(cur)) showStep(cur+1); }
function goBack(){ if(cur>1) showStep(cur-1); }

function collect(){
  const d={};
  document.querySelectorAll('input[name],select[name]').forEach(el=>{
    if(!el.name) return;
    if(el.type==='radio'){ if(el.checked) d[el.name]=el.value; }
    else if(el.value!==undefined&&el.value!=='') d[el.name]=el.value;
  });
  return d;
}

function buildReview(){
  const d=collect();
  const pm={parallel:t('pt_par'),series:t('pt_ser'),electric:t('pt_ele')};
  const cm={armador:t('cat_arm'),astillero:t('cat_ast'),disenador:t('cat_dis'),integrador:t('cat_int'),otro:t('cat_ot')};
  const hm={mono:t('h_mono'),catamaran:t('h_cat'),trimaran:t('h_tri')};
  const yn=v=>v==='yes'?t('yn_y'):t('yn_n');
  const plm={'1':'1 '+t('pl_1').replace(/^\d+\s*/,''),'2':'2 '+t('pl_2').replace(/^\d+\s*/,'')};
  const gom={straight:t('go_str'),angle:t('go_ang'),vdrive:t('go_vdr')};
  const gtm={mechanical:t('gt_mec'),electric:t('gt_ele')};
  const rows=[
    [t('l_proj'),d.x_project_name],[t('l_vessel'),d.x_vessel_name],[t('l_country'),d.x_installation_country],
    [t('l_cat'),cm[d.x_client_category]||d.x_client_category],
    [t('l_retrofit'),yn(d.x_vessel_retrofit)],[t('l_hull'),hm[d.x_hull_type]||d.x_hull_type],
    [t('l_lwl')+' (m)',d.x_waterline_length],[t('l_disp')+' (t)',d.x_max_displacement],
    [t('l_prop_lines'),d.x_prop_lines?d.x_prop_lines+' '+t(d.x_prop_lines==='1'?'pl_1':'pl_2').replace(/^\d+\s*/,''):''],
    ['Sistema / System',pm[d.x_propulsion_type]||d.x_propulsion_type],
  ];
  if(d.x_propulsion_type==='parallel'||d.x_propulsion_type==='series'){
    rows.push(
      [t('l_diesel_mfr'),d.x_diesel_manufacturer],[t('l_diesel_mdl'),d.x_diesel_model],
      [t('l_diesel_kw'),d.x_diesel_power_kw],[t('l_diesel_rpm'),d.x_diesel_rpm],
      [t('l_gb_mfr'),d.x_gearbox_manufacturer],[t('l_gb_mdl'),d.x_gearbox_model],
      [t('l_gb_ratio'),d.x_gearbox_ratio],
      [t('l_gb_output'),gom[d.x_gearbox_output]||d.x_gearbox_output],
      [t('l_gb_type'),gtm[d.x_gearbox_type]||d.x_gearbox_type],
    );
  }
  if(d.x_propulsion_type==='parallel'){
    rows.push(
      [t('l_par_d_cruise'),d.x_par_diesel_cruise_kn],[t('l_par_d_max'),d.x_par_diesel_max_kn],
      [t('l_par_e_cruise'),d.x_par_elec_cruise_kn],[t('l_par_e_max'),d.x_par_elec_max_kn],
    );
  }
  if(d.x_propulsion_type==='series'){
    rows.push(
      [t('l_gen_kw'),d.x_ser_generator_kw],
      [t('l_cruise_kn'),d.x_cruise_speed_kn],[t('l_max_kn'),d.x_max_speed_kn],
    );
  }
  if(d.x_propulsion_type==='electric'){
    rows.push(
      [t('l_cruise_kn'),d.x_cruise_speed_kn],[t('l_max_kn'),d.x_max_speed_kn],
      [t('l_autonomy_h'),d.x_ele_autonomy_h],
    );
  }
  const filtered=rows.filter(r=>r[1]||r[1]===0);
  document.getElementById('rev-body').innerHTML=filtered.map(([k,v])=>'<tr><td>'+k+'</td><td>'+(v||'—')+'</td></tr>').join('');
}

async function submit(){
  if(!validate(STEPS)) return;
  const nx=document.getElementById('btn-nx');
  nx.disabled=true;
  nx.innerHTML='<span class="spin"></span>'+t('submitting');
  const data=collect();
  try{
    const r=await fetch('/api/scoping/'+TOKEN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    if(r.status===409||r.ok){ showOk(); return; }
    const j=await r.json().catch(()=>({}));
    throw new Error(j.error||r.status);
  }catch(e){
    nx.disabled=false; nx.innerHTML=t('btn_sb'); nx.className='btn btn-sb';
    showErr(STEPS,t('err_srv')+' ('+e.message+')');
  }
}

function showOk(){
  document.getElementById('wizard').style.display='none';
  document.getElementById('nav').style.display='none';
  document.getElementById('ok').classList.add('on');
  applyLang();
}

// Init
applyLang(); cond(); progress(); nav();
</script>
</body>
</html>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.SCOPING_SECRET;
  if (!secret) {
    console.error('[token].js: SCOPING_SECRET not set');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // Extract token from Vercel dynamic route param
  const token = req.query.token || '';
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const payload = verifyToken(token, secret);
  if (!payload) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Enlace inválido</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#0d1b2a;padding:0 20px">
<h2 style="color:#c9a84c;margin-bottom:12px">Enlace inválido o expirado</h2>
<p>Este enlace no es válido o ha caducado. Por favor, contacte con Antrade Servitech para obtener un nuevo enlace.</p>
<p style="color:#999;font-size:.82rem;margin-top:16px">Invalid or expired link. Please contact Antrade Servitech.</p>
</body></html>`;
    return res.status(403).send(html);
  }

  const sheetId = payload.id;

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const sheets = await searchRead(SHEET_MODEL, [['id', '=', sheetId]], [
        'id', 'x_portal_submitted', 'x_project_name', 'x_vessel_name',
        'x_installation_country', 'x_portal_first_viewed_at',
      ]);
      if (!sheets.length) return res.status(404).send('Formulario no encontrado');
      const sheet = sheets[0];

      if (sheet.x_portal_submitted) {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Ya enviado</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#0d1b2a;padding:0 20px">
<h2 style="color:#c9a84c;margin-bottom:12px">Formulario ya enviado</h2>
<p>Este formulario ya fue completado. No es posible enviarlo de nuevo.</p>
<p style="color:#999;font-size:.82rem;margin-top:16px">This form has already been submitted.</p>
</body></html>`;
        return res.status(200).send(html);
      }

      // Record first view (non-blocking)
      if (!sheet.x_portal_first_viewed_at) {
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        execute(SHEET_MODEL, 'write', [[sheetId], { x_portal_first_viewed_at: now }]).catch(() => {});
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(renderWizard(sheet, token));
    } catch (err) {
      console.error('[token].js GET error:', err);
      return res.status(500).send('Error interno / Internal error');
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
      body = body || {};

      // Single-use check
      const sheets = await searchRead(SHEET_MODEL, [['id', '=', sheetId]], [
        'id', 'x_portal_submitted', 'x_lead_id',
      ]);
      if (!sheets.length) return res.status(404).json({ error: 'Sheet not found' });
      const sheet = sheets[0];
      if (sheet.x_portal_submitted) return res.status(409).json({ error: 'Already submitted' });

      const leadId = Array.isArray(sheet.x_lead_id) ? sheet.x_lead_id[0] : sheet.x_lead_id;

      // ── SERVER-SIDE VALIDATION (mirrors client validate(), enforced even on direct POST)
      {
        const missing = [];
        const has = (k) => { const v = body[k]; return v !== undefined && v !== null && String(v).trim() !== ''; };
        const pos = (k) => { const v = parseFloat(body[k]); return !isNaN(v) && v > 0; };
        if (!has('x_client_category'))   missing.push('Categoría del cliente / Client category');
        if (!pos('x_waterline_length'))  missing.push('Eslora en flotación / Waterline length');
        if (!pos('x_max_displacement'))  missing.push('Desplazamiento / Displacement');
        if (!has('x_prop_lines'))        missing.push('Número de líneas de propulsión / Propulsion lines');
        if (!has('x_propulsion_type'))   missing.push('Tipo de propulsión / Propulsion type');
        const pt = body.x_propulsion_type;
        if (pt === 'parallel') {
          if (!has('x_diesel_manufacturer'))  missing.push('Fabricante diesel / Diesel manufacturer');
          if (!has('x_diesel_model'))         missing.push('Modelo diesel / Diesel model');
          if (!pos('x_diesel_power_kw'))      missing.push('Potencia diesel / Diesel power (kW)');
          if (!has('x_gearbox_ratio'))        missing.push('Ratio reductora / Gearbox ratio');
          if (!pos('x_par_elec_cruise_kn'))   missing.push('V. crucero eléctrico / Electric cruise speed (kn)');
          if (!pos('x_par_elec_max_kn'))      missing.push('V. máxima eléctrico / Electric max speed (kn)');
        } else if (pt === 'series') {
          if (!pos('x_ser_generator_kw'))     missing.push('Potencia generador / Generator power (kW)');
          if (!pos('x_cruise_speed_kn'))      missing.push('Velocidad crucero / Cruise speed (kn)');
          if (!pos('x_max_speed_kn'))         missing.push('Velocidad máxima / Max speed (kn)');
        } else if (pt === 'electric') {
          if (!pos('x_cruise_speed_kn'))      missing.push('Velocidad crucero / Cruise speed (kn)');
          if (!pos('x_max_speed_kn'))         missing.push('Velocidad máxima / Max speed (kn)');
          if (!pos('x_ele_autonomy_h'))       missing.push('Autonomía / Autonomy (h)');
        }
        if (!has('x_declarant'))         missing.push('Declarado por / Declarant');
        if (missing.length) {
          return res.status(422).json({ error: 'Campos requeridos ausentes / Missing required fields', fields: missing });
        }
      }

      // ── STEP A: Write to Odoo — NO inner try/catch ────────────────────────
      // Helper: '' is invalid for Odoo Selection fields; use false for all optional fields
      const sel = v => v || false;
      const writeVals = {
        x_portal_submitted: true,
        x_state: 'completed',
        x_project_name: String(body.x_project_name || ''),
        x_vessel_name: String(body.x_vessel_name || ''),
        x_installation_country: String(body.x_installation_country || ''),
        x_client_category: String(body.x_client_category || ''),
        x_has_classification: bool(body.x_has_classification),
        x_class_society_name: String(body.x_class_society_name || ''),
        x_class_society_type: sel(body.x_class_society_type),
        x_vessel_retrofit: bool(body.x_vessel_retrofit),
        x_prop_original: sel(body.x_prop_original),
        x_hull_type: sel(body.x_hull_type),
        x_application: sel(body.x_application),
        x_vessel_model: String(body.x_vessel_model || ''),
        x_prop_lines: String(body.x_prop_lines || ''),
        x_propulsion_type: String(body.x_propulsion_type || ''),
        x_diesel_manufacturer: String(body.x_diesel_manufacturer || ''),
        x_diesel_model: String(body.x_diesel_model || ''),
        x_gearbox_manufacturer: String(body.x_gearbox_manufacturer || ''),
        x_gearbox_model: String(body.x_gearbox_model || ''),
        x_gearbox_ratio: String(body.x_gearbox_ratio || ''),
        x_gearbox_output: sel(body.x_gearbox_output),
        x_gearbox_type: sel(body.x_gearbox_type),
        x_charge_generator: bool(body.x_charge_generator),
        x_charge_port: bool(body.x_charge_port),
        x_charge_solar: bool(body.x_charge_solar),
        x_declarant: String(body.x_declarant || ''),
      };

      // Numeric fields — only set if provided
      const numFields = {
        x_waterline_length: num(body.x_waterline_length),
        x_max_displacement: num(body.x_max_displacement),
        x_diesel_power_kw: num(body.x_diesel_power_kw),
        x_diesel_rpm: numInt(body.x_diesel_rpm),
        x_par_diesel_cruise_kn: num(body.x_par_diesel_cruise_kn),
        x_par_diesel_max_kn: num(body.x_par_diesel_max_kn),
        x_par_elec_cruise_kn: num(body.x_par_elec_cruise_kn),
        x_par_elec_max_kn: num(body.x_par_elec_max_kn),
        x_ser_generator_kw: num(body.x_ser_generator_kw),
        x_cruise_speed_kn: num(body.x_cruise_speed_kn),
        x_max_speed_kn: num(body.x_max_speed_kn),
        x_ele_autonomy_h: num(body.x_ele_autonomy_h),
        x_charge_gen_power: num(body.x_charge_gen_power),
      };
      Object.entries(numFields).forEach(([k, v]) => { if (v !== null) writeVals[k] = v; });

      await execute(SHEET_MODEL, 'write', [[sheetId], writeVals]);

      // Set x_ficha_completada on lead
      if (leadId) {
        try {
          await execute('crm.lead', 'write', [[leadId], { x_ficha_completada: true }]);
        } catch (e) {
          console.error('[token].js: x_ficha_completada write failed:', e.message);
        }
      }

      // ── STEP B: Email field list ───────────────────────────────────────────
      const propMap = { parallel: 'Híbrido en Paralelo', series: 'Híbrido en Serie', electric: 'Eléctrico Puro' };
      const catMap = { armador: 'Armador', astillero: 'Astillero', integrador: 'Integrador', usuario_final: 'Usuario Final' };
      const appMap = { commercial: 'Comercial', pleasure: 'Recreo', fishing: 'Pesca', patrol: 'Patrullero', ferry: 'Ferry', other: 'Otro' };
      const hullMap = { mono: 'Monocasco', catamaran: 'Catamarán', trimaran: 'Trimarán' };
      const yn = v => bool(v) ? 'Sí' : 'No';

      const emailFields = [
        ['Proyecto', body.x_project_name],
        ['Buque', body.x_vessel_name],
        ['País instalación', body.x_installation_country],
        ['Categoría cliente', catMap[body.x_client_category] || body.x_client_category],
        ['Clasificación', bool(body.x_has_classification) ? ((body.x_class_society_name || '—') + ' — ' + (body.x_class_society_type === 'mandatory' ? 'Obligatoria' : 'Consulta')) : 'No'],
        ['Retrofit', yn(body.x_vessel_retrofit)],
        ['Propulsión original', body.x_prop_original || '—'],
        ['Casco', hullMap[body.x_hull_type] || body.x_hull_type || '—'],
        ['Aplicación', appMap[body.x_application] || body.x_application || '—'],
        ['Modelo', body.x_vessel_model || '—'],
        ['Eslora de flotación (m)', body.x_waterline_length],
        ['Desplazamiento máx. (t)', body.x_max_displacement],
        ['Sistema propulsión', propMap[body.x_propulsion_type] || body.x_propulsion_type],
      ];

      if (body.x_propulsion_type === 'parallel') {
        emailFields.push(
          ['Fabricante diesel', body.x_diesel_manufacturer || '—'],
          ['Modelo diesel', body.x_diesel_model || '—'],
          ['Potencia diesel (kW)', body.x_diesel_power_kw],
          ['RPM diesel', body.x_diesel_rpm],
          ['Fabricante reductora', body.x_gearbox_manufacturer || '—'],
          ['Modelo reductora', body.x_gearbox_model || '—'],
          ['Relación reducción', body.x_gearbox_ratio || '—'],
          ['Salida reductora', body.x_gearbox_output || '—'],
          ['Tipo reductora', body.x_gearbox_type || '—'],
          ['V. crucero diesel (kn)', body.x_par_diesel_cruise_kn],
          ['V. máxima diesel (kn)', body.x_par_diesel_max_kn],
          ['V. crucero eléctrico (kn)', body.x_par_elec_cruise_kn],
          ['V. máxima eléctrico (kn)', body.x_par_elec_max_kn],
        );
      } else if (body.x_propulsion_type === 'series') {
        emailFields.push(
          ['Fabricante diesel', body.x_diesel_manufacturer || '—'],
          ['Modelo diesel', body.x_diesel_model || '—'],
          ['Potencia diesel (kW)', body.x_diesel_power_kw],
          ['RPM diesel', body.x_diesel_rpm],
          ['Fabricante reductora', body.x_gearbox_manufacturer || '—'],
          ['Modelo reductora', body.x_gearbox_model || '—'],
          ['Relación reducción', body.x_gearbox_ratio || '—'],
          ['Salida reductora', body.x_gearbox_output || '—'],
          ['Tipo reductora', body.x_gearbox_type || '—'],
          ['Potencia generador (kW)', body.x_ser_generator_kw],
          ['Velocidad crucero (kn)', body.x_cruise_speed_kn],
          ['Velocidad máxima (kn)', body.x_max_speed_kn],
        );
      } else if (body.x_propulsion_type === 'electric') {
        emailFields.push(
          ['Velocidad crucero (kn)', body.x_cruise_speed_kn],
          ['Velocidad máxima (kn)', body.x_max_speed_kn],
          ['Autonomía estimada (h)', body.x_ele_autonomy_h],
        );
      }

      emailFields.push(
        ['Generador a bordo', yn(body.x_charge_generator)],
        ['Potencia gen. (kW)', bool(body.x_charge_generator) ? (body.x_charge_gen_power || '—') : '—'],
        ['Carga en puerto', yn(body.x_charge_port)],
        ['Panel solar', yn(body.x_charge_solar)],
        ['Declarado por', body.x_declarant],
      );

      // ── STEP C: PDF generation (isolated try/catch) ───────────────────────
      let attachmentId = null;
      let pdfError = '';
      try {
        const pdfData = Object.assign({ id: sheetId }, writeVals, numFields);
        const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
        const pdfBytes = await buildPdf(pdfData, body.x_declarant, clientIp);
        const safeName = (body.x_project_name || 'Proyecto').replace(/[^a-zA-Z0-9_\-]/g, '_');
        const pdfName = `Dimensionamiento_${safeName}.pdf`;
        const rawId = await execute('ir.attachment', 'create', [{
          name: pdfName,
          datas: Buffer.from(pdfBytes).toString('base64'),
          res_model: SHEET_MODEL,
          res_id: sheetId,
          mimetype: 'application/pdf',
        }]);
        attachmentId = Array.isArray(rawId) ? rawId[0] : rawId;
        console.log(`[token].js: PDF ir.attachment id=${attachmentId}`);
      } catch (pdfErr) {
        pdfError = pdfErr.message || 'PDF error';
        console.error('[token].js PDF error:', pdfErr);
        execute(SHEET_MODEL, 'write', [[sheetId], { x_pdf_generation_error: pdfError }]).catch(() => {});
      }

      // ── STEP D: Email to Jesús ─────────────────────────────────────────────
      const isParallel = body.x_propulsion_type === 'parallel';
      const parallelBanner = isParallel
        ? `<div style="background:#fff3cd;border-left:5px solid #e0a000;padding:12px 16px;margin-bottom:16px;border-radius:0 6px 6px 0">
<strong style="font-size:.95rem;color:#7a4800">⚡ SISTEMA HÍBRIDO EN PARALELO — REVISIÓN MANUAL REQUERIDA</strong>
<p style="margin:5px 0 0;color:#7a4800;font-size:.85rem">No generar actividad automática. El equipo técnico debe evaluar este proyecto de forma manual.</p>
</div>`
        : '';

      const pdfBanner = !attachmentId
        ? `<p style="color:#c0392b;font-size:.82rem;background:#fdf2f0;border:1px solid #e8b4af;border-radius:6px;padding:8px 12px;margin-bottom:12px">⚠ El PDF no se pudo generar: ${esc(pdfError)}</p>`
        : '';

      const emailBody = `<div style="font-family:sans-serif;max-width:700px">
<div style="background:#0d1b2a;padding:14px 22px;margin-bottom:18px">
<span style="color:#fff;font-size:1rem;font-weight:bold">Antrade Servitech — Dimensionamiento Inicial de Proyecto</span>
</div>
${parallelBanner}
<p style="margin-bottom:12px;font-size:.88rem;color:#333">Se ha recibido un nuevo formulario de dimensionamiento completado por el cliente.</p>
${pdfBanner}
<h3 style="margin-bottom:8px;color:#0d1b2a;font-size:.9rem;border-bottom:2px solid #c9a84c;padding-bottom:6px">Datos del formulario</h3>
${buildEmailTable(emailFields)}
<p style="margin-top:14px;font-size:.75rem;color:#aaa">Ficha id=${sheetId} · ${new Date().toLocaleString('es-ES')}</p>
</div>`;

      try {
        const subj = `[Dimensionamiento] ${body.x_project_name || 'Nuevo proyecto'} — ${propMap[body.x_propulsion_type] || body.x_propulsion_type}`;
        const mailId = await execute('mail.mail', 'create', [{
          subject: subj,
          body_html: emailBody,
          email_to: JESUS_EMAIL,
          auto_delete: false,
        }]);
        await execute('mail.mail', 'send', [[mailId]]);
        try {
          const mailRecs = await execute('mail.mail', 'read', [[mailId]], { fields: ['state'] });
          const mailState = mailRecs.length ? mailRecs[0].state : '';
          const statusStr = mailState === 'sent'
            ? `Enviado ${new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
            : `Estado: ${mailState || 'desconocido'}`;
          await execute(SHEET_MODEL, 'write', [[sheetId], { x_last_email_status: statusStr }]);
          if (mailState === 'sent') await execute('mail.mail', 'unlink', [[mailId]]);
        } catch (_) {}
        console.log(`[token].js: email enviado a ${JESUS_EMAIL}, sheet ${sheetId}`);
      } catch (mailErr) {
        console.error('[token].js email error:', mailErr.message);
      }

      return res.status(200).json({ ok: true });

    } catch (err) {
      console.error('[token].js POST error:', err);
      return res.status(500).json({ error: err.message || 'Internal error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
