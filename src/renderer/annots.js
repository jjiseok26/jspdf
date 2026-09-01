// 주석/편집 요소는 페이지 크기에 대한 0~1 정규 좌표로 저장되어 확대/축소와 무관하게 유지된다.

export function boundsOf(a) {
  if (a.t === 'pen') {
    const xs = a.pts.map((p) => p[0]);
    const ys = a.pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (a.t === 'note') return { x: a.x, y: a.y, w: a.w ?? 0.22, h: a.h ?? 0.06 };
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}

export function hitTest(list, x, y) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const b = boundsOf(list[i]);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
  }
  return -1;
}

export function moveAnnot(a, dx, dy) {
  if (a.t === 'pen') {
    a.pts = a.pts.map((p) => [p[0] + dx, p[1] + dy]);
  } else {
    a.x += dx;
    a.y += dy;
  }
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
  ctx.font = `${fontPx}px "Malgun Gothic", sans-serif`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  const lines = wrapText(ctx, text, maxWidth);
  lines.forEach((line, i) => ctx.fillText(line, px, py + i * fontPx * 1.25));
  return lines.length * fontPx * 1.25;
}

// 하나의 페이지 주석 목록을 투명 캔버스에 그린다. 저장 시에도 같은 함수로 렌더해 화면과 결과가 일치한다.
export function drawAnnots(ctx, list, W, H, selectedIndex = -1) {
  ctx.clearRect(0, 0, W, H);
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
      const fontPx = a.size * H;
      const padding = fontPx * 0.5;
      ctx.font = `${fontPx}px "Malgun Gothic", sans-serif`;
      const lines = wrapText(ctx, a.text, a.w * W - padding * 2);
      const boxH = lines.length * fontPx * 1.25 + padding * 2;
      ctx.fillStyle = 'rgba(255, 244, 179, 0.95)';
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 1.5;
      ctx.fillRect(a.x * W, a.y * H, a.w * W, boxH);
      ctx.strokeRect(a.x * W, a.y * H, a.w * W, boxH);
      drawTextBlock(ctx, a.text, a.x * W + padding, a.y * H + padding, a.w * W - padding * 2, fontPx, '#333');
      a.h = boxH / H;
    } else if (a.t === 'edit') {
      ctx.fillStyle = a.bg || '#ffffff';
      ctx.fillRect(a.x * W, a.y * H, a.w * W, a.h * H);
      drawTextBlock(ctx, a.text, a.x * W + 2, a.y * H + 2, a.w * W - 4, a.size * H, a.color);
    } else if (a.t === 'seal' && a.img) {
      ctx.globalAlpha = a.opacity ?? 1;
      ctx.drawImage(a.img, a.x * W, a.y * H, a.w * W, a.h * H);
    }
    ctx.restore();

    if (index === selectedIndex) {
      const b = boundsOf(a);
      ctx.save();
      ctx.strokeStyle = '#4c8dff';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x * W - 3, b.y * H - 3, b.w * W + 6, b.h * H + 6);
      ctx.restore();
    }
  });
}

// 전자인장: 원형 테두리 + 문구를 그린 이미지를 만든다.
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
