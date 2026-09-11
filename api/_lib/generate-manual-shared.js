/**
 * _lib/generate-manual-shared.js
 * Logica compartida para generate-manual-elec.js y generate-manual-meca.js.
 *
 * Exporta createManualHandler(cfg) donde cfg tiene:
 *   cfg.FAMILY_REPS   — { '800A': 56, '802': 115, '803B': 116, '805': <id> }
 *   cfg.ATTACHMENT_PATTERN  — e.g. 'MANUAL_ELEC_%' o 'MANUAL_MECA_%'
 *   cfg.OUTPUT_PREFIX  — e.g. 'Manual_Electrico_' o 'Manual_Mecanico_'
 *   cfg.LABELS         — { es: { title, client, order, date, products, footer }, en: {...} }
 *   cfg.LOG_TAG        — e.g. '[generate-manual-elec]'
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const odoo = require('./odoo');

const A4_W  = 595;
const A4_H  = 842;
const MARGIN = 50;

const BLUE    = rgb(0,    0.231, 0.431);
const BLUE_LT = rgb(0.88, 0.93,  0.97);
const GRAY    = rgb(0.45, 0.45,  0.45);
const GRAY_LT = rgb(0.85, 0.85,  0.85);
const BLACK   = rgb(0,    0,     0);
const WHITE   = rgb(1,    1,     1);

module.exports = function createManualHandler(cfg) {
  const { FAMILY_REPS, ATTACHMENT_PATTERN, OUTPUT_PREFIX, LABELS, LOG_TAG } = cfg;

  // Validar que ningun representante de familia sea null (ocurre si se
  // despliega antes de ejecutar step365a para la familia 805).
  for (const [fam, repId] of Object.entries(FAMILY_REPS)) {
    if (!repId) throw new Error(`${LOG_TAG} FAMILY_REPS['${fam}'] es null — ejecutar step365a primero.`);
  }

  // -------------------------------------------------------------------------
  // Handler principal
  // -------------------------------------------------------------------------
  return async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    const body     = req.body || {};
    const order_id = body.order_id || body.id;
    const secret   = body.secret || (req.query && req.query.secret);

    if (!process.env.FICHA_SECRET || secret !== process.env.FICHA_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!order_id) return res.status(400).json({ error: 'order_id or id is required' });

    try {
      const situation = await locateManuals(order_id, FAMILY_REPS, ATTACHMENT_PATTERN, LABELS, LOG_TAG);

      if (!situation.tmplIdsWithManual.length) {
        return res.status(200).json({
          success: false,
          sin_manual: situation.sinManual,
          message: 'No hay manuales disponibles',
        });
      }

      // Fast path: todos los productos son de una sola familia -> copia server-side
      if (situation.familyResIds.size === 1) {
        const attName = await fastPathCopy(order_id, situation, OUTPUT_PREFIX, LOG_TAG);
        return res.status(200).json({
          success: true, fast_path: true,
          attachment: attName, sin_manual: situation.sinManual,
        });
      }

      const pdfBytes = await buildManualPdf(situation, OUTPUT_PREFIX, LOG_TAG);
      const attName  = await uploadToOdoo(order_id, pdfBytes, situation.opportunityId, OUTPUT_PREFIX, LOG_TAG);

      return res.status(200).json({
        success: true, fast_path: false,
        attachment: attName, sin_manual: situation.sinManual,
      });
    } catch (err) {
      console.error(`${LOG_TAG} ERROR:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  };
};

// ---------------------------------------------------------------------------
// locateManuals
// ---------------------------------------------------------------------------
async function locateManuals(orderId, FAMILY_REPS, ATTACHMENT_PATTERN, LABELS, LOG_TAG) {
  const orders = await odoo.searchRead(
    'sale.order',
    [['id', '=', orderId]],
    ['id', 'name', 'date_order', 'partner_id', 'opportunity_id'],
  );
  if (!orders.length) throw new Error(`sale.order id=${orderId} no encontrado`);
  const order = orders[0];
  const opportunityId = Array.isArray(order.opportunity_id) ? order.opportunity_id[0] : null;
  const orderName = order.name;

  const partners = await odoo.searchRead(
    'res.partner', [['id', '=', order.partner_id[0]]], ['name', 'lang'], { limit: 1 },
  );
  const lang = (partners[0] && partners[0].lang && partners[0].lang.startsWith('es')) ? 'es' : 'en';
  const L = LABELS[lang];

  const lines = await odoo.searchRead(
    'sale.order.line',
    [['order_id', '=', orderId], ['product_id', '!=', false]],
    ['product_id', 'product_uom_qty'],
  );
  const prodIds = [...new Set(lines.map(l => l.product_id[0]))];
  if (!prodIds.length) throw new Error('La orden no tiene lineas de producto.');

  const prods = await odoo.searchRead(
    'product.product', [['id', 'in', prodIds]], ['id', 'product_tmpl_id'],
  );
  const tmplIds = [...new Set(prods.map(p => p.product_tmpl_id[0]))];

  const tmpls = await odoo.searchRead(
    'product.template', [['id', 'in', tmplIds]], ['id', 'name', 'default_code', 'x_familia'],
  );
  const tmplById = Object.fromEntries(tmpls.map(t => [t.id, t]));

  const tmplsByFamilia = {};
  const sinManual = [];
  for (const tid of tmplIds) {
    const tmpl = tmplById[tid];
    const familia = tmpl && tmpl.x_familia;
    if (familia && FAMILY_REPS[familia]) {
      if (!tmplsByFamilia[familia]) tmplsByFamilia[familia] = [];
      tmplsByFamilia[familia].push(tid);
    } else {
      sinManual.push(tmpl ? (tmpl.default_code || tmpl.name) : `id_${tid}`);
    }
  }

  const uniqueFamilias = Object.keys(tmplsByFamilia);
  const manualsByTmpl  = {};
  const usedAttsById   = {};
  const familyResIds   = new Set();

  if (uniqueFamilias.length) {
    const repIds = uniqueFamilias.map(f => FAMILY_REPS[f]);
    const repManuals = await odoo.searchRead(
      'ir.attachment',
      [
        ['res_model', '=', 'product.template'],
        ['res_id', 'in', repIds],
        ['name', 'like', ATTACHMENT_PATTERN],
        ['mimetype', '=', 'application/pdf'],
      ],
      ['id', 'name', 'res_id'],
    );

    const manualsByRepId = {};
    for (const att of repManuals) {
      if (!manualsByRepId[att.res_id]) manualsByRepId[att.res_id] = [];
      manualsByRepId[att.res_id].push(att);
    }

    for (const familia of uniqueFamilias) {
      const repId = FAMILY_REPS[familia];
      const atts  = manualsByRepId[repId] || [];
      if (atts.length) {
        familyResIds.add(repId);
        for (const att of atts) usedAttsById[att.id] = att;
        for (const tid of tmplsByFamilia[familia]) manualsByTmpl[tid] = atts;
      } else {
        for (const tid of tmplsByFamilia[familia]) {
          const tmpl = tmplById[tid];
          sinManual.push(tmpl ? (tmpl.default_code || tmpl.name) : `id_${tid}`);
        }
      }
    }
  }

  const tmplIdsWithManual = tmplIds.filter(tid => manualsByTmpl[tid] && manualsByTmpl[tid].length);
  const usedAtts = Object.values(usedAttsById);

  return {
    order, orderName, opportunityId, lang, L, partner: partners[0],
    tmplIds, tmplById, manualsByTmpl, tmplIdsWithManual, sinManual,
    usedAtts, familyResIds,
  };
}

// ---------------------------------------------------------------------------
// fastPathCopy — copia server-side cuando hay una sola familia en el pedido.
// ---------------------------------------------------------------------------
async function fastPathCopy(orderId, situation, OUTPUT_PREFIX, LOG_TAG) {
  const { order, opportunityId, usedAtts } = situation;
  const orderName = order.name;
  const sortedAtts = [...usedAtts].sort((a, b) => a.name.localeCompare(b.name));

  function getOutputName(att) {
    if (sortedAtts.length === 1) return `${OUTPUT_PREFIX}${orderName}.pdf`;
    if (att.name.includes('_part1of2')) return `${OUTPUT_PREFIX}${orderName}_part1of2.pdf`;
    if (att.name.includes('_part2of2')) return `${OUTPUT_PREFIX}${orderName}_part2of2.pdf`;
    const idx = sortedAtts.indexOf(att);
    return `${OUTPUT_PREFIX}${orderName}_part${idx + 1}of${sortedAtts.length}.pdf`;
  }

  // Limpiar adjuntos anteriores del sale.order
  const existingSO = await odoo.searchRead(
    'ir.attachment',
    [
      ['res_model', '=', 'sale.order'],
      ['res_id', '=', orderId],
      ['name', 'like', `${OUTPUT_PREFIX}${orderName}%`],
    ],
    ['id'],
  );
  if (existingSO.length) await odoo.execute('ir.attachment', 'unlink', [existingSO.map(a => a.id)]);

  const copiedSO = [];
  for (const att of sortedAtts) {
    const attName = getOutputName(att);
    const result  = await odoo.execute('ir.attachment', 'copy', [[att.id], {
      name: attName, res_model: 'sale.order', res_id: orderId,
    }]);
    const newId = Array.isArray(result) ? result[0] : result;
    copiedSO.push({ name: attName, attId: newId });
    console.log(`${LOG_TAG} fast path: adjunto id=${newId} ("${attName}") copiado al sale.order`);
  }

  // Copiar tambien al crm.lead vinculado
  if (opportunityId && opportunityId > 0) {
    try {
      const existingCRM = await odoo.searchRead(
        'ir.attachment',
        [
          ['res_model', '=', 'crm.lead'],
          ['res_id', '=', opportunityId],
          ['name', 'like', `${OUTPUT_PREFIX}${orderName}%`],
        ],
        ['id'],
      );
      if (existingCRM.length) await odoo.execute('ir.attachment', 'unlink', [existingCRM.map(a => a.id)]);
      for (const att of sortedAtts) {
        const attName = getOutputName(att);
        const result  = await odoo.execute('ir.attachment', 'copy', [[att.id], {
          name: attName, res_model: 'crm.lead', res_id: opportunityId,
        }]);
        console.log(`${LOG_TAG} fast path: adjunto copiado a crm.lead id=${opportunityId} ("${attName}")`);
      }
    } catch (crmErr) {
      console.warn(`${LOG_TAG} fast path: no se pudo copiar al crm.lead: ${crmErr.message}`);
    }
  }

  for (const part of copiedSO) await addToDocuments(opportunityId, part.attId, part.name, LOG_TAG);
  return copiedSO.length === 1 ? copiedSO[0].name : copiedSO.map(p => p.name).join(', ');
}

// ---------------------------------------------------------------------------
// buildManualPdf — slow path (multi-familia).
// ---------------------------------------------------------------------------
async function buildManualPdf(situation, OUTPUT_PREFIX, LOG_TAG) {
  const { order, partner, lang, L, tmplIds, tmplById, manualsByTmpl, tmplIdsWithManual, usedAtts } = situation;

  const allAttIds = [...new Set(usedAtts.map(a => a.id))];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const attDataById = {};
  for (let i = 0; i < allAttIds.length; i++) {
    const id = allAttIds[i];
    if (i > 0) await sleep(1500);
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const single = await odoo.searchRead('ir.attachment', [['id', '=', id]], ['id', 'name', 'raw']);
        if (single.length) attDataById[single[0].id] = single[0];
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        console.warn(`${LOG_TAG} Intento ${attempt}/3 de descarga del adjunto id=${id} fallido: ${e.message}`);
        if (attempt < 3) await sleep(2000);
      }
    }
    if (lastErr) console.warn(`${LOG_TAG} No se pudo descargar adjunto id=${id} tras 3 intentos: ${lastErr.message}`);
  }

  const pdfDoc   = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regFont  = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let logoImage = null;
  try {
    const logoBytes = fs.readFileSync(path.join(__dirname, '../../public/logo-antrade.png'));
    logoImage = await pdfDoc.embedPng(logoBytes);
  } catch (_) { /* sin logo */ }

  const dateStr = order.date_order
    ? new Date(order.date_order).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-GB')
    : '';

  addCoverPage(pdfDoc, boldFont, regFont, logoImage, order, partner, tmplIds, tmplById, dateStr, L);

  const embeddedIds = new Set();
  for (const tid of tmplIdsWithManual) {
    const attsForTid = [...manualsByTmpl[tid]].sort((a, b) => a.name.localeCompare(b.name));
    for (const att of attsForTid) {
      if (embeddedIds.has(att.id)) continue;
      embeddedIds.add(att.id);
      const full = attDataById[att.id];
      if (!full || !full.raw) continue;
      try {
        const src   = await PDFDocument.load(Buffer.from(full.raw, 'base64'), { ignoreEncryption: true });
        const pages = await pdfDoc.copyPages(src, src.getPageIndices());
        for (const p of pages) pdfDoc.addPage(p);
      } catch (e) {
        console.warn(`${LOG_TAG} No se pudo incrustar ${att.name}: ${e.message}`);
      }
    }
  }

  return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// addCoverPage
// ---------------------------------------------------------------------------
function addCoverPage(doc, bold, reg, logo, order, partner, tmplIds, tmplById, dateStr, L) {
  const page = doc.addPage([A4_W, A4_H]);
  page.drawRectangle({ x: 0, y: A4_H - 90, width: A4_W, height: 90, color: BLUE });

  if (logo) {
    const dims = logo.scaleToFit(160, 50);
    page.drawImage(logo, {
      x: MARGIN, y: A4_H - 90 + (90 - dims.height) / 2,
      width: dims.width, height: dims.height,
    });
  }

  page.drawText('Antrade Servitech SL', {
    x: A4_W - MARGIN - 160, y: A4_H - 55, size: 11, font: bold, color: WHITE,
  });
  page.drawText(L.title, { x: MARGIN, y: A4_H - 130, size: 22, font: bold, color: BLUE });
  page.drawLine({
    start: { x: MARGIN, y: A4_H - 140 }, end: { x: A4_W - MARGIN, y: A4_H - 140 },
    thickness: 1, color: BLUE_LT,
  });

  const infoY = A4_H - 170;
  [
    [L.client, partner ? partner.name : (order.partner_id[1] || '')],
    [L.order,  order.name],
    [L.date,   dateStr],
  ].forEach(([label, value], i) => {
    const y = infoY - i * 22;
    page.drawText(label + ':', { x: MARGIN, y, size: 11, font: bold, color: GRAY });
    page.drawText(String(value), { x: MARGIN + 110, y, size: 11, font: reg, color: BLACK });
  });

  const listY = infoY - 3 * 22 - 30;
  page.drawText(L.products, { x: MARGIN, y: listY, size: 11, font: bold, color: GRAY });

  let itemY = listY - 22;
  tmplIds.forEach((tid, idx) => {
    const t = tmplById[tid];
    if (!t) return;
    const code  = t.default_code ? ` (${t.default_code})` : '';
    const label = safeText(`${idx + 1}. ${t.name}${code}`);
    page.drawText(label, { x: MARGIN + 10, y: itemY, size: 10, font: reg, color: BLACK });
    itemY -= 18;
  });

  drawFooter(page, reg, L.footer, 1);
}

function drawFooter(page, font, text, pageNum) {
  page.drawLine({
    start: { x: MARGIN, y: 40 }, end: { x: A4_W - MARGIN, y: 40 },
    thickness: 0.5, color: GRAY_LT,
  });
  page.drawText(safeText(text), { x: MARGIN, y: 26, size: 8, font, color: GRAY });
  if (pageNum !== null) page.drawText(String(pageNum), { x: A4_W - MARGIN - 10, y: 26, size: 8, font, color: GRAY });
}

function safeText(str) { return (str || '').replace(/[^\x00-\xFF]/g, '?'); }

// ---------------------------------------------------------------------------
// uploadOneAttachment
// ---------------------------------------------------------------------------
async function uploadOneAttachment(name, pdfBytes, resModel, resId, maxAttempts, LOG_TAG) {
  const b64 = Buffer.from(pdfBytes).toString('base64');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await odoo.create('ir.attachment', {
        name, type: 'binary', raw: b64,
        res_model: resModel, res_id: resId, mimetype: 'application/pdf',
      });
    } catch (e) {
      console.warn(`${LOG_TAG} Intento ${attempt}/${maxAttempts} de subida de "${name}" fallido: ${e.message}`);
      if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// uploadPdfWithSplitFallback
// ---------------------------------------------------------------------------
async function uploadPdfWithSplitFallback(baseName, pdfBytes, resModel, resId, LOG_TAG) {
  const attId = await uploadOneAttachment(baseName, pdfBytes, resModel, resId, 3, LOG_TAG);
  if (attId !== null) return [{ name: baseName, attId }];

  const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  if (pageCount <= 1) {
    console.warn(`${LOG_TAG} No se pudo subir "${baseName}" (1 pagina, no se puede partir mas).`);
    return [];
  }

  console.warn(`${LOG_TAG} Subida de "${baseName}" fallo repetidamente. Partiendo en 2 mitades...`);
  const mid = Math.ceil(pageCount / 2);
  const nameRoot = baseName.endsWith('.pdf') ? baseName.slice(0, -4) : baseName;
  const results = [];
  for (let i = 0; i < 2; i++) {
    const [start, end] = i === 0 ? [0, mid] : [mid, pageCount];
    const half  = await PDFDocument.create();
    const idxs  = [];
    for (let p = start; p < end; p++) idxs.push(p);
    const pages = await half.copyPages(src, idxs);
    for (const p of pages) half.addPage(p);
    const halfBytes = await half.save();
    const halfName  = `${nameRoot}_part${i + 1}of2.pdf`;
    const sub = await uploadPdfWithSplitFallback(halfName, halfBytes, resModel, resId, LOG_TAG);
    results.push(...sub);
  }
  return results;
}

// ---------------------------------------------------------------------------
// uploadToOdoo — slow path
// ---------------------------------------------------------------------------
async function uploadToOdoo(orderId, pdfBytes, opportunityId, OUTPUT_PREFIX, LOG_TAG) {
  const orders = await odoo.searchRead('sale.order', [['id', '=', orderId]], ['name'], { limit: 1 });
  const orderName = orders.length ? orders[0].name : `order-${orderId}`;
  const attName   = `${OUTPUT_PREFIX}${orderName}.pdf`;

  const existingSO = await odoo.searchRead(
    'ir.attachment',
    [['res_model', '=', 'sale.order'], ['res_id', '=', orderId], ['name', 'like', `${OUTPUT_PREFIX}${orderName}%`]],
    ['id'],
  );
  if (existingSO.length) await odoo.execute('ir.attachment', 'unlink', [existingSO.map(a => a.id)]);

  const soParts = await uploadPdfWithSplitFallback(attName, pdfBytes, 'sale.order', orderId, LOG_TAG);
  if (!soParts.length) throw new Error(`No se pudo subir "${attName}" al sale.order.`);

  if (opportunityId && opportunityId > 0) {
    try {
      const existingCRM = await odoo.searchRead(
        'ir.attachment',
        [['res_model', '=', 'crm.lead'], ['res_id', '=', opportunityId], ['name', 'like', `${OUTPUT_PREFIX}${orderName}%`]],
        ['id'],
      );
      if (existingCRM.length) await odoo.execute('ir.attachment', 'unlink', [existingCRM.map(a => a.id)]);
      const crmParts = await uploadPdfWithSplitFallback(attName, pdfBytes, 'crm.lead', opportunityId, LOG_TAG);
      if (crmParts.length) {
        console.log(`${LOG_TAG} Adjunto subido a crm.lead id=${opportunityId} (${crmParts.length} parte(s))`);
      }
    } catch (crmErr) {
      console.warn(`${LOG_TAG} No se pudo subir a crm.lead id=${opportunityId}: ${crmErr.message}`);
    }
  }

  for (const part of soParts) await addToDocuments(opportunityId, part.attId, part.name, LOG_TAG);
  return soParts.length === 1 ? soParts[0].name : soParts.map(p => p.name).join(', ');
}

// ---------------------------------------------------------------------------
// addToDocuments
// ---------------------------------------------------------------------------
async function addToDocuments(opportunityId, attachmentId, attachmentName, LOG_TAG) {
  try {
    if (!opportunityId) return;
    const projects = await odoo.searchRead(
      'project.project', [['x_lead_id', '=', opportunityId]], ['id', 'documents_folder_id'],
    );
    const projectWithFolder = projects.find(p => p.documents_folder_id);
    if (!projectWithFolder) return;
    const rootFolderId = projectWithFolder.documents_folder_id[0];

    const subfolders = await odoo.searchRead(
      'documents.document',
      [['folder_id', '=', rootFolderId], ['is_folder', '=', true], ['name', 'ilike', '02_Ingenieria']],
      ['id', 'name'],
    );
    if (!subfolders.length) {
      console.warn(`${LOG_TAG} WARNING: subcarpeta 02_Ingenieria no encontrada, omitiendo Documents`);
      return;
    }

    const docId = await odoo.create('documents.document', {
      name: attachmentName,
      attachment_id: attachmentId,
      folder_id: subfolders[0].id,
    });
    console.log(`${LOG_TAG} documents.document creado id=${docId}`);
  } catch (err) {
    console.warn(`${LOG_TAG} No se pudo crear documents.document: ${err.message}`);
  }
}
