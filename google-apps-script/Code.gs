/**
 * iizima 見積もり診断アプリ - 相談フォーム受信スクリプト
 *
 * このファイルをGoogle Apps Scriptに貼り付けてウェブアプリとしてデプロイすると、
 * アプリの「専門家に相談する」フォームから送信された内容が
 * このスプレッドシートの「診断依頼」シートに自動で追加され、
 * 下記 NOTIFY_EMAIL 宛にお知らせメールが届きます。
 *
 * セットアップ手順は SETUP_GOOGLE_SHEETS.md を参照してください。
 */

// 新しい相談が届いたときに通知メールを送る宛先。不要な場合は空文字 '' にする。
var NOTIFY_EMAIL = 'iizima.bousui@outlook.jp';

function doPost(e) {
  var sheetName = '診断依頼';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      '受信日時', 'お名前', '電話番号/メール', 'スコア', '判定',
      '見積提示額(万円)', '適正相場(万円)', '工事内容', '相談内容', 'ご質問・ご要望'
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
    (data.topics && data.topics.length) ? data.topics.join('、') : '',
    data.memo || ''
  ]);

  if (NOTIFY_EMAIL) {
    sendNotifyEmail(data);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ result: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sendNotifyEmail(data) {
  var subject = '【iizima診断アプリ】新しい相談が届きました（' + (data.name || '名前未入力') + '様）';
  var body =
    'iizima見積もり診断アプリから、新しい相談の連絡が届きました。\n\n' +
    'お名前　　　：' + (data.name || '') + '\n' +
    '連絡先　　　：' + (data.contact || '') + '\n' +
    '相談内容　　：' + ((data.topics && data.topics.length) ? data.topics.join('、') : '（なし）') + '\n' +
    'ご質問・要望：' + (data.memo || '（なし）') + '\n\n' +
    '診断スコア　：' + (data.score || '') + '点\n' +
    '工事内容　　：' + (data.scopeSummary || '') + '\n' +
    '見積提示額　：' + (data.priceMan || '') + '万円\n' +
    '適正相場　　：' + (data.expectedMin || '') + '〜' + (data.expectedMax || '') + '万円\n\n' +
    '詳細はスプレッドシートの「診断依頼」シートをご確認ください。';

  MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}
