/**
 * POST /api/data-sheet/send
 * Called by Odoo webhook (state='webhook') when user clicks "Enviar al cliente"
 * on a x_transfluid_data_sheet record.
 *
 * Payload from Odoo: { id: <sheet_id>, ... }
 * Secret: ?secret=<DATA_SHEET_SECRET>
 *
 * Actions:
 *   1. Validate secret
 *   2. Read sheet -> project -> lead -> partner email
 *   3. Generate HMAC token (7-day TTL, single-use)
 *   4. Store token hash + expiry + sent_to in Odoo
 *   5. Send email to client via Odoo mail.mail
 *   6. Return { ok: true }
 */

'use strict';

const crypto = require('crypto');
const { execute, searchRead } = require('../_lib/odoo.js');

const SHEET_MODEL = 'x_transfluid_data_sheet';
const BASE_URL = 'https://antrade-expensesnap.vercel.app';
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
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

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
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const sheetId = Number(body.id);
  if (!sheetId) {
    return res.status(400).json({ error: 'Missing id in webhook payload' });
  }

  try {
    // 1. Read the data sheet
    const sheets = await searchRead(SHEET_MODEL, [['id', '=', sheetId]],
      ['x_project_id', 'x_portal_submitted', 'x_state']);
    if (!sheets.length) {
      return res.status(404).json({ error: 'Data sheet not found', id: sheetId });
    }
    const sheet = sheets[0];

    if (sheet.x_portal_submitted) {
      return res.status(409).json({ error: 'Client already submitted this form' });
    }

    // 2. Read project
    const projectField = sheet.x_project_id;
    const projectId = Array.isArray(projectField) ? projectField[0] : projectField;
    if (!projectId) {
      return res.status(400).json({ error: 'Data sheet has no project assigned' });
    }

    const projects = await searchRead('project.project', [['id', '=', projectId]],
      ['name', 'x_lead_id', 'x_serial_antrade']);
    if (!projects.length) {
      return res.status(404).json({ error: 'Project not found', projectId });
    }
    const project = projects[0];
    const serialRef = project.x_serial_antrade || project.name || `Proyecto ${projectId}`;

    // 3. Read lead -> partner email
    let partnerEmail = null;
    let partnerName = null;

    if (project.x_lead_id) {
      const leadId = Array.isArray(project.x_lead_id) ? project.x_lead_id[0] : project.x_lead_id;
      const leads = await searchRead('crm.lead', [['id', '=', leadId]], ['partner_id']);
      if (leads.length && leads[0].partner_id) {
        const pId = Array.isArray(leads[0].partner_id) ? leads[0].partner_id[0] : leads[0].partner_id;
        const partners = await searchRead('res.partner', [['id', '=', pId]], ['email', 'name']);
        if (partners.length) {
          partnerEmail = partners[0].email || null;
          partnerName = partners[0].name || null;
        }
      }
    }

    if (!partnerEmail) {
      return res.status(400).json({
        error: 'No client email found. Check that the lead has a partner_id with email.',
        projectId,
      });
    }

    // 4. Generate token
    const { token, sig, exp } = generateToken(sheetId, DS_SECRET);
    const portalUrl = `${BASE_URL}/api/data-sheet/${token}`;
    const expiresAt = odooDatetime(exp);

    // 5. Store in Odoo
    await execute(SHEET_MODEL, 'write', [[sheetId], {
      x_portal_token_hash: sig,
      x_portal_expires_at: expiresAt,
      x_portal_sent_to: partnerEmail,
      x_portal_submitted: false,
      x_state: 'in_progress',
    }]);

    // 6. Send email via Odoo mail.mail
    const expiresHuman = new Date(exp * 1000).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'long', year: 'numeric',
    });
    const salutation = partnerName ? `Estimado/a ${partnerName},` : 'Estimado cliente,';

    const emailHtml = `<p>${salutation}</p>
<p>Antrade Servitech SL le solicita que complete los datos tecnicos del proyecto
<strong>${serialRef}</strong> para la instalacion del sistema Transfluid.</p>
<p>Por favor, acceda al siguiente enlace para rellenar el formulario de datos:</p>
<p style="margin:20px 0">
  <a href="${portalUrl}" style="background:#1a56a8;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold">
    Completar datos tecnicos
  </a>
</p>
<p>O copie esta URL en su navegador:<br>
<small style="color:#555">${portalUrl}</small></p>
<p>Este enlace es personal y de un solo uso. Expira el <strong>${expiresHuman}</strong>.</p>
<p>Si tiene alguna duda, contacte con su interlocutor en Antrade Servitech.</p>
<p>Saludos,<br>
<strong>Antrade Servitech SL</strong></p>`;

    try {
      const mailId = await execute('mail.mail', 'create', [{
        subject: `Datos Tecnicos Transfluid — Proyecto ${serialRef}`,
        body_html: emailHtml,
        email_to: partnerEmail,
        auto_delete: true,
      }]);
      await execute('mail.mail', 'send', [[mailId]]);
    } catch (mailErr) {
      // Log but don't fail — token was already stored
      console.error('[send.js] mail.mail.send error:', mailErr.message);
    }

    return res.status(200).json({
      ok: true,
      sent_to: partnerEmail,
      expires_at: expiresAt,
      project: serialRef,
    });

  } catch (err) {
    console.error('[send.js] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
