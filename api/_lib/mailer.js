'use strict';

/**
 * Mailer helper — sends email via corporate SMTP using Nodemailer.
 *
 * Required env vars (set in Vercel):
 *   SMTP_HOST   e.g. smtp.office365.com  or  smtp.gmail.com
 *   SMTP_PORT   e.g. 587
 *   SMTP_USER   e.g. j.guzman@antradeservitech.com
 *   SMTP_PASS   App password / contrasenya de aplicacion
 *   SMTP_FROM   (optional) "Antrade Servitech <j.guzman@antradeservitech.com>"
 */

const nodemailer = require('nodemailer');

function createTransport() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP no configurado: faltan SMTP_HOST, SMTP_USER o SMTP_PASS');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

/**
 * sendMail({ to, subject, html, attachments? })
 * attachments: [{ filename, content (Buffer), contentType }]
 */
async function sendMail({ to, bcc, subject, html, attachments }) {
  const transport = createTransport();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  const mailOpts = { from, to, subject, html, attachments: attachments || [] };
  if (bcc) mailOpts.bcc = bcc;

  const info = await transport.sendMail(mailOpts);

  return info;
}

module.exports = { sendMail };
