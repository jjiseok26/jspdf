import * as pdfjsLib from '../../node_modules/pdfjs-dist/build/pdf.mjs';
import { recognizeCanvas } from './ocr.js';

const Util = pdfjsLib.Util;

export function textLength(items) {
  return items.reduce((sum, item) => sum + item.str.length, 0);
}

// pdf.js 텍스트 아이템을 뷰포트 좌표(좌상단 기준)로 변환한다.
export async function extractPdfTextItems(page, viewport) {
  const content = await page.getTextContent();
  const items = [];
  for (const item of content.items) {
    const str = item.str;
    if (!str || (!str.trim() && str !== ' ')) continue;
    const transform = Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(transform[2], transform[3]);
    const width = Math.max(fontHeight * 0.5, (item.width || 0) * viewport.scale);
    items.push({
      str,
      left: transform[4],
      top: transform[5] - fontHeight,
      width,
      height: fontHeight,
      source: 'pdf'
    });
  }
  return items;
}

export function renderTextLayer(container, items, width, height, beforeEl = null) {
  const existing = container.querySelector('.text-layer');
  if (existing) existing.remove();

  const layer = document.createElement('div');
  layer.className = 'text-layer';
  layer.style.width = `${width}px`;
  layer.style.height = `${height}px`;

  for (const item of items) {
    const span = document.createElement('span');
    span.textContent = item.str;
    span.dataset.source = item.source;
    span.style.left = `${item.left}px`;
    span.style.top = `${item.top}px`;
    span.style.fontSize = `${Math.max(8, item.height)}px`;
    if (item.width > 0) span.style.width = `${item.width}px`;
    layer.appendChild(span);
  }

  if (beforeEl) container.insertBefore(layer, beforeEl);
  else container.appendChild(layer);
  return layer;
}

export async function buildPageTextItems(page, viewport, canvas, { forceOcr = false } = {}) {
  const pdfItems = await extractPdfTextItems(page, viewport);
  if (!forceOcr && textLength(pdfItems) >= 8) return pdfItems;
  const ocrItems = await recognizeCanvas(canvas);
  return ocrItems.length ? ocrItems : pdfItems;
}

export function itemsToPlainText(items) {
  if (!items.length) return '';
  const lines = new Map();
  for (const item of items) {
    const key = Math.round(item.top / 8);
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(item);
  }
  return [...lines.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row.sort((a, b) => a.left - b.left).map((i) => i.str).join(' '))
    .join('\n')
    .trim();
}
