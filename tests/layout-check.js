// Layout check for phones: paste in the browser console (or run from an automated browser) with
// the app open. It reports, for the current page and width:
//  · header pieces that overlap each other or leave the screen (logo, VaultKeeper, vault pill,
//    exchange-rate chip, offline chip, gear);
//  · text cut with "…" in the header;
//  · anything wider than the screen (horizontal scroll) in the view and the tab bar.
// Returns { width, ok, problems: [...] }. Used to validate every iPhone width (320 → 440 px).
(() => {
  const W = document.documentElement.clientWidth;
  const problems = [];
  const vis = (el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const box = (el) => el.getBoundingClientRect();
  const name = (el) => (el.className && String(el.className).split(' ')[0]) || el.tagName.toLowerCase();
  const textWidth = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect().width;
  };

  const top = document.querySelector('.topbar');
  if (top) {
    const parts = [...top.querySelectorAll('.brand img, .brand > span, .vault-pill, .fxchip, .offline-dot, .gear')].filter(vis);
    for (let i = 0; i < parts.length; i++) {
      const a = box(parts[i]);
      if (a.left < -0.5 || a.right > W + 0.5) problems.push(`cabecera: ${name(parts[i])} se sale de la pantalla (${Math.round(a.left)}–${Math.round(a.right)} de ${W})`);
      for (let j = i + 1; j < parts.length; j++) {
        const b = box(parts[j]);
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (overlap > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) problems.push(`cabecera: ${name(parts[i])} se monta sobre ${name(parts[j])} (${Math.round(overlap)} px)`);
      }
    }
    for (const el of [...top.querySelectorAll('.vp-name, .fxchip, .brand > span')].filter(vis)) {
      if (textWidth(el) > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') problems.push(`cabecera: texto cortado en ${name(el)} («${el.textContent.trim()}»)`);
    }
    if (box(top).height > 80) problems.push(`cabecera: muy alta (${Math.round(box(top).height)} px, algo saltó de línea)`);
  }
  // Content: nothing may cross the right edge (except horizontal scrollers like the rarity chips),
  // and money amounts must never be cut with "…".
  const scrollers = '.chips-scroll, .rgrid, .tv, .burst-strip';
  for (const el of document.querySelectorAll('#view *, .sheet-body *')) {
    if (!vis(el) || el.closest(scrollers)) continue;
    const r = box(el);
    if (r.width && r.right > W + 1) {
      problems.push(`contenido: ${name(el)} se sale por la derecha (${Math.round(r.right)} de ${W})`);
      break;
    }
  }
  for (const el of document.querySelectorAll('.hero-value, .hero-stats b, .tile-val b, .trow-val b, .rank-side b, .kv b, .bal-row b, .ev-val b, .big')) {
    if (vis(el) && getComputedStyle(el).textOverflow === 'ellipsis' && textWidth(el.firstChild?.nodeType === 3 ? el : el) > el.clientWidth + 1) problems.push(`monto cortado: «${el.textContent.trim().slice(0, 24)}»`);
  }
  // Horizontal carousels (rarities, chips) bleed to the screen edge, but their first item must line
  // up with the page margin (16 px), never stick to the edge.
  for (const sc of document.querySelectorAll('#view .rgrid, #view .chips-scroll')) {
    const first = [...sc.children].find(vis);
    if (!first || getComputedStyle(sc).overflowX === 'visible') continue;
    const left = box(first).left;
    if (left < 12) problems.push(`contenido: ${name(sc)} pegado al borde (primer elemento en x=${Math.round(left)}, debería estar en ~16)`);
  }
  if (document.documentElement.scrollWidth > W + 1) problems.push(`la página es más ancha que la pantalla (${document.documentElement.scrollWidth} px de ${W}): scroll lateral`);
  const tab = document.querySelector('.tabbar');
  if (tab && (box(tab).left < 0 || box(tab).right > W)) problems.push('barra de pestañas fuera de la pantalla');
  return { width: W, ok: !problems.length, problems };
})();
