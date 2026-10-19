/**
 * IKASI · Backend Google Apps Script
 * V9: clave para lectura/escritura + tiempo real por sesión.
 */

const PLAN_SHEET = 'Plan';
const SUBJECTS_SHEET = 'Asignaturas';
const COMMITMENTS_SHEET = 'Compromisos';
const CONFIG_SHEET = 'Config';

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getBook_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Este script debe estar vinculado al Google Sheet de Ikasi.');
  return ss;
}

function getExpectedKey_() {
  return String(PropertiesService.getScriptProperties().getProperty('WRITE_KEY') || '');
}

function validKey_(candidate) {
  const expected = getExpectedKey_();
  return !!expected && String(candidate || '') === expected;
}

function doGet(e) {
  try {
    const key = e && e.parameter ? e.parameter.key : '';
    if (!validKey_(key)) return jsonOutput_({ok:false, error:'unauthorized'});

    const ss = getBook_();
    return jsonOutput_({
      ok: true,
      updatedAt: DriveApp.getFileById(ss.getId()).getLastUpdated().toISOString(),
      subjects: readSubjects_(ss),
      schedule: readPlan_(ss),
      fixedDays: readCommitments_(ss),
      settings: readConfig_(ss)
    });
  } catch (err) {
    return jsonOutput_({ok:false, error:String(err && err.message ? err.message : err)});
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!validKey_(body.key)) return jsonOutput_({ok:false, error:'unauthorized'});

    if (body.action === 'setProgress') {
      setProgress_(
        String(body.id || ''),
        Boolean(body.completed),
        Math.max(0, Math.round(Number(body.actualMinutes) || 0))
      );
      return jsonOutput_({
        ok:true,
        id:String(body.id || ''),
        completed:Boolean(body.completed),
        actualMinutes:Math.max(0, Math.round(Number(body.actualMinutes) || 0))
      });
    }

    // Compatibilidad con versiones anteriores de Ikasi.
    if (body.action === 'setCompleted') {
      setCompletedLegacy_(String(body.id || ''), Boolean(body.completed));
      return jsonOutput_({ok:true, id:String(body.id || ''), completed:Boolean(body.completed)});
    }

    return jsonOutput_({ok:false, error:'unknown_action'});
  } catch (err) {
    return jsonOutput_({ok:false, error:String(err && err.message ? err.message : err)});
  }
}

function generarClaveEscritura() {
  const key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('WRITE_KEY', key);
  console.log('WRITE_KEY=' + key);
  Logger.log('WRITE_KEY=' + key);
  return key;
}

function readPlan_(ss) {
  const sh = ss.getSheetByName(PLAN_SHEET);
  if (!sh) throw new Error('Falta la pestaña Plan.');
  const last = sh.getLastRow();
  if (last < 2) return [];

  const rows = sh.getRange(2, 1, last - 1, 10).getValues();

  return rows
    .filter(r => r[0] && r[7] !== false)
    .map(r => {
      const planned = Math.max(0, Number(r[3]) || 0);
      const completed = Boolean(r[8]);
      const rawActual = r[9];
      const actual = rawActual === '' || rawActual == null
        ? (completed ? planned : 0)
        : Math.max(0, Number(rawActual) || 0);

      return {
        id: String(r[0]),
        date: normalizeDate_(r[1]),
        subject: String(r[2]),
        minutes: planned,
        title: String(r[5] || ''),
        description: String(r[6] || ''),
        completed,
        actualMinutes: actual
      };
    });
}

function readSubjects_(ss) {
  const sh = ss.getSheetByName(SUBJECTS_SHEET);
  if (!sh) throw new Error('Falta la pestaña Asignaturas.');
  const last = sh.getLastRow();
  const out = {};
  if (last < 2) return out;

  sh.getRange(2, 1, last - 1, 5).getValues().forEach(r => {
    if (!r[0]) return;
    out[String(r[0])] = {
      name: String(r[1] || ''),
      short: String(r[2] || r[1] || r[0]),
      color: String(r[3] || '#cbd5e1'),
      exam: normalizeDateTime_(r[4])
    };
  });
  return out;
}

function readCommitments_(ss) {
  const sh = ss.getSheetByName(COMMITMENTS_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;

  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    if (!r[0]) return;
    out[normalizeDate_(r[0])] = String(r[1] || '');
  });
  return out;
}

function readConfig_(ss) {
  const sh = ss.getSheetByName(CONFIG_SHEET);
  const out = {};
  if (!sh || sh.getLastRow() < 2) return out;

  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    if (r[0]) out[String(r[0])] = String(r[1] == null ? '' : r[1]);
  });
  return out;
}

function findPlanRow_(sh, id) {
  if (!id) throw new Error('ID vacío.');
  const last = sh.getLastRow();
  if (last < 2) throw new Error('No hay bloques en Plan.');

  const ids = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  const idx = ids.findIndex(r => String(r[0]) === id);
  if (idx < 0) throw new Error('No se encontró el bloque: ' + id);
  return idx + 2;
}

function setProgress_(id, completed, actualMinutes) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getBook_().getSheetByName(PLAN_SHEET);
    const row = findPlanRow_(sh, id);
    sh.getRange(row, 9, 1, 2).setValues([[completed, actualMinutes]]);
  } finally {
    lock.releaseLock();
  }
}

function setCompletedLegacy_(id, completed) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = getBook_().getSheetByName(PLAN_SHEET);
    const row = findPlanRow_(sh, id);
    sh.getRange(row, 9).setValue(completed);

    const realCell = sh.getRange(row, 10);
    const currentReal = realCell.getValue();
    if (completed && (currentReal === '' || currentReal == null)) {
      realCell.setValue(Math.max(0, Number(sh.getRange(row, 4).getValue()) || 0));
    }
  } finally {
    lock.releaseLock();
  }
}

function normalizeDate_(v) {
  if (v instanceof Date && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return s;
}

function normalizeDateTime_(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  return String(v || '').trim();
}
