'use strict';
const crypto = require('crypto');
const { searchRead, create } = require('../_lib/odoo');
const { generateTF7430Excel, generateTF7430Pdf } = require('./tf7430');

const SHEET_MODEL = 'x_project_scoping_sheet';

const FIELDS = [
  'id', 'x_propulsion_type',
  'x_project_name', 'x_vessel_name', 'x_installation_country',
  'x_has_classification', 'x_class_society_type', 'x_class_society_name', 'x_class_cert_otros',
  'x_gearbox_manufacturer', 'x_gearbox_model', 'x_gearbox_ratio', 'x_gearbox_output',
  'x_prop_rotation', 'x_diesel_battery_voltage',
];

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.SCOPING_SECRET;
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const provided = String(body.secret || req.query.secret || '');
  let ok = false;
  try {
    ok = provided.length === secret.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch (_) { ok = false; }
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });

  const leadId = body.id ? Number(body.id) : null;
  if (!leadId) return res.status(400).json({ error: 'Missing lead id' });

  const allSheets = await searchRead(SHEET_MODEL, [['x_lead_id', '=', leadId]], FIELDS);
  if (!allSheets.length) return res.status(404).json({ error: 'Scoping sheet not found' });
  const sheets = allSheets.filter(s => s.x_propulsion_type === 'parallel');
  if (!sheets.length) {
    return res.status(400).json({ error: 'Not a parallel hybrid project', x_propulsion_type: allSheets[0]?.x_propulsion_type });
  }
  const sheet = sheets[0];

  const leads = await searchRead('crm.lead', [['id', '=', leadId]], ['x_serial_antrade', 'name']);
  const lead = leads[0] || {};
  const serial = lead.x_serial_antrade || lead.name || String(leadId);

  const excelBuffer = await generateTF7430Excel(sheet);
  const pdfBuffer  = await generateTF7430Pdf(sheet);

  const excelFilename = `TF7430_${serial}.xlsx`;
  const pdfFilename   = `TF7430_${serial}_EN.pdf`;

  const excelBase64 = excelBuffer.toString('base64');
  const pdfBase64   = pdfBuffer.toString('base64');

  const excelResult = await create('ir.attachment', {
    name:      excelFilename,
    res_model: 'crm.lead',
    res_id:    leadId,
    type:      'binary',
    raw:       excelBase64,
    mimetype:  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const excelId = Array.isArray(excelResult) ? excelResult[0] : excelResult;

  const pdfResult = await create('ir.attachment', {
    name:      pdfFilename,
    res_model: 'crm.lead',
    res_id:    leadId,
    type:      'binary',
    raw:       pdfBase64,
    mimetype:  'application/pdf',
  });
  const pdfId = Array.isArray(pdfResult) ? pdfResult[0] : pdfResult;

  return res.status(200).json({ ok: true, excel_id: excelId, pdf_id: pdfId });
};
