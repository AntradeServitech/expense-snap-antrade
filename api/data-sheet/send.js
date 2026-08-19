/**
 * POST /api/data-sheet/send
 * Paso 2: lee el link ya generado (prepare.js paso 1) y envia el email al cliente.
 * El operador puede modificar x_portal_sent_to en Odoo antes de ejecutar este paso.
 * Envia BCC a SMTP_USER para que quede copia en el buzón del remitente.
 */

'use strict';

const crypto = require('crypto');
const { execute, searchRead } = require('../_lib/odoo.js');
const { sendMail } = require('../_lib/mailer.js');

const SHEET_MODEL = 'x_transfluid_data_sheet';

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
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
      ['x_project_id', 'x_portal_submitted', 'x_portal_token_hash',
       'x_portal_url', 'x_portal_sent_to', 'x_portal_expires_at']);
    if (!sheets.length) return res.status(404).json({ error: 'Data sheet not found', id: sheetId });
    const sheet = sheets[0];

    if (sheet.x_portal_submitted) {
      return res.status(409).json({ error: 'Client already submitted this form' });
    }
    if (!sheet.x_portal_token_hash || !sheet.x_portal_url) {
      return res.status(400).json({
        error: 'Link no generado. Ejecuta primero "Generar link de datos" en el menu de Acciones.',
      });
    }

    const recipientEmail = sheet.x_portal_sent_to;
    if (!recipientEmail) {
      return res.status(400).json({ error: 'Sin destinatario. Rellena el campo "Link enviado a" en la ficha.' });
    }

    // Project name for subject/body
    let serialRef = 'Proyecto';
    let partnerName = null;
    const pf = sheet.x_project_id;
    const pId = Array.isArray(pf) ? pf[0] : pf;
    if (pId) {
      const projs = await searchRead('project.project', [['id', '=', pId]], ['name', 'x_serial_antrade', 'x_lead_id']);
      if (projs.length) {
        serialRef = projs[0].x_serial_antrade || projs[0].name;
        if (projs[0].x_lead_id) {
          const leadId = Array.isArray(projs[0].x_lead_id) ? projs[0].x_lead_id[0] : projs[0].x_lead_id;
          const leads = await searchRead('crm.lead', [['id', '=', leadId]], ['partner_id']);
          if (leads.length && leads[0].partner_id) {
            const partnerId = Array.isArray(leads[0].partner_id) ? leads[0].partner_id[0] : leads[0].partner_id;
            const partners = await searchRead('res.partner', [['id', '=', partnerId]], ['name']);
            if (partners.length) partnerName = partners[0].name || null;
          }
        }
      }
    }

    const portalUrl = sheet.x_portal_url;
    const expiresAtRaw = sheet.x_portal_expires_at;
    let expiresHuman = '';
    if (expiresAtRaw) {
      const d = new Date(expiresAtRaw.replace(' ', 'T') + 'Z');
      expiresHuman = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' });
    }

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
${expiresHuman ? `<p>Este enlace es personal y de un solo uso. Expira el <strong>${expiresHuman}</strong>.</p>` : ''}
<p>Si tiene alguna duda, contacte con su interlocutor en Antrade Servitech.</p>
<p>Saludos,<br>
<strong>Antrade Servitech SL</strong></p>`;

    // BCC al remitente para que quede copia en el buzón
    const senderCopy = process.env.SMTP_USER;

    try {
      await sendMail({
        to: recipientEmail,
        bcc: senderCopy,
        subject: `Datos Tecnicos Transfluid - Proyecto ${serialRef}`,
        html: emailHtml,
      });
      console.log(`[send.js] Email enviado a ${recipientEmail} (BCC: ${senderCopy}) para ficha ${sheetId}`);
    } catch (mailErr) {
      console.error('[send.js] SMTP error:', mailErr.message);
      // No falla el endpoint: el token ya existe, el operador puede reintentar
      return res.status(500).json({ error: `SMTP error: ${mailErr.message}` });
    }

    return res.status(200).json({
      ok: true,
      sent_to: recipientEmail,
      bcc: senderCopy,
      project: serialRef,
    });

  } catch (err) {
    console.error('[send.js] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
