// 임시 검증 스크립트: electron scripts/smoke.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const samplePath = path.join(__dirname, 'sample.pdf');

async function makeSample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Hello PDF Studio page ${i + 1}`, { x: 60, y: 700, size: 24, font });
  }
  fs.writeFileSync(samplePath, await doc.save());
}

app.whenReady().then(async () => {
  await makeSample();
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'main', 'preload.js'),
      contextIsolation: true
    }
  });
  win.webContents.on('console-message', (_e, level, message, line, source) =>
    console.log(`[renderer:${level}] ${message} (${source}:${line})`)
  );
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));

  const bytes = Array.from(fs.readFileSync(samplePath));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const a = window.__app;
    if (!a) return { error: 'app.js 로드 실패' };
    await a.loadPdf(new Uint8Array(${JSON.stringify(bytes)}), 'sample.pdf');
    const list = a.annotsOf(0);
    list.push({ t: 'pen', color: '#e03131', w: 0.004, pts: [[0.1,0.1],[0.5,0.4]] });
    list.push({ t: 'hl', color: '#ffd43b', x: 0.1, y: 0.5, w: 0.4, h: 0.05 });
    list.push({ t: 'note', text: '검토 필요합니다', x: 0.55, y: 0.1, w: 0.3, h: 0.06, size: 0.014, color: '#e03131' });
    list.push({ t: 'edit', text: '수정된 본문 내용', bg: '#ffffff', x: 0.1, y: 0.62, w: 0.5, h: 0.05, size: 0.014, color: '#111' });
    list.push({ t: 'seal', img: a.makeSealImage('홍길동'), x: 0.7, y: 0.8, w: 0.15, h: 0.15, opacity: 0.95 });
    a.paintOverlay(0);
    const probe = a.state.pages[0].overlay.getContext('2d').getImageData(0, 0, a.state.pages[0].overlay.width, a.state.pages[0].overlay.height).data;
    let painted = 0;
    for (let i = 3; i < probe.length; i += 4) if (probe[i] > 0) painted += 1;

    const textLen = (a.state.textItems[0] || []).reduce((sum, item) => sum + item.str.length, 0);
    const textLayerActive = !!document.querySelector('.text-layer.active');
    a.state.order = [1, 0];
    await a.renderThumbs();
    const reordered = await a.buildOutputBytes();
    const textAfterReorder = (await a.extractPages())[0].slice(0, 30);
    a.state.order = [0, 1];

    const src = a.state.originalBytes;
    const flattened = await a.ops.flattenAnnotations(src, a.state.annots);
    const merged = await a.ops.mergePdfs([src, src]);
    const watermarked = await a.ops.addWatermark(src, { text: '대외비', opacity: 0.2, angle: 45 });
    const textPdf = await a.ops.textToPdf('한글 텍스트 변환 테스트\\n두번째 줄');
    const text = await a.extractPages();
    return {
      overlayPaintedPixels: painted,
      textLen,
      textLayerActive,
      thumbs: document.querySelectorAll('#thumbList .thumb').length,
      reorderedBytes: reordered.length,
      textAfterReorder,
      pages: a.state.pdf.numPages,
      rendered: a.state.pages.length,
      overlaySize: [a.state.pages[0].overlay.width, a.state.pages[0].overlay.height],
      flattenedBytes: flattened.length,
      mergedBytes: merged.length,
      watermarkedBytes: watermarked.length,
      textPdfBytes: textPdf.length,
      header: new TextDecoder().decode(flattened.slice(0, 5)),
      text: text[0].slice(0, 40)
    };
  })()`);

  await new Promise((r) => setTimeout(r, 1200));
  // 홈 탭 리본이 보이도록 유지
  const shot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'smoke-screenshot.png'), shot.toPNG());

  console.log('SMOKE RESULT:', JSON.stringify(result));
  app.exit(result && !result.error ? 0 : 1);
});
