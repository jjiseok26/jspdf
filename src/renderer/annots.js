// 주석/편집 요소는 페이지 크기에 대한 0~1 정규 좌표로 저장되어 확대/축소와 무관하게 유지된다.

export function boundsOf(a) {
  if (a.t === 'pen') {
    const xs = a.pts.map((p) => p[0]);
    const ys = a.pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const w = Math.max(a.w ?? 0.1, 0.04);
  const h = Math.max(a.h ?? 0.05, 0.025);
  return { x: a.x, y: a.y, w, h };
}

export function hitTest(list, x, y) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const b = boundsOf(list[i]);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

export function hitResizeHandle(list, x, y, threshold = 0.025) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const a = list[i];
    if (!['edit', 'note', 'insert', 'hl'].includes(a.t)) continue;
    const b = boundsOf(a);
    if (Math.abs(x - (b.x + b.w)) < threshold && Math.abs(y - (b.y + b.h)) < threshold) {
      return { index: i, corner: 'se' };
    }
  }
  return null;
}

export function moveAnnot(a, dx, dy) {
  if (a.t === 'pen') {
    a.pts = a.pts.map((p) => [p[0] + dx, p[1] + dy]);
  } else {
    a.x += dx;
    a.y += dy;
  }
}

export function resizeAnnot(a, dx, dy) {
  if (a.t === 'pen') return;
  a.w = Math.max(0.04, (a.w || 0.1) + dx);
  a.h = Math.max(0.025, (a.h || 0.05) + dy);
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const ch of paragraph) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function drawTextBlock(ctx, text, px, py, maxWidth, fontPx, color) {
  const size = Math.max(12, fontPx);
  ctx.font = `${size}px "Malgun Gothic", sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, text, maxWidth);
  lines.forEach((line, i) => ctx.fillText(line, px, py + i * size * 1.3));
  return lines.length * size * 1.3;
}

function fontPxFromNorm(sizeNorm, H) {
  return Math.max(12, sizeNorm * H);
}

// clearBackground=false 이면 기존 캔버스(썸네일 PDF) 위에 주석만 합성한다.
export function drawAnnots(ctx, list, W, H, selectedIndex = -1, clearBackground = true) {
  if (clearBackground) ctx.clearRect(0, 0, W, H);
  list.forEach((a, index) => {
    ctx.save();
    if (a.t === 'pen') {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = Math.max(1, a.w * H);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      a.pts.forEach((p, i) => (i ? ctx.lineTo(p[0] * W, p[1] * H) : ctx.moveTo(p[0] * W, p[1] * H)));
      ctx.stroke();
    } else if (a.t === 'hl') {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = a.color;
      ctx.fillRect(a.x * W, a.y * H, a.w * W, a.h * H);
    } else if (a.t === 'note') {
      const fontPx = fontPxFromNorm(a.size, H);
      const padding = fontPx * 0.4;
      const boxW = Math.max(a.w * W, 80);
      const lines = wrapText(ctx, a.text || '', boxW - padding * 2);
      const boxH = Math.max(lines.length * fontPx * 1.3 + padding * 2, fontPx * 2);
      ctx.fillStyle = 'rgba(255, 244, 179, 0.95)';
      ctx.strokeStyle = a.color || '#e03131';
      ctx.lineWidth = 2;
      ctx.fillRect(a.x * W, a.y * H, boxW, boxH);
      ctx.strokeRect(a.x * W, a.y * H, boxW, boxH);
      drawTextBlock(ctx, a.text, a.x * W + padding, a.y * H + padding, boxW - padding * 2, fontPx, '#333');
      a.w = boxW / W;
      a.h = boxH / H;
    } else if (a.t === 'insert') {
      const fontPx = fontPxFromNorm(a.size, H);
      const boxW = Math.max(a.w * W, 60);
      const textH = drawTextBlock(ctx, a.text, a.x * W, a.y * H, boxW, fontPx, a.color || '#111');
      a.h = Math.max(a.h || 0.04, textH / H);
      a.w = boxW / W;
    } else if (a.t === 'edit') {
      const boxW = Math.max(a.w * W, 40);
      const boxH = Math.max(a.h * H, 20);
      ctx.fillStyle = a.bg || '#ffffff';
      ctx.fillRect(a.x * W, a.y * H, boxW, boxH);
      if (a.text) {
        const fontPx = fontPxFromNorm(a.size, H);
        drawTextBlock(ctx, a.text, a.x * W + 4, a.y * H + 4, boxW - 8, fontPx, a.color || '#111');
      } else if (a.pending) {
        ctx.strokeStyle = '#4c8dff';
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(a.x * W, a.y * H, boxW, boxH);
      }
    } else if (a.t === 'seal' && a.img) {
      ctx.globalAlpha = a.opacity ?? 1;
      ctx.drawImage(a.img, a.x * W, a.y * H, a.w * W, a.h * H);
    }
    ctx.restore();

    if (index === selectedIndex) {
      const b = boundsOf(a);
      ctx.save();
      ctx.strokeStyle = '#217346';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x * W - 3, b.y * H - 3, b.w * W + 6, b.h * H + 6);
      if (['edit', 'note', 'insert', 'hl'].includes(a.t)) {
        ctx.fillStyle = '#217346';
        ctx.fillRect(b.x * W + b.w * W - 5, b.y * H + b.h * H - 5, 10, 10);
      }
      ctx.restore();
    }
  });
}

export function makeSealImage(text) {
  const size = 300;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const red = '#c92a2a';
  ctx.strokeStyle = red;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 34, 0, Math.PI * 2);
  ctx.stroke();

  const chars = [...(text || '인').slice(0, 6)];
  const fontPx = chars.length <= 2 ? 110 : chars.length <= 4 ? 84 : 62;
  ctx.fillStyle = red;
  ctx.font = `bold ${fontPx}px "Malgun Gothic", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (chars.length <= 2) {
    ctx.fillText(chars.join(''), size / 2, size / 2);
  } else {
    const cols = 2;
    const rows = Math.ceil(chars.length / cols);
    chars.forEach((ch, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.fillText(ch, size / 2 + (col - (cols - 1) / 2) * fontPx, size / 2 + (row - (rows - 1) / 2) * fontPx);
    });
  }
  return canvas;
}
