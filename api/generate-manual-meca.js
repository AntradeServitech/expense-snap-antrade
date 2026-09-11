/**
 * generate-manual-meca.js
 * Genera el Manual de Montaje MECANICO de una SOC.
 * Busca adjuntos MANUAL_MECA_% en el producto representante de cada familia.
 *
 * Familias soportadas: 800A, 802, 803B, 805 (SailMaster)
 * Los adjuntos MANUAL_MECA_* se crean con step365b_elec_meca_all_families.py.
 *
 * Payload (POST): { order_id, secret }  o  Odoo webhook: { id, secret }
 * Auth: ?secret=<FICHA_SECRET> en query o en body.
 */

'use strict';

const createManualHandler = require('./_lib/generate-manual-shared');

// NOTA: el id de FAMILY_REPS['805'] lo reporta step365a al ejecutarse.
// Sustituir REPLACE_WITH_805_ID por el valor que salga en:
//   "PASO 3: id minimo: XXXX  ->  FAMILY_REPS['805'] = XXXX"
const FAMILY_REPS = {
  '800A': 56,
  '802': 115,
  '803B': 116,
  '805': 47,
};

const LABELS = {
  es: {
    title:    'MANUAL MECANICO',
    client:   'Cliente',
    order:    'Pedido',
    date:     'Fecha',
    products: 'Productos incluidos:',
    footer:   'Antrade Servitech SL — Manual Mecanico generado automaticamente',
  },
  en: {
    title:    'MECHANICAL MANUAL',
    client:   'Client',
    order:    'Order',
    date:     'Date',
    products: 'Products included:',
    footer:   'Antrade Servitech SL — Mechanical Manual automatically generated',
  },
};

module.exports = createManualHandler({
  FAMILY_REPS,
  ATTACHMENT_PATTERN: 'MANUAL_MECA_%',
  OUTPUT_PREFIX: 'Manual_Mecanico_',
  LABELS,
  LOG_TAG: '[generate-manual-meca]',
});
