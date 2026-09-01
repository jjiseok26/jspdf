import Tesseract from '../../node_modules/tesseract.js/dist/tesseract.esm.min.js';

const { createWorker } = Tesseract;

let workerPromise = null;

function assetUrl(relative) {
  return new URL(relative, import.meta.url).href;
}

export function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('kor+eng', 1, {
      workerPath: assetUrl('../../node_modules/tesseract.js/dist/worker.min.js'),
      corePath: assetUrl('../../node_modules/tesseract.js-core'),
      workerBlobURL: false,
      logger: () => {}
    });
  }
  return workerPromise;
}

export async function terminateOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}

// 캔버스 이미지에서 단어 단위 bbox를 뽑아 텍스트 레이어에 쓸 좌표로 변환한다.
export async function recognizeCanvas(canvas, onProgress) {
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas, {}, onProgress);
  const scaleX = canvas.width / (data.image?.width || canvas.width);
  const scaleY = canvas.height / (data.image?.height || canvas.height);
  const items = [];
  for (const word of data.words || []) {
    const text = (word.text || '').trim();
    if (!text || (word.confidence ?? 0) < 35) continue;
    const { x0, y0, x1, y1 } = word.bbox;
    items.push({
      str: text,
      left: x0 * scaleX,
      top: y0 * scaleY,
      width: (x1 - x0) * scaleX,
      height: (y1 - y0) * scaleY,
      source: 'ocr'
    });
  }
  return items;
}
