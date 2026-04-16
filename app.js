const DB_NAME = 'ac-app-db';
const STORE_NAME = 'keyval';
const STORAGE_KEY = 'ac-app-state';
const APP_VERSION = '1.0.1';

const CAMERA_OPTIONS = [
  'Alexa Mini', 'Alexa Mini LF', 'Alexa 35', 'RED Epic', 'RED V-Raptor', 'RED Komodo',
  'Sony Venice', 'Sony FX6', 'Sony FX9', 'Canon C300', 'Canon C500', 'Blackmagic URSA Mini Pro'
];
const FRAME_RATE_OPTIONS = ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'];
const LUT_OPTIONS = ['No', 'Yes'];
const FILTER_OPTIONS = ['None', 'ND .3', 'ND .6', 'ND .9', 'ND 1.2', 'Polarizer', 'Black Pro-Mist 1/8', 'Black Pro-Mist 1/4', 'Custom'];
const LENS_OPTIONS = ['14mm', '18mm', '21mm', '24mm', '25mm', '27mm', '32mm', '35mm', '40mm', '50mm', '65mm', '75mm', '85mm', '100mm', '135mm', 'Custom'];
const CAMERA_VARIANT_OPTIONS = ['Main camera', 'A Cam', 'B Cam', 'Custom'];

const DEFAULT_STATE = {
  version: 1,
  settings: { theme: 'light' },
  projects: [],
  currentProjectId: null,
  lastSavedAt: null,
};

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

let state = deepClone(DEFAULT_STATE);
let saveTimer = null;
let dbPromise = null;
let isLoading = true;
let isSaving = false;
let hasPendingSave = false;
let toastTimeout = null;
const app = document.getElementById('app');
const filePicker = document.getElementById('filePicker');
const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  
  if (toastContainer.children.length > 0) {
    toastContainer.removeChild(toastContainer.children[0]);
  }
  toastContainer.appendChild(toast);
  
  requestAnimationFrame(() => toast.classList.add('show'));
  
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function todayLocal() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.length > 10000) return str.slice(0, 10000);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeText(text, maxLength = 500) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().slice(0, maxLength).replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

function validateProject(project) {
  if (!project || typeof project !== 'object') return false;
  if (typeof project.projectName === 'string' && project.projectName.length > 200) project.projectName = project.projectName.slice(0, 200);
  if (typeof project.prodCompany === 'string' && project.prodCompany.length > 200) project.prodCompany = project.prodCompany.slice(0, 200);
  if (typeof project.dp === 'string' && project.dp.length > 100) project.dp = project.dp.slice(0, 100);
  if (typeof project.firstACName === 'string' && project.firstACName.length > 100) project.firstACName = project.firstACName.slice(0, 100);
  if (typeof project.secondACName === 'string' && project.secondACName.length > 100) project.secondACName = project.secondACName.slice(0, 100);
  if (typeof project.cameraTraineeName === 'string' && project.cameraTraineeName.length > 100) project.cameraTraineeName = project.cameraTraineeName.slice(0, 100);
  if (typeof project.director === 'string' && project.director.length > 100) project.director = project.director.slice(0, 100);
  if (typeof project.camera === 'string' && !CAMERA_OPTIONS.includes(project.camera) && project.camera !== 'Custom') project.camera = CAMERA_OPTIONS[0];
  if (typeof project.frameRate === 'string' && !FRAME_RATE_OPTIONS.includes(project.frameRate)) project.frameRate = FRAME_RATE_OPTIONS[1];
  if (typeof project.lutUsed === 'string' && !LUT_OPTIONS.includes(project.lutUsed)) project.lutUsed = 'No';
  if (typeof project.extraNotes === 'string' && project.extraNotes.length > 5000) project.extraNotes = project.extraNotes.slice(0, 5000);
  if (!Array.isArray(project.productionDays)) project.productionDays = [];
  if (typeof project.hasBUnit !== 'boolean') project.hasBUnit = false;
  if (!project.bUnit || typeof project.bUnit !== 'object') {
    project.bUnit = { dp: '', firstACName: '', secondACName: '', cameraTraineeName: '' };
  }
  project.productionDays.forEach(day => {
    if (!day || typeof day !== 'object') return;
    if (typeof day.prodDay !== 'string') day.prodDay = todayLocal();
    if (typeof day.expanded !== 'boolean') day.expanded = true;
    if (!Array.isArray(day.takes)) day.takes = [];
    day.takes.forEach(take => {
      if (!take || typeof take !== 'object') return;
      if (typeof take.takeNotes === 'string' && take.takeNotes.length > 2000) take.takeNotes = take.takeNotes.slice(0, 2000);
      if (typeof take.cameraNotes === 'string' && take.cameraNotes.length > 2000) take.cameraNotes = take.cameraNotes.slice(0, 2000);
      if (typeof take.lensSize !== 'string' || !LENS_OPTIONS.includes(take.lensSize)) take.lensSize = '50mm';
      if (typeof take.filter !== 'string') take.filter = 'None';
      if (typeof take.camera !== 'string' || !CAMERA_VARIANT_OPTIONS.includes(take.camera)) take.camera = 'Main camera';
      if (take.isGood !== true && take.isGood !== false && take.isGood !== null) take.isGood = null;
      if (typeof take.soft !== 'boolean') take.soft = false;
      if (typeof take.flare !== 'boolean') take.flare = false;
      if (typeof take.boomIn !== 'boolean') take.boomIn = false;
      if (typeof take.expanded !== 'boolean') take.expanded = false;
      if (typeof take.label !== 'string') take.label = '';
      if (take.label && take.label.length > 50) take.label = take.label.slice(0, 50);
    });
  });
  return project;
}

function debounceSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 180);
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function idbSet(key, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveState() {
  if (isSaving) {
    hasPendingSave = true;
    return;
  }

  isSaving = true;
  hasPendingSave = false;

  try {
    state.lastSavedAt = nowIso();
    await idbSet(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('Save failed:', error);
    showToast('Failed to save. Please try again.', 'error');
  } finally {
    isSaving = false;
  }

  if (hasPendingSave) {
    hasPendingSave = false;
    queueMicrotask(saveState);
  }
}

async function loadState() {
  isLoading = true;
  render();
  try {
    const raw = await idbGet(STORAGE_KEY);
    if (!raw) {
      state = deepClone(DEFAULT_STATE);
      await saveState();
      isLoading = false;
      return;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid state');
    state = {
      ...deepClone(DEFAULT_STATE),
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    };
    state.projects = state.projects.map(p => validateProject(p));
    if (!state.projects.some((project) => project.id === state.currentProjectId)) {
      state.currentProjectId = state.projects[0]?.id || null;
    }
  } catch {
    state = deepClone(DEFAULT_STATE);
    showToast('Could not load saved data. Starting fresh.', 'error');
  }
  isLoading = false;
  render();
}

function setTheme(theme) {
  state.settings.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1015' : '#f4f5f7');
  debounceSave();
}

function currentProject() {
  return state.projects.find((p) => p.id === state.currentProjectId) || null;
}

function baseProject() {
  return {
    id: uid('project'),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    projectName: '',
    prodCompany: '',
    dp: '',
    firstACName: '',
    secondACName: '',
    cameraTraineeName: '',
    hasBUnit: false,
    bUnit: { dp: '', firstACName: '', secondACName: '', cameraTraineeName: '' },
    director: '',
    camera: CAMERA_OPTIONS[0],
    customCamera: '',
    frameRate: FRAME_RATE_OPTIONS[1],
    lutUsed: 'No',
    lutName: '',
    extraNotes: '',
    productionDays: [],
  };
}

function baseProductionDay() {
  return {
    id: uid('day'),
    prodDay: todayLocal(),
    takes: [],
    expanded: true,
  };
}

function baseTake(project) {
  const lastDay = project.productionDays[project.productionDays.length - 1];
  const lastTake = lastDay && Array.isArray(lastDay.takes) ? lastDay.takes[lastDay.takes.length - 1] : undefined;
  return {
    id: uid('take'),
    lensSize: lastTake?.lensSize || '50mm',
    customLensSize: lastTake?.customLensSize || '',
    filter: lastTake?.filter || 'None',
    takeNotes: '',
    cameraNotes: '',
    camera: 'Main camera',
    customCamera: '',
    isGood: null,
    soft: false,
    flare: false,
    boomIn: false,
    expanded: false,
    label: '',
    createdAt: nowIso(),
  };
}

function updateProject(projectId, updater, options = { render: true }) {
  state.projects = state.projects.map((project) => {
    if (project.id !== projectId) return project;
    const updated = updater(deepClone(project));
    updated.updatedAt = nowIso();
    return updated;
  });
  debounceSave();
  if (options.render) render();
}

function addProject() {
  const project = baseProject();
  state.projects.unshift(project);
  state.currentProjectId = project.id;
  debounceSave();
  render();
}

function duplicateProject(projectId) {
  const original = state.projects.find((p) => p.id === projectId);
  if (!original) return;
  const copy = deepClone(original);
  copy.id = uid('project');
  copy.projectName = `${original.projectName || 'Untitled Project'} Copy`;
  copy.createdAt = nowIso();
  copy.updatedAt = nowIso();
  copy.productionDays = copy.productionDays.map((day) => ({
    ...day,
    id: uid('day'),
    takes: day.takes.map((take) => ({ ...take, id: uid('take') })),
  }));
  state.projects.unshift(copy);
  state.currentProjectId = copy.id;
  debounceSave();
  render();
}

function deleteProject(projectId) {
  state.projects = state.projects.filter((p) => p.id !== projectId);
  if (state.currentProjectId === projectId) {
    state.currentProjectId = null;
  }
  debounceSave();
  render();
}

function addProductionDay(projectId) {
  updateProject(projectId, (project) => {
    project.productionDays.push(baseProductionDay());
    return project;
  });
}

function duplicateProductionDay(projectId, dayId) {
  updateProject(projectId, (project) => {
    const day = project.productionDays.find((d) => d.id === dayId);
    if (!day) return project;
    const copy = deepClone(day);
    copy.id = uid('day');
    copy.expanded = false;
    copy.takes = copy.takes.map((take) => ({ ...take, id: uid('take'), createdAt: nowIso(), expanded: false }));
    const idx = project.productionDays.findIndex((d) => d.id === dayId);
    project.productionDays.splice(idx + 1, 0, copy);
    return project;
  });
}

function deleteProductionDay(projectId, dayId) {
  updateProject(projectId, (project) => {
    project.productionDays = project.productionDays.filter((d) => d.id !== dayId);
    return project;
  });
}

function addTake(projectId, dayId) {
  updateProject(projectId, (project) => {
    const day = project.productionDays.find((d) => d.id === dayId);
    if (!day) return project;
    day.takes.unshift(baseTake(project));
    return project;
  });
}

function duplicateTake(projectId, dayId, takeId) {
  updateProject(projectId, (project) => {
    const day = project.productionDays.find((d) => d.id === dayId);
    const take = day?.takes.find((t) => t.id === takeId);
    if (!take || !day) return project;
    const copy = deepClone(take);
    copy.id = uid('take');
    copy.createdAt = nowIso();
    copy.expanded = false;
    copy.label = 'Copy';
    const idx = day.takes.findIndex((t) => t.id === takeId);
    day.takes.splice(idx + 1, 0, copy);
    return project;
  });
}

function deleteTake(projectId, dayId, takeId) {
  updateProject(projectId, (project) => {
    const day = project.productionDays.find((d) => d.id === dayId);
    if (!day) return project;
    day.takes = day.takes.filter((t) => t.id !== takeId);
    return project;
  });
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function safeFilename(parts, ext) {
  const base = parts.filter(Boolean).join('_').trim() || 'AC_App_Export';
  return `${base.replace(/[^a-z0-9_-]+/gi, '_').replace(/_+/g, '_')}.${ext}`;
}

function exportProjectJson(project) {
  const filename = safeFilename([project.projectName, project.prodCompany], 'json');
  downloadBlob(filename, JSON.stringify(project, null, 2), 'application/json');
}

function backupAll() {
  const backup = {
    exportedAt: nowIso(),
    app: 'AC App',
    version: APP_VERSION,
    projects: state.projects,
  };
  downloadBlob(safeFilename(['AC_App_Backup', todayLocal()], 'json'), JSON.stringify(backup, null, 2), 'application/json');
}

function restoreFromFile(file) {
  if (!file || !(file instanceof File)) {
    showToast('Invalid file selected.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File too large. Maximum size is 10MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const result = String(reader.result);
      if (!result.trim()) throw new Error('Empty file');
      const parsed = JSON.parse(result);
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid format');
      
      if (Array.isArray(parsed.projects)) {
        state.projects = parsed.projects.map(p => validateProject(p));
        state.currentProjectId = state.projects[0]?.id || null;
      } else if (parsed.id && typeof parsed.projectName === 'string') {
        const validated = validateProject(parsed);
        if (validated) {
          validated.id = uid('project');
          state.projects.unshift(validated);
        } else {
          throw new Error('Invalid project');
        }
      } else {
        throw new Error('Invalid backup file');
      }
      if (!state.currentProjectId && state.projects[0]) state.currentProjectId = state.projects[0].id;
      await saveState();
      showToast('Backup restored successfully.');
    } catch (err) {
      showToast('This file could not be restored.', 'error');
    }
  };
  reader.onerror = () => showToast('Failed to read file.', 'error');
  reader.readAsText(file);
}

function pdfEscape(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildProjectReportLines(project) {
  const lines = [];
  lines.push(`Project: ${project.projectName || '-'}`);
  lines.push(`Prod. Company: ${project.prodCompany || '-'}`);
  lines.push(`Director: ${project.director || '-'}`);
  lines.push(`DP: ${project.dp || '-'}`);
  lines.push(`1st AC: ${project.firstACName || '-'}`);
  lines.push(`2nd AC: ${project.secondACName || '-'}`);
  lines.push(`Camera trainee: ${project.cameraTraineeName || '-'}`);
  lines.push(`Camera: ${project.camera === 'Custom' ? project.customCamera || 'Custom' : project.camera || '-'}`);
  lines.push(`Frame rate: ${project.frameRate || '-'}`);
  lines.push(`LUT: ${project.lutUsed === 'Yes' ? (project.lutName || 'Yes') : 'No'}`);
  lines.push(`B Unit: ${project.hasBUnit ? 'Yes' : 'No'}`);
  if (project.hasBUnit) {
    lines.push(`B Unit DP: ${project.bUnit.dp || '-'}`);
    lines.push(`B Unit 1st AC: ${project.bUnit.firstACName || '-'}`);
    lines.push(`B Unit 2nd AC: ${project.bUnit.secondACName || '-'}`);
    lines.push(`B Unit trainee: ${project.bUnit.cameraTraineeName || '-'}`);
  }
  if (project.extraNotes) {
    lines.push('');
    lines.push('Project notes:');
    wrapText(project.extraNotes, 92).forEach((line) => lines.push(line));
  }
  lines.push('');
  lines.push(`Production days: ${project.productionDays.length}`);
  lines.push('');
  project.productionDays.forEach((day, dayIndex) => {
    lines.push(`Day ${dayIndex + 1}  |  Date: ${day.prodDay || '-'}`);
    if (!day.takes.length) {
      lines.push('  No takes logged');
      lines.push('');
      return;
    }
    day.takes.forEach((take, takeIndex) => {
      const lens = take.lensSize === 'Custom' ? take.customLensSize || 'Custom' : take.lensSize || '-';
      const camera = take.camera === 'Custom' ? take.customCamera || 'Custom' : take.camera || '-';
      const goodMark = take.isGood === true ? ' [GOOD]' : take.isGood === false ? ' [NO GOOD]' : '';
      const flags = [take.soft ? 'Soft' : '', take.flare ? 'Flare' : '', take.boomIn ? 'Boom in' : ''].filter(Boolean).join(', ');
      const flagStr = flags ? ` [${flags}]` : '';
      lines.push(`  Take ${takeIndex + 1} | Lens: ${lens} | Filter: ${take.filter || '-'} | Camera: ${camera}${goodMark}${flagStr}`);
      if (take.takeNotes) wrapText(`Take notes: ${take.takeNotes}`, 88).forEach((line) => lines.push(`    ${line}`));
      if (take.cameraNotes) wrapText(`Camera notes: ${take.cameraNotes}`, 88).forEach((line) => lines.push(`    ${line}`));
      lines.push(`    Logged: ${new Date(take.createdAt || nowIso()).toLocaleString()}`);
    });
    lines.push('');
  });
  return lines;
}

function wrapText(text, max = 90) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createSimplePdf(lines, title) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 40;
  const top = 52;
  const bottom = 50;
  const lineHeight = 14;
  const linesPerPage = Math.floor((pageHeight - top - bottom) / lineHeight);
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) pages.push(lines.slice(i, i + linesPerPage));

  const objects = [];
  const offsets = [];
  const pushObj = (content) => { objects.push(content); return objects.length; };

  const fontObj = pushObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];
  const contentIds = [];
  pages.forEach((pageLines, index) => {
    const textParts = [];
    let y = pageHeight - top;
    textParts.push('BT');
    textParts.push('/F1 11 Tf');
    textParts.push(`1 0 0 1 ${marginX} ${y} Tm`);
    textParts.push(`(${pdfEscape(title)}) Tj`);
    y -= lineHeight * 1.6;
    textParts.push(`/F1 9.5 Tf`);
    pageLines.forEach((line) => {
      textParts.push(`1 0 0 1 ${marginX} ${y} Tm`);
      textParts.push(`(${pdfEscape(line)}) Tj`);
      y -= lineHeight;
    });
    textParts.push('ET');
    const stream = textParts.join('\n');
    const contentId = pushObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    pageIds.push(null);
  });

  const pagesRootIdPlaceholder = objects.length + 1 + pages.length;
  pages.forEach((_, idx) => {
    const pageObj = `<< /Type /Page /Parent ${pagesRootIdPlaceholder} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentIds[idx]} 0 R >>`;
    const pageId = pushObj(pageObj);
    pageIds[idx] = pageId;
  });
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ');
  const pagesRootId = pushObj(`<< /Type /Pages /Kids [${kids}] /Count ${pageIds.length} >>`);
  const catalogId = pushObj(`<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  objects.forEach((obj, idx) => {
    offsets[idx + 1] = pdf.length;
    pdf += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

function exportProjectPdf(project) {
  const lines = buildProjectReportLines(project);
  const title = `${project.projectName || 'Untitled Project'} Report`;
  const pdf = createSimplePdf(lines, title);
  const filename = safeFilename([project.projectName, project.prodCompany, 'Report'], 'pdf');
  downloadBlob(filename, pdf, 'application/pdf');
}

function projectStats(project) {
  const days = project.productionDays.length;
  const takes = project.productionDays.reduce((sum, day) => sum + day.takes.length, 0);
  const goodTakes = project.productionDays.reduce((sum, day) => sum + day.takes.filter(t => t.isGood === true).length, 0);
  const noGoodTakes = project.productionDays.reduce((sum, day) => sum + day.takes.filter(t => t.isGood === false).length, 0);
  return { days, takes, goodTakes, noGoodTakes };
}

function formatDateTime(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

async function confirmAction({ title, message, confirmText = 'Confirm', requireText = '' }) {
  const dialog = document.getElementById('confirmDialog');
  const titleEl = document.getElementById('confirmTitle');
  const messageEl = document.getElementById('confirmMessage');
  const inputWrap = document.getElementById('confirmInputWrap');
  const input = document.getElementById('confirmInput');
  const inputLabel = document.getElementById('confirmInputLabel');
  const accept = document.getElementById('confirmAccept');

  titleEl.textContent = title;
  messageEl.textContent = message;
  accept.textContent = confirmText;
  input.value = '';
  if (requireText) {
    inputWrap.classList.remove('hidden');
    inputLabel.textContent = `Type ${requireText} to confirm`;
  } else {
    inputWrap.classList.add('hidden');
  }

  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', function onClose() {
      dialog.removeEventListener('close', onClose);
      const ok = dialog.returnValue === 'confirm' && (!requireText || input.value === requireText);
      resolve(ok);
    }, { once: true });
  });
}

function homeView() {
  const projectsHtml = state.projects.map((project) => {
    const stats = projectStats(project);
    return `
      <article class="card project-card">
        <div class="section-head">
          <div>
            <h3>${escapeHtml(project.projectName || 'Untitled Project')}</h3>
            <p class="muted">${escapeHtml(project.prodCompany || 'No production company')}</p>
          </div>
          <div class="mini-meta">
            <span class="pill">${stats.days} day${stats.days === 1 ? '' : 's'}</span>
            <span class="pill">${stats.takes} take${stats.takes === 1 ? '' : 's'}</span>
            ${stats.goodTakes > 0 ? `<span class="pill good">✓ ${stats.goodTakes}</span>` : ''}
            ${stats.noGoodTakes > 0 ? `<span class="pill bad">✗ ${stats.noGoodTakes}</span>` : ''}
          </div>
        </div>
        <div class="project-meta">
          <span class="pill">DP: ${escapeHtml(project.dp || '-')}</span>
          <span class="pill">2nd AC: ${escapeHtml(project.secondACName || '-')}</span>
          <span class="pill">Cam: ${escapeHtml(project.camera === 'Custom' ? project.customCamera || 'Custom' : project.camera || '-')}</span>
        </div>
        <div class="actions">
          <button class="button primary" data-action="open-project" data-project-id="${project.id}">Open</button>
          <button class="button" data-action="duplicate-project" data-project-id="${project.id}">Duplicate</button>
          <button class="button" data-action="export-project" data-project-id="${project.id}">Save to device</button>
          <button class="button" data-action="report-project" data-project-id="${project.id}">PDF report</button>
          <button class="button danger" data-action="delete-project" data-project-id="${project.id}">Delete</button>
        </div>
      </article>
    `;
  }).join('');

  const saveStatus = isSaving 
    ? '<span class="save-indicator saving">Saving...</span>' 
    : `<span class="save-indicator">Saved ${formatDateTime(state.lastSavedAt)}</span>`;

  return `
    <div class="app-shell stack">
      <header class="topbar">
        <div class="brand">
          <div class="brand-badge" aria-hidden="true">
            <img src="icons/icon.svg" alt="" width="42" height="42" />
          </div>
          <div class="brand-text">
            <h1>AC App</h1>
            <p>Fast local note logging for 2nd ACs</p>
          </div>
        </div>
        <div class="actions">
          <div class="segmented" aria-label="Theme selector">
            <button type="button" data-action="theme" data-theme="light" class="${state.settings.theme === 'light' ? 'active' : ''}">Light</button>
            <button type="button" data-action="theme" data-theme="dark" class="${state.settings.theme === 'dark' ? 'active' : ''}">Dark</button>
          </div>
          <button class="button" data-action="open-guide">Guide</button>
        </div>
      </header>

      <section class="card stack">
        <div class="section-head">
          <div>
            <h2>Projects</h2>
            <p class="helper">${saveStatus}</p>
          </div>
          <div class="actions">
            <button class="button primary" data-action="add-project" data-focus>Add new project</button>
          </div>
        </div>
        <div class="actions">
          <button class="button" data-action="backup-all">Backup all</button>
          <button class="button" data-action="restore-all">Restore backup</button>
          <button class="button danger" data-action="reset-all">Reset all</button>
        </div>
      </section>

      ${state.projects.length ? projectsHtml : `
        <div class="empty">
          <p>No projects yet. Create your first project to start logging production days and takes.</p>
          <button class="button primary" data-action="add-project" style="margin-top: 16px;">Create your first project</button>
        </div>
      `}
    </div>
  `;
}

function projectView(project) {
  return `
    <div class="app-shell stack">
      <header class="topbar">
        <div class="brand">
          <button class="icon-button" data-action="go-home" aria-label="Back">←</button>
          <div class="brand-text">
            <h1>${escapeHtml(project.projectName || 'Untitled Project')}</h1>
            <p>${escapeHtml(project.prodCompany || 'No production company')} · Saved ${formatDateTime(state.lastSavedAt)}</p>
          </div>
        </div>
        <div class="actions">
          <button class="button" data-action="project-guide">Guide</button>
        </div>
      </header>

      <section class="card stack">
        <div class="section-head">
          <h2>Project details</h2>
          <div class="actions">
            <button class="button" data-action="duplicate-project" data-project-id="${project.id}">Duplicate project</button>
            <button class="button" data-action="export-project" data-project-id="${project.id}">Save to device</button>
            <button class="button" data-action="report-project" data-project-id="${project.id}">PDF report</button>
          </div>
        </div>

        <div class="grid">
          ${textField('projectName', 'Project name', project.projectName)}
          ${textField('prodCompany', 'Prod. Company', project.prodCompany)}
          ${textField('dp', 'DP', project.dp)}
          ${textField('firstACName', '1st AC name', project.firstACName)}
          ${textField('secondACName', '2nd AC name', project.secondACName)}
          ${textField('cameraTraineeName', 'Camera trainee name', project.cameraTraineeName)}
          ${textField('director', 'Director', project.director)}
          ${selectField('camera', 'Camera', CAMERA_OPTIONS.concat('Custom'), project.camera)}
        </div>

        ${project.camera === 'Custom' ? `<div class="grid">${textField('customCamera', 'Custom camera', project.customCamera)}</div>` : ''}

        <div class="grid three">
          ${selectField('frameRate', 'Frame rate', FRAME_RATE_OPTIONS, project.frameRate)}
          ${selectField('lutUsed', 'LUT used', LUT_OPTIONS, project.lutUsed)}
          ${project.lutUsed === 'Yes' ? textField('lutName', 'LUT name', project.lutName) : '<div></div>'}
        </div>

        <label class="field">
          <span>B Unit</span>
          <select data-role="project-field" data-project-id="${project.id}" data-key="hasBUnit">
            <option value="false" ${!project.hasBUnit ? 'selected' : ''}>No</option>
            <option value="true" ${project.hasBUnit ? 'selected' : ''}>Yes</option>
          </select>
        </label>

        ${project.hasBUnit ? `
          <div class="card stack">
            <div class="section-head"><h3>B Unit</h3></div>
            <div class="grid">
              ${textField('bUnit.dp', 'B Unit DP', project.bUnit.dp, project.id)}
              ${textField('bUnit.firstACName', 'B Unit 1st AC name', project.bUnit.firstACName, project.id)}
              ${textField('bUnit.secondACName', 'B Unit 2nd AC name', project.bUnit.secondACName, project.id)}
              ${textField('bUnit.cameraTraineeName', 'B Unit camera trainee name', project.bUnit.cameraTraineeName, project.id)}
            </div>
          </div>
        ` : ''}

        <label class="field">
          <span>Extra notes</span>
          <textarea data-role="project-field" data-project-id="${project.id}" data-key="extraNotes">${escapeHtml(project.extraNotes)}</textarea>
        </label>
      </section>

      <section class="card stack">
        <div class="section-head">
          <div>
            <h2>Production days</h2>
            <p class="helper">Add a day, then log takes quickly underneath it.</p>
          </div>
          <button class="button primary" data-action="add-day" data-project-id="${project.id}">Add production day</button>
        </div>

        ${project.productionDays.length ? project.productionDays.map((day, index) => productionDayHtml(project, day, index)).join('') : '<div class="empty">No production days yet.</div>'}
      </section>

      <div class="footer-actions">
        <button class="button ghost" data-action="go-home">Projects</button>
        <button class="button" data-action="export-project" data-project-id="${project.id}">Save JSON</button>
        <button class="button primary" data-action="report-project" data-project-id="${project.id}">Export PDF</button>
      </div>
    </div>
  `;
}

function textField(key, label, value, projectId = null) {
  return `
    <label class="field">
      <span>${label}</span>
      <input type="text" value="${escapeHtml(value || '')}" data-role="project-field" data-project-id="${projectId || currentProject().id}" data-key="${key}" autocomplete="off" />
    </label>
  `;
}

function selectField(key, label, options, value) {
  return `
    <label class="field">
      <span>${label}</span>
      <select data-role="project-field" data-project-id="${currentProject().id}" data-key="${key}">
        ${options.map((item) => `<option value="${escapeHtml(item)}" ${item === value ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
      </select>
    </label>
  `;
}

function productionDayHtml(project, day, index) {
  const dayGood = day.takes.filter(t => t.isGood === true).length;
  const dayNoGood = day.takes.filter(t => t.isGood === false).length;
  const isExpanded = day.expanded !== false;
  return `
    <article class="day-card stack${isExpanded ? ' expanded' : ''}" data-project-id="${project.id}" data-day-id="${day.id}">
      <div class="day-head" data-action="toggle-day">
        <div>
          <p class="day-title">Production day ${index + 1} <span class="collapse-icon">${isExpanded ? '−' : '+'}</span></p>
          <p class="muted">
            ${day.takes.length} take${day.takes.length === 1 ? '' : 's'}
            ${dayGood > 0 ? ` · <span class="good-count">✓ ${dayGood}</span>` : ''}
            ${dayNoGood > 0 ? ` · <span class="nogood-count">✗ ${dayNoGood}</span>` : ''}
          </p>
        </div>
        <div class="actions">
          <button type="button" class="button" data-action="duplicate-day">Duplicate</button>
          <button type="button" class="button danger" data-action="delete-day">Delete</button>
        </div>
      </div>

      <div class="day-content"${isExpanded ? '' : ' hidden'}>
        <div class="grid">
          <label class="field">
            <span>Prod day (date)</span>
            <input type="date" value="${escapeHtml(day.prodDay || '')}" data-role="day-field" data-project-id="${project.id}" data-day-id="${day.id}" data-key="prodDay" />
          </label>
        </div>

        <div class="section-head">
          <h4>Takes</h4>
          <button type="button" class="button primary" data-action="add-take" data-project-id="${project.id}" data-day-id="${day.id}">Add new take</button>
        </div>

        ${day.takes.length ? day.takes.map((take, takeIndex) => takeHtml(project, day, take, takeIndex)).join('') : '<div class="empty">No takes for this day yet.</div>'}
      </div>
    </article>
  `;
}

function takeHtml(project, day, take, takeIndex) {
  const lensSummary = take.lensSize === 'Custom' ? (take.customLensSize || 'Custom') : take.lensSize;
  const filterSummary = take.filter || 'None';
  const goodLabel = take.isGood === true ? '✓' : take.isGood === false ? '✗' : '';
  const tagsSummary = [goodLabel, take.soft ? 'Soft' : '', take.flare ? 'Flare' : '', take.boomIn ? 'Boom' : ''].filter(Boolean).join(' · ');
  const isExpanded = take.expanded !== false;
  const takeTitle = take.label ? `Take ${takeIndex + 1}: ${escapeHtml(take.label)}` : `Take ${takeIndex + 1}`;
  
  return `
    <article class="take-card stack${isExpanded ? ' expanded' : ''}" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}">
      <div class="take-head" data-action="toggle-take">
        <div>
          <p class="take-title">${takeTitle} <span class="take-summary">${escapeHtml(lensSummary)} · ${escapeHtml(filterSummary)}${tagsSummary ? ' · ' + tagsSummary : ''}</span></p>
        </div>
        <div class="actions take-actions">
          <button type="button" class="icon-button collapse-btn" data-action="toggle-take" aria-label="Toggle take">
            <span class="collapse-icon">${isExpanded ? '−' : '+'}</span>
          </button>
          <button type="button" class="button" data-action="duplicate-take">Duplicate</button>
          <button type="button" class="button danger" data-action="delete-take">Delete</button>
        </div>
      </div>

      <div class="take-content"${isExpanded ? '' : ' hidden'}>
        <label class="field">
          <span>Take label (optional)</span>
          <input type="text" value="${escapeHtml(take.label || '')}" data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="label" placeholder="e.g. Copy, Wide, Close-up" autocomplete="off" />
        </label>

        <div class="grid">
          <label class="field">
            <span>Lens size</span>
            <select data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="lensSize">
              ${LENS_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${take.lensSize === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
            </select>
          </label>

          <label class="field">
            <span>Filter</span>
            <select data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="filter">
              ${FILTER_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${take.filter === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
            </select>
          </label>
        </div>

        ${take.lensSize === 'Custom' ? `
          <div class="grid">
            <label class="field">
              <span>Custom lens size</span>
              <input type="text" value="${escapeHtml(take.customLensSize || '')}" data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="customLensSize" />
            </label>
          </div>
        ` : ''}

        <div class="grid">
          <label class="field">
            <span>Camera</span>
            <select data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="camera">
              ${CAMERA_VARIANT_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${take.camera === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
            </select>
          </label>
          ${take.camera === 'Custom' ? `
            <label class="field">
              <span>Custom camera</span>
              <input type="text" value="${escapeHtml(take.customCamera || '')}" data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="customCamera" />
            </label>
          ` : '<div></div>'}
        </div>

        <div class="take-tags">
          <span class="field-label">Status</span>
          <div class="tag-buttons">
            <button type="button" class="tag-btn ${take.isGood === true ? 'active good' : ''}" data-action="toggle-good" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-value="true">Good</button>
            <button type="button" class="tag-btn ${take.isGood === false ? 'active bad' : ''}" data-action="toggle-good" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-value="false">No Good</button>
            <button type="button" class="tag-btn ${take.soft ? 'active warning' : ''}" data-action="toggle-tag" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="soft">Soft</button>
            <button type="button" class="tag-btn ${take.flare ? 'active warning' : ''}" data-action="toggle-tag" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="flare">Flare</button>
            <button type="button" class="tag-btn ${take.boomIn ? 'active warning' : ''}" data-action="toggle-tag" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="boomIn">Boom in</button>
          </div>
        </div>

        <label class="field">
          <span>Take notes</span>
          <textarea data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="takeNotes">${escapeHtml(take.takeNotes || '')}</textarea>
        </label>

        <label class="field">
          <span>Camera notes</span>
          <textarea data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="cameraNotes">${escapeHtml(take.cameraNotes || '')}</textarea>
        </label>
      </div>
    </article>
  `;
}

function render() {
  document.documentElement.dataset.theme = state.settings.theme;
  const project = currentProject();
  
  if (isLoading) {
    app.innerHTML = loadingView();
    return;
  }
  
  app.innerHTML = project ? projectView(project) : homeView();
  requestAnimationFrame(() => {
    const focusTarget = app.querySelector('[data-focus]');
    if (focusTarget) focusTarget.focus();
  });
}

function loadingView() {
  return `
    <div class="loading-view">
      <div class="loading-spinner">
        <svg viewBox="0 0 50 50" class="spinner-svg">
          <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-dasharray="80, 200"/>
        </svg>
      </div>
      <p>Loading your projects...</p>
    </div>
  `;
}

function setPathValue(obj, path, value) {
  const keys = path.split('.');
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    target = target[keys[i]];
  }
  target[keys[keys.length - 1]] = value;
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const projectId = target.dataset.projectId || target.closest('[data-project-id]')?.dataset.projectId;
  const dayId = target.dataset.dayId || target.closest('[data-day-id]')?.dataset.dayId;
  const takeId = target.dataset.takeId || target.closest('[data-take-id]')?.dataset.takeId;

  if (action === 'add-project') addProject();
  if (action === 'open-project') { state.currentProjectId = projectId; render(); debounceSave(); }
  if (action === 'go-home') { state.currentProjectId = null; render(); debounceSave(); }
  if (action === 'theme') setTheme(target.dataset.theme);
  if (action === 'open-guide' || action === 'project-guide') document.getElementById('guideDialog').showModal();
  if (action === 'duplicate-project') duplicateProject(projectId);
  if (action === 'export-project') { const project = state.projects.find((p) => p.id === projectId); if (project) exportProjectJson(project); }
  if (action === 'report-project') { const project = state.projects.find((p) => p.id === projectId); if (project) exportProjectPdf(project); }
  if (action === 'backup-all') backupAll();
  if (action === 'restore-all') filePicker.click();
  if (action === 'delete-project') {
    const ok = await confirmAction({ title: 'Delete project', message: 'This will remove the project from local storage. Export a backup first if needed.', confirmText: 'Delete' });
    if (ok) deleteProject(projectId);
  }
  if (action === 'reset-all') {
    const ok = await confirmAction({ title: 'Reset all data', message: 'This permanently removes every stored project from this device.', confirmText: 'Erase all', requireText: 'RESET' });
    if (ok) {
      state = deepClone(DEFAULT_STATE);
      await saveState();
      render();
      showToast('All data has been reset.');
    } else if (document.getElementById('confirmInput').value !== 'RESET') {
      showToast('Reset cancelled. Type RESET to confirm.');
    }
  }
  if (action === 'add-day') addProductionDay(projectId);
  if (action === 'toggle-day') {
    const card = target.closest('.day-card');
    const content = card?.querySelector('.day-content');
    const icon = card?.querySelector('.collapse-icon');
    if (content) {
      const isHidden = content.hidden;
      const willExpand = isHidden;
      content.hidden = !isHidden;
      if (icon) icon.textContent = willExpand ? '−' : '+';
      card.classList.toggle('expanded', willExpand);
      updateProject(projectId, (project) => {
        const day = project.productionDays.find((d) => d.id === dayId);
        if (day) day.expanded = willExpand;
        return project;
      }, { render: false });
    }
  }
  if (action === 'duplicate-day') duplicateProductionDay(projectId, dayId);
  if (action === 'delete-day') {
    const ok = await confirmAction({ title: 'Delete production day', message: 'This removes the day and all takes inside it.', confirmText: 'Delete' });
    if (ok) deleteProductionDay(projectId, dayId);
  }
  if (action === 'add-take') addTake(projectId, dayId);
  if (action === 'toggle-take') {
    const card = target.closest('.take-card');
    const content = card?.querySelector('.take-content');
    const icon = card?.querySelector('.collapse-icon');
    if (content) {
      const isHidden = content.hidden;
      const willExpand = isHidden;
      content.hidden = !isHidden;
      if (icon) icon.textContent = willExpand ? '−' : '+';
      card.classList.toggle('expanded', willExpand);
      updateProject(projectId, (project) => {
        const day = project.productionDays.find((d) => d.id === dayId);
        const take = day?.takes.find((t) => t.id === takeId);
        if (take) take.expanded = willExpand;
        return project;
      }, { render: false });
    }
  }
  if (action === 'toggle-good') {
    const value = target.dataset.value === 'true';
    updateProject(projectId, (project) => {
      const day = project.productionDays.find((d) => d.id === dayId);
      const take = day?.takes.find((t) => t.id === takeId);
      if (take) take.isGood = take.isGood === value ? null : value;
      return project;
    });
  }
  if (action === 'toggle-tag') {
    const key = target.dataset.key;
    updateProject(projectId, (project) => {
      const day = project.productionDays.find((d) => d.id === dayId);
      const take = day?.takes.find((t) => t.id === takeId);
      if (take && key in take) take[key] = !take[key];
      return project;
    });
  }
  if (action === 'duplicate-take') duplicateTake(projectId, dayId, takeId);
  if (action === 'delete-take') {
    const ok = await confirmAction({ title: 'Delete take', message: 'This removes the selected take.', confirmText: 'Delete' });
    if (ok) deleteTake(projectId, dayId, takeId);
  }
});

document.addEventListener('input', (event) => {
  const el = event.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
  const role = el.dataset.role;
  if (!role) return;

  if (role === 'project-field') {
    const projectId = el.dataset.projectId;
    const key = el.dataset.key;
    let value = el.value;
    if (key === 'hasBUnit') value = value === 'true';
    const shouldRender = ['camera', 'lutUsed', 'hasBUnit'].includes(key);
    updateProject(projectId, (project) => {
      setPathValue(project, key, value);
      if (key === 'lutUsed' && value === 'No') project.lutName = '';
      if (key === 'camera' && value !== 'Custom') project.customCamera = '';
      if (key === 'hasBUnit' && !value) project.bUnit = { dp: '', firstACName: '', secondACName: '', cameraTraineeName: '' };
      return project;
    }, { render: shouldRender });
    return;
  }

  if (role === 'day-field') {
    const { projectId, dayId, key } = el.dataset;
    updateProject(projectId, (project) => {
      const day = project.productionDays.find((d) => d.id === dayId);
      if (day) day[key] = el.value;
      return project;
    }, { render: false });
    return;
  }

  if (role === 'take-field') {
    const { projectId, dayId, takeId, key } = el.dataset;
    const shouldRender = ['lensSize', 'camera'].includes(key);
    updateProject(projectId, (project) => {
      const day = project.productionDays.find((d) => d.id === dayId);
      const take = day?.takes.find((t) => t.id === takeId);
      if (!take) return project;
      take[key] = el.value;
      if (key === 'lensSize' && el.value !== 'Custom') take.customLensSize = '';
      if (key === 'camera' && el.value !== 'Custom') take.customCamera = '';
      return project;
    }, { render: shouldRender });
  }
});

filePicker.addEventListener('change', () => {
  const file = filePicker.files?.[0];
  if (file) restoreFromFile(file);
  filePicker.value = '';
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');

      const promptWorkerToActivate = (worker) => {
        if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
      };

      if (registration.waiting) promptWorkerToActivate(registration.waiting);

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
        installingWorker.addEventListener('statechange', () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            promptWorkerToActivate(registration.waiting || installingWorker);
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
    } catch {
      // Service worker registration failed.
    }
  });
}

async function init() {
  try {
    await loadState();
    document.documentElement.dataset.theme = state.settings.theme;
    render();
  } catch (error) {
    console.error('App failed to start:', error);
    if (app) {
      app.innerHTML = `
        <div class="loading-view">
          <div class="card" style="max-width:640px;text-align:left;">
            <h2 style="margin-top:0;">App could not start</h2>
            <p>Please hard refresh once. If this still happens, remove the old installed app and reopen the latest version.</p>
            <p><strong>Error:</strong> ${escapeHtml(error && error.message ? error.message : 'Unknown startup error')}</p>
          </div>
        </div>
      `;
    }
  }
}

init();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const dialogs = document.querySelectorAll('dialog[open]');
    dialogs.forEach(d => d.close());
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    if (state.currentProjectId) {
      const project = currentProject();
      if (project) {
        exportProjectJson(project);
        showToast('Project saved to device.');
      }
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !state.currentProjectId) {
    e.preventDefault();
    addProject();
    showToast('New project created.');
  }
});
