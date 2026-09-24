'use strict';
/**
 * tf7430.js — TF7430 Transfluid data sheet generator
 *
 * Exports:
 *   generateTF7430Excel(data)  → Buffer  (.xlsx)
 *   generateTF7430Pdf(data)    → Buffer  (.pdf)  — always EN
 *
 * data = x_project_scoping_sheet record from Odoo (flat object with x_* fields)
 */

const ExcelJS = require('exceljs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ── helpers ──────────────────────────────────────────────────────────────────
const na = v => (v !== undefined && v !== null && v !== false && String(v).trim() !== '') ? String(v) : 'N/A';
const PENDING = 'PENDING — fill in manually';

// ── CATEGORY A/B MAPPING (fields auto-filled from scoping sheet) ─────────────
function getSocietyLabel(data) {
  if (!data.x_has_classification) return 'Not applicable';
  const certMap = { type_approval: 'Type Approval', full_class: 'Full Class', otros: 'Other' };
  const cert = certMap[data.x_class_society_type] || (data.x_class_society_type || 'N/A');
  const extra = data.x_class_cert_otros ? ` (${data.x_class_cert_otros})` : '';
  return `${na(data.x_class_society_name)} — ${cert}${extra}`;
}

function getRotationLabel(code) {
  if (code === 'cw') return 'Clockwise (right-handed)';
  if (code === 'ccw') return 'Counter-clockwise (left-handed)';
  return 'N/A';
}

// ── Excel generation ─────────────────────────────────────────────────────────
async function generateTF7430Excel(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Antrade Servitech SL';
  wb.created = new Date();

  const ws = wb.addWorksheet('TF7430');
  ws.pageSetup.paperSize = 9; // A4

  // Column widths
  ws.getColumn('A').width = 6;
  ws.getColumn('B').width = 35;
  ws.getColumn('C').width = 38;
  ws.getColumn('D').width = 14;

  // ── Styles ──────────────────────────────────────────────────────────────────
  const navy = { argb: 'FF0D1B2A' };
  const gold = { argb: 'FFC9A84C' };
  const white = { argb: 'FFFFFFFF' };
  const lightBlue = { argb: 'FFE8EFF8' };
  const lightGold = { argb: 'FFFFF3CD' };
  const red = { argb: 'FFCC0000' };
  const lightRed = { argb: 'FFFFF0F0' };
  const green = { argb: 'FF006633' };
  const lightGreen = { argb: 'FFEAFAF0' };

  const hdrFont = { name: 'Calibri', bold: true, color: white, size: 12 };
  const sectionFont = { name: 'Calibri', bold: true, size: 10, color: navy };
  const labelFont = { name: 'Calibri', size: 9, color: { argb: 'FF333333' } };
  const valueFont = { name: 'Calibri', size: 9, color: { argb: 'FF111111' } };
  const pendingFont = { name: 'Calibri', bold: true, italic: true, size: 9, color: red };
  const catFont = { name: 'Calibri', bold: true, size: 8.5 };

  const thin = { style: 'thin', color: { argb: 'FFCCCCCC' } };
  const thinBorder = { top: thin, left: thin, bottom: thin, right: thin };

  let row = 1;

  // ── Header ──────────────────────────────────────────────────────────────────
  const h1 = ws.getRow(row);
  ws.mergeCells(`A${row}:D${row}`);
  const h1c = ws.getCell(`A${row}`);
  h1c.value = 'TRANSFLUID TECNOLOGY IBÉRICA SL';
  h1c.font = { ...hdrFont, size: 14 };
  h1c.alignment = { horizontal: 'center', vertical: 'middle' };
  h1c.fill = { type: 'pattern', pattern: 'solid', fgColor: navy };
  h1.height = 24;
  row++;

  ws.mergeCells(`A${row}:D${row}`);
  const h2c = ws.getCell(`A${row}`);
  h2c.value = 'Technical Data Sheet — Hybrid Parallel Propulsion System';
  h2c.font = { name: 'Calibri', bold: true, size: 10, color: gold };
  h2c.alignment = { horizontal: 'center', vertical: 'middle' };
  h2c.fill = { type: 'pattern', pattern: 'solid', fgColor: navy };
  ws.getRow(row).height = 16;
  row++;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = 'Form TF 7430';
  ws.getCell(`A${row}`).font = { name: 'Calibri', bold: true, size: 9, color: { argb: 'FF666666' } };
  ws.mergeCells(`C${row}:D${row}`);
  ws.getCell(`C${row}`).value = `Generated: ${new Date().toLocaleDateString('en-GB')}`;
  ws.getCell(`C${row}`).font = { name: 'Calibri', size: 9, color: { argb: 'FF666666' } };
  ws.getCell(`C${row}`).alignment = { horizontal: 'right' };
  ws.getRow(row).height = 14;
  row++;

  row++; // blank separator

  // ── Project info ────────────────────────────────────────────────────────────
  const addSection = (label, bg) => {
    ws.mergeCells(`A${row}:D${row}`);
    const c = ws.getCell(`A${row}`);
    c.value = label;
    c.font = sectionFont;
    c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: bg };
    c.border = thinBorder;
    ws.getRow(row).height = 16;
    row++;
  };

  const addField = (label, value, fillBg, isCategory, isPending) => {
    ws.getCell(`A${row}`).value = isCategory || '';
    ws.getCell(`A${row}`).font = { ...catFont, color: isCategory === 'A' ? { argb: 'FF1E5799' } : isCategory === 'B' ? green : red };
    ws.getCell(`A${row}`).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(`A${row}`).border = thinBorder;

    ws.getCell(`B${row}`).value = label;
    ws.getCell(`B${row}`).font = labelFont;
    ws.getCell(`B${row}`).alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
    ws.getCell(`B${row}`).border = thinBorder;

    ws.getCell(`C${row}`).value = value;
    ws.getCell(`C${row}`).font = isPending ? pendingFont : valueFont;
    ws.getCell(`C${row}`).alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
    ws.getCell(`C${row}`).border = thinBorder;
    if (fillBg) {
      ws.getCell(`A${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: fillBg };
      ws.getCell(`B${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: fillBg };
      ws.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: fillBg };
    }

    ws.getCell(`D${row}`).border = thinBorder;
    ws.getRow(row).height = 14;
    row++;
  };

  // Project identification
  addSection('Project Identification', { argb: 'FFEEEEEE' });
  addField('Project Name', na(data.x_project_name), null, '', false);
  addField('Vessel Name', na(data.x_vessel_name), null, '', false);
  addField('Installation Country', na(data.x_installation_country), null, '', false);

  row++;

  // ── Category A — Auto-filled from Antrade scoping data ──────────────────────
  addSection('CATEGORY A — Data available from Antrade project file (auto-filled)', lightBlue);

  addField('Classification Society & Level', getSocietyLabel(data), { argb: 'FFE8EFF8' }, 'A', false);
  addField('Gearbox Manufacturer', na(data.x_gearbox_manufacturer), { argb: 'FFE8EFF8' }, 'A', false);
  addField('Gearbox Model', na(data.x_gearbox_model), { argb: 'FFE8EFF8' }, 'A', false);
  addField('Reduction Ratio', na(data.x_gearbox_ratio), { argb: 'FFE8EFF8' }, 'A', false);
  addField('Gearbox Output Type', na(data.x_gearbox_output), { argb: 'FFE8EFF8' }, 'A', false);

  row++;

  // ── Category B — New PASO 1 fields ─────────────────────────────────────────
  addSection('CATEGORY B — Additional data from scoping questionnaire', { argb: 'FFE4F4EC' });

  addField('Propeller Rotation Direction', getRotationLabel(data.x_prop_rotation), { argb: 'FFE4F4EC' }, 'B', false);
  addField('Diesel Engine Battery Voltage (V)',
    (data.x_diesel_battery_voltage && data.x_diesel_battery_voltage > 0)
      ? String(data.x_diesel_battery_voltage)
      : 'N/A',
    { argb: 'FFE4F4EC' }, 'B', false);

  row++;

  // ── Category C — Must be filled manually ────────────────────────────────────
  addSection('CATEGORY C — Data to be completed manually by Antrade / Transfluid', lightRed);

  const pendingFields = [
    'IACS/Classification Society (formal name)',
    'Diesel Engine Manufacturer',
    'Diesel Engine Model',
    'Diesel Engine Power (kW)',
    'Diesel Engine RPM',
    'Engine Torsional System Data',
    'Engine Crankshaft Inertia',
    'Engine Firing Angle / Cylinder Configuration',
    'Gearbox Torsional Inertia Data',
    'Cardan Shaft Inertia',
    'Tailshaft Inertia',
    'Propeller Type (with / without nozzle)',
    'Propeller Geometry (diameter, pitch, hub Ø)',
    'Number of Propeller Blades',
    'SAE Interface (B / C)',
    'Diesel Engine 3D Plan (STEP/DXF)',
    'Gearbox 3D Plan (STEP/DXF)',
    'Vibration Analysis Reference (TF7324)',
  ];

  for (const f of pendingFields) {
    addField(f, PENDING, lightRed, 'C', true);
  }

  row++;

  // ── Legend ──────────────────────────────────────────────────────────────────
  addSection('Legend', { argb: 'FFF5F5F5' });
  ws.mergeCells(`A${row}:D${row}`);
  ws.getCell(`A${row}`).value =
    'A = Auto-filled from Antrade project file   |   ' +
    'B = From scoping questionnaire   |   ' +
    'C = Must be completed manually before sending to Transfluid';
  ws.getCell(`A${row}`).font = { name: 'Calibri', size: 8, italic: true, color: { argb: 'FF555555' } };
  ws.getCell(`A${row}`).alignment = { horizontal: 'left', indent: 1 };
  ws.getRow(row).height = 12;
  row++;

  row++;

  // ── Signature area ──────────────────────────────────────────────────────────
  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = 'Prepared by (Antrade):';
  ws.getCell(`A${row}`).font = labelFont;
  ws.getCell(`A${row}`).border = { bottom: { style: 'medium', color: { argb: 'FF333333' } } };
  ws.mergeCells(`C${row}:D${row}`);
  ws.getCell(`C${row}`).value = 'Reviewed by (Transfluid):';
  ws.getCell(`C${row}`).font = labelFont;
  ws.getCell(`C${row}`).border = { bottom: { style: 'medium', color: { argb: 'FF333333' } } };
  ws.getRow(row).height = 24;
  row++;
  ws.getRow(row).height = 20;
  row++;

  ws.mergeCells(`A${row}:B${row}`);
  ws.getCell(`A${row}`).value = 'Date:';
  ws.getCell(`A${row}`).font = labelFont;
  ws.mergeCells(`C${row}:D${row}`);
  ws.getCell(`C${row}`).value = 'Date:';
  ws.getCell(`C${row}`).font = labelFont;
  ws.getRow(row).height = 14;

  // Freeze top rows
  ws.views = [{ state: 'frozen', ySplit: 4 }];

  const buf = await wb.xlsx.writeBuffer();
  return buf;
}

// ── PDF generation (EN only, for Transfluid) ─────────────────────────────────
async function generateTF7430Pdf(data) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const navy = rgb(0.051, 0.106, 0.165);
  const gold = rgb(0.788, 0.659, 0.298);
  const red = rgb(0.75, 0.05, 0.05);
  const green = rgb(0.0, 0.4, 0.2);

  const addPage = () => {
    const p = pdfDoc.addPage([595, 842]);
    p.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: navy });
    p.drawText('TRANSFLUID TECNOLOGY IBÉRICA SL', { x: 40, y: 812, size: 12, font: bold, color: rgb(1, 1, 1) });
    p.drawText('Technical Data Sheet — Hybrid Parallel Propulsion System — Form TF 7430', { x: 40, y: 794, size: 8, font, color: gold });
    p.drawText(`Generated by Antrade Servitech SL — ${new Date().toLocaleDateString('en-GB')}`, {
      x: 40, y: 779, size: 7, font, color: rgb(0.7, 0.7, 0.7),
    });
    return p;
  };

  const page = addPage();
  let y = 748;
  const lineH = 16;

  const drawRow = (p, label, value, cat, isPending) => {
    if (y < 60) { p = addPage(); y = 748; }
    const catColor = cat === 'A' ? rgb(0.12, 0.34, 0.6) : cat === 'B' ? green : red;
    p.drawText(`[${cat}]`, { x: 40, y, size: 7, font: bold, color: catColor });
    p.drawText(label + ':', { x: 65, y, size: 8.5, font: bold, color: navy });
    p.drawText(isPending ? value : (value || 'N/A'), {
      x: 280, y, size: 8.5, font: isPending ? italic : font,
      color: isPending ? red : rgb(0.1, 0.1, 0.1),
    });
    y -= lineH;
    return p;
  };

  let p = page;

  // Project info
  p.drawText('Project Identification', { x: 40, y, size: 10, font: bold, color: navy });
  y -= lineH;
  p.drawText('Project:', { x: 40, y, size: 8.5, font: bold, color: navy });
  p.drawText(na(data.x_project_name), { x: 280, y, size: 8.5, font, color: rgb(0.1, 0.1, 0.1) });
  y -= lineH;
  p.drawText('Vessel:', { x: 40, y, size: 8.5, font: bold, color: navy });
  p.drawText(na(data.x_vessel_name), { x: 280, y, size: 8.5, font, color: rgb(0.1, 0.1, 0.1) });
  y -= lineH;

  y -= 6;
  p.drawLine({ start: { x: 40, y: y + 4 }, end: { x: 555, y: y + 4 }, thickness: 0.4, color: rgb(0.7, 0.7, 0.7) });
  y -= 4;

  // Category A section
  p.drawText('CATEGORY A — Auto-filled from Antrade project data', { x: 40, y, size: 9, font: bold, color: rgb(0.12, 0.34, 0.6) });
  y -= lineH;
  p = drawRow(p, 'Classification Society & Level', getSocietyLabel(data), 'A', false);
  p = drawRow(p, 'Gearbox Manufacturer', na(data.x_gearbox_manufacturer), 'A', false);
  p = drawRow(p, 'Gearbox Model', na(data.x_gearbox_model), 'A', false);
  p = drawRow(p, 'Reduction Ratio', na(data.x_gearbox_ratio), 'A', false);
  p = drawRow(p, 'Gearbox Output Type', na(data.x_gearbox_output), 'A', false);

  y -= 6;
  p.drawLine({ start: { x: 40, y: y + 4 }, end: { x: 555, y: y + 4 }, thickness: 0.4, color: rgb(0.7, 0.7, 0.7) });
  y -= 4;

  // Category B section
  p.drawText('CATEGORY B — From scoping questionnaire', { x: 40, y, size: 9, font: bold, color: green });
  y -= lineH;
  p = drawRow(p, 'Propeller Rotation Direction', getRotationLabel(data.x_prop_rotation), 'B', false);
  p = drawRow(p, 'Diesel Battery Voltage (V)',
    (data.x_diesel_battery_voltage && data.x_diesel_battery_voltage > 0)
      ? String(data.x_diesel_battery_voltage) : 'N/A',
    'B', false);

  y -= 6;
  p.drawLine({ start: { x: 40, y: y + 4 }, end: { x: 555, y: y + 4 }, thickness: 0.4, color: rgb(0.7, 0.7, 0.7) });
  y -= 4;

  // Category C section
  p.drawText('CATEGORY C — Must be completed manually', { x: 40, y, size: 9, font: bold, color: red });
  y -= lineH;

  const pendingFields = [
    'IACS/Classification Society (formal name)',
    'Diesel Engine Manufacturer',
    'Diesel Engine Model',
    'Diesel Engine Power (kW)',
    'Diesel Engine RPM',
    'Engine Torsional System Data',
    'Engine Crankshaft Inertia',
    'Engine Firing Angle / Cylinder Config.',
    'Gearbox Torsional Inertia Data',
    'Cardan Shaft Inertia',
    'Tailshaft Inertia',
    'Propeller Type (with/without nozzle)',
    'Propeller Geometry (diameter, pitch, hub)',
    'Number of Propeller Blades',
    'SAE Interface (B / C)',
    'Diesel Engine 3D Plan (STEP/DXF)',
    'Gearbox 3D Plan (STEP/DXF)',
    'Vibration Analysis Reference (TF7324)',
  ];

  for (const f of pendingFields) {
    p = drawRow(p, f, PENDING, 'C', true);
  }

  y -= 12;
  if (y < 80) { p = addPage(); y = 748; }
  p.drawLine({ start: { x: 40, y: y + 4 }, end: { x: 555, y: y + 4 }, thickness: 0.6, color: navy });
  y -= 8;
  p.drawText('Prepared by (Antrade Servitech SL):', { x: 40, y, size: 8, font: bold, color: navy });
  p.drawText('Reviewed by (Transfluid):',          { x: 320, y, size: 8, font: bold, color: navy });
  y -= 18;
  p.drawLine({ start: { x: 40, y }, end: { x: 270, y }, thickness: 0.6, color: rgb(0.4, 0.4, 0.4) });
  p.drawLine({ start: { x: 320, y }, end: { x: 555, y }, thickness: 0.6, color: rgb(0.4, 0.4, 0.4) });
  y -= 10;
  p.drawText('Name / Signature / Date', { x: 40, y, size: 7, font: italic, color: rgb(0.5, 0.5, 0.5) });
  p.drawText('Name / Signature / Date', { x: 320, y, size: 7, font: italic, color: rgb(0.5, 0.5, 0.5) });

  return pdfDoc.save();
}

module.exports = { generateTF7430Excel, generateTF7430Pdf };
