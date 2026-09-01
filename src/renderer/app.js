import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.mjs';
import { drawAnnots, hitTest, moveAnnot, makeSealImage } from './annots.js';
import { flattenAnnotations, mergePdfs, addWatermark, imagesToPdf, textToPdf, reorderPages, canvasToPngBytes } from './pdfops.js';
import { extractPdfTextItems, renderTextLayer, textLength, itemsToPlainText } from './textlayer.js';
import { recognizeCanvas } from './ocr.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '../../node_modules/pdfjs-dist/build/pdf.worker.mjs';

const viewer = document.getElementById('viewer');
const statusEl = document.getElementById('status');
const docNameEl = document.getElementById('docName');
const zoomLabel = document.getElementById('zoomLabel');
const colorInput = document.getElementById('color');
const sizeInput = document.getElementById('size');
const sealTextInput = document.getElementById('sealText');
const sealPreview = document.getElementById('sealPreview');

const state = {
  originalBytes: null,
  pdf: null,
  name: '',
  zoom: 1,
  tool: 'text',
  annots: {},
  pages: [],
  order: [],
  textItems: {},
  ocrBusy: false,
  find: { query: '', hits: [], index: -1 },
  selected: { page: -1, index: -1 },
  sealImage: null,
  present: { on: false, page: 0 }
};

const setStatus = (msg) => {
  statusEl.textContent = msg;
};

function annotsOf(pageIndex) {
  if (!state.annots[pageIndex]) state.annots[pageIndex] = [];
  return state.annots[pageIndex];
}

/* ---------- 모달 ---------- */
const modal = document.getElementById('modal');
const modalForm = document.getElementById('modalForm');
const modalTitle = document.getElementById('modalTitle');
const modalFields = document.getElementById('modalFields');

function showModal(title, fields) {
  modalTitle.textContent = title;
  modalFields.innerHTML = '';
  fields.forEach((f) => {
    const label = document.createElement('label');
    label.textContent = f.label;
    const input = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
    if (f.type !== 'textarea') input.type = f.type || 'text';
    input.name = f.name;
    input.value = f.value ?? '';
    if (f.placeholder) input.placeholder = f.placeholder;
    if (f.min !== undefined) input.min = f.min;
    if (f.max !== undefined) input.max = f.max;
    if (f.step !== undefined) input.step = f.step;
    label.appendChild(input);
    modalFields.appendChild(label);
  });
  modal.classList.remove('hidden');
  const first = modalFields.querySelector('input, textarea');
  if (first) first.focus();

  return new Promise((resolve) => {
    const close = (value) => {
      modal.classList.add('hidden');
      modalForm.onsubmit = null;
      resolve(value);
    };
    modalForm.onsubmit = (event) => {
      event.preventDefault();
      const values = {};
      fields.forEach((f) => {
        values[f.name] = modalForm.elements[f.name].value;
      });
      close(values);
    };
    document.getElementById('modalCancel').onclick = () => close(null);
  });
}

/* ---------- 문서 열기 / 렌더 ---------- */
async function loadPdf(bytes, name) {
  state.originalBytes = new Uint8Array(bytes);
  state.pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
  state.name = name;
  state.annots = {};
  state.selected = { page: -1, index: -1 };
  state.order = Array.from({ length: state.pdf.numPages }, (_, i) => i);
  state.textItems = {};
  docNameEl.textContent = `${name} (${state.pdf.numPages}페이지)`;
  await renderAll();
  await renderThumbs();
  autoOcrSparsePages();
  setStatus(`${name} 불러오기 완료 · 선택 도구에서 글자를 드래그해 복사(Ctrl+C)할 수 있습니다`);
}

async function renderAll() {
  viewer.innerHTML = '';
  state.pages = [];
  for (let position = 0; position < state.order.length; position += 1) {
    const i = state.order[position];
    const page = await state.pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: state.zoom * 1.35 });

    const wrap = document.createElement('div');
    wrap.className = 'page-wrap';
    wrap.style.width = `${viewport.width}px`;
    wrap.style.height = `${viewport.height}px`;

    const base = document.createElement('canvas');
    base.width = viewport.width;
    base.height = viewport.height;
    const overlay = document.createElement('canvas');
    overlay.className = 'overlay';
    overlay.width = viewport.width;
    overlay.height = viewport.height;

    const badge = document.createElement('div');
    badge.className = 'page-no';
    badge.textContent = `${position + 1} / ${state.order.length} (원본 ${i + 1}쪽)`;

    wrap.append(base);
    viewer.appendChild(wrap);

    await page.render({ canvasContext: base.getContext('2d'), viewport }).promise;

    const pdfItems = await extractPdfTextItems(page, viewport);
    state.textItems[i] = pdfItems;
    const textLayer = renderTextLayer(wrap, pdfItems, viewport.width, viewport.height);
    wrap.append(overlay, badge);

    const info = { index: i, page, wrap, base, overlay, textLayer, viewport };
    state.pages.push(info);
    attachEditing(info);
    paintOverlay(i);
  }
  zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  syncZoomSelect();
  updatePointerMode();
}

function syncZoomSelect() {
  const sel = document.getElementById('zoomSelect');
  if (!sel) return;
  let best = sel.options[0];
  let bestDiff = Infinity;
  for (const opt of sel.options) {
    const diff = Math.abs(Number(opt.value) - state.zoom);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = opt;
    }
  }
  sel.value = best.value;
}

function updatePointerMode() {
  const textMode = state.tool === 'text';
  const drawTools = ['pen', 'highlight', 'note', 'edit', 'seal'];
  const drawMode = drawTools.includes(state.tool);
  const handMode = state.tool === 'hand';

  viewer.classList.toggle('hand-mode', handMode);

  for (const info of state.pages) {
    if (info.textLayer) info.textLayer.classList.toggle('active', textMode);
    if (info.overlay) info.overlay.style.pointerEvents = drawMode ? 'auto' : 'none';
  }
}

async function runOcrOnPage(info, { force = false } = {}) {
  const existing = state.textItems[info.index] || [];
  if (!force && textLength(existing) >= 8) return existing;

  const ocrScale = 2;
  const ocrViewport = info.page.getViewport({ scale: state.zoom * 1.35 * ocrScale });
  const ocrCanvas = document.createElement('canvas');
  ocrCanvas.width = ocrViewport.width;
  ocrCanvas.height = ocrViewport.height;
  await info.page.render({ canvasContext: ocrCanvas.getContext('2d'), viewport: ocrViewport }).promise;

  const raw = await recognizeCanvas(ocrCanvas, (message) => {
    if (message.status === 'recognizing text') {
      setStatus(`OCR ${info.index + 1}쪽 ${Math.round((message.progress || 0) * 100)}%`);
    }
  });

  const scale = 1 / ocrScale;
  const items = raw.map((item) => ({
    ...item,
    left: item.left * scale,
    top: item.top * scale,
    width: item.width * scale,
    height: item.height * scale
  }));

  state.textItems[info.index] = items.length ? items : existing;
  renderTextLayer(info.wrap, state.textItems[info.index], info.viewport.width, info.viewport.height, info.overlay);
  info.textLayer = info.wrap.querySelector('.text-layer');
  updatePointerMode();
  return state.textItems[info.index];
}

async function autoOcrSparsePages() {
  if (state.ocrBusy) return;
  const targets = state.pages.filter((info) => textLength(state.textItems[info.index] || []) < 8);
  if (!targets.length) return;
  state.ocrBusy = true;
  setStatus(`스캔 문서 감지 · OCR 시작 (${targets.length}쪽)`);
  try {
    for (const info of targets) {
      await runOcrOnPage(info);
    }
    setStatus('OCR 완료 · 글자를 드래그해 복사할 수 있습니다');
  } catch (error) {
    setStatus(`OCR 오류: ${error.message}`);
  } finally {
    state.ocrBusy = false;
  }
}

function pageInfo(pageIndex) {
  return state.pages.find((p) => p.index === pageIndex);
}

function paintOverlay(pageIndex) {
  const info = pageInfo(pageIndex);
  if (!info) return;
  const selected = state.selected.page === pageIndex ? state.selected.index : -1;
  drawAnnots(info.overlay.getContext('2d'), annotsOf(pageIndex), info.overlay.width, info.overlay.height, selected);
}

/* ---------- 페이지 썸네일 / 순서 변경 ---------- */
const thumbList = document.getElementById('thumbList');

async function renderThumbs() {
  thumbList.innerHTML = '';
  for (let position = 0; position < state.order.length; position += 1) {
    const pageIndex = state.order[position];
    const page = await state.pdf.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 150 / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    drawAnnots(canvas.getContext('2d'), annotsOf(pageIndex), canvas.width, canvas.height);

    const item = document.createElement('div');
    item.className = 'thumb';
    item.draggable = true;
    item.dataset.position = String(position);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = `${position + 1} (원본 ${pageIndex + 1})`;
    item.append(canvas, label);
    item.addEventListener('click', () => {
      const info = pageInfo(pageIndex);
      if (info) info.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      thumbList.querySelectorAll('.thumb').forEach((el) => el.classList.toggle('current', el === item));
    });
    thumbList.appendChild(item);
  }
}

let dragFrom = -1;

thumbList.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.thumb');
  if (!item) return;
  dragFrom = Number(item.dataset.position);
  item.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(dragFrom));
});

thumbList.addEventListener('dragover', (event) => {
  const item = event.target.closest('.thumb');
  if (!item || dragFrom < 0) return;
  event.preventDefault();
  const rect = item.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  thumbList.querySelectorAll('.thumb').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  item.classList.add(after ? 'drop-after' : 'drop-before');
});

thumbList.addEventListener('drop', async (event) => {
  const item = event.target.closest('.thumb');
  if (!item || dragFrom < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = item.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;
  let to = Number(item.dataset.position) + (after ? 1 : 0);
  const [moved] = state.order.splice(dragFrom, 1);
  if (dragFrom < to) to -= 1;
  state.order.splice(to, 0, moved);
  await finishThumbDrag();
  await renderAll();
  await renderThumbs();
  setStatus(`페이지 순서 변경: ${dragFrom + 1} → ${to + 1}`);
});

async function finishThumbDrag() {
  dragFrom = -1;
  thumbList.querySelectorAll('.thumb').forEach((el) => el.classList.remove('dragging', 'drop-before', 'drop-after'));
}

thumbList.addEventListener('dragend', finishThumbDrag);

/* ---------- 편집 상호작용 ---------- */
function attachEditing(info) {
  const canvas = info.overlay;
  const norm = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
  let drag = null;

  const onMove = (event) => {
    if (!drag) return;
    const p = norm(event);
    if (drag.kind === 'pen') {
      drag.annot.pts.push([p.x, p.y]);
    } else if (drag.kind === 'rect') {
      drag.annot.x = Math.min(drag.origin.x, p.x);
      drag.annot.y = Math.min(drag.origin.y, p.y);
      drag.annot.w = Math.abs(p.x - drag.origin.x);
      drag.annot.h = Math.abs(p.y - drag.origin.y);
    } else if (drag.kind === 'move') {
      moveAnnot(drag.annot, p.x - drag.last.x, p.y - drag.last.y);
      drag.last = p;
    }
    paintOverlay(info.index);
  };

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', endDrag);
  };

  const startDrag = () => {
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', endDrag);
  };

  info.wrap.addEventListener('mousedown', async (event) => {
    if (state.tool !== 'select') return;
    if (event.target.closest('.text-layer span')) return;

    const p = norm(event);
    const list = annotsOf(info.index);
    const index = hitTest(list, p.x, p.y);
    state.selected = { page: info.index, index };
    if (index >= 0) {
      drag = { kind: 'move', annot: list[index], last: p };
      startDrag();
    }
    state.pages.forEach((pg) => paintOverlay(pg.index));
  });

  canvas.addEventListener('mousedown', async (event) => {
    if (state.tool === 'select') return;

    const p = norm(event);
    const list = annotsOf(info.index);
    const strokeWidth = Number(sizeInput.value) / 1000;
    const fontRatio = Number(sizeInput.value) / 600;

    if (state.tool === 'pen') {
      const annot = { t: 'pen', color: colorInput.value, w: strokeWidth, pts: [[p.x, p.y]] };
      list.push(annot);
      drag = { kind: 'pen', annot };
      startDrag();
      return;
    }
    if (state.tool === 'highlight') {
      const annot = { t: 'hl', color: colorInput.value, x: p.x, y: p.y, w: 0, h: 0 };
      list.push(annot);
      drag = { kind: 'rect', annot, origin: p };
      startDrag();
      return;
    }
    if (state.tool === 'note') {
      const values = await showModal('메모 주석', [{ name: 'text', label: '내용', type: 'textarea' }]);
      if (!values || !values.text.trim()) return;
      list.push({ t: 'note', text: values.text, x: p.x, y: p.y, w: 0.26, h: 0.06, size: fontRatio * 0.04, color: colorInput.value });
      paintOverlay(info.index);
      setStatus('메모 주석 추가');
      return;
    }
    if (state.tool === 'edit') {
      const values = await showModal('본문 수정 (기존 내용을 덮고 새 텍스트 삽입)', [
        { name: 'text', label: '새 본문', type: 'textarea' },
        { name: 'bg', label: '덮을 배경색', type: 'color', value: '#ffffff' }
      ]);
      if (!values) return;
      list.push({
        t: 'edit',
        text: values.text,
        bg: values.bg,
        x: p.x,
        y: p.y,
        w: 0.4,
        h: 0.06,
        size: fontRatio * 0.03,
        color: '#111111'
      });
      paintOverlay(info.index);
      setStatus('본문 수정 블록 추가 (선택 도구로 이동 가능)');
      return;
    }
    if (state.tool === 'seal') {
      const image = state.sealImage || makeSealImage(sealTextInput.value);
      const side = 0.14;
      list.push({ t: 'seal', img: image, x: p.x - side / 2, y: p.y - side / 2, w: side, h: side, opacity: 0.95 });
      paintOverlay(info.index);
      setStatus('전자인장 삽입');
    }
  });

  canvas.addEventListener('dblclick', async () => {
    const { page, index } = state.selected;
    if (page !== info.index || index < 0) return;
    const annot = annotsOf(page)[index];
    if (annot.t !== 'note' && annot.t !== 'edit') return;
    const values = await showModal('텍스트 수정', [{ name: 'text', label: '내용', type: 'textarea', value: annot.text }]);
    if (!values) return;
    annot.text = values.text;
    paintOverlay(page);
  });
}

document.addEventListener('keydown', (event) => {
  if (state.present.on) {
    if (event.key === 'Escape') exitPresent();
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') showPresentPage(state.present.page + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') showPresentPage(state.present.page - 1);
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selected.index >= 0) {
    const { page, index } = state.selected;
    annotsOf(page).splice(index, 1);
    state.selected = { page: -1, index: -1 };
    paintOverlay(page);
  }
});

/* ---------- 프레젠테이션 ---------- */
const presentEl = document.getElementById('present');
const presentCanvas = document.getElementById('presentCanvas');

async function showPresentPage(index) {
  if (!state.pdf) return;
  const clamped = Math.max(0, Math.min(state.order.length - 1, index));
  state.present.page = clamped;
  const pageIndex = state.order[clamped];
  const page = await state.pdf.getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(window.innerWidth / base.width, window.innerHeight / base.height);
  const viewport = page.getViewport({ scale });
  presentCanvas.width = viewport.width;
  presentCanvas.height = viewport.height;
  const ctx = presentCanvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, presentCanvas.width, presentCanvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  drawAnnots(ctx, annotsOf(pageIndex), presentCanvas.width, presentCanvas.height);
}

async function enterPresent() {
  if (!state.pdf) return setStatus('먼저 PDF를 열어주세요');
  state.present.on = true;
  presentEl.classList.remove('hidden');
  await window.api.setFullScreen(true);
  await showPresentPage(0);
}

function exitPresent() {
  state.present.on = false;
  presentEl.classList.add('hidden');
  window.api.setFullScreen(false);
}

/* ---------- PDF 텍스트 추출 ---------- */
async function extractPages() {
  const out = [];
  for (const pageIndex of state.order) {
    const cached = state.textItems[pageIndex];
    if (cached && cached.length) {
      out.push(itemsToPlainText(cached));
      continue;
    }
    const page = await state.pdf.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    let text = '';
    let lastY = null;
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += '\n';
      text += item.str;
      lastY = y;
    }
    out.push(text.trim());
  }
  return out;
}

function baseName() {
  return state.name.replace(/\.pdf$/i, '') || 'document';
}

function requireDoc() {
  if (!state.pdf) {
    setStatus('먼저 PDF를 열어주세요');
    return false;
  }
  return true;
}

// 주석을 합성하고 썸네일에서 바꾼 페이지 순서를 적용한 최종 바이트를 만든다.
async function buildOutputBytes() {
  const flattened = await flattenAnnotations(state.originalBytes, state.annots);
  return reorderPages(flattened, state.order);
}

/* ---------- 액션 ---------- */
const actions = {
  async open() {
    const [file] = await window.api.openPdfs(false);
    if (!file) return;
    await loadPdf(file.data, file.name);
  },

  async save() {
    if (!requireDoc()) return;
    setStatus('저장 중...');
    const bytes = await buildOutputBytes();
    const saved = await window.api.savePdf(`${baseName()}-편집.pdf`, bytes);
    setStatus(saved ? `저장 완료: ${saved}` : '저장 취소');
  },

  async merge() {
    const files = await window.api.openPdfs(true);
    if (files.length < 2) return setStatus('병합할 PDF를 2개 이상 선택하세요');
    const bytes = await mergePdfs(files.map((f) => new Uint8Array(f.data)));
    const saved = await window.api.savePdf('병합문서.pdf', bytes);
    setStatus(saved ? `${files.length}개 문서 병합 완료` : '병합 취소');
  },

  async watermark() {
    if (!requireDoc()) return;
    const values = await showModal('워터마크', [
      { name: 'text', label: '문구', value: '대외비' },
      { name: 'opacity', label: '투명도 (0.05 ~ 1)', type: 'number', value: '0.2', min: 0.05, max: 1, step: 0.05 },
      { name: 'angle', label: '기울기(도)', type: 'number', value: '45' }
    ]);
    if (!values) return;
    const source = await buildOutputBytes();
    const bytes = await addWatermark(source, {
      text: values.text,
      opacity: Number(values.opacity),
      angle: Number(values.angle)
    });
    const saved = await window.api.savePdf(`${baseName()}-워터마크.pdf`, bytes);
    setStatus(saved ? '워터마크 적용 완료' : '워터마크 취소');
  },

  async 'export-images'() {
    if (!requireDoc()) return;
    setStatus('이미지 렌더링 중...');
    const files = [];
    for (let position = 0; position < state.order.length; position += 1) {
      const pageIndex = state.order[position];
      const page = await state.pdf.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      drawAnnots(ctx, annotsOf(pageIndex), canvas.width, canvas.height);
      files.push({
        name: `${baseName()}-${String(position + 1).padStart(3, '0')}.png`,
        data: canvasToPngBytes(canvas)
      });
    }
    const dir = await window.api.saveFilesToFolder(files);
    setStatus(dir ? `이미지 ${files.length}장 저장: ${dir}` : '이미지 저장 취소');
  },

  async 'to-pdf-images'() {
    const files = await window.api.openImages(true);
    if (files.length === 0) return;
    const bytes = await imagesToPdf(files);
    const saved = await window.api.savePdf('이미지변환.pdf', bytes);
    setStatus(saved ? `이미지 ${files.length}장을 PDF로 변환` : '변환 취소');
  },

  async 'to-pdf-text'() {
    const files = await window.api.openTexts();
    if (files.length === 0) return;
    const text = files.map((f) => new TextDecoder('utf-8').decode(new Uint8Array(f.data))).join('\n\n');
    const bytes = await textToPdf(text);
    const saved = await window.api.savePdf('텍스트변환.pdf', bytes);
    setStatus(saved ? '텍스트를 PDF로 변환' : '변환 취소');
  },

  async 'from-pdf-text'() {
    if (!requireDoc()) return;
    setStatus('텍스트 추출 중...');
    const pages = await extractPages();
    const text = pages.map((t, i) => `--- ${i + 1}페이지 ---\n${t}`).join('\n\n');
    const saved = await window.api.saveText(`${baseName()}.txt`, new TextEncoder().encode(text));
    setStatus(saved ? `역변환 완료: ${saved}` : '역변환 취소');
  },

  async 'from-pdf-html'() {
    if (!requireDoc()) return;
    setStatus('HTML 변환 중...');
    const pages = await extractPages();
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = pages
      .map((t, i) => `<section><h2>${i + 1}페이지</h2>${t.split('\n').map((line) => `<p>${escape(line)}</p>`).join('')}</section>`)
      .join('\n');
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${escape(baseName())}</title>
<style>body{font-family:"Malgun Gothic",sans-serif;max-width:820px;margin:40px auto;line-height:1.7}section{margin-bottom:48px}</style>
</head><body>${body}</body></html>`;
    const saved = await window.api.saveText(`${baseName()}.html`, new TextEncoder().encode(html));
    setStatus(saved ? `역변환 완료: ${saved}` : '역변환 취소');
  },

  async 'seal-image'() {
    const [file] = await window.api.openImages(false);
    if (!file) return;
    const blob = new Blob([new Uint8Array(file.data)]);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    state.sealImage = canvas;
    updateSealPreview();
    setStatus('인장 이미지 등록 완료');
  },

  present: enterPresent,

  undo() {
    for (let position = state.order.length - 1; position >= 0; position -= 1) {
      const pageIndex = state.order[position];
      const list = annotsOf(pageIndex);
      if (list.length) {
        list.pop();
        paintOverlay(pageIndex);
        return setStatus('마지막 주석 취소');
      }
    }
  },

  'clear-page'() {
    const target = state.selected.page >= 0 ? state.selected.page : state.order[0] ?? 0;
    state.annots[target] = [];
    paintOverlay(target);
    setStatus(`${target + 1}페이지 주석 삭제`);
  },

  async 'zoom-in'() {
    if (!requireDoc()) return;
    state.zoom = Math.min(3, state.zoom + 0.2);
    await renderAll();
  },

  async 'zoom-out'() {
    if (!requireDoc()) return;
    state.zoom = Math.max(0.4, state.zoom - 0.2);
    await renderAll();
  },

  async 'zoom-reset'() {
    if (!requireDoc()) return;
    state.zoom = 1;
    await renderAll();
  },

  'toggle-thumbs'() {
    document.getElementById('thumbsPane').classList.toggle('hidden');
    setStatus(document.getElementById('thumbsPane').classList.contains('hidden') ? '탐색 창 숨김' : '탐색 창 표시');
  },

  'find-next'() {
    findStep(1);
  },

  'find-prev'() {
    findStep(-1);
  },

  help() {
    showModal('JSPDF 사용 안내', [
      {
        name: 'info',
        label: '',
        type: 'textarea',
        value:
          '• 홈 탭: 손 도구(끌어서 이동), 텍스트 선택(드래그 후 Ctrl+C)\n' +
          '• 주석 탭: 펜·형광펜·메모·인장\n' +
          '• 편집 탭: 본문 수정·인장 설정\n' +
          '• 변환 탭: PDF 병합·이미지/텍스트 변환·역변환\n' +
          '• 왼쪽 썸네일을 드래그하면 페이지 순서 변경'
      }
    ]);
  },

  async ocr() {
    if (!requireDoc()) return;
    if (state.ocrBusy) return setStatus('OCR이 이미 실행 중입니다');
    state.ocrBusy = true;
    try {
      setStatus('전체 페이지 OCR 실행 중...');
      for (const info of state.pages) {
        await runOcrOnPage(info, { force: true });
      }
      setStatus('OCR 완료 · 글자를 드래그해 복사할 수 있습니다');
    } catch (error) {
      setStatus(`OCR 오류: ${error.message}`);
    } finally {
      state.ocrBusy = false;
    }
  }
};

function clearFindHits() {
  document.querySelectorAll('.text-layer span.find-hit').forEach((el) => el.classList.remove('find-hit'));
}

function collectFindHits(query) {
  clearFindHits();
  if (!query) return [];
  const q = query.toLowerCase();
  const hits = [];
  for (const info of state.pages) {
    const layer = info.textLayer || info.wrap.querySelector('.text-layer');
    if (!layer) continue;
    for (const span of layer.querySelectorAll('span')) {
      if (span.textContent.toLowerCase().includes(q)) {
        span.classList.add('find-hit');
        hits.push({ pageIndex: info.index, span, wrap: info.wrap });
      }
    }
  }
  return hits;
}

function findStep(dir) {
  const input = document.getElementById('findInput');
  const query = input?.value.trim() || '';
  if (!query) return setStatus('찾을 단어를 입력하세요');
  if (state.find.query !== query) {
    state.find = { query, hits: collectFindHits(query), index: -1 };
  }
  if (!state.find.hits.length) return setStatus(`"${query}" 를 찾을 수 없습니다`);
  state.find.index = (state.find.index + dir + state.find.hits.length) % state.find.hits.length;
  const hit = state.find.hits[state.find.index];
  hit.wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const range = document.createRange();
  range.selectNodeContents(hit.span);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  setStatus(`찾기 ${state.find.index + 1}/${state.find.hits.length}: "${query}"`);
}

document.getElementById('tabBar').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  const name = tab.dataset.tab;
  document.querySelectorAll('.tab:not(.tab-file)').forEach((el) => el.classList.toggle('active', el === tab));
  document.querySelectorAll('.ribbon-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
});

document.getElementById('zoomSelect')?.addEventListener('change', async (event) => {
  if (!requireDoc()) return;
  state.zoom = Number(event.target.value);
  await renderAll();
});

document.getElementById('findInput')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') findStep(event.shiftKey ? -1 : 1);
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action], [data-tool]');
  if (!target) return;
  if (target.dataset.tool) {
    state.tool = target.dataset.tool;
    document.querySelectorAll('.tool').forEach((btn) => btn.classList.toggle('active', btn.dataset.tool === state.tool));
    updatePointerMode();
    return;
  }
  const action = actions[target.dataset.action];
  if (action) Promise.resolve(action()).catch((error) => setStatus(`오류: ${error.message}`));
});

document.addEventListener('selectionchange', () => {
  const text = String(document.getSelection?.()?.toString?.() || '').trim();
  if (text) setStatus(`선택됨 (${text.length}자) · Ctrl+C로 복사`);
});

presentEl.addEventListener('click', () => showPresentPage(state.present.page + 1));

/* ---------- 드래그 앤 드롭으로 PDF 열기 ---------- */
const dropHint = document.getElementById('dropHint');
let dragDepth = 0;

const isPdfDrag = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

window.addEventListener('dragenter', (event) => {
  if (!isPdfDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  dropHint.classList.remove('hidden');
});

window.addEventListener('dragover', (event) => {
  if (isPdfDrag(event)) event.preventDefault();
});

window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropHint.classList.add('hidden');
});

window.addEventListener('drop', async (event) => {
  if (!isPdfDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropHint.classList.add('hidden');
  const file = Array.from(event.dataTransfer.files).find((f) => f.name.toLowerCase().endsWith('.pdf'));
  if (!file) return setStatus('PDF 파일만 열 수 있습니다');
  await loadPdf(new Uint8Array(await file.arrayBuffer()), file.name);
});

// 연결 프로그램(마우스 오른쪽 → 연결 프로그램)으로 실행됐을 때 전달되는 파일
window.api.onOpenFile(async ({ name, data }) => {
  await loadPdf(new Uint8Array(data), name);
});

/* ---------- 손 도구(패닝) ---------- */
let pan = null;
viewer.addEventListener('mousedown', (event) => {
  if (state.tool !== 'hand') return;
  pan = { x: event.clientX, y: event.clientY, sl: viewer.scrollLeft, st: viewer.scrollTop };
  viewer.classList.add('panning');
});
document.addEventListener('mousemove', (event) => {
  if (!pan) return;
  viewer.scrollLeft = pan.sl - (event.clientX - pan.x);
  viewer.scrollTop = pan.st - (event.clientY - pan.y);
});
document.addEventListener('mouseup', () => {
  if (!pan) return;
  pan = null;
  viewer.classList.remove('panning');
});

function updateSealPreview() {
  const ctx = sealPreview.getContext('2d');
  ctx.clearRect(0, 0, sealPreview.width, sealPreview.height);
  const image = state.sealImage || makeSealImage(sealTextInput.value);
  ctx.drawImage(image, 0, 0, sealPreview.width, sealPreview.height);
}

sealTextInput.addEventListener('input', () => {
  state.sealImage = null;
  updateSealPreview();
});

window.api
  .version()
  .then((v) => {
    document.getElementById('version').textContent = `v${v}`;
  })
  .catch(() => {});

sealTextInput.value = '홍길동';
updateSealPreview();

// 자동 점검용 진입점 (PDFSTUDIO_DEBUG 실행 시 메인 프로세스에서 사용)
window.__app = {
  state,
  loadPdf,
  actions,
  extractPages,
  annotsOf,
  paintOverlay,
  renderThumbs,
  buildOutputBytes,
  runOcrOnPage,
  autoOcrSparsePages,
  updatePointerMode,
  makeSealImage,
  ops: { flattenAnnotations, mergePdfs, addWatermark, imagesToPdf, textToPdf, reorderPages, canvasToPngBytes }
};
