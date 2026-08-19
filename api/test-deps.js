'use strict';
// Endpoint temporal de diagnóstico — confirma que nodemailer está instalado en Vercel
// BORRAR tras confirmar que el build funciona
module.exports = (req, res) => {
  try {
    const nm = require('nodemailer');
    const pdfLib = require('pdf-lib');
    const xmlrpc = require('xmlrpc');
    res.status(200).json({
      ok: true,
      nodemailer: typeof nm.createTransport === 'function' ? 'OK' : 'BAD',
      pdfLib: typeof pdfLib.PDFDocument === 'function' ? 'OK' : 'BAD',
      xmlrpc: typeof xmlrpc.createClient === 'function' ? 'OK' : 'BAD',
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};
