// Ajustes: currency, exchange rate, deal thresholds, Claude key, backups.

import { esc, $, $$, fmtCLP, timeAgo, parseAmount, toast } from '../util.js';
import { state, save, exportData, replaceAll, snapshot } from '../store.js';
import { RARITIES, raritySymbol } from '../rarity.js';
import { refreshFx, setManualFx } from '../fx.js';
import { testClaudeKey } from '../scan.js';
import { confirmSheet } from '../ui.js';
import { backupNow, isInstalled } from '../backup.js';

const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 (más preciso)'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 (más barato)'],
];

export function renderSettings(root) {
  const s = state.settings;
  const fx = state.fx;
  root.innerHTML = `
    <div class="view-head rise"><h1>Ajustes</h1></div>

    <section class="panel rise" style="--d:1">
      <h2>Moneda</h2>
      <div class="seg disp"><button data-c="CLP" class="${s.display === 'CLP' ? 'on' : ''}">Mostrar en CLP</button><button data-c="USD" class="${s.display === 'USD' ? 'on' : ''}">Mostrar en USD</button></div>
      <div class="kv"><span>Dólar hoy</span><b>${fmtCLP(fx.usdclp)}</b></div>
      <p class="muted small">${esc(fx.src)} · ${timeAgo(fx.at)}. Cada compra guarda el tipo de cambio del momento en que la registras.</p>
      <div class="money-in"><input class="input fxman" inputmode="decimal" placeholder="Fijar manual (ej: 975)"><button class="btn ghost setfx">Fijar</button><button class="btn ghost upfx">Actualizar</button></div>
    </section>

    <section class="panel rise" style="--d:2">
      <h2>Ferias y reventa</h2>
      <label class="field"><span>Considerar “Ganga” desde (% bajo mercado)</span><input class="input num" data-k="dealPct" inputmode="numeric" value="${s.dealPct}"></label>
      <label class="field"><span>Tu rango: valor mínimo de mercado (US$)</span><input class="input num" data-k="minUSD" inputmode="decimal" value="${s.minUSD}"></label>
      <label class="field"><span>Margen que buscas al revender (%)</span><input class="input num" data-k="targetMargin" inputmode="decimal" value="${s.targetMargin}"></label>
      <p class="muted tiny">Se usa para “Paga como máximo” y para avisarte cuándo una carta ya rinde lo que buscas.</p>
      <label class="field"><span>Avisarme si una carta del vault se mueve más de (% en 7 días)</span><input class="input num" data-k="alertPct" inputmode="decimal" value="${s.alertPct}"></label>
      <div class="field"><span>Rarezas que se guardan como colección por defecto</span>
        <div class="chips-wrap">${RARITIES.map((r) => `<button class="rchip ${s.keepRarities.includes(r.api.toLowerCase()) ? 'on' : ''}" data-keep="${esc(r.api.toLowerCase())}">${raritySymbol(r.key, 16)}<span>${esc(r.label)}</span></button>`).join('')}</div>
      </div>
    </section>

    <section class="panel rise" style="--d:3">
      <h2>Dónde vendes</h2>
      <p class="muted small">Comisión de cada canal: se descuenta al registrar una venta. El canal habitual se usa para las estimaciones (veredicto, “paga como máximo”, ranking). La comisión de Mercado Libre depende de la categoría y del tipo de publicación: revisa la tuya y ajústala.</p>
      <div class="channels">${s.channels
        .map(
          (c) => `<div class="ch-row" data-id="${esc(c.id)}">
            <label class="radio"><input type="radio" name="defch" ${s.defaultChannel === c.id ? 'checked' : ''}><span></span></label>
            <input class="input ch-name" value="${esc(c.name)}">
            <label class="ch-num"><input class="input ch-pct" inputmode="decimal" value="${c.feePct}"><em>%</em></label>
            <label class="ch-num"><em>+$</em><input class="input ch-fix" inputmode="numeric" value="${c.fixedCLP || 0}"></label>
          </div>`
        )
        .join('')}</div>
      <p class="muted tiny">● = canal habitual · % comisión · + monto fijo por venta (CLP)</p>
    </section>

    <section class="panel rise" style="--d:3">
      <h2>Reconocimiento con Claude <small class="muted">opcional</small></h2>
      <p class="muted small">Sin clave, la app lee el número de la carta con OCR en el teléfono. Con una clave de la API de Anthropic, Claude identifica la carta desde la foto (más preciso con reflejos, ángulos y cartas en otros idiomas). La clave queda guardada solo en este teléfono; cada foto cuesta fracciones de centavo de dólar.</p>
      <label class="field"><span>API key</span><input class="input key" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(s.claudeKey)}"></label>
      <label class="field"><span>Modelo</span><select class="input model">${MODELS.map(([v, l]) => `<option value="${v}" ${s.claudeModel === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="btn-row"><button class="btn ghost savekey">Guardar</button><button class="btn ghost testkey">Probar</button></div>
      <label class="field"><span>pokemontcg.io API key (opcional, precios de respaldo)</span><input class="input ptcg" type="password" autocomplete="off" value="${esc(s.ptcgKey)}"></label>
    </section>

    <section class="panel rise" style="--d:4">
      <h2>Tus datos</h2>
      <p class="muted small">Todo se guarda en este teléfono. Exporta un respaldo de vez en cuando (y antes de cambiar de teléfono).</p>
      <button class="btn primary full backup">Respaldar en iCloud / Archivos</button>
      <p class="muted tiny">${s.lastBackup ? `Último respaldo: ${new Date(s.lastBackup).toLocaleString('es-CL')}` : 'Aún no has hecho un respaldo.'} En el iPhone elige “Guardar en Archivos” → iCloud Drive.${isInstalled() ? '' : ' Estás en Safari: los datos de Safari y de la app instalada en inicio son distintos.'}</p>
      <div class="btn-row"><button class="btn ghost export">Descargar respaldo</button><label class="btn ghost">Importar<input type="file" accept="application/json,.json" hidden class="import"></label></div>
      <p class="muted small persist"></p>
      <button class="btn ghost danger full wipe">Borrar todos los datos</button>
    </section>

    <section class="panel rise" style="--d:5">
      <h2>Instalar en iPhone</h2>
      <p class="muted small">Abre la app en Safari → botón Compartir → “Agregar a pantalla de inicio”. Así abre a pantalla completa, funciona sin conexión y iOS no borra tus datos.</p>
      <p class="muted tiny">Datos de cartas y precios: TCGdex (TCGplayer y Cardmarket) y pokemontcg.io. Tipo de cambio: mindicador.cl / open.er-api.com. VaultKeeper no está afiliado a Pokémon, Nintendo ni TCGplayer.</p>
    </section>`;

  $$('.disp button', root).forEach((b) => (b.onclick = () => {
    s.display = b.dataset.c;
    save();
  }));
  $('.setfx', root).onclick = () => {
    const v = parseAmount($('.fxman', root).value, 'USD');
    if (!(v > 100)) return toast('Ingresa un valor válido (ej: 975)', 'err');
    setManualFx(v);
    snapshot();
    save();
    toast('Tipo de cambio fijado');
  };
  $('.upfx', root).onclick = async () => {
    await refreshFx({ force: true });
    snapshot();
    save();
    toast(`Dólar: ${fmtCLP(state.fx.usdclp)}`);
  };
  $$('input.num', root).forEach((inp) => (inp.onchange = () => {
    const v = parseAmount(inp.value, 'USD');
    if (!isNaN(v) && v >= 0) {
      s[inp.dataset.k] = v;
      save();
    }
  }));
  // Sale channels: name, % fee, fixed fee; the default one feeds every estimate (settings.feePct).
  const syncFee = () => (s.feePct = s.channels.find((c) => c.id === s.defaultChannel)?.feePct || 0);
  $$('.ch-row', root).forEach((row) => {
    const c = s.channels.find((x) => x.id === row.dataset.id);
    $('input[type=radio]', row).onchange = () => ((s.defaultChannel = c.id), syncFee(), save());
    $('.ch-name', row).onchange = (e) => ((c.name = e.target.value.trim() || c.name), save({ silent: true }));
    $('.ch-pct', row).onchange = (e) => {
      const v = parseAmount(e.target.value, 'USD');
      if (!isNaN(v) && v >= 0 && v < 100) (c.feePct = v), syncFee(), save({ silent: true });
    };
    $('.ch-fix', row).onchange = (e) => {
      const v = parseAmount(e.target.value, 'CLP');
      if (!isNaN(v) && v >= 0) (c.fixedCLP = v), save({ silent: true });
    };
  });
  $('.backup', root).onclick = () => backupNow();
  $$('[data-keep]', root).forEach((b) => (b.onclick = () => {
    const k = b.dataset.keep;
    s.keepRarities = s.keepRarities.includes(k) ? s.keepRarities.filter((x) => x !== k) : [...s.keepRarities, k];
    save();
  }));
  const storeKeys = () => {
    s.claudeKey = $('.key', root).value.trim();
    s.claudeModel = $('.model', root).value;
    s.ptcgKey = $('.ptcg', root).value.trim();
    save({ silent: true });
  };
  $('.savekey', root).onclick = () => (storeKeys(), toast('Guardado'));
  $('.ptcg', root).onchange = storeKeys;
  $('.model', root).onchange = storeKeys;
  $('.testkey', root).onclick = async (e) => {
    storeKeys();
    if (!s.claudeKey) return toast('Primero pega tu API key', 'err');
    e.target.textContent = 'Probando…';
    try {
      await testClaudeKey();
      toast('Claude responde OK', 'ok');
    } catch (err) {
      toast(`Error: ${err.status || ''} ${err.message || err}`.slice(0, 120), 'err');
    }
    e.target.textContent = 'Probar';
  };
  $('.export', root).onclick = () => {
    const blob = new Blob([exportData()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vaultkeeper-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
  };
  $('.import', root).onchange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.items)) throw new Error('formato');
      if (await confirmSheet('Importar respaldo', `Reemplazar tus datos actuales por el respaldo (${data.items.length} cartas)?`, 'Importar', true)) {
        replaceAll(data);
        toast('Respaldo importado', 'ok');
      }
    } catch {
      toast('Ese archivo no es un respaldo de VaultKeeper', 'err');
    }
  };
  $('.wipe', root).onclick = async () => {
    if (await confirmSheet('Borrar todo', 'Se eliminarán todas tus cartas, ventas e historial de este teléfono. Exporta un respaldo antes si lo necesitas.', 'Borrar todo', true)) {
      replaceAll({});
      toast('Datos borrados');
    }
  };
  navigator.storage?.persisted?.().then((p) => {
    $('.persist', root).textContent = p ? 'Almacenamiento persistente activado ✓' : 'Almacenamiento estándar (instala la app en inicio para que iOS no lo borre).';
  });
}
