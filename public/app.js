(() => {
  'use strict';

  const MAX_DIMENSION = 1600;
  const JPEG_QUALITY = 0.82;
  const PENDING_KEY = 'expenseSnap.pendingExpenses';

  const screens = {
    capture: document.getElementById('screen-capture'),
    review: document.getElementById('screen-review'),
    done: document.getElementById('screen-done'),
  };

  const els = {
    offlineBanner: document.getElementById('offlineBanner'),
    captureEmptyState: document.getElementById('captureEmptyState'),
    capturePreviewWrap: document.getElementById('capturePreviewWrap'),
    capturePreviewImg: document.getElementById('capturePreviewImg'),
    capturePdfPlaceholder: document.getElementById('capturePdfPlaceholder'),
    capturePdfName: document.getElementById('capturePdfName'),
    btnTakePhoto: document.getElementById('btnTakePhoto'),
    btnUploadImage: document.getElementById('btnUploadImage'),
    btnUploadPdf: document.getElementById('btnUploadPdf'),
    inputCamera: document.getElementById('inputCamera'),
    inputGallery: document.getElementById('inputGallery'),
    inputPdf: document.getElementById('inputPdf'),
    selectProject: document.getElementById('selectProject'),
    btnAnalyze: document.getElementById('btnAnalyze'),
    captureError: document.getElementById('captureError'),
    pendingBox: document.getElementById('pendingBox'),
    pendingList: document.getElementById('pendingList'),

    reviewPreviewImg: document.getElementById('reviewPreviewImg'),
    reviewPdfPlaceholder: document.getElementById('reviewPdfPlaceholder'),
    confidenceBadge: document.getElementById('confidenceBadge'),
    confidenceWarning: document.getElementById('confidenceWarning'),
    noTextWarning: document.getElementById('noTextWarning'),
    fieldMerchant: document.getElementById('fieldMerchant'),
    fieldAmount: document.getElementById('fieldAmount'),
    fieldCurrency: document.getElementById('fieldCurrency'),
    fieldDate: document.getElementById('fieldDate'),
    fieldCategory: document.getElementById('fieldCategory'),
    fieldDescription: document.getElementById('fieldDescription'),
    fieldProject: document.getElementById('fieldProject'),
    btnConfirmSubmit: document.getElementById('btnConfirmSubmit'),
    btnBackToCapture: document.getElementById('btnBackToCapture'),
    reviewError: document.getElementById('reviewError'),

    summaryBox: document.getElementById('summaryBox'),
    linkOdooExpense: document.getElementById('linkOdooExpense'),
    linkOdooAll: document.getElementById('linkOdooAll'),
    btnNewExpense: document.getElementById('btnNewExpense'),

    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingText: document.getElementById('loadingText'),
  };

  let state = {
    projects: [],
    imageBase64: null, // sin prefijo data: (imagen o PDF)
    mimeType: 'image/jpeg',
    isPdf: false,
    extracted: null,
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo(0, 0);
  }

  function showLoading(text) {
    els.loadingText.textContent = text;
    els.loadingOverlay.classList.remove('hidden');
  }
  function hideLoading() {
    els.loadingOverlay.classList.add('hidden');
  }

  function showToast(message, ms = 3200) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), ms);
  }

  function setError(el, message) {
    if (!message) {
      el.classList.add('hidden');
      el.textContent = '';
    } else {
      el.classList.remove('hidden');
      el.textContent = message;
    }
  }

  // ---------- Conectividad ----------
  function updateOnlineStatus() {
    els.offlineBanner.classList.toggle('hidden', navigator.onLine);
    if (navigator.onLine) flushPendingQueue();
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  // ---------- Proyectos ----------
  async function loadProjects() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      state.projects = data.projects || [];
      [els.selectProject, els.fieldProject].forEach((select) => {
        select.innerHTML = '';
        state.projects.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.id === null ? '' : p.id;
          opt.textContent = p.serial ? `${p.serial} — ${p.name}` : p.name;
          select.appendChild(opt);
        });
      });
    } catch (err) {
      els.selectProject.innerHTML = '<option value="">Gasto general (sin proyectos)</option>';
      console.error('No se pudieron cargar los proyectos', err);
    }
  }

  // ---------- Captura y compresión de imagen ----------
  function resizeAndEncode(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => {
          let { width, height } = img;
          if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            const scale = MAX_DIMENSION / Math.max(width, height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          resolve({ dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFileSelected(file) {
    if (!file) return;
    setError(els.captureError, null);
    try {
      const { dataUrl, base64, mimeType } = await resizeAndEncode(file);
      state.imageBase64 = base64;
      state.mimeType = mimeType;
      state.isPdf = false;
      els.capturePreviewImg.src = dataUrl;
      els.capturePreviewImg.classList.remove('hidden');
      els.capturePdfPlaceholder.classList.add('hidden');
      els.capturePreviewWrap.classList.remove('hidden');
      els.captureEmptyState.classList.add('hidden');
      els.btnAnalyze.disabled = false;
    } catch (err) {
      console.error(err);
      setError(els.captureError, 'No se pudo procesar la imagen. Inténtalo de nuevo.');
    }
  }

  async function handlePdfSelected(file) {
    if (!file) return;
    setError(els.captureError, null);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      state.imageBase64 = base64;
      state.mimeType = 'application/pdf';
      state.isPdf = true;
      els.capturePdfName.textContent = file.name;
      els.capturePreviewImg.classList.add('hidden');
      els.capturePdfPlaceholder.classList.remove('hidden');
      els.capturePreviewWrap.classList.remove('hidden');
      els.captureEmptyState.classList.add('hidden');
      els.btnAnalyze.disabled = false;
    } catch (err) {
      console.error(err);
      setError(els.captureError, 'No se pudo leer el archivo PDF. Inténtalo de nuevo.');
    }
  }

  els.btnTakePhoto.addEventListener('click', () => els.inputCamera.click());
  els.btnUploadImage.addEventListener('click', () => els.inputGallery.click());
  els.btnUploadPdf.addEventListener('click', () => els.inputPdf.click());
  els.inputCamera.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));
  els.inputGallery.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));
  els.inputPdf.addEventListener('change', (e) => handlePdfSelected(e.target.files[0]));

  // ---------- Analizar ticket (OCR + estructuración) ----------
  els.btnAnalyze.addEventListener('click', async () => {
    if (!state.imageBase64) return;
    setError(els.captureError, null);
    showLoading(state.isPdf ? 'Extrayendo texto del PDF…' : 'Analizando ticket…');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.imageBase64, mimeType: state.mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al analizar el ticket');

      state.extracted = data.extracted;
      populateReviewScreen(data.extracted, data.no_text);
      showScreen('review');
    } catch (err) {
      console.error(err);
      setError(els.captureError, err.message || 'No se pudo analizar el ticket. Comprueba tu conexión.');
    } finally {
      hideLoading();
    }
  });

  function populateReviewScreen(extracted, noText = false) {
    if (state.isPdf) {
      els.reviewPreviewImg.classList.add('hidden');
      els.reviewPdfPlaceholder.classList.remove('hidden');
    } else {
      els.reviewPreviewImg.src = els.capturePreviewImg.src;
      els.reviewPreviewImg.classList.remove('hidden');
      els.reviewPdfPlaceholder.classList.add('hidden');
    }

    els.fieldMerchant.value = extracted.merchant || '';
    els.fieldAmount.value = extracted.amount != null ? extracted.amount : '';
    els.fieldCurrency.value = extracted.currency && [...els.fieldCurrency.options].some(o => o.value === extracted.currency)
      ? extracted.currency : (extracted.currency ? 'OTHER' : 'EUR');
    els.fieldDate.value = extracted.date || new Date().toISOString().slice(0, 10);
    els.fieldCategory.value = ['restaurant', 'hotel', 'transport', 'fuel', 'office', 'other'].includes(extracted.category)
      ? extracted.category : 'other';
    els.fieldDescription.value = extracted.description || '';
    els.fieldProject.value = els.selectProject.value || '';

    const confidence = extracted.confidence || 'low';
    els.confidenceBadge.className = `confidence-badge confidence-${confidence}`;
    const labels = { high: '✓ Confianza alta', medium: '⚠ Confianza media', low: '⚠ Confianza baja' };
    els.confidenceBadge.textContent = labels[confidence] || labels.low;
    // noTextWarning es más específico que confidenceWarning — se muestran mutuamente excluyentes
    els.confidenceWarning.classList.toggle('hidden', confidence !== 'low' || noText);
    els.noTextWarning.classList.toggle('hidden', !noText);
  }

  els.btnBackToCapture.addEventListener('click', () => {
    setError(els.reviewError, null);
    showScreen('capture');
  });

  // ---------- Confirmar y subir a Odoo ----------
  function buildPayload() {
    return {
      merchant: els.fieldMerchant.value.trim(),
      amount: parseFloat(els.fieldAmount.value),
      currency: els.fieldCurrency.value,
      date: els.fieldDate.value,
      category: els.fieldCategory.value,
      description: els.fieldDescription.value.trim(),
      project_id: els.fieldProject.value ? Number(els.fieldProject.value) : null,
      image: state.imageBase64,
      mimeType: state.mimeType,
    };
  }

  els.btnConfirmSubmit.addEventListener('click', async () => {
    setError(els.reviewError, null);
    const payload = buildPayload();
    if (!payload.merchant || !payload.amount || !payload.date) {
      setError(els.reviewError, 'Completa establecimiento, importe y fecha antes de continuar.');
      return;
    }

    if (!navigator.onLine) {
      queuePendingExpense(payload);
      showToast('Sin conexión: el gasto se guardó como pendiente en este dispositivo.');
      resetToCapture();
      return;
    }

    showLoading('Subiendo gasto a Odoo…');
    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Error al crear el gasto en Odoo');

      showDoneScreen(payload, data);
    } catch (err) {
      console.error(err);
      if (!navigator.onLine) {
        queuePendingExpense(payload);
        showToast('Sin conexión: el gasto se guardó como pendiente en este dispositivo.');
        resetToCapture();
      } else {
        setError(els.reviewError, err.message || 'No se pudo subir el gasto. Inténtalo de nuevo.');
      }
    } finally {
      hideLoading();
    }
  });

  function showDoneScreen(payload, data) {
    els.summaryBox.innerHTML = '';
    const rows = [
      ['Establecimiento', payload.merchant],
      ['Importe', `${payload.amount.toFixed(2)} ${payload.currency}`],
      ['Fecha', payload.date],
      ['Categoría', els.fieldCategory.options[els.fieldCategory.selectedIndex].text],
    ];
    rows.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'summary-row';
      row.innerHTML = `<span>${label}</span><span>${value}</span>`;
      els.summaryBox.appendChild(row);
    });

    if (data.odoo_url) {
      els.linkOdooExpense.href = data.odoo_url;
      els.linkOdooExpense.classList.remove('hidden');
    } else {
      els.linkOdooExpense.classList.add('hidden');
    }
    if (data.odoo_expenses_url) {
      els.linkOdooAll.href = data.odoo_expenses_url;
    }

    showScreen('done');
  }

  els.btnNewExpense.addEventListener('click', resetToCapture);

  function resetToCapture() {
    state.imageBase64 = null;
    state.isPdf = false;
    state.extracted = null;
    els.capturePreviewWrap.classList.add('hidden');
    els.capturePreviewImg.src = '';
    els.capturePreviewImg.classList.remove('hidden');
    els.capturePdfPlaceholder.classList.add('hidden');
    els.captureEmptyState.classList.remove('hidden');
    els.btnAnalyze.disabled = true;
    els.inputCamera.value = '';
    els.inputGallery.value = '';
    els.inputPdf.value = '';
    els.noTextWarning.classList.add('hidden');
    setError(els.captureError, null);
    renderPendingQueue();
    showScreen('capture');
  }

  // ---------- Cola de gastos pendientes (offline) ----------
  function getPendingQueue() {
    try {
      return JSON.parse(localStorage.getItem(PENDING_KEY)) || [];
    } catch {
      return [];
    }
  }

  function savePendingQueue(queue) {
    localStorage.setItem(PENDING_KEY, JSON.stringify(queue));
    renderPendingQueue();
  }

  function queuePendingExpense(payload) {
    const queue = getPendingQueue();
    queue.push({ id: Date.now(), payload });
    savePendingQueue(queue);
  }

  function renderPendingQueue() {
    const queue = getPendingQueue();
    if (queue.length === 0) {
      els.pendingBox.classList.add('hidden');
      return;
    }
    els.pendingBox.classList.remove('hidden');
    els.pendingList.innerHTML = queue
      .map((item) => `<div class="summary-row"><span>${item.payload.merchant || 'Sin nombre'}</span><span>${item.payload.amount} ${item.payload.currency}</span></div>`)
      .join('');
  }

  async function flushPendingQueue() {
    const queue = getPendingQueue();
    if (queue.length === 0) return;
    const remaining = [];
    for (const item of queue) {
      try {
        const res = await fetch('/api/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'fallo al subir pendiente');
        showToast(`Gasto pendiente "${item.payload.merchant}" subido a Odoo.`);
      } catch (err) {
        console.warn('No se pudo subir el gasto pendiente todavía:', err.message);
        remaining.push(item);
      }
    }
    savePendingQueue(remaining);
  }

  // ---------- Service Worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registro falló', err));
    });
  }

  // ---------- Init ----------
  updateOnlineStatus();
  renderPendingQueue();
  loadProjects();
})();
