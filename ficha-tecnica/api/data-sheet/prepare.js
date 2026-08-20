/**
 * POST /api/data-sheet/prepare
 * Paso 1: genera el token HMAC, lo guarda en Odoo con la URL del portal
 * y el destinatario sugerido. NO envia email.
 * El operador verifica la URL y el destinatario en el formulario de Odoo
 * y luego pulsa "Enviar al cliente" (send.js paso 2) o comparte el link manualmente.
 */

'use strict';

const crypto = require('crypto');
const { execute, searchRead } = require('../_lib/odoo.js');

const SHEET_MODEL = 'x_transfluid_data_sheet';
// PORTAL_BASE_URL debe configurarse en Vercel como variable de entorno
// Ejemplo: https://antrade-ficha-tecnica.vercel.app
const BASE_URL = (process.env.PORTAL_BASE_URL || 'https://antrade-ficha-tecnica.vercel.app').replace(/\/$/, '');
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function generateToken(sheetId, secret) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ id: sheetId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { token: `${payload}.${sig}`, sig, exp };
}

function odooDatetime(unixSec) {
  return new Date(unixSec * 1000).toISOString().replace('T', ' ').substring(0, 19);
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const DS_SECRET = process.env.DATA_SHEET_SECRET;
  if (!DS_SECRET) {
    console.error('DATA_SHEET_SECRET not configured');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const { secret } = req.query;
  if (!secret || !timingSafeEqual(secret, DS_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};

  const sheetId = Number(body.id);
  if (!sheetId) return res.status(400).json({ error: 'Missing id in webhook payload' });

  try {
    const sheets = await searchRead(SHEET_MODEL, [['id', '=', sheetId]],
      ['x_project_id', 'x_portal_submitted', 'x_state', 'x_portal_token_hash', 'x_client_email']);
    if (!sheets.length) return res.status(404).json({ error: 'Data sheet not found', id: sheetId });
    const sheet = sheets[0];

    if (sheet.x_portal_submitted) {
      return res.status(409).json({ error: 'Client already submitted this form' });
    }

    // Read project → lead → partner email
    const projectField = sheet.x_project_id;
    const projectId = Array.isArray(projectField) ? projectField[0] : projectField;
    if (!projectId) return res.status(400).json({ error: 'Data sheet has no project assigned' });

    const projects = await searchRead('project.project', [['id', '=', projectId]],
      ['name', 'x_lead_id', 'x_serial_antrade']);
    if (!projects.length) return res.status(404).json({ error: 'Project not found' });
    const project = projects[0];
    const serialRef = project.x_serial_antrade || project.name || `Proyecto ${projectId}`;

    let partnerEmail = null;
    if (project.x_lead_id) {
      const leadId = Array.isArray(project.x_lead_id) ? project.x_lead_id[0] : project.x_lead_id;
      const leads = await searchRead('crm.lead', [['id', '=', leadId]], ['partner_id']);
      if (leads.length && leads[0].partner_id) {
        const pId = Array.isArray(leads[0].partner_id) ? leads[0].partner_id[0] : leads[0].partner_id;
        const partners = await searchRead('res.partner', [['id', '=', pId]], ['email', 'name']);
        if (partners.length) partnerEmail = partners[0].email || null;
      }
    }

    // Generate token
    const { token, sig, exp } = generateToken(sheetId, DS_SECRET);
    const portalUrl = `${BASE_URL}/api/data-sheet/${token}`;
    const expiresAt = odooDatetime(exp);

    // Si x_client_email ya esta rellenado, respetar el valor que edito Jesus;
    // si esta vacio, pre-rellenarlo con el email del partner del lead.
    const writeVals = {
      x_portal_token_hash: sig,
      x_portal_expires_at: expiresAt,
      x_portal_sent_to: partnerEmail || '',
      x_portal_url: portalUrl,
      x_portal_submitted: false,
      x_state: 'in_progress',
    };
    if (!sheet.x_client_email && partnerEmail) {
      writeVals.x_client_email = partnerEmail;
    }
    // Write token + URL to Odoo (no email sent here)
    await execute(SHEET_MODEL, 'write', [[sheetId], writeVals]);

    console.log(`[prepare.js] Link generado para ficha ${sheetId} (${serialRef}): ${portalUrl}`);

    return res.status(200).json({
      ok: true,
      portal_url: portalUrl,
      sent_to: partnerEmail,
      expires_at: expiresAt,
      project: serialRef,
      message: 'Link generado. Copia el link desde la ficha en Odoo o pulsa "Enviar al cliente" para enviarlo por email.',
    });

  } catch (err) {
    console.error('[prepare.js] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
