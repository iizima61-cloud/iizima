/* ====================================================================
   iizima 見積もり適正診断アプリ
   ==================================================================== */

/* ==================== 会社側の設定（データ管理連携） ====================
   Google スプレッドシートに診断依頼（相談希望のお客様）を自動で貯めたい場合は、
   google-apps-script/Code.gs をGoogle Apps Scriptにデプロイして発行される
   ウェブアプリのURLを下の sheetsWebhookUrl に入れてください。
   （手順は SETUP_GOOGLE_SHEETS.md を参照）
   空欄のままなら「専門家に相談する」機能は表示されません。
==================================================================== */
const CONFIG = {
  sheetsWebhookUrl: 'https://script.google.com/macros/s/AKfycbw2TMFIKNnAE63OOmGeiQCglwSUH8yLt-NwkqeNc6JO_bl4x1FEgqOh4pbwSyCFSW2xzg/exec'
};

const SQM_PER_TSUBO = 3.30578;
const HISTORY_KEY = 'iizima_diagnosis_history_v1';
const HISTORY_MAX = 30;

// 施工1㎡あたりの相場（円）。塗装はグレードごとに変動、防水は箇所ごとに変動。
const PAINT_RATE = {
  urethane:  { min: 2500, max: 3500 },
  silicon:   { min: 3000, max: 4000 },
  radical:   { min: 3500, max: 4500 },
  fluorine:  { min: 4000, max: 5000 },
  inorganic: { min: 4500, max: 6000 },
  unknown:   { min: 3000, max: 4500 }
};
const ROOF_FACTOR = 0.85; // 屋根は外壁よりやや単価が下がる目安

// 防水1㎡あたりの相場（円）。工法によって変動する（バルコニー・屋上共通）。
const WATERPROOF_RATE = {
  urethane: { min: 5000, max: 7500 },  // ウレタン防水（密着・通気緩衝工法など）
  frp:      { min: 6500, max: 9500 },  // FRP防水
  sheet:    { min: 6000, max: 12000 }, // 塩ビシート防水
  unknown:  { min: 4500, max: 9000 }
};

const MANUFACTURER_KEYWORDS = [
  "日本ペイント","関西ペイント","エスケー化研","SK化研","アステックペイント","アステック",
  "プレマテックス","日進産業","ガイナ","大日本塗料","水谷ペイント","水谷","菊水化学工業","菊水化学","キクスイ","アトミクス",
  "エーゲンダイヤ","トウペ","中国塗料","ロックペイント","四国化成"
];
const PAINT_PRODUCT_KEYWORDS = [
  "パーフェクトトップ","プレミアムシリコン","超低汚染リファイン","セラMシリコン","ラジカルガード",
  "ナノコンポジット","クリーンマイルド","ファインパーフェクト","ジンクシリコン","エスケーハイフッソ",
  "サーモアイ","ダイナミックトップ","水性シリコン"
];
const GRADE_KEYWORDS = [
  { grade: "inorganic", words: ["無機","むき","ハイブリッド無機"] },
  { grade: "fluorine",  words: ["フッ素","ふっ素"] },
  { grade: "radical",   words: ["ラジカル制御","ラジカル系","ラジカル"] },
  { grade: "silicon",   words: ["シリコン"] },
  { grade: "urethane",  words: ["ウレタン塗料","ウレタン系"] }
];
const REPAIR_KEYWORDS = ["ケレン","クラック","シーリング","コーキング","下地補修","下地調整","サーフェサー","カチオン","目地補修","ひび割れ補修"];
const DRAIN_KEYWORDS = ["改修ドレン","ドレン交換","ドレン改修","ドレン"];
const WALL_KEYWORDS = ["外壁塗装","外壁"];
const ROOF_KEYWORDS = ["屋根塗装","屋根"];
const BALCONY_KEYWORDS = ["バルコニー防水","ベランダ防水","バルコニー","ベランダ"];
const ROOFTOP_KEYWORDS = ["屋上防水","屋上"];
const WATERPROOF_METHOD_KEYWORDS = ["ウレタン防水","FRP防水","塩ビシート","シート防水","通気緩衝","トップコート"];
const WATERPROOF_METHOD_GRADE_KEYWORDS = [
  { method: "sheet",    words: ["塩ビシート","シート防水"] },
  { method: "frp",      words: ["FRP防水","ＦＲＰ防水"] },
  { method: "urethane", words: ["ウレタン防水"] }
];
const SCAFFOLD_KEYWORDS = ["足場"];
const WARRANTY_KEYWORDS = ["保証書","保証期間","瑕疵保証","アフター保証"];

const GRADE_LABELS = { urethane: 'ウレタン', silicon: 'シリコン', radical: 'ラジカル制御', fluorine: 'フッ素', inorganic: '無機' };
const WATERPROOF_METHOD_LABELS = { urethane: 'ウレタン防水', frp: 'FRP防水', sheet: '塩ビシート防水' };

/* ---- フェーズ3: 3社比較用のキーワード ---- */
const SEALING_KEYWORDS = ["シーリング", "コーキング"];
const SUBSTRATE_KEYWORDS = ["下地処理", "下地補修", "下地調整", "ケレン", "クラック補修", "カチオン", "サーフェサー"];
const ATTACHED_WORK_KEYWORDS = ["付帯部", "破風", "鼻隠し", "軒天", "雨樋", "戸袋", "水切り", "笠木"];

/* ==================== タブ切り替え ==================== */
function initTabs() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'history') renderHistory();
  document.querySelector('main').scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  window.scrollTo(0, 0);
}

/* ==================== UI: 面積欄の表示切り替え ==================== */
function onScopeChange() {
  toggle('chk-wall', 'area-wall-wrap');
  toggle('chk-roof', 'area-roof-wrap');
  toggle('chk-balcony', 'area-balcony-wrap');
  toggle('chk-rooftop', 'area-rooftop-wrap');

  const paintActive = document.getElementById('chk-wall').checked || document.getElementById('chk-roof').checked;
  const waterActive = document.getElementById('chk-balcony').checked || document.getElementById('chk-rooftop').checked;

  setRowEnabled('row-no-paint-name', paintActive);
  setRowEnabled('row-no-repair', paintActive);
  setRowEnabled('row-no-drain', waterActive);
}
function toggle(chkId, wrapId) {
  document.getElementById(wrapId).classList.toggle('show', document.getElementById(chkId).checked);
}
function setRowEnabled(rowId, enabled) {
  const row = document.getElementById(rowId);
  row.classList.toggle('disabled', !enabled);
  if (!enabled) row.querySelector('input[type=checkbox]').checked = false;
}
function onAreaChange() {
  updateTsuboHint('area-wall','tsubo-wall');
  updateTsuboHint('area-roof','tsubo-roof');
  updateTsuboHint('area-balcony','tsubo-balcony');
  updateTsuboHint('area-rooftop','tsubo-rooftop');
}
function updateTsuboHint(inputId, hintId) {
  const v = parseFloat(document.getElementById(inputId).value) || 0;
  document.getElementById(hintId).innerText = `（約${(v / SQM_PER_TSUBO).toFixed(1)}坪）`;
}

/* ==================== サンプルデータ ==================== */
function loadSample(type) {
  document.getElementById('chk-wall').checked = true;
  document.getElementById('chk-roof').checked = false;
  document.getElementById('chk-balcony').checked = false;
  document.getElementById('chk-rooftop').checked = true;

  if (type === 'danger') {
    document.getElementById('area-wall').value = 130;
    document.getElementById('area-rooftop').value = 45;
    document.getElementById('total-price').value = 210;
    document.getElementById('paint-grade').value = 'silicon';
    document.getElementById('discount-amount').value = 40;
    setChecks(true, true, true, true, true);
  } else if (type === 'cheap') {
    document.getElementById('area-wall').value = 140;
    document.getElementById('area-rooftop').value = 50;
    document.getElementById('total-price').value = 68;
    document.getElementById('paint-grade').value = 'urethane';
    document.getElementById('discount-amount').value = 0;
    setChecks(true, false, true, true, false);
  } else if (type === 'good') {
    document.getElementById('area-wall').value = 125;
    document.getElementById('area-rooftop').value = 40;
    document.getElementById('total-price').value = 148;
    document.getElementById('paint-grade').value = 'fluorine';
    document.getElementById('discount-amount').value = 3;
    setChecks(false, false, false, false, false);
  }
  onScopeChange();
  onAreaChange();
  document.getElementById('ai-report').style.display = 'none';
}
function setChecks(isshiki, noPaint, noRepair, noDrain, pushy) {
  document.getElementById('chk-isshiki').checked = isshiki;
  document.getElementById('chk-no-paint-name').checked = noPaint;
  document.getElementById('chk-no-repair').checked = noRepair;
  document.getElementById('chk-no-drain').checked = noDrain;
  document.getElementById('chk-pushy').checked = pushy;
}

/* ==================== ファイル読み込み・OCR ==================== */
function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

  document.getElementById('selected-file-clear').addEventListener('click', e => {
    e.stopPropagation();
    clearSelectedFile();
  });

  if (window['pdfjsLib']) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

let selectedFileThumbUrl = null;
async function showSelectedFile(file) {
  const info = document.getElementById('selected-file-info');
  const nameEl = document.getElementById('selected-file-name');
  const thumbEl = document.getElementById('selected-file-thumb');

  nameEl.textContent = file.name;
  info.classList.add('show');

  if (selectedFileThumbUrl) { URL.revokeObjectURL(selectedFileThumbUrl); selectedFileThumbUrl = null; }
  thumbEl.classList.remove('show');
  thumbEl.removeAttribute('src');

  if (file.type.startsWith('image/')) {
    selectedFileThumbUrl = URL.createObjectURL(file);
    thumbEl.src = selectedFileThumbUrl;
    thumbEl.classList.add('show');
  } else if (file.type === 'application/pdf') {
    try {
      const dataUrl = await renderPdfThumbnail(file);
      if (dataUrl && document.getElementById('selected-file-name').textContent === file.name) {
        thumbEl.src = dataUrl;
        thumbEl.classList.add('show');
        renderResultFileInfo();
      }
    } catch (err) {
      console.warn('PDFのプレビュー画像を作成できませんでした。', err);
    }
  }
}

async function renderPdfThumbnail(file) {
  if (typeof pdfjsLib === 'undefined') return null;
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc = await getPdfWorkerSrc();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas.toDataURL('image/png');
}
function clearSelectedFile() {
  document.getElementById('selected-file-info').classList.remove('show');
  document.getElementById('file-input').value = '';
  if (selectedFileThumbUrl) { URL.revokeObjectURL(selectedFileThumbUrl); selectedFileThumbUrl = null; }
}

// ids を渡すと、単体診断の読み込み状況表示（#scan-status等）以外の場所
// （フェーズ3の3社比較の各社スロットなど）にも同じ仕組みで進捗を表示できる。
// 省略した場合は今まで通り単体診断の表示要素を使うため、既存の挙動は変わらない。
function setScanStatus(text, percent, ids) {
  ids = ids || { status: 'scan-status', progress: 'scan-progress', bar: 'scan-progress-bar' };
  const statusEl = document.getElementById(ids.status);
  const progEl = document.getElementById(ids.progress);
  const barEl = document.getElementById(ids.bar);
  if (!statusEl || !progEl || !barEl) return;
  if (text === null) { statusEl.style.display = 'none'; progEl.style.display = 'none'; return; }
  statusEl.style.display = 'block';
  statusEl.innerText = text;
  if (typeof percent === 'number') {
    progEl.style.display = 'block';
    barEl.style.width = Math.max(0, Math.min(100, percent)) + '%';
  }
}

async function handleFile(file) {
  showSelectedFile(file);

  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');

  if (!isPdf && !isImage) {
    alert('画像（JPG/PNG）またはPDFファイルを選択してください。');
    return;
  }
  if (isPdf && typeof pdfjsLib === 'undefined') {
    alert('PDFを読み取る部品がインターネットから取得できていないため、PDFの自動読み取りができません。\n\n・インターネットに接続されているかご確認のうえ、ページを再読み込みしてお試しください。\n・改善しない場合は、見積書の文字を「文字を貼り付ける」欄にコピーして貼り付けてください。');
    return;
  }
  if (isImage && typeof Tesseract === 'undefined') {
    alert('写真から文字を読み取る部品がインターネットから取得できていないため、画像の自動読み取りができません。\n\n・インターネットに接続されているかご確認のうえ、ページを再読み込みしてお試しください。\n・改善しない場合は、見積書の文字を「文字を貼り付ける」欄にコピーして貼り付けてください。');
    return;
  }

  try {
    setScanStatus('見積書を読み込んでいます…', 5);
    const extractPromise = isPdf ? extractTextFromPDF(file) : extractTextFromImage(file);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 30000));
    const text = await Promise.race([extractPromise, timeoutPromise]);
    setScanStatus('内容を解析しています…', 95);
    const data = analyzeText(normalizeText(text));
    applyExtractedData(data);
    setScanStatus(null);
  } catch (err) {
    console.error(err);
    setScanStatus(null);
    if (err && err.message === 'TIMEOUT') {
      alert('30秒待っても読み込みが完了しませんでした。\n\nこのファイルの自動読み取りはうまくいかない可能性があります。お手数ですが、見積書の文字を「文字を貼り付ける」欄にコピーして貼り付けてください。');
    } else {
      alert('読み込み中にエラーが発生しました。お手数ですが、下の「文字を貼り付ける」欄をお試しください。\n\n(エラー内容: ' + (err && err.message ? err.message : err) + ')');
    }
  }
}

// file:// で開いた場合、CDN上のワーカースクリプトをそのまま指定すると
// ブラウザのセキュリティ制限でWorkerの生成に失敗することがある。
// 一度スクリプトを取得してBlob化することで「同一オリジン」として扱わせ、回避する。
let pdfWorkerBlobUrlPromise = null;
function getPdfWorkerSrc() {
  if (!pdfWorkerBlobUrlPromise) {
    const cdnUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    pdfWorkerBlobUrlPromise = fetch(cdnUrl)
      .then(res => { if (!res.ok) throw new Error('status ' + res.status); return res.text(); })
      .then(code => URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
      .catch(err => { console.warn('PDFワーカーのBlob化に失敗。直接CDNを指定します。', err); return cdnUrl; });
  }
  return pdfWorkerBlobUrlPromise;
}

let tesseractWorkerBlobUrlPromise = null;
function getTesseractWorkerPath() {
  if (!tesseractWorkerBlobUrlPromise) {
    const cdnUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.4/dist/worker.min.js';
    tesseractWorkerBlobUrlPromise = fetch(cdnUrl)
      .then(res => { if (!res.ok) throw new Error('status ' + res.status); return res.text(); })
      .then(code => URL.createObjectURL(new Blob([code], { type: 'text/javascript' })))
      .catch(err => { console.warn('OCRワーカーのBlob化に失敗。既定の読み込み方法を使用します。', err); return null; });
  }
  return tesseractWorkerBlobUrlPromise;
}

async function extractTextFromPDF(file, statusIds) {
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc = await getPdfWorkerSrc();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  const pageCount = Math.min(pdf.numPages, 5);
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  // テキストがほぼ無い＝スキャン画像PDFの可能性 → OCRへフォールバック
  if (text.replace(/\s/g, '').length < 20) {
    setScanStatus('画像として認識しています（少し時間がかかります）…', 20, statusIds);
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    text = await ocrCanvas(canvas, statusIds);
  }
  return text;
}

async function extractTextFromImage(file, statusIds) {
  return await ocrFile(file, statusIds);
}

// 文字認識の精度を上げるため、グレースケール化＋コントラスト強調を行う。
// スマホ写真は照明のムラや低コントラストで誤読しやすいため、白黒をはっきりさせる。
function enhanceCanvasForOcr(canvas) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const contrast = 1.35;
  const intercept = 128 * (1 - contrast);
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let v = gray * contrast + intercept;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// 解像度が低い写真は拡大してから認識にかけると精度が上がりやすい。
async function prepareImageForOcr(file) {
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    URL.revokeObjectURL(url);

    const minWidth = 1600;
    const scale = img.width < minWidth ? minWidth / img.width : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    enhanceCanvasForOcr(canvas);
    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('画像の前処理に失敗したため、元の画像でOCRを実行します。', err);
    return file;
  }
}

async function ocrFile(file, statusIds) {
  const workerPath = await getTesseractWorkerPath();
  const options = {
    logger: m => {
      if (m.status === 'recognizing text') {
        setScanStatus('文字を読み取っています…', 20 + Math.round(m.progress * 70), statusIds);
      }
    }
  };
  if (workerPath) options.workerPath = workerPath;
  const source = await prepareImageForOcr(file);
  const { data } = await Tesseract.recognize(source, 'jpn+eng', options);
  return data.text;
}
async function ocrCanvas(canvas, statusIds) {
  const workerPath = await getTesseractWorkerPath();
  const options = {
    logger: m => {
      if (m.status === 'recognizing text') {
        setScanStatus('文字を読み取っています…', 20 + Math.round(m.progress * 70), statusIds);
      }
    }
  };
  if (workerPath) options.workerPath = workerPath;
  enhanceCanvasForOcr(canvas);
  const { data } = await Tesseract.recognize(canvas.toDataURL('image/png'), 'jpn+eng', options);
  return data.text;
}

function analyzePastedText() {
  const raw = document.getElementById('paste-text').value;
  if (!raw.trim()) { alert('文章を貼り付けてください。'); return; }
  const data = analyzeText(normalizeText(raw));
  applyExtractedData(data);
}

/* ==================== テキスト正規化・抽出ロジック ==================== */
function normalizeText(text) {
  // 全角数字→半角
  text = text.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  // 面積の単位ゆれを統一
  text = text.replace(/平方メートル|平米|㎡|m2|m²/g, 'm2');
  // 余分な空白を軽く整理（数字と単位がくっつくよう）
  text = text.replace(/[，]/g, ',');
  return text;
}

// 指定キーワードの直後付近（40文字以内）にある「◯◯m2」を探す。
// 「外壁 120m2」「屋根塗装：60.5m2」のように、工事項目ごとに書かれた面積を拾うために使う。
function extractAreaNear(text, keywords) {
  for (const kw of keywords) {
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(kw, searchFrom);
      if (idx === -1) break;
      const window = text.slice(idx, idx + 40);
      const m = window.match(/([0-9]+(?:\.[0-9]+)?)\s*m2/);
      if (m) return parseFloat(m[1]);
      searchFrom = idx + kw.length;
    }
  }
  return null;
}

function analyzeText(text) {
  const result = {
    totalPriceMan: null, areaSqm: null, grade: null, manufacturer: null,
    isshikiCount: 0, hasRepairKeywords: false, hasDrainKeyword: false,
    hasWall: false, hasRoof: false, hasBalcony: false, hasRooftop: false,
    hasWaterproofMethod: false, waterproofMethod: null, hasScaffold: false, hasWarranty: false,
    discountMan: null, foundKeywords: []
  };

  // ---- 総額の抽出 ----
  // 「円」表記だけでなく「¥」記号や、「お見積金額」「合計」など見出しの直後に
  // 金額だけが書かれているケース（円もなし）にも対応する。
  let priceMatch = text.match(/(?:お見積金額|御見積金額|見積金額|御見積合計|見積合計|合計金額|ご請求金額|総額|合計|税込)[^0-9]{0,10}([0-9][0-9,]{4,})/);
  if (!priceMatch) priceMatch = text.match(/([0-9][0-9,]{4,})\s*円\s*(?:（?税込）?)/);
  if (priceMatch) {
    result.totalPriceMan = Math.round(parseInt(priceMatch[1].replace(/,/g, ''), 10) / 1000) / 10;
  } else {
    // フェールセーフ：文中で最も大きい「円」または「¥」付きの金額（10万円以上）を採用
    const yenSuffixed = [...text.matchAll(/([0-9][0-9,]{4,})\s*円/g)].map(m => parseInt(m[1].replace(/,/g, ''), 10));
    const yenPrefixed = [...text.matchAll(/[¥￥]\s*([0-9][0-9,]{4,})/g)].map(m => parseInt(m[1].replace(/,/g, ''), 10));
    const all = [...yenSuffixed, ...yenPrefixed].filter(n => n >= 100000);
    if (all.length) result.totalPriceMan = Math.round(Math.max(...all) / 1000) / 10;
  }

  // ---- 値引き額の抽出 ----
  const discountMatch = text.match(/(?:値引き|値引|割引)[^0-9]{0,10}([0-9][0-9,]{2,})\s*円/);
  if (discountMatch) {
    result.discountMan = Math.round(parseInt(discountMatch[1].replace(/,/g, ''), 10) / 1000) / 10;
  }

  // ---- 面積の抽出（工事項目ごと。見つからない場合は書類全体から1つだけ拾う）----
  result.areaWall = extractAreaNear(text, WALL_KEYWORDS);
  result.areaRoof = extractAreaNear(text, ROOF_KEYWORDS);
  result.areaBalcony = extractAreaNear(text, BALCONY_KEYWORDS);
  result.areaRooftop = extractAreaNear(text, ROOFTOP_KEYWORDS);

  let areaMatch = text.match(/(?:施工面積|延床面積|塗装面積|面積)[^0-9]{0,6}([0-9]+(?:\.[0-9]+)?)\s*m2/);
  if (!areaMatch) areaMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*m2/);
  if (areaMatch) {
    result.areaSqm = parseFloat(areaMatch[1]);
  } else {
    const tsuboMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*坪/);
    if (tsuboMatch) result.areaSqm = Math.round(parseFloat(tsuboMatch[1]) * SQM_PER_TSUBO * 10) / 10;
  }

  // ---- 塗料グレード ----
  for (const g of GRADE_KEYWORDS) {
    if (g.words.some(w => text.includes(w))) { result.grade = g.grade; break; }
  }

  // ---- 防水工法 ----
  for (const wm of WATERPROOF_METHOD_GRADE_KEYWORDS) {
    if (wm.words.some(w => text.includes(w))) { result.waterproofMethod = wm.method; break; }
  }

  // ---- メーカー・商品名 ----
  // 壁と屋根で違うメーカーの塗料を使うケースもあるため、見つかった分はすべて拾う
  // （「水谷ペイント」と「水谷」のような、同じメーカーの略記の重複はまとめる）
  const foundManufacturers = [];
  for (const m of MANUFACTURER_KEYWORDS) {
    if (!text.includes(m)) continue;
    if (foundManufacturers.some(existing => existing.includes(m) || m.includes(existing))) continue;
    foundManufacturers.push(m);
  }
  if (!foundManufacturers.length) {
    for (const p of PAINT_PRODUCT_KEYWORDS) { if (text.includes(p)) { foundManufacturers.push(p); break; } }
  }
  result.manufacturers = foundManufacturers;
  result.manufacturer = foundManufacturers[0] || null;
  result.foundKeywords = foundManufacturers;

  // ---- 一式の出現回数 ----
  result.isshikiCount = (text.match(/一式/g) || []).length;

  // ---- 下地補修キーワード ----
  result.hasRepairKeywords = REPAIR_KEYWORDS.some(k => text.includes(k));
  // ---- ドレン ----
  result.hasDrainKeyword = DRAIN_KEYWORDS.some(k => text.includes(k));
  // ---- 防水工法 ----
  result.hasWaterproofMethod = WATERPROOF_METHOD_KEYWORDS.some(k => text.includes(k));
  // ---- 足場 ----
  result.hasScaffold = SCAFFOLD_KEYWORDS.some(k => text.includes(k));
  // ---- 保証 ----
  result.hasWarranty = WARRANTY_KEYWORDS.some(k => text.includes(k));

  // ---- 工事範囲の推定 ----
  result.hasWall = WALL_KEYWORDS.some(k => text.includes(k));
  result.hasRoof = ROOF_KEYWORDS.some(k => text.includes(k));
  result.hasBalcony = BALCONY_KEYWORDS.some(k => text.includes(k));
  result.hasRooftop = ROOFTOP_KEYWORDS.some(k => text.includes(k)) && !result.hasBalcony;

  return result;
}

/* ---- フェーズ3: 3社比較用のテキスト解析（既存のanalyzeTextを流用し、比較に必要な項目だけ追加で判定する） ----
   analyzeTextはDOMを一切書き換えない純粋な関数なので、単体診断とは別に何度呼び出しても
   既存の診断結果には影響しない。 */
function analyzeForCompare(text) {
  const base = analyzeText(text);

  const hasSealing = SEALING_KEYWORDS.some(k => text.includes(k));
  const hasSubstrate = SUBSTRATE_KEYWORDS.some(k => text.includes(k));
  const hasAttachedWork = ATTACHED_WORK_KEYWORDS.some(k => text.includes(k));
  const hasWaterproofWork = base.hasBalcony || base.hasRooftop || base.hasWaterproofMethod;

  let scaffold = '記載なし（不明）';
  if (base.hasScaffold) {
    const idx = text.indexOf('足場');
    const around = text.slice(Math.max(0, idx - 10), idx + 20);
    scaffold = /別途|別料金/.test(around) ? '別途（追加費用の可能性）' : '見積りに含まれている様子';
  }

  let warranty = '記載なし（不明）';
  if (base.hasWarranty) {
    const warrantyMatch = text.match(/([0-9]+)\s*年[^0-9]{0,6}保証|保証[^0-9]{0,6}([0-9]+)\s*年/);
    warranty = warrantyMatch ? `${warrantyMatch[1] || warrantyMatch[2]}年保証の記載あり` : '保証についての記載あり（詳細は要確認）';
  }

  return {
    totalPriceMan: base.totalPriceMan,
    areaWall: base.areaWall, areaRoof: base.areaRoof, areaBalcony: base.areaBalcony, areaRooftop: base.areaRooftop, areaSqm: base.areaSqm,
    grade: base.grade, manufacturers: base.manufacturers, waterproofMethod: base.waterproofMethod,
    hasSealing, hasSubstrate, hasAttachedWork, hasWaterproofWork, scaffold, warranty
  };
}

function applyExtractedData(d) {
  const reportLines = [];

  if (d.totalPriceMan) {
    document.getElementById('total-price').value = d.totalPriceMan;
    reportLines.push(`💰 見積もり総額として <b>約${d.totalPriceMan}万円</b> を読み取りました。金額欄と一致しているか、念のためご確認ください。`);
  } else {
    reportLines.push(`💰 総額をうまく読み取れませんでした。お手数ですが「見積もり提示総額」欄に手入力をお願いします。`);
  }

  const areaLines = [];
  if (d.areaWall) areaLines.push(`外壁 約${d.areaWall}㎡`);
  if (d.areaRoof) areaLines.push(`屋根 約${d.areaRoof}㎡`);
  if (d.areaBalcony) areaLines.push(`バルコニー 約${d.areaBalcony}㎡`);
  if (d.areaRooftop) areaLines.push(`屋上 約${d.areaRooftop}㎡`);
  if (areaLines.length) {
    reportLines.push(`📐 施工面積として ${areaLines.join('、')} を読み取りました。`);
  } else if (d.areaSqm) {
    reportLines.push(`📐 施工面積として <b>約${d.areaSqm}㎡</b> を読み取りました。該当する工事範囲の面積欄に反映しています。`);
  }

  if (d.hasWall) { document.getElementById('chk-wall').checked = true; if (d.areaWall) document.getElementById('area-wall').value = d.areaWall; else if (d.areaSqm) document.getElementById('area-wall').value = d.areaSqm; }
  if (d.hasRoof) { document.getElementById('chk-roof').checked = true; if (d.areaRoof) document.getElementById('area-roof').value = d.areaRoof; else if (d.areaSqm && !d.hasWall) document.getElementById('area-roof').value = d.areaSqm; }
  if (d.hasBalcony) { document.getElementById('chk-balcony').checked = true; if (d.areaBalcony) document.getElementById('area-balcony').value = d.areaBalcony; else if (d.areaSqm && !d.hasWall && !d.hasRoof) document.getElementById('area-balcony').value = d.areaSqm; }
  if (d.hasRooftop) { document.getElementById('chk-rooftop').checked = true; if (d.areaRooftop) document.getElementById('area-rooftop').value = d.areaRooftop; else if (d.areaSqm && !d.hasWall && !d.hasRoof && !d.hasBalcony) document.getElementById('area-rooftop').value = d.areaSqm; }
  if (!d.hasWall && !d.hasRoof && !d.hasBalcony && !d.hasRooftop) {
    // 何も検出できなければ、初期値の外壁塗装のみ有効化しておく
    document.getElementById('chk-wall').checked = true;
  }
  onScopeChange();
  onAreaChange();

  if (d.discountMan) {
    document.getElementById('discount-amount').value = d.discountMan;
    reportLines.push(`💸 値引きとして <b>約${d.discountMan}万円</b> の記載を見つけました。値引き額欄に反映しています。`);
  }

  if (d.grade) {
    document.getElementById('paint-grade').value = d.grade;
    document.getElementById('grade-auto').style.display = 'inline-block';
    const gradeName = GRADE_LABELS[d.grade];
    reportLines.push(`🎨 塗料のグレードとして <b>「${gradeName}」</b> という記載を見つけました。グレードによって適正相場が変わるため、自動で反映しています。`);
  } else {
    document.getElementById('grade-auto').style.display = 'none';
  }

  if (d.waterproofMethod) {
    document.getElementById('waterproof-method').value = d.waterproofMethod;
    document.getElementById('method-auto').style.display = 'inline-block';
    const methodName = WATERPROOF_METHOD_LABELS[d.waterproofMethod];
    reportLines.push(`🧴 防水工法として <b>「${methodName}」</b> という記載を見つけました。工法によって適正相場が変わるため、自動で反映しています。`);
  } else {
    document.getElementById('method-auto').style.display = 'none';
  }

  if (d.manufacturers && d.manufacturers.length) {
    document.getElementById('chk-no-paint-name').checked = false;
    reportLines.push(`🏭 塗料メーカー・商品名として <b>「${d.manufacturers.join('」「')}」</b> の記載を確認しました。メーカー名がはっきりしているのは良い傾向です。`);
  } else {
    reportLines.push(`🏭 塗料のメーカー名・正式な商品名は見つかりませんでした。「◯◯シリコン塗料」のような曖昧な表記のみの可能性があります。`);
  }

  document.getElementById('chk-isshiki').checked = d.isshikiCount >= 4;
  if (d.isshikiCount > 0) {
    reportLines.push(`📋 見積書の中に「一式」という言葉が <b>${d.isshikiCount}回</b> 見つかりました。${d.isshikiCount >= 4 ? 'やや多めなので、内訳の開示を求めることをおすすめします。' : 'この程度であれば大きな問題ではないことが多いです。'}`);
  }

  document.getElementById('chk-no-repair').checked = !d.hasRepairKeywords;
  if (d.hasRepairKeywords) {
    reportLines.push(`🛠️ ひび割れ補修・シーリングなど下地処理に関する記載を確認できました。`);
  }

  const waterActiveNow = document.getElementById('chk-balcony').checked || document.getElementById('chk-rooftop').checked;
  if (waterActiveNow) {
    document.getElementById('chk-no-drain').checked = !d.hasDrainKeyword;
    if (d.hasDrainKeyword) reportLines.push(`🚿 防水工事に必要な「改修ドレン」についての記載を確認できました。`);
  }

  if (d.hasScaffold) {
    reportLines.push(`🪜 「足場」に関する記載を確認できました。`);
  } else {
    reportLines.push(`🪜 「足場」についての記載が見当たりませんでした。外壁・屋根の工事では通常必須の費用のため、別途か含まれているか確認しましょう。`);
  }

  if (d.hasWarranty) {
    reportLines.push(`📜 保証についての記載を確認できました。保証期間・保証範囲を契約前に確認しておくと安心です。`);
  }

  const reportBox = document.getElementById('ai-report');
  reportBox.innerHTML = `<h3>🤖 AI読み取りレポート</h3><ul>${reportLines.map(l => `<li>${l}</li>`).join('')}</ul><p style="margin:8px 0 0;color:#a0733a;font-size:11px;">※文字認識には誤読の可能性があります。診断前に必ず内容をご確認・修正ください。</p>`;
  reportBox.style.display = 'block';
  reportBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // 「この診断になった理由」表示で、AIが実際に読み取れた項目/読み取れなかった項目を
  // 区別して示すために保持しておく（推測値を読み取り結果として扱わないため）。
  lastExtraction = d;
}

/* ==================== 診断ロジック ==================== */
function getPaintRateRange(grade) {
  const base = PAINT_RATE[grade] || PAINT_RATE.unknown;
  return base;
}

/* ---- フェーズ1: 総合点の意味・価格判定・5項目評価・確認ポイント ---- */
function getScoreMeaning(score) {
  if (score >= 85) return 'とても良い内容です。安心して検討を進められます。';
  if (score >= 70) return '大きな問題は見当たりませんが、いくつか確認しておきたい項目があります。';
  if (score >= 55) return '気になる点がいくつかあります。契約前に業者へしっかり確認しましょう。';
  if (score >= 40) return '不透明な点が目立ちます。慎重な確認をおすすめします。';
  return 'リスクが高い内容です。契約を急がず、他社にも相見積もりを取りましょう。';
}

// 価格判定を5段階（🟢おおむね妥当 / 🟡やや高め / 🟡やや安め / 🔴安すぎる可能性 / ⚪判断材料不足）で返す。
function getPriceJudgement(price, expectedMinMan, expectedMaxMan) {
  if (!(expectedMinMan > 0)) {
    return { icon: '⚪', label: '判断材料不足', tone: 'neutral' };
  }
  if (price < expectedMinMan * 0.75) return { icon: '🔴', label: '安すぎる可能性', tone: 'danger' };
  if (price < expectedMinMan) return { icon: '🟡', label: 'やや安め', tone: 'warn' };
  if (price <= expectedMaxMan * 1.15) return { icon: '🟢', label: 'おおむね妥当', tone: 'good' };
  return { icon: '🟡', label: 'やや高め', tone: 'warn' };
}

// 「安すぎる」場合に確認したいポイント
const CHEAP_CHECK_POINTS = [
  '施工範囲（面積）が正しく計測されているか',
  '下塗り・中塗り・上塗りなど、工程が省略されていないか',
  'シーリング（コーキング）工事が含まれているか',
  '付帯部（破風板・雨樋など）の塗装が別料金になっていないか',
  '足場代が別途請求になっていないか',
  '記載されている塗料・防水材のグレードが、実際に使われるものと合っているか'
];
// 「高い」場合に考えられる理由の候補
const EXPENSIVE_REASON_POINTS = [
  '施工面積が実際より大きく計上されている可能性',
  '高耐久グレードの塗料・工法が使われる前提になっている可能性',
  '下地処理（補修・ケレンなど）の費用が多めに含まれている可能性',
  'シーリング工事の範囲が広く設定されている可能性',
  '防水工事が別途含まれている可能性',
  '付帯部塗装の項目が多く含まれている可能性'
];

// 総合点を5項目（価格・透明性・施工内容・材料塗料・注意事項）に分解する。
// 既存のscore計算で使っている判定材料（isIsshiki等）をそのまま流用する。
function computeSubScores(ctx) {
  const { priceJudgement, isIsshiki, isPushy, discount, paintActive, waterActive, isNoPaintName, isNoRepair, isNoDrain, waterproofMethod } = ctx;
  const clamp = v => Math.max(0, Math.min(100, v));

  const priceScoreMap = { good: 95, warn: 65, danger: 35, neutral: null };
  const priceScore = priceScoreMap[priceJudgement.tone];

  const transparencyScore = clamp(100 - (isIsshiki ? 40 : 0));

  let workScore = 100;
  if (paintActive && isNoRepair) workScore -= 35;
  if (waterActive && isNoDrain) workScore -= 30;
  workScore = clamp(workScore);

  let materialScore = 100;
  if (paintActive && isNoPaintName) materialScore -= 40;
  if (waterActive && waterproofMethod === 'unknown') materialScore -= 20;
  materialScore = clamp(materialScore);

  let cautionScore = 100;
  if (isPushy) cautionScore -= 50;
  if (discount >= 10) cautionScore -= 30;
  cautionScore = clamp(cautionScore);

  return [
    { key: 'price', label: '① 価格', score: priceScore,
      desc: priceScore === null ? '面積・工事内容の入力が不足しており判断できません。' : `適正相場と比べて「${priceJudgement.label}」です。` },
    { key: 'transparency', label: '② 見積書の透明性', score: transparencyScore,
      desc: isIsshiki ? '「一式」表記が多く、内訳が分かりにくい状態です。' : '数量や内訳がある程度明確に書かれています。' },
    { key: 'work', label: '③ 施工内容', score: workScore,
      desc: workScore < 100 ? '下地処理や改修ドレンなど、必要な工程の記載が一部見当たりません。' : '必要な工程がひととおり記載されています。' },
    { key: 'material', label: '④ 材料・塗料', score: materialScore,
      desc: materialScore < 100 ? '塗料メーカー名や防水工法など、材料に関する記載が不明確です。' : '使用する材料・工法の情報が明確です。' },
    { key: 'caution', label: '⑤ 注意事項', score: cautionScore,
      desc: cautionScore < 100 ? '値引きや契約を急がせる表現など、注意したい記載があります。' : '契約を急がせるような不審な記載はありません。' }
  ];
}

function subscoreTone(score) {
  if (score === null) return 'neutral';
  if (score >= 80) return 'good';
  if (score >= 55) return 'warn';
  return 'danger';
}

// AIが実際に読み取れた項目／読み取れなかった項目を明示する
// （読み取れなかった場合に、推測値を「読み取れた事実」として見せないため）。
function buildReasonList(ctx) {
  const { wallOn, roofOn, balconyOn, rooftopOn, paintActive, waterActive } = ctx;
  const lines = [];
  const ext = lastExtraction;

  if (!ext) {
    lines.push('ℹ️ 見積書の自動読み取りは行っていません。フォームに入力された内容をもとに診断しています。');
    return lines;
  }

  lines.push(ext.totalPriceMan
    ? `✅ 見積書から総額（約${ext.totalPriceMan}万円）が読み取れました。`
    : '❔ 総額は見積書から読み取れませんでした（不明）。入力された金額をもとに診断しています。');

  if (wallOn) {
    lines.push(ext.areaWall
      ? `✅ 外壁の施工面積（約${ext.areaWall}㎡）が読み取れました。`
      : '❔ 外壁の施工面積は読み取れませんでした（不明）。');
  }
  if (roofOn) {
    lines.push(ext.areaRoof
      ? `✅ 屋根の施工面積（約${ext.areaRoof}㎡）が読み取れました。`
      : '❔ 屋根の施工面積は読み取れませんでした（不明）。');
  }
  if (balconyOn) {
    lines.push(ext.areaBalcony
      ? `✅ バルコニーの施工面積（約${ext.areaBalcony}㎡）が読み取れました。`
      : '❔ バルコニーの施工面積は読み取れませんでした（不明）。');
  }
  if (rooftopOn) {
    lines.push(ext.areaRooftop
      ? `✅ 屋上の施工面積（約${ext.areaRooftop}㎡）が読み取れました。`
      : '❔ 屋上の施工面積は読み取れませんでした（不明）。');
  }

  if (paintActive) {
    lines.push(ext.grade
      ? `✅ 塗料のグレード（${GRADE_LABELS[ext.grade]}）の記載が見つかりました。`
      : '❔ 塗料のグレードは記載が見当たらず不明です。');
    lines.push((ext.manufacturers && ext.manufacturers.length)
      ? `✅ 塗料メーカー・商品名（${ext.manufacturers.join('・')}）の記載が見つかりました。`
      : '❔ 塗料のメーカー名・正式な商品名は記載されておらず不明です。');
    lines.push(ext.hasRepairKeywords
      ? '✅ 下地補修・シーリングに関する記載が見つかりました。'
      : '❔ 下地補修・シーリングに関する記載が見当たりません。');
  }

  if (waterActive) {
    lines.push(ext.waterproofMethod
      ? `✅ 防水工法（${WATERPROOF_METHOD_LABELS[ext.waterproofMethod]}）の記載が見つかりました。`
      : '❔ 防水工法は記載が見当たらず不明です。');
    lines.push(ext.hasDrainKeyword
      ? '✅ 改修ドレンに関する記載が見つかりました。'
      : '❔ 改修ドレンに関する記載が見当たりません。');
  }

  lines.push(ext.hasScaffold
    ? '✅ 足場に関する記載が見つかりました。'
    : '❔ 足場に関する記載が見当たりません。');

  return lines;
}

// issues（検出されたポイント）の中から優先度の高いものを最大N個選ぶ。
function getPriorityIssues(issuesList, max) {
  const priority = { danger: 0, warn: 1, good: 2 };
  return issuesList
    .filter(i => i.level !== 'good')
    .sort((a, b) => priority[a.level] - priority[b.level])
    .slice(0, max);
}

function buildChecklist(issuesList) {
  const top3 = getPriorityIssues(issuesList, 3);
  if (!top3.length) {
    return ['特に急いで確認すべき懸念点は見つかりませんでした。念のため保証内容や工程表を確認しておくと安心です。'];
  }
  return top3.map(i => `${i.level === 'danger' ? '🔴' : '🟡'} ${i.title}`);
}

/* ---- フェーズ2: 診断結果に応じた確認質問の自動生成 ---- */
// 既存のissueタイトル（calculateDiagnostic内のissues.pushで使われる文言）をキーに、
// 業者にそのまま送れる質問文を対応させる。
const ISSUE_QUESTION_TEMPLATES = {
  '相場よりかなり安い金額です（手抜き・工程省略のリスク）': '見積書を確認したところ、相場よりかなり安い金額でした。その分、下地処理や塗装回数などの工程を省略されているのでしょうか？含まれる工程を具体的に教えてください。',
  '相場よりやや安めの金額です': '見積書を確認したところ、相場よりやや安めの金額でした。含まれる工程やグレードについて、念のため教えてください。',
  '相場よりやや高めの金額です': '見積書を確認したところ、相場よりやや高めの金額でした。金額の内訳（諸経費や仮設費など）を詳しく教えてください。',
  '「一式」表記が多く、内訳が不透明です': '見積書を確認したところ、「一式」という表記が多く、数量ごとの内訳が分かりませんでした。㎡やmごとの内訳を教えてください。',
  '塗料のメーカー名・商品名が不明です': '見積書を確認したところ、使用する塗料のメーカー名・正式な商品名が分かりませんでした。具体的な製品名を教えてください。',
  '下地補修・シーリングの記載がありません': '見積書を確認したところ、シーリング工事や下地補修の施工範囲が分かりませんでした。今回の工事では、どの部分が施工対象になりますか？',
  '改修ドレン（排水口）の記載がありません': '見積書を確認したところ、改修ドレン（排水口の交換）についての記載が見当たりませんでした。今回の工事に含まれていますか？',
  '大幅な値引きや契約を急がせる表現があります': '見積書を確認したところ、大幅な値引きや契約を急がせるような記載がありました。値引き前の金額の根拠を教えてください。'
};

// 「確認した方がいいポイント」上位3つに対応する質問文を生成する。
function buildAutoQuestions(issuesList) {
  const top3 = getPriorityIssues(issuesList, 3);
  return top3.map(i => '・' + (ISSUE_QUESTION_TEMPLATES[i.title] || `見積書を確認したところ、「${i.title}」という点が気になりました。詳しく教えてください。`));
}

/* ---- フェーズ2: 専門用語のかんたん解説 ---- */
const GLOSSARY = {
  'シーリング': 'コーキングとも呼ばれる、外壁のつなぎ目やサッシまわりに詰めるゴム状の防水材です。劣化すると隙間から雨水が入り込む原因になります。',
  '下塗り': '塗装で一番最初に塗る工程です。下地と上の塗料をしっかり密着させる役割があり、ここを省くと塗料が剥がれやすくなります。',
  '中塗り': '下塗りの上に塗る2回目の塗装です。色や耐久性を出す役割があります。',
  '上塗り': '最後に塗る仕上げの塗装です。見た目の色つやと、雨風から建物を守る役割を持ちます。',
  '下地処理': '塗装前に、ひび割れの補修や汚れ・古い塗膜の除去などを行う工程の総称です。ここを丁寧に行うかどうかで、仕上がりの持ちが大きく変わります。',
  'クラック': '外壁などに入るひび割れのことです。放置すると雨水が浸入し、建物の劣化を早めます。',
  '改修ドレン': 'バルコニーや屋上にある排水口（ドレン）を新しく交換する工事です。ここが劣化していると雨漏りの直接の原因になります。',
  'FRP防水': 'ガラス繊維強化プラスチックを使った防水工法です。硬くて丈夫なため、ベランダやバルコニーでよく使われます。',
  'ウレタン防水': '液状のウレタン樹脂を塗って防水層をつくる工法です。複雑な形状の場所にも施工しやすいのが特徴です。',
  '塩ビシート防水': '塩化ビニール製のシートを貼って防水層をつくる工法です。広い屋上などで多く使われます。',
  'シリコン塗料': '外壁塗装で広く使われている、価格と耐久性のバランスが良い標準的なグレードの塗料です。',
  'フッ素塗料': 'シリコンより耐久性が高いグレードの塗料です。その分、価格もやや高くなります。',
  '無機塗料': '現在市販されている塗料の中で、最も耐久性が高いとされるグレードの塗料です。'
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 診断結果の文章中に専門用語が出てきたら、タップで説明を見られるようにする。
// （対象はプレーンテキストの結果表示のみ。コピー用のテンプレート文には適用しない）
function linkifyGlossary(html) {
  let out = html;
  Object.keys(GLOSSARY).forEach(term => {
    const re = new RegExp(escapeRegExp(term), 'g');
    out = out.replace(re, `<span class="glossary-term" onclick="showGlossary('${term}')">${term}</span>`);
  });
  return out;
}

function showGlossary(term) {
  const def = GLOSSARY[term];
  if (!def) return;
  document.getElementById('modal-body').innerHTML = `
    <h3 style="margin-top:0;">📖 ${term}</h3>
    <p style="font-size:14px;color:#4a5568;line-height:1.7;">${def}</p>
  `;
  document.getElementById('modal-overlay').classList.add('show');
}

let lastDiagnosis = null; // 直近の診断結果（履歴保存・相談送信に使う）
let lastExtraction = null; // 直近のAI読み取り結果（「この診断になった理由」表示に使う）

function calculateDiagnostic(e) {
  e.preventDefault();

  const wallOn = document.getElementById('chk-wall').checked;
  const roofOn = document.getElementById('chk-roof').checked;
  const balconyOn = document.getElementById('chk-balcony').checked;
  const rooftopOn = document.getElementById('chk-rooftop').checked;
  const paintActive = wallOn || roofOn;
  const waterActive = balconyOn || rooftopOn;

  if (!paintActive && !waterActive) {
    alert('工事の内容（外壁塗装・屋根塗装・バルコニー防水・屋上防水のいずれか）を1つ以上選んでください。');
    return;
  }

  const areaWall = parseFloat(document.getElementById('area-wall').value) || 0;
  const areaRoof = parseFloat(document.getElementById('area-roof').value) || 0;
  const areaBalcony = parseFloat(document.getElementById('area-balcony').value) || 0;
  const areaRooftop = parseFloat(document.getElementById('area-rooftop').value) || 0;

  const price = parseFloat(document.getElementById('total-price').value);
  const grade = document.getElementById('paint-grade').value;
  const waterproofMethod = document.getElementById('waterproof-method').value;
  const discount = parseFloat(document.getElementById('discount-amount').value) || 0;

  const isIsshiki = document.getElementById('chk-isshiki').checked;
  const isNoPaintName = document.getElementById('chk-no-paint-name').checked && paintActive;
  const isNoRepair = document.getElementById('chk-no-repair').checked && paintActive;
  const isNoDrain = document.getElementById('chk-no-drain').checked && waterActive;
  const isPushy = document.getElementById('chk-pushy').checked;

  // ---- 相場計算（円）----
  const paintRate = getPaintRateRange(grade);
  const waterRate = WATERPROOF_RATE[waterproofMethod] || WATERPROOF_RATE.unknown;
  let expectedMin = 0, expectedMax = 0;
  if (wallOn) { expectedMin += areaWall * paintRate.min; expectedMax += areaWall * paintRate.max; }
  if (roofOn) { expectedMin += areaRoof * paintRate.min * ROOF_FACTOR; expectedMax += areaRoof * paintRate.max * ROOF_FACTOR; }
  if (balconyOn) { expectedMin += areaBalcony * waterRate.min; expectedMax += areaBalcony * waterRate.max; }
  if (rooftopOn) { expectedMin += areaRooftop * waterRate.min; expectedMax += areaRooftop * waterRate.max; }

  const expectedMinMan = Math.round(expectedMin / 1000) / 10;
  const expectedMaxMan = Math.round(expectedMax / 1000) / 10;

  let score = 100;
  const issues = [];
  const qGeneral = [], qPaint = [], qWater = [];

  // ---- 価格診断 ----
  const priceJudgement = getPriceJudgement(price, expectedMinMan, expectedMaxMan);
  if (expectedMinMan > 0) {
    if (priceJudgement.tone === 'danger') {
      score -= 25;
      issues.push({ level: 'danger', tag: '価格', title: '相場よりかなり安い金額です（手抜き・工程省略のリスク）', desc: `目安となる適正相場は約${expectedMinMan}万円〜${expectedMaxMan}万円ですが、それを大きく下回っています。下地処理や塗装の回数、必要な部材が省かれている可能性があります。` });
      qGeneral.push('・相場より大変お手頃なお見積りですが、その分どこかの工程を簡略化されているのでしょうか？下地処理や塗り回数など、含まれる工程を具体的に教えてください。');
    } else if (priceJudgement.label === 'やや安め') {
      score -= 10;
      issues.push({ level: 'warn', tag: '価格', title: '相場よりやや安めの金額です', desc: `目安となる適正相場は約${expectedMinMan}万円〜${expectedMaxMan}万円ですが、それよりやや低い水準です。工程の一部が簡略化されている可能性もあるため、内容を確認しておくと安心です。` });
      qGeneral.push('・相場よりやや控えめな金額に見えますが、含まれる工程やグレードについて念のため教えてください。');
    } else if (priceJudgement.label === 'やや高め') {
      score -= 15;
      issues.push({ level: 'warn', tag: '価格', title: '相場よりやや高めの金額です', desc: `目安となる適正相場は約${expectedMinMan}万円〜${expectedMaxMan}万円ですが、それより高めの水準です。中間業者を挟んでいる場合や、諸経費が多めに計上されている可能性があります。` });
      qGeneral.push('・相場と比較してやや高めに感じましたが、金額の内訳（諸経費や仮設費など）を詳しく教えていただけますか？');
    } else {
      issues.push({ level: 'good', tag: '価格', title: '金額は相場の範囲内です', desc: `お見積り金額（${price}万円）は、選択された工事内容における適正相場（約${expectedMinMan}万円〜${expectedMaxMan}万円）の範囲に収まっています。` });
    }
  }

  // ---- 一式表記 ----
  if (isIsshiki) {
    score -= 15;
    issues.push({ level: 'warn', tag: '透明度', title: '「一式」表記が多く、内訳が不透明です', desc: '数量（㎡やmなど）が書かれていないと、必要な量の材料が使われているか、施主側では確認できません。後からの追加請求トラブルの元にもなります。' });
    qGeneral.push('・「一式」となっている項目について、数量（㎡・m）ごとの内訳を出していただくことは可能でしょうか？');
  }

  // ---- 塗装関連 ----
  if (paintActive && isNoPaintName) {
    score -= 12;
    issues.push({ level: 'warn', tag: '塗装', title: '塗料のメーカー名・商品名が不明です', desc: 'メーカー名や正式な商品名が分からないと、実際にどのグレードの塗料が使われるのか確認できません。安価な塗料に差し替えられるリスクもあります。' });
    qPaint.push('・使用される塗料の「メーカー名」と「正式な商品名」を教えてください。');
  }
  if (paintActive && isNoRepair) {
    score -= 18;
    issues.push({ level: 'danger', tag: '塗装', title: '下地補修・シーリングの記載がありません', desc: '塗装はいわば「お化粧」で、下地補修はその前段階の「肌のお手入れ」にあたります。ここを省いて上から塗るだけだと、数年でひび割れや剥がれが再発しやすくなります。' });
    qPaint.push('・ひび割れ補修や、目地のシーリング（打ち替え・増し打ち）、鉄部のケレン処理の費用は含まれていますか？');
  }

  // ---- 防水関連 ----
  if (waterActive && isNoDrain) {
    score -= 15;
    issues.push({ level: 'warn', tag: '防水', title: '改修ドレン（排水口）の記載がありません', desc: '防水工事において雨漏りが最も発生しやすいのが排水口（ドレン）まわりです。ここの交換・改修が含まれていないと、数年後に雨漏りするリスクが残ります。' });
    qWater.push('・防水工事の明細に「改修ドレンの設置・交換」の費用は含まれていますか？');
  }

  // ---- 値引き・煽り文言 ----
  if (discount >= 10 || isPushy) {
    score -= 15;
    issues.push({ level: 'danger', tag: '契約', title: '大幅な値引きや契約を急がせる表現があります', desc: 'あらかじめ金額を高く設定しておき、大幅値引きで「お得感」を演出して即決を迫る手口は、悪質な業者に多いパターンです。値引き自体が悪いわけではありませんが、根拠を確認しましょう。' });
    qGeneral.push('・大きな値引きをしていただいていますが、値引き前の金額の根拠（内訳）を教えていただけますか？また、今日契約しない場合は金額が変わりますか？');
  } else if (discount > 0) {
    issues.push({ level: 'good', tag: '契約', title: '値引きの範囲は常識的です', desc: '少額の端数調整程度の値引きであれば、特別に警戒する必要はありません。' });
  }

  score = Math.max(0, Math.min(100, score));

  /* ---- 結果表示 ---- */
  const resultArea = document.getElementById('result-area');
  const scoreBox = document.getElementById('score-box');
  const scoreBadge = document.getElementById('score-badge');
  const scoreDesc = document.getElementById('score-desc');
  const scoreTitle = document.getElementById('score-title');
  const gaugeMarker = document.getElementById('gauge-marker');
  const priceCompare = document.getElementById('price-compare');

  scoreBadge.innerText = score + '点';
  gaugeMarker.style.left = score + '%';
  resultArea.style.display = 'block';
  document.getElementById('score-meaning').textContent = `${score}点 - ${getScoreMeaning(score)}`;

  let persona = '', level = '';
  if (score >= 80) {
    level = 'good';
    scoreBox.className = 'score-box good';
    scoreTitle.innerText = '🟢 総合判定：適正（健康優良児タイプ）';
    scoreDesc.innerText = '記載内容・金額ともに大きな問題は見られません。安心して検討を進めやすい見積もりです。';
    persona = 'とても良いお見積りですね！内訳もしっかりしていて、金額も相場の範囲内です。人間ドックで例えるなら「健康優良児」タイプ。とはいえ最終決定の前には、必ず他の業者とも比較（相見積もり）することをおすすめします。';
  } else if (score >= 50) {
    level = 'warn';
    scoreBox.className = 'score-box warn';
    scoreTitle.innerText = '🟡 総合判定：要確認（もう少し検査が必要）';
    scoreDesc.innerText = 'いくつか気になる点があります。契約前に、下の「確認フレーズ」を使って業者に質問してみましょう。';
    persona = 'いくつか気になる項目が見つかりました。人間ドックで言う「要精密検査」のような状態です。悪い業者と決まったわけではなく、単に見積書の書き方が省略されているだけの場合もよくあります。まずは下の質問フレーズを使って、業者に確認してみてください。';
  } else {
    level = 'danger';
    scoreBox.className = 'score-box danger';
    scoreTitle.innerText = '🔴 総合判定：注意（リスクが高い可能性）';
    scoreDesc.innerText = '不透明な項目や、工程の省略・高額請求のリスクが高い見積もりです。契約を急がず、他社に相見積もりを取ることを強くおすすめします。';
    persona = '正直に申し上げると、少し心配な点が多いお見積りです。「安いから」「今すぐ契約しないと損」といった言葉に惑わされず、一度立ち止まって、他の会社にも同じ条件で見積もりを依頼（相見積もり）することを強くおすすめします。工事は一生に何度もあるものではないからこそ、慎重に選びましょう。';
  }

  if (expectedMinMan > 0) {
    priceCompare.innerText = `適正相場の目安：約 ${expectedMinMan}万円 〜 ${expectedMaxMan}万円（今回の入力条件に基づく概算）`;
  } else {
    priceCompare.innerText = '';
  }

  const issueList = document.getElementById('issue-list');
  issueList.innerHTML = linkifyGlossary(issues.map(i => `
    <div class="issue-item ${i.level}">
      <strong>${i.title}</strong><span class="tag">${i.tag}</span>
      <div style="margin-top: 4px; color: #4a5568;">${i.desc}</div>
    </div>
  `).join('') || '<p style="font-size:13px;color:#718096;">特筆すべき懸念点は見つかりませんでした。</p>');

  document.getElementById('ai-explain').innerHTML = linkifyGlossary(`<p><span class="persona">AI診断士：</span>${persona}</p>`);

  /* ---- フェーズ1: 5項目評価 ---- */
  const subScores = computeSubScores({ priceJudgement, isIsshiki, isPushy, discount, paintActive, waterActive, isNoPaintName, isNoRepair, isNoDrain, waterproofMethod });
  document.getElementById('subscore-list').innerHTML = subScores.map(s => {
    const tone = subscoreTone(s.score);
    const valueText = s.score === null ? '判断材料不足' : s.score + '点';
    const barWidth = s.score === null ? 0 : s.score;
    return `
      <div class="subscore-item">
        <div class="subscore-head"><span>${s.label}</span><span class="subscore-value ${tone}">${valueText}</span></div>
        <div class="subscore-bar"><div class="subscore-bar-fill ${tone}" style="width:${barWidth}%;"></div></div>
        <div class="subscore-desc">${s.desc}</div>
      </div>`;
  }).join('');

  /* ---- フェーズ1: 価格判定（5段階）と確認ポイント ---- */
  document.getElementById('price-judgement-badge').textContent = `${priceJudgement.icon} ${priceJudgement.label}`;
  const pricePointsHint = document.getElementById('price-judgement-hint');
  const pricePointsEl = document.getElementById('price-judgement-points');
  if (priceJudgement.tone === 'danger') {
    pricePointsHint.textContent = '確認ポイント：';
    pricePointsHint.style.display = 'block';
    pricePointsEl.innerHTML = linkifyGlossary(CHEAP_CHECK_POINTS.map(p => `<li>${p}</li>`).join(''));
  } else if (priceJudgement.label === 'やや高め') {
    pricePointsHint.textContent = '高くなっている理由の候補：';
    pricePointsHint.style.display = 'block';
    pricePointsEl.innerHTML = linkifyGlossary(EXPENSIVE_REASON_POINTS.map(p => `<li>${p}</li>`).join(''));
  } else {
    pricePointsHint.style.display = 'none';
    pricePointsEl.innerHTML = '';
  }

  /* ---- フェーズ1: この診断になった理由 ---- */
  const reasonLines = buildReasonList({ wallOn, roofOn, balconyOn, rooftopOn, paintActive, waterActive });
  document.getElementById('reason-list').innerHTML = linkifyGlossary(reasonLines.map(l => `<li>${l}</li>`).join(''));

  /* ---- フェーズ1: 確認した方がいいポイント（最大3つ） ---- */
  const checklistLines = buildChecklist(issues);
  document.getElementById('checklist-list').innerHTML = linkifyGlossary(checklistLines.map(l => `<li>${l}</li>`).join(''));

  /* ---- 確認フレーズ ---- */
  const container = document.getElementById('template-container');
  let html = '';
  const autoQuestions = buildAutoQuestions(issues);
  if (autoQuestions.length) html += buildTemplateSection('診断結果からのおすすめ質問', autoQuestions, 'auto');
  html += buildTemplateSection('お見積り全体について', qGeneral, 'general');
  if (paintActive) html += buildTemplateSection('塗装工事について', qPaint, 'paint');
  if (waterActive) html += buildTemplateSection('防水工事について', qWater, 'water');
  if (!autoQuestions.length && !qGeneral.length && !qPaint.length && !qWater.length) {
    html = `<div class="template-section"><div class="template-box" id="tmpl-none">特に気になる点は見つかりませんでした。念のため、施工時の工程表や保証内容について確認しておくと安心です。\n\n・工事の工程表（何日目に何を行うか）を教えていただけますか？\n・保証書は発行していただけますか？保証の対象範囲も教えてください。</div><button type="button" class="btn-copy" onclick="copyTemplate('tmpl-none', this)">コピーする</button></div>`;
  }
  container.innerHTML = html;

  // ---- 工事範囲サマリー（履歴・相談送信で使う） ----
  const scopeParts = [];
  if (wallOn) scopeParts.push(`外壁塗装(${areaWall}㎡)`);
  if (roofOn) scopeParts.push(`屋根塗装(${areaRoof}㎡)`);
  if (balconyOn) scopeParts.push(`バルコニー防水(${areaBalcony}㎡)`);
  if (rooftopOn) scopeParts.push(`屋上防水(${areaRooftop}㎡)`);

  lastDiagnosis = {
    id: 'd' + Date.now(),
    timestamp: Date.now(),
    score, level,
    priceMan: price,
    expectedMin: expectedMinMan,
    expectedMax: expectedMaxMan,
    scopeSummary: scopeParts.join('、'),
    grade,
    issues: issues.map(i => ({ level: i.level, tag: i.tag, title: i.title })),
    // ---- フェーズ3: 履歴の価格判定・5項目評価の追加表示用 ----
    priceJudgement: { icon: priceJudgement.icon, label: priceJudgement.label, tone: priceJudgement.tone },
    subScores: subScores.map(s => ({ key: s.key, label: s.label, score: s.score, desc: s.desc }))
  };
  saveHistoryRecord(lastDiagnosis);
  setupLeadCard(lastDiagnosis);
  renderResultFileInfo();

  resultArea.scrollIntoView({ behavior: 'smooth' });
}

function renderResultFileInfo() {
  const box = document.getElementById('result-file-info');
  const info = document.getElementById('selected-file-info');
  if (!info.classList.contains('show')) {
    box.classList.remove('show');
    box.innerHTML = '';
    return;
  }
  const name = document.getElementById('selected-file-name').textContent;
  const thumb = document.getElementById('selected-file-thumb');
  const thumbHtml = thumb.classList.contains('show') ? `<img class="show" src="${thumb.src}" alt="" onclick="openImagePreview(this.src)">` : '';
  box.innerHTML = `${thumbHtml}<span class="name">📎 読み込んだ見積書：${name}</span>`;
  box.classList.add('show');
}

function buildTemplateSection(label, questions, key) {
  if (!questions.length) return '';
  const id = 'tmpl-' + key;
  const text = `【${label}についてご質問です】\nお世話になっております。ご提示いただいたお見積りについて、検討にあたり以下の点を確認させてください。\n\n${questions.join('\n')}\n\nお忙しいところ恐れ入りますが、ご回答のほどよろしくお願いいたします。`;
  return `<div class="template-section"><h4>■ ${label}</h4><div class="template-box" id="${id}">${text}</div><button type="button" class="btn-copy" onclick="copyTemplate('${id}', this)">コピーする</button></div>`;
}

function copyTemplate(id, btn) {
  const text = document.getElementById(id).innerText;
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.innerText;
    btn.innerText = 'コピーしました！';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerText = original; btn.classList.remove('copied'); }, 1800);
  }).catch(() => { alert('コピーに失敗しました。テキストを長押しして手動でコピーしてください。'); });
}

/* ==================== フェーズ3: 3社見積もり比較 ====================
   単体の診断（診断する タブ）とは完全に独立した機能。既存のOCR・PDF読み取り部品
   （extractTextFromPDF/extractTextFromImage）と、テキスト解析（analyzeForCompare）を
   3つのスロット分だけ再利用する。単体診断のフォーム・結果表示には一切書き込まない。
==================================================================== */
let compareTexts = [null, null, null]; // 各社の読み取り済みテキスト（正規化済み）
let compareFileThumbUrls = [null, null, null];

function initCompareUpload() {
  for (let n = 1; n <= 3; n++) {
    const slot = n;
    const dropZone = document.getElementById(`compare-drop-${slot}`);
    const fileInput = document.getElementById(`compare-file-${slot}`);
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleCompareFile(slot, e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', e => { if (e.target.files.length) handleCompareFile(slot, e.target.files[0]); });
  }
}

function compareStatusIds(slot) {
  return { status: `compare-status-${slot}`, progress: `compare-progress-${slot}`, bar: `compare-progress-bar-${slot}` };
}

async function showCompareFile(slot, file) {
  const info = document.getElementById(`compare-file-info-${slot}`);
  const nameEl = document.getElementById(`compare-file-name-${slot}`);
  const thumbEl = document.getElementById(`compare-file-thumb-${slot}`);

  nameEl.textContent = file.name;
  info.classList.add('show');

  if (compareFileThumbUrls[slot - 1]) { URL.revokeObjectURL(compareFileThumbUrls[slot - 1]); compareFileThumbUrls[slot - 1] = null; }
  thumbEl.classList.remove('show');
  thumbEl.removeAttribute('src');

  if (file.type.startsWith('image/')) {
    compareFileThumbUrls[slot - 1] = URL.createObjectURL(file);
    thumbEl.src = compareFileThumbUrls[slot - 1];
    thumbEl.classList.add('show');
  } else if (file.type === 'application/pdf') {
    try {
      const dataUrl = await renderPdfThumbnail(file);
      if (dataUrl && document.getElementById(`compare-file-name-${slot}`).textContent === file.name) {
        thumbEl.src = dataUrl;
        thumbEl.classList.add('show');
      }
    } catch (err) {
      console.warn('PDFのプレビュー画像を作成できませんでした。', err);
    }
  }
}

function clearCompareFile(slot) {
  document.getElementById(`compare-file-info-${slot}`).classList.remove('show');
  document.getElementById(`compare-file-${slot}`).value = '';
  if (compareFileThumbUrls[slot - 1]) { URL.revokeObjectURL(compareFileThumbUrls[slot - 1]); compareFileThumbUrls[slot - 1] = null; }
  compareTexts[slot - 1] = null;
}

async function handleCompareFile(slot, file) {
  showCompareFile(slot, file);

  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  const statusIds = compareStatusIds(slot);

  if (!isPdf && !isImage) {
    alert('画像（JPG/PNG）またはPDFファイルを選択してください。');
    return;
  }
  if (isPdf && typeof pdfjsLib === 'undefined') {
    alert('PDFを読み取る部品がインターネットから取得できていないため、PDFの自動読み取りができません。お手数ですが、見積書の文字を「文章を貼り付ける」欄にコピーして貼り付けてください。');
    return;
  }
  if (isImage && typeof Tesseract === 'undefined') {
    alert('写真から文字を読み取る部品がインターネットから取得できていないため、画像の自動読み取りができません。お手数ですが、見積書の文字を「文章を貼り付ける」欄にコピーして貼り付けてください。');
    return;
  }

  try {
    setScanStatus('見積書を読み込んでいます…', 5, statusIds);
    const extractPromise = isPdf ? extractTextFromPDF(file, statusIds) : extractTextFromImage(file, statusIds);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 30000));
    const text = await Promise.race([extractPromise, timeoutPromise]);
    compareTexts[slot - 1] = normalizeText(text);
    setScanStatus(null, null, statusIds);
  } catch (err) {
    console.error(err);
    setScanStatus(null, null, statusIds);
    compareTexts[slot - 1] = null;
    if (err && err.message === 'TIMEOUT') {
      alert('30秒待っても読み込みが完了しませんでした。お手数ですが、見積書の文字を「文章を貼り付ける」欄にコピーして貼り付けてください。');
    } else {
      alert('読み込み中にエラーが発生しました。お手数ですが、下の「文章を貼り付ける」欄をお試しください。\n\n(エラー内容: ' + (err && err.message ? err.message : err) + ')');
    }
  }
}

function analyzeComparePastedText(slot) {
  const raw = document.getElementById(`compare-paste-${slot}`).value;
  if (!raw.trim()) { alert('文章を貼り付けてください。'); return; }
  compareTexts[slot - 1] = normalizeText(raw);
  alert(`${slot}社目の文章を読み込みました。「この内容で比較する」ボタンから比較できます。`);
}

const COMPARE_ROWS = [
  { key: 'price', label: '価格' },
  { key: 'area', label: '施工面積' },
  { key: 'material', label: '使用塗料・工法' },
  { key: 'sealing', label: 'シーリング工事の有無' },
  { key: 'substrate', label: '下地処理の有無' },
  { key: 'scaffold', label: '足場の扱い' },
  { key: 'waterproof', label: '防水工事の有無' },
  { key: 'attached', label: '付帯部工事の有無' },
  { key: 'warranty', label: '保証内容' }
];

// 各社の項目を文字列化する。ここでは価格の大小による強調・並び替えは一切行わない
// （「最安値」「おすすめ」を示唆する表示をしないため）。
function formatCompareCell(key, c) {
  switch (key) {
    case 'price':
      return c.totalPriceMan ? `${c.totalPriceMan}万円` : '不明';
    case 'area': {
      const parts = [];
      if (c.areaWall) parts.push(`外壁${c.areaWall}㎡`);
      if (c.areaRoof) parts.push(`屋根${c.areaRoof}㎡`);
      if (c.areaBalcony) parts.push(`バルコニー${c.areaBalcony}㎡`);
      if (c.areaRooftop) parts.push(`屋上${c.areaRooftop}㎡`);
      if (!parts.length && c.areaSqm) parts.push(`約${c.areaSqm}㎡`);
      return parts.length ? parts.join('<br>') : '不明';
    }
    case 'material': {
      const parts = [];
      if (c.grade) parts.push(GRADE_LABELS[c.grade] + '塗料');
      if (c.waterproofMethod) parts.push(WATERPROOF_METHOD_LABELS[c.waterproofMethod]);
      if (c.manufacturers && c.manufacturers.length) parts.push(c.manufacturers.join('・'));
      return parts.length ? parts.join('<br>') : '不明';
    }
    case 'sealing': return c.hasSealing ? '記載あり' : '記載なし（不明）';
    case 'substrate': return c.hasSubstrate ? '記載あり' : '記載なし（不明）';
    case 'scaffold': return c.scaffold;
    case 'waterproof': return c.hasWaterproofWork ? '記載あり' : '記載なし';
    case 'attached': return c.hasAttachedWork ? '記載あり' : '記載なし';
    case 'warranty': return c.warranty;
    default: return '';
  }
}

function runCompare() {
  const slots = [1, 2, 3].filter(i => compareTexts[i - 1]);
  if (!slots.length) {
    alert('少なくとも1社分の見積書を読み込むか、文章を貼り付けて解析してください。');
    return;
  }

  const companies = slots.map(i => analyzeForCompare(compareTexts[i - 1]));

  let html = '<table class="compare-table"><thead><tr><th>項目</th>';
  slots.forEach((i, idx) => { html += `<th>${idx + 1}社目</th>`; });
  html += '</tr></thead><tbody>';
  COMPARE_ROWS.forEach(row => {
    html += `<tr><th>${row.label}</th>`;
    companies.forEach(c => { html += `<td>${formatCompareCell(row.key, c)}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';

  document.getElementById('compare-table-wrap').innerHTML = linkifyGlossary(html);
  const resultArea = document.getElementById('compare-result-area');
  resultArea.style.display = 'block';
  resultArea.scrollIntoView({ behavior: 'smooth' });
}

/* ==================== 診断履歴（この端末に保存） ==================== */
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function saveHistoryRecord(record) {
  const list = loadHistory();
  list.unshift(record);
  while (list.length > HISTORY_MAX) list.pop();
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* 端末の容量制限などは無視 */ }
}
function deleteHistoryRecord(id) {
  const list = loadHistory().filter(r => r.id !== id);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  renderHistory();
}
function clearHistory() {
  if (!confirm('保存されている診断履歴をすべて削除します。よろしいですか？')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}
function levelLabel(level) {
  return { good: '🟢 適正', warn: '🟡 要確認', danger: '🔴 注意' }[level] || '';
}
function formatDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function renderHistory() {
  const list = loadHistory();
  const wrap = document.getElementById('history-list');
  const actions = document.getElementById('history-actions');
  if (!list.length) {
    actions.style.display = 'none';
    wrap.innerHTML = '<div class="history-empty">まだ診断履歴がありません。<br>「診断する」タブから見積もりを診断すると、ここに記録されます。</div>';
    return;
  }
  actions.style.display = 'flex';
  wrap.innerHTML = list.map(r => `
    <div class="history-item" onclick="showHistoryDetail('${r.id}')">
      <div class="history-top">
        <span class="history-date">${formatDate(r.timestamp)}</span>
        <span class="history-score ${r.level}">${r.score}点 ${levelLabel(r.level)}</span>
      </div>
      <div class="history-sub">${r.scopeSummary || '工事内容未設定'} ／ 見積 ${r.priceMan}万円</div>
      ${r.priceJudgement ? `<div class="history-sub2">価格判定：${r.priceJudgement.icon} ${r.priceJudgement.label}</div>` : ''}
    </div>
  `).join('');
}
function showHistoryDetail(id) {
  const r = loadHistory().find(x => x.id === id);
  if (!r) return;
  const body = document.getElementById('modal-body');

  // フェーズ3以前に保存された古い履歴データには priceJudgement / subScores が
  // 存在しないため、あればその項目だけ追加表示する（無くてもエラーにならないようにする）。
  const priceJudgementHtml = r.priceJudgement
    ? `<p style="font-size:13px;color:#4a5568;"><b>価格判定：</b>${r.priceJudgement.icon} ${r.priceJudgement.label}</p>`
    : '';
  const subScoreHtml = (r.subScores && r.subScores.length)
    ? `<div class="card" style="margin:10px 0 14px;">
        <h2 style="font-size:13px;">📊 5項目でみる診断結果</h2>
        <div class="subscore-list">${r.subScores.map(s => {
          const tone = subscoreTone(s.score);
          const valueText = s.score === null ? '判断材料不足' : s.score + '点';
          const barWidth = s.score === null ? 0 : s.score;
          return `<div class="subscore-item">
            <div class="subscore-head"><span>${s.label}</span><span class="subscore-value ${tone}">${valueText}</span></div>
            <div class="subscore-bar"><div class="subscore-bar-fill ${tone}" style="width:${barWidth}%;"></div></div>
          </div>`;
        }).join('')}</div>
      </div>`
    : '';

  body.innerHTML = `
    <h3 style="margin-top:0;">${formatDate(r.timestamp)} の診断結果</h3>
    <div class="score-box ${r.level}" style="margin-bottom:14px;">
      <div class="score-title">${levelLabel(r.level)}</div>
      <div class="score-badge">${r.score}点</div>
      <div class="price-compare">適正相場の目安：約 ${r.expectedMin}万円 〜 ${r.expectedMax}万円</div>
    </div>
    <p style="font-size:13px;color:#4a5568;"><b>工事内容：</b>${r.scopeSummary || '－'}<br><b>見積提示額：</b>${r.priceMan}万円</p>
    ${priceJudgementHtml}
    ${subScoreHtml}
    <div class="issue-list">
      ${(r.issues || []).map(i => `<div class="issue-item ${i.level}"><strong>${i.title}</strong><span class="tag">${i.tag}</span></div>`).join('') || '<p style="font-size:13px;color:#718096;">記録された懸念点はありません。</p>'}
    </div>
    <button type="button" class="btn-danger-text" style="margin-top:10px;" onclick="deleteHistoryRecord('${r.id}'); closeModal();">この履歴を削除する</button>
  `;
  document.getElementById('modal-overlay').classList.add('show');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

/* ==================== 画像プレビュー（タップで拡大表示・ホイールでズーム） ==================== */
function openImagePreview(src) {
  if (!src) return;
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div class="preview-image-wrap" id="preview-image-wrap">
      <img class="preview-image-full" id="preview-image-el" src="${src}" alt="見積書のプレビュー">
    </div>
    <p class="preview-hint">マウスホイールで拡大・縮小、画像をなぞってスクロールできます（ダブルクリックでもズーム）</p>
  `;
  document.getElementById('modal-overlay').classList.add('show');

  const wrap = document.getElementById('preview-image-wrap');
  const img = document.getElementById('preview-image-el');
  let zoom = 1;
  const applyZoom = z => { zoom = Math.min(4, Math.max(1, z)); img.style.transform = `scale(${zoom})`; };

  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    applyZoom(zoom - e.deltaY * 0.0015);
  }, { passive: false });

  img.addEventListener('dblclick', () => applyZoom(zoom > 1 ? 1 : 2));
}

/* ==================== 専門家への相談送信（Google スプレッドシート連携） ====================
   会社側で google-apps-script/Code.gs をデプロイし、CONFIG.sheetsWebhookUrl を設定すると、
   お客様が「相談したい」を選んだ場合に診断結果と連絡先がスプレッドシートに自動で貯まります。
==================================================================== */
function setupLeadCard(diagnosis) {
  const card = document.getElementById('lead-card');
  if (!CONFIG.sheetsWebhookUrl) {
    card.classList.add('hidden');
    return;
  }
  card.classList.remove('hidden');
  const form = document.getElementById('lead-form');
  const statusEl = document.getElementById('lead-status');
  statusEl.classList.remove('show');
  statusEl.innerText = '';
  form.onsubmit = async (e) => {
    e.preventDefault();
    const consent = document.getElementById('lead-consent').checked;
    if (!consent) { alert('送信には同意チェックが必要です。'); return; }
    const name = document.getElementById('lead-name').value.trim();
    const contact = document.getElementById('lead-contact').value.trim();
    if (!name || !contact) { alert('お名前と、電話番号かメールアドレスのいずれかをご入力ください。'); return; }
    const memo = document.getElementById('lead-memo').value.trim();
    const topics = Array.from(document.querySelectorAll('.lead-topic:checked')).map(cb => cb.value);

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.innerText = '送信中…';
    try {
      await fetch(CONFIG.sheetsWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          name, contact, memo, topics,
          score: diagnosis.score,
          level: diagnosis.level,
          priceMan: diagnosis.priceMan,
          expectedMin: diagnosis.expectedMin,
          expectedMax: diagnosis.expectedMax,
          scopeSummary: diagnosis.scopeSummary,
          timestamp: new Date(diagnosis.timestamp).toISOString()
        })
      });
      statusEl.innerText = '✅ 送信しました。担当者よりご連絡いたします。';
      statusEl.classList.add('show');
      form.reset();
      if (typeof gtag === 'function') {
        gtag('event', 'conversion', {'send_to': 'AW-18391141487/3zPyCIOl0vEcEO-YysFE'});
      }
    } catch (err) {
      console.error(err);
      alert('送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'この内容で相談する';
    }
  };
}

/* ==================== フェーズ3: 診断結果の共有（URL） ====================
   診断結果そのものではなく、診断に使った「入力内容」をURLに埋め込んで共有する。
   共有されたリンクを開くと、同じ入力内容から診断が自動で再実行され、
   まったく同じ結果が表示される（既存の診断ロジック・表示は一切変更しない）。
==================================================================== */
function buildShareUrl() {
  const state = {
    w: document.getElementById('chk-wall').checked ? 1 : 0,
    r: document.getElementById('chk-roof').checked ? 1 : 0,
    b: document.getElementById('chk-balcony').checked ? 1 : 0,
    t: document.getElementById('chk-rooftop').checked ? 1 : 0,
    aw: document.getElementById('area-wall').value,
    ar: document.getElementById('area-roof').value,
    ab: document.getElementById('area-balcony').value,
    at: document.getElementById('area-rooftop').value,
    price: document.getElementById('total-price').value,
    grade: document.getElementById('paint-grade').value,
    method: document.getElementById('waterproof-method').value,
    disc: document.getElementById('discount-amount').value,
    isk: document.getElementById('chk-isshiki').checked ? 1 : 0,
    np: document.getElementById('chk-no-paint-name').checked ? 1 : 0,
    nr: document.getElementById('chk-no-repair').checked ? 1 : 0,
    nd: document.getElementById('chk-no-drain').checked ? 1 : 0,
    ps: document.getElementById('chk-pushy').checked ? 1 : 0
  };
  const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(state)))));
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('share', encoded);
  return url.toString();
}

async function shareResult() {
  if (!lastDiagnosis) return;
  const url = buildShareUrl();
  const shareText = `見積もり診断結果（${lastDiagnosis.score}点）を共有します。`;
  if (navigator.share) {
    try {
      await navigator.share({ title: '見積もり適正診断の結果', text: shareText, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // ユーザーが共有をキャンセルした場合は何もしない
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    alert('共有用のリンクをコピーしました。LINEやメールに貼り付けてお使いください。');
  } catch (e) {
    prompt('以下のリンクをコピーしてお使いください。', url);
  }
}

// ページ読み込み時に ?share=... が付いていれば、その内容をフォームに反映する。
// 読み込みに失敗した場合は通常どおりの初期状態に戻す（エラーにはしない）。
function applySharedStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('share');
  if (!encoded) return false;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(encoded))));
    const state = JSON.parse(json);
    document.getElementById('chk-wall').checked = !!state.w;
    document.getElementById('chk-roof').checked = !!state.r;
    document.getElementById('chk-balcony').checked = !!state.b;
    document.getElementById('chk-rooftop').checked = !!state.t;
    document.getElementById('area-wall').value = state.aw;
    document.getElementById('area-roof').value = state.ar;
    document.getElementById('area-balcony').value = state.ab;
    document.getElementById('area-rooftop').value = state.at;
    document.getElementById('total-price').value = state.price;
    document.getElementById('paint-grade').value = state.grade;
    document.getElementById('waterproof-method').value = state.method;
    document.getElementById('discount-amount').value = state.disc;
    document.getElementById('chk-isshiki').checked = !!state.isk;
    document.getElementById('chk-no-paint-name').checked = !!state.np;
    document.getElementById('chk-no-repair').checked = !!state.nr;
    document.getElementById('chk-no-drain').checked = !!state.nd;
    document.getElementById('chk-pushy').checked = !!state.ps;
    return true;
  } catch (e) {
    console.warn('共有リンクの読み込みに失敗しました。通常の初期状態で表示します。', e);
    return false;
  }
}

/* ==================== ライブラリ状態表示 ==================== */
function checkLibraries() {
  const box = document.getElementById('lib-status');
  const pdfOk = typeof pdfjsLib !== 'undefined';
  const ocrOk = typeof Tesseract !== 'undefined';

  if (pdfOk && ocrOk) {
    box.className = 'ok';
    box.innerText = '✅ 見積書の自動読み取りの準備ができています。写真やPDFをアップロードできます。';
    setTimeout(() => { box.style.display = 'none'; }, 4000);
  } else {
    box.className = 'fail';
    let missing = [];
    if (!pdfOk) missing.push('PDF読み取り');
    if (!ocrOk) missing.push('写真の文字読み取り(AI-OCR)');
    box.innerHTML = `⚠️ ${missing.join('・')}の部品をインターネットから取得できませんでした。<br>自動読み取りはご利用いただけませんが、下の「文字を貼り付ける」欄への直接入力や、フォームへの手入力は問題なくご利用いただけます。<br><span style="font-size:11px;">(考えられる原因：インターネットに繋がっていない／会社や学校のネットワークでセキュリティソフトが外部サイトの読み込みをブロックしている、など。Wi-Fiやモバイル回線を変えて試すと直ることがあります)</span>`;
  }
}

/* ==================== 初期化 ==================== */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initUpload();
  initCompareUpload();
  document.getElementById('diag-form').addEventListener('submit', calculateDiagnostic);
  document.getElementById('history-clear-btn').addEventListener('click', clearHistory);
  document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });
  document.getElementById('compare-run-btn').addEventListener('click', runCompare);

  // ---- フェーズ3: 共有リンク（?share=...）からの読み込み ----
  // 共有された内容がある場合はそちらを優先し、無ければ今まで通りの初期値（サンプル用チェック）を入れる。
  const sharedLoaded = applySharedStateFromUrl();
  if (!sharedLoaded) {
    document.getElementById('chk-wall').checked = true;
    document.getElementById('chk-rooftop').checked = true;
  }
  onScopeChange();
  onAreaChange();
  checkLibraries();

  if (sharedLoaded) {
    document.getElementById('shared-notice').style.display = 'block';
    calculateDiagnostic({ preventDefault: () => {} });
  }
});
