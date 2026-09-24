// Cliente XML-RPC reutilizable para la API de Odoo (Antrade Servitech SL)
const xmlrpc = require('xmlrpc');

function sanitize(s) {
  // Elimina BOM UTF-8 (﻿) y espacios laterales que pueden colarse al pegar en Vercel
  return (s || '').replace(/^﻿/, '').trim();
}

function getEnv() {
  const ODOO_URL     = sanitize(process.env.ODOO_URL);
  const ODOO_DB      = sanitize(process.env.ODOO_DB);
  const ODOO_USER    = sanitize(process.env.ODOO_USER);
  const ODOO_PASSWORD = sanitize(process.env.ODOO_PASSWORD);
  if (!ODOO_URL || !ODOO_DB || !ODOO_USER || !ODOO_PASSWORD) {
    throw new Error('Faltan variables de entorno ODOO_URL / ODOO_DB / ODOO_USER / ODOO_PASSWORD');
  }
  return { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD };
}

function buildClients(url) {
  const parsed = new URL(url);
  const isSecure = parsed.protocol === 'https:';
  const createFn = isSecure ? xmlrpc.createSecureClient : xmlrpc.createClient;
  const base = {
    host: parsed.hostname,
    port: Number(parsed.port) || (isSecure ? 443 : 80),
    path: (parsed.pathname || '').replace(/\/$/, ''),
  };
  return {
    common: createFn({ ...base, path: base.path + '/xmlrpc/2/common' }),
    models: createFn({ ...base, path: base.path + '/xmlrpc/2/object' }),
  };
}

function methodCall(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, value) => {
      if (err) return reject(err);
      resolve(value);
    });
  });
}

let cachedUid = null;

async function authenticate() {
  const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD } = getEnv();
  const { common } = buildClients(ODOO_URL);
  const uid = await methodCall(common, 'authenticate', [ODOO_DB, ODOO_USER, ODOO_PASSWORD, {}]);
  if (!uid) throw new Error('Autenticacion Odoo fallida: revisa credenciales');
  cachedUid = uid;
  return uid;
}

async function execute(model, method, args = [], kwargs = {}) {
  const { ODOO_URL, ODOO_DB, ODOO_PASSWORD } = getEnv();
  const { models } = buildClients(ODOO_URL);
  const uid = cachedUid || (await authenticate());
  try {
    return await methodCall(models, 'execute_kw', [ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs]);
  } catch (err) {
    if (cachedUid) {
      cachedUid = null;
      const freshUid = await authenticate();
      return methodCall(models, 'execute_kw', [ODOO_DB, freshUid, ODOO_PASSWORD, model, method, args, kwargs]);
    }
    throw err;
  }
}

function searchRead(model, domain = [], fields = [], opts = {}) {
  const kwargs = { fields };
  if (opts.limit) kwargs.limit = opts.limit;
  if (opts.order) kwargs.order = opts.order;
  return execute(model, 'search_read', [domain], kwargs);
}

function create(model, values) {
  return execute(model, 'create', [values]);
}

module.exports = { execute, searchRead, create, getEnv };
