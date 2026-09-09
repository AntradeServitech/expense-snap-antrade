'use strict';
// prepare.js — Genera token HMAC + crea/actualiza ficha de dimensionamiento + envía email al cliente
// Envía a: email del partner del lead (CRM) + contactos de roles del proyecto (x_antrade_project_role)
// Auth: ?secret=<SCOPING_SECRET>

const crypto = require('crypto');
const { execute, searchRead, create } = require('../_lib/odoo');

const SHEET_MODEL = 'x_project_scoping_sheet';
const TOKEN_TTL_SECONDS = 7 * 24 * 3600; // 7 días

function generateToken(sheetId, secret) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ id: sheetId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { token: `${payload}.${sig}`, exp };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secret = process.env.SCOPING_SECRET;
  const portalBase = (process.env.PORTAL_BASE_URL || '').replace(/^﻿/, '').trim();

  if (!secret) {
    console.error('prepare.js: SCOPING_SECRET no configurado');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // Auth timing-safe
  const provided = String(req.query.secret || (req.body && req.body.secret) || '');
  let ok = false;
  try {
    ok = provided.length === secret.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch (_) { ok = false; }
  if (!ok) return res.status(401).json({ error: 'Unauthorized' });

  let leadId = null;
  try {
    // Odoo webhook payload: {id: lead_id, name: ..., partner_id: [id, name]}
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    body = body || {};

    leadId = body.id ? Number(body.id) : null;
    if (!leadId) return res.status(400).json({ error: 'Missing lead id' });

    // Lee el lead (incluye x_scoping_wizard_emails para respetar el override del wizard)
    const leads = await searchRead('crm.lead', [['id', '=', leadId]], [
      'id', 'name', 'x_serial_antrade', 'partner_id', 'x_scoping_wizard_emails',
    ]);
    if (!leads.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = leads[0];

    const partnerId = Array.isArray(lead.partner_id) ? lead.partner_id[0] : null;
    const partnerName = Array.isArray(lead.partner_id) ? lead.partner_id[1] : '';

    // Obtiene email del partner (CRM)
    let partnerEmail = '';
    if (partnerId) {
      const partners = await searchRead('res.partner', [['id', '=', partnerId]], ['email']);
      if (partners.length && partners[0].email) partnerEmail = partners[0].email;
    }

    const projectName = lead.x_serial_antrade || lead.name || 'Proyecto';

    // Busca ficha existente para este lead
    const sheets = await searchRead(SHEET_MODEL, [['x_lead_id', '=', leadId]], [
      'id', 'x_portal_submitted', 'x_project_name', 'x_client_email',
    ]);
    let sheetId;
    let primaryEmail;

    if (sheets.length && !sheets[0].x_portal_submitted) {
      // Reutiliza ficha existente si no fue enviada aún
      sheetId = sheets[0].id;
      primaryEmail = sheets[0].x_client_email || partnerEmail;
    } else {
      // Crea nueva ficha — x_state es required, resto opcionales
      const raw = await create(SHEET_MODEL, {
        x_name: projectName,
        x_lead_id: leadId,
        x_state: 'draft',
        x_portal_submitted: false,
      });
      sheetId = Array.isArray(raw) ? raw[0] : raw;
      primaryEmail = partnerEmail;
    }

    // Destinatarios: override del wizard si está poblado, fallback a partner+roles
    let recipients;
    const wizardEmailsRaw = (lead.x_scoping_wizard_emails || '').trim();
    if (wizardEmailsRaw) {
      recipients = [...new Set(
        wizardEmailsRaw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
      )];
      console.log(`prepare.js: usando destinatarios del wizard lead=${leadId}: [${recipients.join(', ')}]`);
    } else {
      // Fallback: partner principal + contactos de roles del proyecto
      let extraEmails = [];
      try {
        const roles = await searchRead(
          'x_antrade_project_role',
          [['x_lead_id', '=', leadId]],
          ['x_contact_ids'],
        );
        const contactIds = [
          ...new Set(roles.flatMap(r => Array.isArray(r.x_contact_ids) ? r.x_contact_ids : [])),
        ];
        if (contactIds.length) {
          const contacts = await searchRead('res.partner', [['id', 'in', contactIds]], ['email']);
          extraEmails = contacts
            .filter(c => c.email)
            .map(c => c.email.trim().toLowerCase());
        }
      } catch (e) {
        console.error('prepare.js: error fetching role contacts:', e.message);
      }
      const primaryNorm = (primaryEmail || '').trim().toLowerCase();
      recipients = [
        ...new Set([
          ...(primaryNorm ? [primaryNorm] : []),
          ...extraEmails.filter(e => e && e !== primaryNorm),
        ]),
      ].filter(Boolean);
    }

    // Genera token HMAC
    const { token, exp } = generateToken(sheetId, secret);
    const tokenHash = crypto.createHmac('sha256', secret).update(token).digest('hex');
    const portalUrl = `${portalBase}/api/scoping/${token}`;
    const expiresAt = new Date(exp * 1000).toISOString().replace('T', ' ').slice(0, 19);

    // Actualiza la ficha con el token — campos confirmados
    await execute(SHEET_MODEL, 'write', [[sheetId], {
      x_portal_token_hash: tokenHash,
      x_portal_url: portalUrl,
      x_portal_submitted: false,
      ...(primaryEmail && { x_client_email: primaryEmail }),
    }]);

    // Campos opcionales (pueden no existir en el modelo Odoo)
    try {
      await execute(SHEET_MODEL, 'write', [[sheetId], {
        x_portal_expires_at: expiresAt,
        x_portal_sent_to: recipients.join(', '),
        x_state: 'in_progress',
      }]);
    } catch (e) {
      console.warn('prepare.js: campos opcionales no disponibles en el modelo:', e.message);
    }

    console.log(`prepare.js: token generado lead=${leadId} sheet=${sheetId} recipients=[${recipients.join(', ')}] exp=${expiresAt}`);

    // Envía email de invitación a cada destinatario
    const sentList = [];
    for (const email of recipients) {
      const emailBody = `
<p>Estimado/a ${escHtml(partnerName)},</p>
<p>Le invitamos a completar el formulario de dimensionamiento inicial para el proyecto <strong>${escHtml(projectName)}</strong>.</p>
<p>Por favor, acceda al siguiente enlace para cumplimentar los datos técnicos del buque y del sistema de propulsión:</p>
<p style="margin:24px 0;text-align:center">
  <a href="${escHtml(portalUrl)}" style="display:inline-block;padding:14px 28px;background:#0d1b2a;color:#c9a84c;text-decoration:none;border-radius:4px;font-weight:bold;font-family:sans-serif">
    Acceder al formulario
  </a>
</p>
<p>Este enlace es válido durante 7 días y puede ser completado <strong>una sola vez</strong>.</p>
<p>Si tiene cualquier pregunta, no dude en contactarnos.</p>
<p>Atentamente,<br/>Antrade Servitech SL</p>`;
      try {
        const mailId = await execute('mail.mail', 'create', [{
          subject: `[Antrade] Formulario de dimensionamiento — ${projectName}`,
          body_html: emailBody,
          email_to: email,
          auto_delete: false,
        }]);
        try {
          await execute('mail.mail', 'send', [[mailId]]);
        } catch (sendErr) {
          // Odoo SaaS: send() devuelve None → xmlrpc no puede serializarlo.
          // El envío sí ocurrió; solo falla la serialización de la respuesta.
          if (!sendErr.message || !sendErr.message.includes('cannot marshal None')) throw sendErr;
        }
        try {
          const mailRecs = await execute('mail.mail', 'read', [[mailId]], { fields: ['state'] });
          if (mailRecs.length && mailRecs[0].state === 'sent') {
            await execute('mail.mail', 'unlink', [[mailId]]);
          }
        } catch (_) {}
        sentList.push(email);
        console.log(`prepare.js: email enviado a ${email} sheet=${sheetId}`);
        if (leadId) {
          try {
            const ts = new Date().toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            await execute('crm.lead', 'message_post', [[leadId], {
              body: `<p>Invitacion de dimensionamiento enviada a ${email} (${ts}).<br/>Proyecto: ${escHtml(projectName)}</p>`,
              message_type: 'comment',
              subtype_xmlid: 'mail.mt_note',
            }]);
          } catch (chatErr) {
            console.error(`prepare.js: error en message_post para ${email}:`, chatErr.message);
          }
        }
      } catch (mailErr) {
        console.error(`prepare.js: error enviando a ${email}:`, mailErr.message);
      }
    }

    // Escribe el resultado REAL del envío en crm.lead (sobreescribe el valor optimista de id=1214)
    const tsNow = new Date();
    const nowStr = [
      String(tsNow.getDate()).padStart(2, '0'),
      String(tsNow.getMonth() + 1).padStart(2, '0'),
      tsNow.getFullYear(),
    ].join('/') + ' ' + [
      String(tsNow.getHours()).padStart(2, '0'),
      String(tsNow.getMinutes()).padStart(2, '0'),
    ].join(':');
    const statusFinal = sentList.length > 0
      ? `Enviado ${nowStr} a: ${sentList.join(', ')}`
      : `Error ${nowStr}: Ningun email pudo enviarse`;
    try {
      await execute('crm.lead', 'write', [[leadId], {
        x_last_scoping_status: statusFinal,
        x_scoping_wizard_emails: false,
      }]);
      console.log(`prepare.js: status lead=${leadId}: "${statusFinal}"`);
    } catch (writeErr) {
      console.error('prepare.js: error escribiendo status en lead:', writeErr.message);
    }

    return res.status(200).json({
      ok: true,
      portal_url: portalUrl,
      sent_to: sentList,
      expires_at: expiresAt,
      sheet_id: sheetId,
      project: projectName,
      message: sentList.length
        ? `Enlace generado y enviado a: ${sentList.join(', ')}`
        : 'Enlace generado (sin email de destinatario — compartir manualmente)',
    });

  } catch (err) {
    console.error('prepare.js error:', err);
    if (leadId) {
      try {
        const tsErr = new Date();
        const errStr = [
          String(tsErr.getDate()).padStart(2, '0'),
          String(tsErr.getMonth() + 1).padStart(2, '0'),
          tsErr.getFullYear(),
        ].join('/') + ' ' + [
          String(tsErr.getHours()).padStart(2, '0'),
          String(tsErr.getMinutes()).padStart(2, '0'),
        ].join(':');
        await execute('crm.lead', 'write', [[leadId], {
          x_last_scoping_status: `Error ${errStr}: ${(err.message || 'Error interno').slice(0, 120)}`,
        }]);
      } catch (_) {}
    }
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
