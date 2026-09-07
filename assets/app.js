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
  fluorine:  { min: 4000, max: 5000 },
  inorganic: { min: 4500, max: 6000 },
  unknown:   { min: 3000, max: 4500 }
};
const ROOF_FACTOR = 0.85; // 屋根は外壁よりやや単価が下がる目安
const WATERPROOF_RATE = {
  balcony: { min: 5500, max: 9000 },
  rooftop: { min: 4500, max: 7500 }
};

const MANUFACTURER_KEYWORDS = [
  "日本ペイント","関西ペイント","エスケー化研","SK化研","アステックペイント","アステック",
  "プレマテックス","日進産業","ガイナ","大日本塗料","水谷ペイント","菊水化学","アトミクス",
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

  if (window['pdfjsLib']) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

function setScanStatus(text, percent) {
  const statusEl = document.getElementById('scan-status');
  const progEl = document.getElementById('scan-progress');
  const barEl = document.getElementById('scan-progress-bar');
  if (text === null) { statusEl.style.display = 'none'; progEl.style.display = 'none'; return; }
  statusEl.style.display = 'block';
  statusEl.innerText = text;
  if (typeof percent === 'number') {
    progEl.style.display = 'block';
    barEl.style.width = Math.max(0, Math.min(100, percent)) + '%';
  }
}

async function handleFile(file) {
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

async function extractTextFromPDF(file) {
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
    setScanStatus('画像として認識しています（少し時間がかかります）…', 20);
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    text = await ocrCanvas(canvas);
  }
  return text;
}

async function extractTextFromImage(file) {
  return await ocrFile(file);
}

async function ocrFile(file) {
  const workerPath = await getTesseractWorkerPath();
  const options = {
    logger: m => {
      if (m.status === 'recognizing text') {
        setScanStatus('文字を読み取っています…', 20 + Math.round(m.progress * 70));
      }
    }
  };
  if (workerPath) options.workerPath = workerPath;
  const { data } = await Tesseract.recognize(file, 'jpn+eng', options);
  return data.text;
}
async function ocrCanvas(canvas) {
  const workerPath = await getTesseractWorkerPath();
  const options = {
    logger: m => {
      if (m.status === 'recognizing text') {
        setScanStatus('文字を読み取っています…', 20 + Math.round(m.progress * 70));
      }
    }
  };
  if (workerPath) options.workerPath = workerPath;
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

function analyzeText(text) {
  const result = {
    totalPriceMan: null, areaSqm: null, grade: null, manufacturer: null,
    isshikiCount: 0, hasRepairKeywords: false, hasDrainKeyword: false,
    hasWall: false, hasRoof: false, hasBalcony: false, hasRooftop: false,
    hasWaterproofMethod: false, foundKeywords: []
  };

  // ---- 総額の抽出 ----
  let priceMatch = text.match(/(?:御見積合計|見積合計|合計金額|ご請求金額|総額|税込)[^0-9]{0,10}([0-9][0-9,]{4,})\s*円/);
  if (!priceMatch) priceMatch = text.match(/([0-9][0-9,]{4,})\s*円\s*(?:（?税込）?)/);
  if (priceMatch) {
    result.totalPriceMan = Math.round(parseInt(priceMatch[1].replace(/,/g, ''), 10) / 1000) / 10;
  } else {
    // フェールセーフ：文中で最も大きい「円」付き金額（10万円以上）を採用
    const all = [...text.matchAll(/([0-9][0-9,]{4,})\s*円/g)].map(m => parseInt(m[1].replace(/,/g, ''), 10)).filter(n => n >= 100000);
    if (all.length) result.totalPriceMan = Math.round(Math.max(...all) / 1000) / 10;
  }

  // ---- 面積の抽出（㎡優先、なければ坪から換算）----
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

  // ---- メーカー・商品名 ----
  for (const m of MANUFACTURER_KEYWORDS) { if (text.includes(m)) { result.manufacturer = m; result.foundKeywords.push(m); break; } }
  if (!result.manufacturer) {
    for (const p of PAINT_PRODUCT_KEYWORDS) { if (text.includes(p)) { result.manufacturer = p; result.foundKeywords.push(p); break; } }
  }

  // ---- 一式の出現回数 ----
  result.isshikiCount = (text.match(/一式/g) || []).length;

  // ---- 下地補修キーワード ----
  result.hasRepairKeywords = REPAIR_KEYWORDS.some(k => text.includes(k));
  // ---- ドレン ----
  result.hasDrainKeyword = DRAIN_KEYWORDS.some(k => text.includes(k));
  // ---- 防水工法 ----
  result.hasWaterproofMethod = WATERPROOF_METHOD_KEYWORDS.some(k => text.includes(k));

  // ---- 工事範囲の推定 ----
  result.hasWall = WALL_KEYWORDS.some(k => text.includes(k));
  result.hasRoof = ROOF_KEYWORDS.some(k => text.includes(k));
  result.hasBalcony = BALCONY_KEYWORDS.some(k => text.includes(k));
  result.hasRooftop = ROOFTOP_KEYWORDS.some(k => text.includes(k)) && !result.hasBalcony;

  return result;
}

function applyExtractedData(d) {
  const reportLines = [];

  if (d.totalPriceMan) {
    document.getElementById('total-price').value = d.totalPriceMan;
    reportLines.push(`💰 見積もり総額として <b>約${d.totalPriceMan}万円</b> を読み取りました。金額欄と一致しているか、念のためご確認ください。`);
  } else {
    reportLines.push(`💰 総額をうまく読み取れませんでした。お手数ですが「見積もり提示総額」欄に手入力をお願いします。`);
  }

  if (d.areaSqm) {
    reportLines.push(`📐 施工面積として <b>約${d.areaSqm}㎡</b> を読み取りました。該当する工事範囲の面積欄に反映しています。`);
  }

  if (d.hasWall) { document.getElementById('chk-wall').checked = true; if (d.areaSqm) document.getElementById('area-wall').value = d.areaSqm; }
  if (d.hasRoof) { document.getElementById('chk-roof').checked = true; if (d.areaSqm && !d.hasWall) document.getElementById('area-roof').value = d.areaSqm; }
  if (d.hasBalcony) { document.getElementById('chk-balcony').checked = true; if (d.areaSqm && !d.hasWall && !d.hasRoof) document.getElementById('area-balcony').value = d.areaSqm; }
  if (d.hasRooftop) { document.getElementById('chk-rooftop').checked = true; if (d.areaSqm && !d.hasWall && !d.hasRoof && !d.hasBalcony) document.getElementById('area-rooftop').value = d.areaSqm; }
  if (!d.hasWall && !d.hasRoof && !d.hasBalcony && !d.hasRooftop) {
    // 何も検出できなければ、初期値の外壁塗装のみ有効化しておく
    document.getElementById('chk-wall').checked = true;
  }
  onScopeChange();
  onAreaChange();

  if (d.grade) {
    document.getElementById('paint-grade').value = d.grade;
    document.getElementById('grade-auto').style.display = 'inline-block';
    const gradeName = {urethane:'ウレタン', silicon:'シリコン', fluorine:'フッ素', inorganic:'無機'}[d.grade];
    reportLines.push(`🎨 塗料のグレードとして <b>「${gradeName}」</b> という記載を見つけました。グレードによって適正相場が変わるため、自動で反映しています。`);
  } else {
    document.getElementById('grade-auto').style.display = 'none';
  }

  if (d.manufacturer) {
    document.getElementById('chk-no-paint-name').checked = false;
    reportLines.push(`🏭 塗料メーカー・商品名として <b>「${d.manufacturer}」</b> の記載を確認しました。メーカー名がはっきりしているのは良い傾向です。`);
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

  const reportBox = document.getElementById('ai-report');
  reportBox.innerHTML = `<h3>🤖 AI読み取りレポート</h3><ul>${reportLines.map(l => `<li>${l}</li>`).join('')}</ul><p style="margin:8px 0 0;color:#a0733a;font-size:11px;">※文字認識には誤読の可能性があります。診断前に必ず内容をご確認・修正ください。</p>`;
  reportBox.style.display = 'block';
  reportBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ==================== 診断ロジック ==================== */
function getPaintRateRange(grade) {
  const base = PAINT_RATE[grade] || PAINT_RATE.unknown;
  return base;
}

let lastDiagnosis = null; // 直近の診断結果（履歴保存・相談送信に使う）

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
  const discount = parseFloat(document.getElementById('discount-amount').value) || 0;

  const isIsshiki = document.getElementById('chk-isshiki').checked;
  const isNoPaintName = document.getElementById('chk-no-paint-name').checked && paintActive;
  const isNoRepair = document.getElementById('chk-no-repair').checked && paintActive;
  const isNoDrain = document.getElementById('chk-no-drain').checked && waterActive;
  const isPushy = document.getElementById('chk-pushy').checked;

  // ---- 相場計算（円）----
  const paintRate = getPaintRateRange(grade);
  let expectedMin = 0, expectedMax = 0;
  if (wallOn) { expectedMin += areaWall * paintRate.min; expectedMax += areaWall * paintRate.max; }
  if (roofOn) { expectedMin += areaRoof * paintRate.min * ROOF_FACTOR; expectedMax += areaRoof * paintRate.max * ROOF_FACTOR; }
  if (balconyOn) { expectedMin += areaBalcony * WATERPROOF_RATE.balcony.min; expectedMax += areaBalcony * WATERPROOF_RATE.balcony.max; }
  if (rooftopOn) { expectedMin += areaRooftop * WATERPROOF_RATE.rooftop.min; expectedMax += areaRooftop * WATERPROOF_RATE.rooftop.max; }

  const expectedMinMan = Math.round(expectedMin / 1000) / 10;
  const expectedMaxMan = Math.round(expectedMax / 1000) / 10;

  let score = 100;
  const issues = [];
  const qGeneral = [], qPaint = [], qWater = [];

  // ---- 価格診断 ----
  if (expectedMinMan > 0) {
    if (price < expectedMinMan * 0.75) {
      score -= 25;
      issues.push({ level: 'danger', tag: '価格', title: '相場よりかなり安い金額です（手抜き・工程省略のリスク）', desc: `目安となる適正相場は約${expectedMinMan}万円〜${expectedMaxMan}万円ですが、それを大きく下回っています。下地処理や塗装の回数、必要な部材が省かれている可能性があります。` });
      qGeneral.push('・相場より大変お手頃なお見積りですが、その分どこかの工程を簡略化されているのでしょうか？下地処理や塗り回数など、含まれる工程を具体的に教えてください。');
    } else if (price > expectedMaxMan * 1.3) {
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
  issueList.innerHTML = issues.map(i => `
    <div class="issue-item ${i.level}">
      <strong>${i.title}</strong><span class="tag">${i.tag}</span>
      <div style="margin-top: 4px; color: #4a5568;">${i.desc}</div>
    </div>
  `).join('') || '<p style="font-size:13px;color:#718096;">特筆すべき懸念点は見つかりませんでした。</p>';

  document.getElementById('ai-explain').innerHTML = `<p><span class="persona">AI診断士：</span>${persona}</p>`;

  /* ---- 確認フレーズ ---- */
  const container = document.getElementById('template-container');
  let html = '';
  html += buildTemplateSection('お見積り全体について', qGeneral, 'general');
  if (paintActive) html += buildTemplateSection('塗装工事について', qPaint, 'paint');
  if (waterActive) html += buildTemplateSection('防水工事について', qWater, 'water');
  if (!qGeneral.length && !qPaint.length && !qWater.length) {
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
    issues: issues.map(i => ({ level: i.level, tag: i.tag, title: i.title }))
  };
  saveHistoryRecord(lastDiagnosis);
  setupLeadCard(lastDiagnosis);

  resultArea.scrollIntoView({ behavior: 'smooth' });
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
    </div>
  `).join('');
}
function showHistoryDetail(id) {
  const r = loadHistory().find(x => x.id === id);
  if (!r) return;
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <h3 style="margin-top:0;">${formatDate(r.timestamp)} の診断結果</h3>
    <div class="score-box ${r.level}" style="margin-bottom:14px;">
      <div class="score-title">${levelLabel(r.level)}</div>
      <div class="score-badge">${r.score}点</div>
      <div class="price-compare">適正相場の目安：約 ${r.expectedMin}万円 〜 ${r.expectedMax}万円</div>
    </div>
    <p style="font-size:13px;color:#4a5568;"><b>工事内容：</b>${r.scopeSummary || '－'}<br><b>見積提示額：</b>${r.priceMan}万円</p>
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

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    submitBtn.innerText = '送信中…';
    try {
      await fetch(CONFIG.sheetsWebhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          name, contact, memo,
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
    } catch (err) {
      console.error(err);
      alert('送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerText = 'この内容で相談する';
    }
  };
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
  document.getElementById('diag-form').addEventListener('submit', calculateDiagnostic);
  document.getElementById('history-clear-btn').addEventListener('click', clearHistory);
  document.getElementById('modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'modal-overlay') closeModal(); });

  document.getElementById('chk-wall').checked = true;
  document.getElementById('chk-rooftop').checked = true;
  onScopeChange();
  onAreaChange();
  checkLibraries();
});
