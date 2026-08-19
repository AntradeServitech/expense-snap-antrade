/**
 * data-sheet-form.js
 * Client-side script for the Transfluid data sheet portal.
 * Loaded via <script src="/data-sheet-form.js" defer> — same-origin, CSP compliant.
 * Handles form submission as JSON to /api/data-sheet/{token}.
 */

'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('ficha-form');
  var submitBtn = document.getElementById('submit-btn');
  var statusDiv = document.getElementById('form-status');
  var successPanel = document.getElementById('success-panel');

  if (!form) return;

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var declarant = (form.querySelector('#declarant-name') || {}).value || '';
    if (!declarant.trim()) {
      showStatus('Por favor, introduzca su nombre y cargo.', true);
      var el = form.querySelector('#declarant-name');
      if (el) el.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';
    showStatus('', false);

    var token = form.dataset.token || '';
    var payload = { __declarant: declarant.trim() };

    // Collect all named inputs (text, select, number)
    var inputs = form.querySelectorAll('input[name], select[name]');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!el.name || el.name === '__declarant' || el.id === 'declarant-name') continue;
      var val = el.value;
      if (val && val.trim()) {
        payload[el.name] = el.type === 'number' ? Number(val) : val.trim();
      }
    }

    fetch('/api/data-sheet/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { ok: resp.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok && result.data.ok) {
          form.style.display = 'none';
          if (successPanel) successPanel.style.display = 'block';
        } else {
          var msg = (result.data && result.data.error) || 'Error inesperado. Por favor, intentelo de nuevo.';
          showStatus('Error: ' + msg, true);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar formulario';
        }
      })
      .catch(function (err) {
        showStatus('Error de red. Compruebe su conexion e intentelo de nuevo.', true);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enviar formulario';
      });
  });

  function showStatus(msg, isError) {
    if (!statusDiv) return;
    statusDiv.textContent = msg;
    statusDiv.style.color = isError ? '#c0392b' : '#166534';
  }
});
