// Cliente XML-RPC reutilizable para la API de Odoo (Antrade Servitech SL)
// Equivalente Node.js de /AntradeERP/odoo_client.py
const xmlrpc = require('xmlrpc');

function getEnv() {
  const { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD } = process.env;
  if (!ODOO_URL || !ODOO_DB || !ODOO_USER || !ODOO_PASSWORD) {
    throw new Error('Faltan variables de entorno ODOO_URL / ODOO_DB / ODOO_USER / ODOO_PASSWORD');
  }
  return { ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD };
}

function buildClients(url) {
  const isSecure = url.startsWith('https');
  const proxyFactory = isSecure ? xmlrpc.createSecureClient : xmlrpc.createClient;
  return {
    common: proxyFactory(`${url}/xmlrpc/2/common`),
    models: proxyFactory(`${url}/xmlrpc/2/object`),
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
  if (!uid) {
    throw new Error('Autenticación Odoo fallida: revisa ODOO_USER/ODOO_PASSWORD/ODOO_DB');
  }
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
    // Reintenta una vez si el uid cacheado quedó inválido
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
