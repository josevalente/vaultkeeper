// Backups and file sharing. On iPhone, navigator.share with a file opens the share sheet, where
// "Guardar en Archivos" puts it in iCloud Drive. Elsewhere the file is downloaded.

import { state, save, exportData } from './store.js';
import { toast } from './util.js';

export async function shareFile(file, { title = '', text = '' } = {}) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false; // user closed the sheet
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1500);
  return true;
}

export async function backupNow() {
  const name = `vaultkeeper-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([exportData()], name, { type: 'application/json' });
  const ok = await shareFile(file, { title: 'Respaldo VaultKeeper', text: 'Guárdalo en Archivos → iCloud Drive' });
  if (ok) {
    state.settings.lastBackup = Date.now();
    save();
    toast('Respaldo listo', 'ok');
  }
  return ok;
}

export const backupDue = () => state.items.length > 0 && Date.now() - (state.settings.lastBackup || 0) > 7 * 86400000;

export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// CSV for Excel in Spanish: semicolons, BOM (accents), decimal comma, and text that starts with
// = + - @ prefixed with ' so a card name or note can never run as a formula.
export function csv(rows) {
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
    let t = String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\n');
}
