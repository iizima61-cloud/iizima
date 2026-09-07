/**
 * iizima 見積もり診断アプリ - 相談フォーム受信スクリプト
 *
 * このファイルをGoogle Apps Scriptに貼り付けてウェブアプリとしてデプロイすると、
 * アプリの「専門家に相談する」フォームから送信された内容が
 * このスプレッドシートの「診断依頼」シートに自動で追加されます。
 *
 * セットアップ手順は SETUP_GOOGLE_SHEETS.md を参照してください。
 */
function doPost(e) {
  var sheetName = '診断依頼';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      '受信日時', 'お名前', '電話番号/メール', 'スコア', '判定',
      '見積提示額(万円)', '適正相場(万円)', '工事内容', 'ご質問・ご要望'
    ]);
  }

  var data = JSON.parse(e.postData.contents);

  sheet.appendRow([
    new Date(),
    data.name || '',
    data.contact || '',
    data.score || '',
    data.level || '',
    data.priceMan || '',
    (data.expectedMin || '') + '〜' + (data.expectedMax || ''),
    data.scopeSummary || '',
    data.memo || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ result: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
