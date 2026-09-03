export const FORM_EMBED_JS = `(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var src = new URL(script.src);
  var match = src.pathname.match(/^\\/forms\\/([^/]+)\\/embed\\.js$/);
  if (!match) return;
  var base = src.origin;
  var formId = match[1];

  var container = null;
  var target = script.getAttribute('data-target');
  if (target) container = document.querySelector(target);
  if (!container) {
    container = document.createElement('div');
    script.parentNode.insertBefore(container, script.nextSibling);
  }

  var LS_KEY = 'wapFormVisitor';
  var visitor = null;
  try { visitor = localStorage.getItem(LS_KEY); } catch (e) {}

  var S = {
    root: 'font-family:system-ui,-apple-system,\\'Segoe UI\\',sans-serif;color:#0f172a;max-width:440px;display:flex;flex-direction:column;gap:14px;',
    field: 'display:flex;flex-direction:column;gap:4px;',
    label: 'font-size:13px;font-weight:600;color:#0f172a;',
    input: 'box-sizing:border-box;width:100%;padding:9px 11px;font-size:14px;font-family:inherit;color:#0f172a;border:1px solid #cbd5e1;border-radius:8px;background:#fff;',
    choice: 'display:flex;gap:8px;align-items:center;font-size:14px;color:#0f172a;',
    error: 'color:#dc2626;font-size:12px;margin:0;',
    button: 'padding:10px 18px;font-size:14px;font-weight:600;font-family:inherit;color:#fff;background:#0f766e;border:0;border-radius:8px;cursor:pointer;align-self:flex-start;',
    consent: 'display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.45;color:#475569;',
    message: 'font-size:14.5px;color:#0f172a;'
  };

  function el(tag, css) {
    var node = document.createElement(tag);
    if (css) node.style.cssText = css;
    return node;
  }

  function fetchDef() {
    var url = base + '/forms/' + formId + '/def' + (visitor ? '?visitor=' + encodeURIComponent(visitor) : '');
    fetch(url).then(function (r) { return r.ok ? r.json() : null; }).then(function (def) {
      if (def) render(def);
    }).catch(function () {});
  }

  function render(def) {
    container.textContent = '';
    var visible = def.fields.filter(function (f) { return def.knownFields.indexOf(f.key) === -1; });
    if (visible.length === 0) {
      var done = el('p', S.message);
      done.textContent = 'Vos informations sont déjà enregistrées. Merci !';
      container.appendChild(done);
      return;
    }

    var form = el('form', S.root);
    var getters = {};
    var errorEls = {};

    visible.forEach(function (f) {
      var wrap = el('div', S.field);
      var id = 'wapf-' + formId.slice(0, 6) + '-' + f.key.replace(/[^a-zA-Z0-9]/g, '-');
      if (f.input === 'boolean') {
        var row = el('label', S.choice);
        var cb = el('input', '');
        cb.type = 'checkbox';
        row.appendChild(cb);
        row.appendChild(document.createTextNode(f.label + (f.required ? ' *' : '')));
        wrap.appendChild(row);
        getters[f.key] = function () { return cb.checked; };
      } else {
        var label = el('label', S.label);
        label.textContent = f.label + (f.required ? ' *' : '');
        label.htmlFor = id;
        wrap.appendChild(label);
        if (f.input === 'textarea') {
          var ta = el('textarea', S.input + 'min-height:80px;resize:vertical;');
          ta.id = id; if (f.required) ta.required = true;
          wrap.appendChild(ta);
          getters[f.key] = function () { return ta.value; };
        } else if (f.input === 'select') {
          var sel = el('select', S.input);
          sel.id = id; if (f.required) sel.required = true;
          sel.appendChild(el('option', ''));
          (f.options || []).forEach(function (o) {
            var opt = el('option', '');
            opt.value = o.value; opt.textContent = o.label;
            sel.appendChild(opt);
          });
          wrap.appendChild(sel);
          getters[f.key] = function () { return sel.value; };
        } else if (f.input === 'radio' || f.input === 'checkbox') {
          var inputs = [];
          (f.options || []).forEach(function (o) {
            var row2 = el('label', S.choice);
            var inp = el('input', '');
            inp.type = f.input === 'radio' ? 'radio' : 'checkbox';
            inp.name = id; inp.value = o.value;
            row2.appendChild(inp);
            row2.appendChild(document.createTextNode(o.label));
            wrap.appendChild(row2);
            inputs.push(inp);
          });
          getters[f.key] = function () {
            var picked = inputs.filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
            return f.input === 'radio' ? (picked[0] || '') : picked;
          };
        } else {
          var input = el('input', S.input);
          input.id = id;
          input.type = f.input === 'number' ? 'number' : f.input === 'date' ? 'date' : f.input;
          if (f.required) input.required = true;
          wrap.appendChild(input);
          getters[f.key] = function () {
            if (f.input === 'number') return input.value === '' ? '' : Number(input.value);
            return input.value;
          };
        }
      }
      var err = el('p', S.error);
      err.hidden = true;
      wrap.appendChild(err);
      errorEls[f.key] = err;
      form.appendChild(wrap);
    });

    // Honeypot: invisible to humans, tempting to bots.
    var hp = el('input', 'position:absolute;left:-9999px;top:-9999px;height:1px;width:1px;opacity:0;');
    hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1;
    hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true');
    form.appendChild(hp);

    var consentRow = el('label', S.consent);
    var consent = el('input', 'margin-top:2px;');
    consent.type = 'checkbox'; consent.required = true;
    consentRow.appendChild(consent);
    consentRow.appendChild(document.createTextNode(def.consentText));
    form.appendChild(consentRow);

    var globalErr = el('p', S.error);
    globalErr.hidden = true;
    form.appendChild(globalErr);

    var button = el('button', S.button);
    button.type = 'submit';
    button.textContent = def.buttonText;
    form.appendChild(button);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      Object.keys(errorEls).forEach(function (k) { errorEls[k].hidden = true; });
      globalErr.hidden = true;
      button.disabled = true;
      var values = {};
      Object.keys(getters).forEach(function (k) { values[k] = getters[k](); });
      fetch(base + '/forms/' + formId + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: values,
          consent: consent.checked,
          honeypot: hp.value,
          renderedAt: def.ts,
          visitorToken: visitor
        })
      }).then(function (r) {
        if (r.status === 429) throw new Error('rate');
        return r.json();
      }).then(function (res) {
        if (res && res.ok) {
          if (res.visitorToken) {
            try { localStorage.setItem(LS_KEY, res.visitorToken); } catch (e2) {}
          }
          if (res.afterSubmit && res.afterSubmit.kind === 'redirect') {
            try { window.top.location.href = res.afterSubmit.url; }
            catch (e3) { window.location.href = res.afterSubmit.url; }
            return;
          }
          var msg = el('p', S.message);
          msg.textContent = (res.afterSubmit && res.afterSubmit.message) || 'Merci !';
          container.textContent = '';
          container.appendChild(msg);
          return;
        }
        button.disabled = false;
        if (res && res.errors) {
          Object.keys(res.errors).forEach(function (k) {
            if (errorEls[k]) { errorEls[k].textContent = res.errors[k]; errorEls[k].hidden = false; }
          });
          return;
        }
        globalErr.textContent = res && res.code === 'too_fast'
          ? 'Veuillez patienter quelques secondes puis réessayer.'
          : 'Une erreur est survenue. Veuillez réessayer.';
        globalErr.hidden = false;
      }).catch(function (err) {
        button.disabled = false;
        globalErr.textContent = err && err.message === 'rate'
          ? 'Trop de tentatives, réessayez dans un instant.'
          : 'Une erreur est survenue. Veuillez réessayer.';
        globalErr.hidden = false;
      });
    });

    container.appendChild(form);
  }

  fetchDef();
})();
`;

export function formIframeHtml(formId: string): string {
  const safeId = encodeURIComponent(formId);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Formulaire</title></head><body style="margin:0;padding:16px;background:#fff"><script src="/forms/${safeId}/embed.js"></script></body></html>`;
}
