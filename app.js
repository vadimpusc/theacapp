const DB_NAME = 'ac-app-db';
const STORE_NAME = 'keyval';
const STORAGE_KEY = 'ac-app-state';
const APP_VERSION = '2.5.0';

const CAMERA_OPTIONS = [
  'Alexa Mini', 'Alexa Mini LF', 'Alexa 35', 'RED Epic', 'RED V-Raptor', 'RED Komodo',
  'Sony Venice', 'Sony FX6', 'Sony FX9', 'Canon C300', 'Canon C500', 'Blackmagic URSA Mini Pro'
];
const FRAME_RATE_OPTIONS = ['23.976', '24', '25', '29.97', '30', '48', '50', '59.94', '60'];
const LUT_OPTIONS = ['No', 'Yes'];
const FILTER_OPTIONS = ['None', 'ND .3', 'ND .6', 'ND .9', 'ND 1.2', 'Polarizer', 'Black Pro-Mist 1/8', 'Black Pro-Mist 1/4', 'Custom'];
const LENS_OPTIONS = ['14mm', '18mm', '21mm', '24mm', '25mm', '27mm', '32mm', '35mm', '40mm', '50mm', '65mm', '75mm', '85mm', '100mm', '135mm', 'Custom'];
const LENS_SPEED_OPTIONS = ['T1.3', 'T1.4', 'T1.5', 'T1.7', 'T1.8', 'T2', 'T2.3', 'T2.5', 'T2.8', 'T3.5', 'T4', 'T4.4', 'T5.6', 'Custom'];
const CAMERA_VARIANT_OPTIONS = ['Main camera', 'A Cam', 'B Cam', 'Custom'];

const DEFAULT_STATE = {
  version: 1,
  settings: { theme: 'light' },
  projects: [],
  currentProjectId: null,
  lastSavedAt: null,
  focusTakeId: null,
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
      if (typeof take.scene === 'string' && take.scene && !take.sceneNumber) {
        take.sceneNumber = take.scene;
        delete take.scene;
      }
      if (typeof take.sceneNumber !== 'string') take.sceneNumber = '';
      if (take.sceneNumber && take.sceneNumber.length > 20) take.sceneNumber = take.sceneNumber.slice(0, 20);
      if (typeof take.setupLetter !== 'string') take.setupLetter = '';
      if (take.setupLetter && take.setupLetter.length > 10) take.setupLetter = take.setupLetter.slice(0, 10);
      if (typeof take.takeNumber !== 'number' || isNaN(take.takeNumber)) take.takeNumber = 1;
      if (take.takeNumber < 1) take.takeNumber = 1;
      if (typeof take.lensSize !== 'string' || !LENS_OPTIONS.includes(take.lensSize)) take.lensSize = '50mm';
      if (typeof take.lensSpeed !== 'string' || !LENS_SPEED_OPTIONS.includes(take.lensSpeed)) take.lensSpeed = 'T2.8';
      if (typeof take.filter !== 'string') take.filter = 'None';
      if (typeof take.camera !== 'string' || !CAMERA_VARIANT_OPTIONS.includes(take.camera)) take.camera = 'Main camera';
      if (typeof take.status !== 'string') {
        if (take.isGood === true) take.status = 'good';
        else if (take.isGood === false) take.status = 'nogood';
        else take.status = '';
        delete take.isGood;
      }
      if (!['good', 'nogood', 'soft', 'flare', 'boom', ''].includes(take.status)) take.status = '';
      if (take.status === 'soft' && typeof take.soft !== 'boolean') take.soft = true;
      if (take.status === 'flare' && typeof take.flare !== 'boolean') take.flare = true;
      if (take.status === 'boom' && typeof take.boomIn !== 'boolean') take.boomIn = true;
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
  const nextTakeNum = lastTake ? (Number(lastTake.takeNumber) || 0) + 1 : 1;
  return {
    id: uid('take'),
    sceneNumber: lastTake?.sceneNumber || '',
    setupLetter: lastTake?.setupLetter || '',
    takeNumber: nextTakeNum,
    lensSize: lastTake?.lensSize || '50mm',
    customLensSize: lastTake?.customLensSize || '',
    lensSpeed: lastTake?.lensSpeed || 'T2.8',
    customLensSpeed: lastTake?.customLensSpeed || '',
    filter: lastTake?.filter || 'None',
    takeNotes: '',
    cameraNotes: '',
    camera: 'Main camera',
    customCamera: '',
    status: '',
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
  const newTakeId = uid('take');
  state.focusTakeId = newTakeId;
  updateProject(projectId, (project) => {
    const day = project.productionDays.find((d) => d.id === dayId);
    if (!day) return project;
    const newTake = baseTake(project);
    newTake.id = newTakeId;
    newTake.expanded = true;
    day.takes.unshift(newTake);
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
    copy.takeNumber = (Number(copy.takeNumber) || 0) + 1;
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

function buildProjectReportSections(project) {
  const sections = [];
  const stats = projectStats(project);
  sections.push({
    type: 'header',
    title: project.projectName || 'Untitled Project',
    subtitle: `${project.prodCompany || 'No production company'} | ${stats.takes} takes | ${stats.goodTakes} good | ${stats.noGoodTakes} no good`,
  });
  sections.push({
    type: 'info',
    items: [
      { label: 'Director', value: project.director || '-' },
      { label: 'DP', value: project.dp || '-' },
      { label: '1st AC', value: project.firstACName || '-' },
      { label: '2nd AC', value: project.secondACName || '-' },
      { label: 'Camera', value: project.camera === 'Custom' ? project.customCamera || 'Custom' : project.camera || '-' },
      { label: 'Frame Rate', value: project.frameRate || '-' },
      { label: 'LUT', value: project.lutUsed === 'Yes' ? (project.lutName || 'Yes') : 'No' },
    ],
  });
  if (project.hasBUnit) {
    sections.push({
      type: 'info',
      title: 'B Unit',
      items: [
        { label: 'DP', value: project.bUnit.dp || '-' },
        { label: '1st AC', value: project.bUnit.firstACName || '-' },
        { label: '2nd AC', value: project.bUnit.secondACName || '-' },
      ],
    });
  }
  if (project.extraNotes) {
    sections.push({ type: 'notes', title: 'Project Notes', content: project.extraNotes });
  }
  project.productionDays.forEach((day, dayIndex) => {
    sections.push({
      type: 'day',
      day: dayIndex + 1,
      date: day.prodDay || '-',
      takes: day.takes,
    });
  });
  return sections;
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


function createPdfDoc(sections, title) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const lineHeight = 12;
  const maxLineWidth = pageWidth - 2 * margin;
  
  let y = margin + 30;
  let pageNum = 1;
  
  const checkNewPage = function() {
    if (y > pageHeight - margin) {
      doc.addPage();
      pageNum++;
      y = margin + 30;
    }
  };
  
  const addLine = function(text, size, bold) {
    if (size === undefined) size = 10;
    if (bold === undefined) bold = false;
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    var lines = doc.splitTextToSize(text, maxLineWidth);
    for (var i = 0; i < lines.length; i++) {
      checkNewPage();
      doc.text(lines[i], margin, y);
      y += lineHeight;
    }
  };
  
  var totalPages = 1;
  
  for (var si = 0; si < sections.length; si++) {
    var section = sections[si];
    if (section.type === 'header') {
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text(title.toUpperCase(), pageWidth / 2, y, { align: 'center' });
      y += 24;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(new Date().toLocaleString(), margin, y);
      y += 20;
    } else if (section.type === 'info') {
      if (section.title) {
        checkNewPage();
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(section.title.toUpperCase(), margin, y);
        y += 16;
        doc.setDrawColor(180, 180, 180);
        doc.line(margin, y - 4, pageWidth - margin, y - 4);
      }
      for (var ii = 0; ii < section.items.length; ii++) {
        checkNewPage();
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(section.items[ii].label + ':', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(String(section.items[ii].value), margin + 60, y);
        y += 11;
      }
      y += 8;
    } else if (section.type === 'notes') {
      checkNewPage();
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('NOTES', margin, y);
      y += 16;
      doc.setFontSize(10);
      var noteLines = doc.splitTextToSize(section.content, maxLineWidth);
      for (var nl = 0; nl < noteLines.length; nl++) {
        checkNewPage();
        doc.text(noteLines[nl], margin, y);
        y += 11;
      }
      y += 12;
    } else if (section.type === 'day') {
      checkNewPage();
      doc.setFillColor(240, 240, 240);
      doc.rect(margin - 10, y - 8, pageWidth - 2 * margin + 20, 22, 'F');
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('DAY ' + section.day + ' - ' + section.date, margin, y);
      y += 18;
      if (section.takes.length === 0) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('(No takes logged)', margin, y);
        y += 15;
      } else {
        checkNewPage();
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text('SCENE  SETUP  TAKE   LENS          T-STOP   FILTER      CAMERA       STATUS', margin, y);
        y += 10;
        doc.setDrawColor(180, 180, 180);
        doc.line(margin, y - 2, pageWidth - margin, y - 2);
        y += 8;
        for (var ti = 0; ti < section.takes.length; ti++) {
          var take = section.takes[ti];
          checkNewPage();
          var scene = String(take.sceneNumber || '-').slice(0, 6);
          var setup = String(take.setupLetter || '-').slice(0, 6);
          var takeNum = String(take.takeNumber || 1);
          var lens = take.lensSize === 'Custom' ? String(take.customLensSize || 'Custom').slice(0, 10) : String(take.lensSize || '-').slice(0, 10);
          var speed = take.lensSpeed === 'Custom' ? String(take.customLensSpeed || 'Custom').slice(0, 8) : String(take.lensSpeed || '-').slice(0, 8);
          var filter = take.filter === 'None' ? '-' : String(take.filter || '-').slice(0, 10);
          var camera = take.camera === 'Custom' ? String(take.customCamera || 'Custom').slice(0, 10) : String(take.camera || '-').slice(0, 10);
          var status = take.status === 'good' ? 'GOOD' : take.status === 'nogood' ? 'NO GOOD' : take.status === 'soft' ? 'SOFT' : take.status === 'flare' ? 'FLARE' : take.status === 'boom' ? 'BOOM' : '';
          
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.text(scene.padEnd(8) + setup.padEnd(8) + takeNum.padEnd(6) + lens.padEnd(12) + speed.padEnd(10) + filter.padEnd(12) + camera.padEnd(12) + status, margin, y);
          y += 10;
          
          if (take.takeNotes) {
            doc.setFontSize(8);
            var tnotes = doc.splitTextToSize('Take: ' + take.takeNotes, maxLineWidth - 20);
            for (var tn = 0; tn < tnotes.length; tn++) {
              checkNewPage();
              doc.text(tnotes[tn], margin + 10, y);
              y += 9;
            }
          }
          if (take.cameraNotes) {
            doc.setFontSize(8);
            var cnotes = doc.splitTextToSize('Camera: ' + take.cameraNotes, maxLineWidth - 20);
            for (var cn = 0; cn < cnotes.length; cn++) {
              checkNewPage();
              doc.text(cnotes[cn], margin + 10, y);
              y += 9;
            }
          }
        }
      }
      y += 10;
    }
  }

  var pageCount = doc.internal.getNumberOfPages();
  for (var p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.text('Page ' + p, pageWidth - 80, pageHeight - 30, { align: 'center' });
  }

  return doc.output('arraybuffer');
}
function exportProjectPdf(project) {
  const sections = buildProjectReportSections(project);
  const title = `${project.projectName || 'Untitled Project'}`;
  const pdf = createPdfDoc(sections, title);
  const filename = safeFilename([project.projectName, project.prodCompany, 'Report'], 'pdf');
  downloadBlob(filename, pdf, 'application/pdf');
}

function exportProjectCsv(project) {
  const rows = [['Day', 'Date', 'Scene', 'Setup', 'Take#', 'Lens', 'T-Stop', 'Filter', 'Camera', 'Status', 'Take Notes', 'Camera Notes', 'Created']];
  project.productionDays.forEach((day, dayIdx) => {
    day.takes.forEach((take) => {
      const status = take.status === 'good' ? 'GOOD' : take.status === 'nogood' ? 'NO GOOD' : take.status === 'soft' ? 'SOFT' : take.status === 'flare' ? 'FLARE' : take.status === 'boom' ? 'BOOM' : '';
      const lens = take.lensSize === 'Custom' ? take.customLensSize : take.lensSize;
      const speed = take.lensSpeed === 'Custom' ? take.customLensSpeed : take.lensSpeed;
      const camera = take.camera === 'Custom' ? take.customCamera : take.camera;
      rows.push([
        dayIdx + 1,
        day.prodDay || '',
        take.sceneNumber || '',
        take.setupLetter || '',
        take.takeNumber || 1,
        lens,
        speed,
        take.filter,
        camera,
        status,
        take.takeNotes || '',
        take.cameraNotes || '',
        take.createdAt || ''
      ]);
    });
  });
  const csv = rows.map(row => row.map(cell => {
    const str = String(cell ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }).join(',')).join('\n');
  const filename = safeFilename([project.projectName, project.prodCompany, 'Export'], 'csv');
  downloadBlob(filename, csv, 'text/csv');
}

function projectStats(project) {
  const days = project.productionDays.length;
  const takes = project.productionDays.reduce((sum, day) => sum + day.takes.length, 0);
  const goodTakes = project.productionDays.reduce((sum, day) => sum + day.takes.filter(t => t.status === 'good').length, 0);
  const noGoodTakes = project.productionDays.reduce((sum, day) => sum + day.takes.filter(t => t.status === 'nogood').length, 0);
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
  const stats = projectStats(project);
  return `
    <div class="app-shell stack">
      <header class="topbar">
        <div class="brand">
          <button class="icon-button" data-action="go-home" aria-label="Back">←</button>
          <div class="brand-text">
            <h1>${escapeHtml(project.projectName || 'Untitled Project')}</h1>
            <p>${escapeHtml(project.prodCompany || 'No production company')} · ${stats.takes} takes · ${stats.goodTakes} ✓ · Saved ${formatDateTime(state.lastSavedAt)}</p>
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
        <button class="button" data-action="export-csv" data-project-id="${project.id}">Export CSV</button>
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
  const dayGood = day.takes.filter(t => t.status === 'good').length;
  const dayNoGood = day.takes.filter(t => t.status === 'nogood').length;
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

        ${day.takes.length ? day.takes.map((take, takeIndex) => takeHtml(project, day, take, takeIndex, index)).join('') : '<div class="empty">No takes for this day yet.</div>'}
      </div>
    </article>
  `;
}

function takeHtml(project, day, take, takeIndex, dayIndex) {
  const lensSummary = take.lensSize === 'Custom' ? (take.customLensSize || 'Custom') : take.lensSize;
  const lensSpeedSummary = take.lensSpeed === 'Custom' ? (take.customLensSpeed || 'Custom') : (take.lensSpeed || '');
  const filterSummary = take.filter || 'None';
  const statusLabel = take.status === 'good' ? '✓' : take.status === 'nogood' ? '✗' : take.status === 'soft' ? 'Soft' : take.status === 'flare' ? 'Flare' : take.status === 'boom' ? 'Boom' : '';
  const isExpanded = take.expanded !== false;
  const projName = project.projectName ? `${escapeHtml(project.projectName)} · ` : '';
  const dayLabel = `Day ${dayIndex + 1}`;
  const scenePart = take.sceneNumber ? `${escapeHtml(take.sceneNumber)}${take.setupLetter || ''}` : '';
  const takePart = take.takeNumber || 1;
  const labelPart = take.label ? `, ${escapeHtml(take.label)}` : '';
  let takeTitle = '';
  if (scenePart) {
    takeTitle = `${projName}${dayLabel} · ${scenePart} Take ${takePart}${labelPart}`;
  } else if (take.label) {
    takeTitle = `${projName}${dayLabel} · Take ${takePart}${labelPart}`;
  } else {
    takeTitle = `${projName}${dayLabel} · Take ${takePart}`;
  }
  if (statusLabel) takeTitle += ` · ${statusLabel}`;
  
  return `
    <article class="take-card stack${isExpanded ? ' expanded' : ''}" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}">
      <div class="take-head" data-action="toggle-take">
        <div>
          <p class="take-title">${takeTitle} <span class="take-summary">${escapeHtml(lensSummary)} ${escapeHtml(lensSpeedSummary)} · ${escapeHtml(filterSummary)}</span></p>
        </div>
        <div class="actions take-actions">
          <button type="button" class="quick-mark-btn ${take.status === 'good' ? 'active good' : ''}" data-action="quick-good" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-value="good" title="Mark Good (G)">✓</button>
          <button type="button" class="quick-mark-btn ${take.status === 'nogood' ? 'active bad' : ''}" data-action="quick-good" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-value="nogood" title="Mark No Good (N)">✗</button>
          <button type="button" class="icon-button collapse-btn" data-action="toggle-take" aria-label="Toggle take">
            <span class="collapse-icon">${isExpanded ? '−' : '+'}</span>
          </button>
          <button type="button" class="button" data-action="duplicate-take">Duplicate</button>
          <button type="button" class="button danger" data-action="delete-take">Delete</button>
        </div>
      </div>

      <div class="take-content"${isExpanded ? '' : ' hidden'}>
        <div class="grid four-top">
          <label class="field">
            <span>Scene</span>
            <input type="text" value="${escapeHtml(take.sceneNumber || '')}" data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="sceneNumber" placeholder="e.g. 24" autocomplete="off" />
          </label>
          <label class="field">
            <span>Setup</span>
            <input type="text" value="${escapeHtml(take.setupLetter || '')}" data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="setupLetter" placeholder="e.g. B" autocomplete="off" />
          </label>
          <label class="field">
            <span>Take #</span>
            <input type="number" min="1" value="${take.takeNumber || 1}" data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="takeNumber" autocomplete="off" />
          </label>
          <label class="field">
            <span>Label</span>
            <input type="text" value="${escapeHtml(take.label || '')}" data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="label" placeholder="e.g. Wide, Close-up" autocomplete="off" />
          </label>
        </div>

        <div class="grid three">
          <label class="field">
            <span>Lens</span>
            <select data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="lensSize">
              ${LENS_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${take.lensSize === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
            </select>
          </label>

          <label class="field">
            <span>Speed</span>
            <select data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="lensSpeed">
              ${LENS_SPEED_OPTIONS.map((item) => `<option value="${escapeHtml(item)}" ${take.lensSpeed === item ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}
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

        ${take.lensSpeed === 'Custom' ? `
          <div class="grid">
            <label class="field">
              <span>Custom lens speed</span>
              <input type="text" value="${escapeHtml(take.customLensSpeed || '')}" data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="customLensSpeed" />
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
          <label class="field">
            <span>Status</span>
            <select data-role="take-field" data-project-id="${project.id}" data-day-id="${day.id}" data-take-id="${take.id}" data-key="status">
              <option value="" ${!take.status ? 'selected' : ''}>—</option>
              <option value="good" ${take.status === 'good' ? 'selected' : ''}>✓ Good</option>
              <option value="nogood" ${take.status === 'nogood' ? 'selected' : ''}>✗ No Good</option>
              <option value="soft" ${take.status === 'soft' ? 'selected' : ''}>Soft</option>
              <option value="flare" ${take.status === 'flare' ? 'selected' : ''}>Flare</option>
              <option value="boom" ${take.status === 'boom' ? 'selected' : ''}>Boom in</option>
            </select>
          </label>
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
    if (state.focusTakeId) {
      const el = document.querySelector(`[data-take-id="${state.focusTakeId}"]`);
      if (el) {
        const input = el.querySelector('input[data-key="sceneNumber"]');
        if (input) input.focus();
      }
      state.focusTakeId = null;
    } else {
      const focusTarget = app.querySelector('[data-focus]');
      if (focusTarget) focusTarget.focus();
    }
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
  if (action === 'export-csv') { const project = state.projects.find((p) => p.id === projectId); if (project) exportProjectCsv(project); }
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
  if (action === 'toggle-good' || action === 'quick-good') {
    const value = target.dataset.value;
    updateProject(projectId, (project) => {
      const day = project.productionDays.find((d) => d.id === dayId);
      const take = day?.takes.find((t) => t.id === takeId);
      if (take) take.status = take.status === value ? '' : value;
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
    const shouldRender = ['lensSize', 'lensSpeed', 'camera'].includes(key);
    updateProject(projectId, (project) => {
      const day = project.productionDays.find((d) => d.id === dayId);
      const take = day?.takes.find((t) => t.id === takeId);
      if (!take) return project;
      if (key === 'takeNumber') {
        take[key] = parseInt(el.value, 10) || 1;
      } else {
        take[key] = el.value;
      }
      if (key === 'lensSize' && el.value !== 'Custom') take.customLensSize = '';
      if (key === 'lensSpeed' && el.value !== 'Custom') take.customLensSpeed = '';
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
  document.getElementById('year').textContent = new Date().getFullYear();
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
  if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
    e.preventDefault();
    if (state.currentProjectId) {
      const project = currentProject();
      if (project) {
        exportProjectCsv(project);
        showToast('CSV exported.');
      }
    }
  }
  if (!e.metaKey && !e.ctrlKey && !e.altKey && state.currentProjectId && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      const firstTake = document.querySelector('.take-card:not(.expanded) .quick-mark-btn[data-value="true"]');
      if (firstTake) firstTake.click();
    }
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      const firstTake = document.querySelector('.take-card:not(.expanded) .quick-mark-btn[data-value="false"]');
      if (firstTake) firstTake.click();
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !state.currentProjectId) {
    e.preventDefault();
    addProject();
    showToast('New project created.');
  }
});
