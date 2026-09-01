import { drawAnnots, drawTextBlock } from './annots.js';

const { PDFDocument, degrees } = window.PDFLib;

const A4 = { w: 595.28, h: 841.89 };

function newCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  return canvas;
}

export function canvasToPngBytes(canvas) {
  const base64 = canvas.toDataURL('image/png').split(',')[1];
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function canvasToJpegBytes(canvas, quality = 0.75) {
  const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// 페이지를 JPEG로 래스터화해 용량을 줄인 PDF를 만든다.
export async function compressPdfRaster(pageRasters) {
  const doc = await PDFDocument.create();
  for (const p of pageRasters) {
    const image = await doc.embedJpg(p.jpegBytes);
    const page = doc.addPage([p.width, p.height]);
    page.drawImage(image, { x: 0, y: 0, width: p.width, height: p.height });
  }
  return doc.save({ useObjectStreams: true });
}

// 화면(뷰포트) 방향으로 그려진 오버레이를 페이지 원본(미디어박스) 방향으로 되돌린다.
function toMediaOriented(overlay, rotation, mediaW, mediaH, scale) {
  const target = newCanvas(mediaW * scale, mediaH * scale);
  const ctx = target.getContext('2d');
  const W = target.width;
  const H = target.height;
  const rot = ((rotation % 360) + 360) % 360;
  if (rot === 90) {
    ctx.translate(0, H);
    ctx.rotate(-Math.PI / 2);
  } else if (rot === 180) {
    ctx.translate(W, H);
    ctx.rotate(Math.PI);
  } else if (rot === 270) {
    ctx.translate(W, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.drawImage(overlay, 0, 0, overlay.width, overlay.height);
  return target;
}

// 주석 레이어를 이미지로 구워 원본 PDF 위에 합성한다(한글 폰트 임베딩 없이 정확히 재현).
export async function flattenAnnotations(originalBytes, annotsByPage, scale = 2) {
  const doc = await PDFDocument.load(originalBytes);
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i += 1) {
    const list = annotsByPage[i];
    if (!list || list.length === 0) continue;
    const page = pages[i];
    const { width, height } = page.getSize();
    const rot = page.getRotation().angle;
    const swap = rot === 90 || rot === 270;
    const viewW = (swap ? height : width) * scale;
    const viewH = (swap ? width : height) * scale;

    const overlay = newCanvas(viewW, viewH);
    drawAnnots(overlay.getContext('2d'), list, overlay.width, overlay.height);
    const oriented = toMediaOriented(overlay, rot, width, height, scale);
    const png = await doc.embedPng(canvasToPngBytes(oriented));
    page.drawImage(png, { x: 0, y: 0, width, height });
  }
  return doc.save();
}

// 지정한 원본 페이지(0-base)를 deltaDegrees만큼 회전한다.
export async function rotatePages(bytes, pageIndices, deltaDegrees) {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const unique = [...new Set(pageIndices)].filter((i) => i >= 0 && i < pages.length);
  for (const idx of unique) {
    const page = pages[idx];
    const cur = page.getRotation().angle;
    const next = (cur + deltaDegrees + 360) % 360;
    page.setRotation(degrees(next));
  }
  return doc.save();
}

// order: 원본 페이지 번호(0-base)를 원하는 배치 순서대로 담은 배열
export async function reorderPages(bytes, order) {
  const unchanged = order.every((pageIndex, position) => pageIndex === position);
  if (unchanged) return bytes;
  const src = await PDFDocument.load(bytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, order);
  copied.forEach((page) => out.addPage(page));
  return out.save();
}

export async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const buffer of buffers) {
    const src = await PDFDocument.load(buffer);
    const copied = await out.copyPages(src, src.getPageIndices());
    copied.forEach((page) => out.addPage(page));
  }
  return out.save();
}

export async function addWatermark(bytes, { text, opacity = 0.2, angle = 45, sizeRatio = 0.08 }) {
  const doc = await PDFDocument.load(bytes);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const scale = 2;
    const canvas = newCanvas(width * scale, height * scale);
    const ctx = canvas.getContext('2d');
    const fontPx = Math.max(12, height * sizeRatio * scale);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-angle * Math.PI) / 180);
    ctx.font = `bold ${fontPx}px "Malgun Gothic", sans-serif`;
    ctx.fillStyle = '#808080';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    const png = await doc.embedPng(canvasToPngBytes(canvas));
    page.drawImage(png, { x: 0, y: 0, width, height, opacity, rotate: degrees(0) });
  }
  return doc.save();
}

export async function imagesToPdf(files) {
  const doc = await PDFDocument.create();
  for (const file of files) {
    const bytes = new Uint8Array(file.data);
    const isPng = file.name.toLowerCase().endsWith('.png');
    const image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const ratio = Math.min(A4.w / image.width, A4.h / image.height);
    const w = image.width * ratio;
    const h = image.height * ratio;
    const page = doc.addPage([A4.w, A4.h]);
    page.drawImage(image, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
  }
  return doc.save();
}

// 텍스트는 캔버스로 렌더 후 이미지로 넣어 한글이 깨지지 않게 한다.
export async function textToPdf(text, fontPx = 15) {
  const doc = await PDFDocument.create();
  const scale = 2;
  const margin = 50;
  const lineHeight = fontPx * 1.6;
  const maxLines = Math.floor((A4.h - margin * 2) / lineHeight);

  const measure = newCanvas(10, 10).getContext('2d');
  measure.font = `${fontPx}px "Malgun Gothic", sans-serif`;
  const maxWidth = A4.w - margin * 2;
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      if (measure.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }

  for (let start = 0; start < lines.length; start += maxLines) {
    const chunk = lines.slice(start, start + maxLines);
    const canvas = newCanvas(A4.w * scale, A4.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    chunk.forEach((line, i) => {
      drawTextBlock(ctx, line, margin * scale, (margin + i * lineHeight) * scale, maxWidth * scale, fontPx * scale, '#111111');
    });
    const png = await doc.embedPng(canvasToPngBytes(canvas));
    const page = doc.addPage([A4.w, A4.h]);
    page.drawImage(png, { x: 0, y: 0, width: A4.w, height: A4.h });
  }
  if (doc.getPageCount() === 0) doc.addPage([A4.w, A4.h]);
  return doc.save();
}
