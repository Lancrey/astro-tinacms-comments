/**
 * Google Apps Script — Comment System API
 *
 * Deploy as Web App (Execute as: Me, Access: Anyone)
 *
 * Script Properties required:
 *   SHEET_ID      — Google Sheet ID
 *   SECRET_TOKEN  — Admin moderation token
 *
 * Google Sheet must have two tabs:
 *   "comments" — columns: id, timestamp, page_slug, author, email, content, status
 *   "captcha"  — columns: id, target_word, correct_answer, distractor_1, distractor_2, distractor_3
 */

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getSpreadsheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID not configured in Script Properties');
  return SpreadsheetApp.openById(sheetId);
}

function getSheet(name) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet "' + name + '" not found');
  return sheet;
}

function getCommentsSheet() {
  return getSheet('comments');
}

function getCaptchaSheet() {
  return getSheet('captcha');
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSecret() {
  return PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
}

// ─── CAPTCHA Token (HMAC-signed, stateless) ─────────────────────────────────────

/**
 * Creates a signed challenge token containing the captcha ID, correct answer,
 * and an expiry timestamp. The token is never readable by the client.
 */
function createCaptchaToken(captchaId, correctAnswer) {
  var secret = getSecret();
  var expiry = new Date().getTime() + 10 * 60 * 1000; // 10 minutes
  var payload = captchaId + '|' + correctAnswer + '|' + expiry;
  var signature = computeHmac(secret, payload);
  // Return base64-encoded: payload + '.' + signature
  return Utilities.base64Encode(payload) + '.' + signature;
}

function verifyCaptchaToken(token, userAnswer) {
  if (!token || !userAnswer) return false;
  var secret = getSecret();

  try {
    var parts = token.split('.');
    if (parts.length !== 2) return false;

    var payload = Utilities.newBlob(Utilities.base64Decode(parts[0])).getDataAsString();
    var signature = parts[1];

    // Verify signature
    var expectedSig = computeHmac(secret, payload);
    if (signature !== expectedSig) return false;

    // Parse payload
    var segments = payload.split('|');
    if (segments.length !== 3) return false;

    var correctAnswer = segments[1];
    var expiry = parseInt(segments[2], 10);

    // Check expiry
    if (new Date().getTime() > expiry) return false;

    // Check answer (case-insensitive trim)
    return userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();
  } catch (e) {
    return false;
  }
}

function computeHmac(secret, message) {
  var signature = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    message,
    secret
  );
  return Utilities.base64Encode(signature);
}

// ─── Shuffle utility ────────────────────────────────────────────────────────────

function shuffleArray(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

// ─── GET ────────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    var params = e.parameter || {};

    if (params.action === 'admin') {
      return handleAdminGet(params);
    }

    if (params.action === 'captcha') {
      return handleCaptchaGet();
    }

    if (params.action === 'admin_captcha') {
      return handleAdminCaptchaGet(params);
    }

    return handlePublicGet(params);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handlePublicGet(params) {
  var page = params.page;
  if (!page) return jsonResponse([]);

  var sheet = getCommentsSheet();
  var data = sheet.getDataRange().getValues();
  var comments = [];

  for (var i = 1; i < data.length; i++) {
    if (data[i][2] === page && data[i][6] === 'approved') {
      comments.push({
        id: String(data[i][0]),
        author: data[i][3],
        date: data[i][1],
        content: data[i][5]
      });
    }
  }

  return jsonResponse(comments);
}

function handleAdminGet(params) {
  var secret = getSecret();
  if (!params.token || params.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  var sheet = getCommentsSheet();
  var data = sheet.getDataRange().getValues();
  var pending = [];

  for (var i = 1; i < data.length; i++) {
    if (data[i][6] === 'pending') {
      pending.push({
        id: data[i][0],
        date: data[i][1],
        page: data[i][2],
        author: data[i][3],
        email: data[i][4],
        content: data[i][5]
      });
    }
  }

  return jsonResponse(pending);
}

// ─── CAPTCHA: Get a random challenge ────────────────────────────────────────────

function handleCaptchaGet() {
  var sheet = getCaptchaSheet();
  var data = sheet.getDataRange().getValues();

  if (data.length < 2) {
    return jsonResponse({ ok: false, error: 'No CAPTCHA items configured' });
  }

  // Pick a random row (skip header)
  var rowIndex = Math.floor(Math.random() * (data.length - 1)) + 1;
  var row = data[rowIndex];

  var captchaId = row[0];
  var targetWord = row[1];
  var correctAnswer = row[2];
  var distractors = [row[3], row[4], row[5]];

  // Shuffle the 4 choices
  var choices = shuffleArray([correctAnswer].concat(distractors));

  // Create signed token (contains the answer — never sent in cleartext)
  var token = createCaptchaToken(String(captchaId), correctAnswer);

  return jsonResponse({
    ok: true,
    target_word: targetWord,
    choices: choices,
    challenge_token: token
  });
}

// ─── CAPTCHA Admin: List all items ──────────────────────────────────────────────

function handleAdminCaptchaGet(params) {
  var secret = getSecret();
  if (!params.token || params.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  var sheet = getCaptchaSheet();
  var data = sheet.getDataRange().getValues();
  var items = [];

  for (var i = 1; i < data.length; i++) {
    items.push({
      id: data[i][0],
      target_word: data[i][1],
      correct_answer: data[i][2],
      distractor_1: data[i][3],
      distractor_2: data[i][4],
      distractor_3: data[i][5]
    });
  }

  return jsonResponse(items);
}

// ─── POST ───────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === 'moderate') {
      return handleModerate(body);
    }

    if (body.action === 'captcha_add') {
      return handleCaptchaAdd(body);
    }

    if (body.action === 'captcha_edit') {
      return handleCaptchaEdit(body);
    }

    if (body.action === 'captcha_delete') {
      return handleCaptchaDelete(body);
    }

    if (body.action === 'captcha_import') {
      return handleCaptchaImport(body);
    }

    return handleSubmit(body);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ─── Comment submission (with CAPTCHA verification) ─────────────────────────────

function handleSubmit(body) {
  // Honeypot check — reject silently
  if (body.honeypot) {
    return jsonResponse({ ok: true, message: 'Comment pending moderation' });
  }

  // Validation
  if (!body.page || typeof body.page !== 'string') {
    return jsonResponse({ ok: false, error: 'Missing field: page' });
  }
  if (!body.author || typeof body.author !== 'string') {
    return jsonResponse({ ok: false, error: 'Missing field: author' });
  }
  if (!body.content || typeof body.content !== 'string') {
    return jsonResponse({ ok: false, error: 'Missing field: content' });
  }
  if (body.content.length > 2000) {
    return jsonResponse({ ok: false, error: 'Content exceeds 2000 characters' });
  }
  if (body.author.length > 100) {
    return jsonResponse({ ok: false, error: 'Author name exceeds 100 characters' });
  }

  // CAPTCHA verification
  if (!body.challenge_token || !body.captcha_answer) {
    return jsonResponse({ ok: false, error: 'CAPTCHA response required' });
  }

  if (!verifyCaptchaToken(body.challenge_token, body.captcha_answer)) {
    return jsonResponse({ ok: false, error: 'CAPTCHA verification failed', captcha_failed: true });
  }

  var sheet = getCommentsSheet();
  var lastRow = sheet.getLastRow();
  var newId = lastRow < 2 ? 1 : Number(sheet.getRange(lastRow, 1).getValue()) + 1;
  var timestamp = new Date().toISOString();

  sheet.appendRow([
    newId,
    timestamp,
    body.page,
    body.author,
    body.email || '',
    body.content,
    'pending'
  ]);

  return jsonResponse({ ok: true, message: 'Comment pending moderation' });
}

// ─── Comment moderation ─────────────────────────────────────────────────────────

function handleModerate(body) {
  var secret = getSecret();
  if (!body.token || body.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  if (!body.id || (body.status !== 'approved' && body.status !== 'rejected')) {
    return jsonResponse({ ok: false, error: 'Invalid parameters: id and status (approved|rejected) required' });
  }

  var sheet = getCommentsSheet();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      sheet.getRange(i + 1, 7).setValue(body.status);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ ok: false, error: 'Comment not found' });
}

// ─── CAPTCHA CRUD ───────────────────────────────────────────────────────────────

function handleCaptchaAdd(body) {
  var secret = getSecret();
  if (!body.token || body.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  if (!body.target_word || !body.correct_answer || !body.distractor_1 || !body.distractor_2 || !body.distractor_3) {
    return jsonResponse({ ok: false, error: 'All fields required: target_word, correct_answer, distractor_1, distractor_2, distractor_3' });
  }

  var sheet = getCaptchaSheet();
  var lastRow = sheet.getLastRow();
  var newId = lastRow < 2 ? 1 : Number(sheet.getRange(lastRow, 1).getValue()) + 1;

  sheet.appendRow([
    newId,
    body.target_word,
    body.correct_answer,
    body.distractor_1,
    body.distractor_2,
    body.distractor_3
  ]);

  return jsonResponse({ ok: true, id: newId });
}

function handleCaptchaEdit(body) {
  var secret = getSecret();
  if (!body.token || body.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  if (!body.id) {
    return jsonResponse({ ok: false, error: 'Missing id' });
  }

  var sheet = getCaptchaSheet();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      var row = i + 1;
      if (body.target_word) sheet.getRange(row, 2).setValue(body.target_word);
      if (body.correct_answer) sheet.getRange(row, 3).setValue(body.correct_answer);
      if (body.distractor_1) sheet.getRange(row, 4).setValue(body.distractor_1);
      if (body.distractor_2) sheet.getRange(row, 5).setValue(body.distractor_2);
      if (body.distractor_3) sheet.getRange(row, 6).setValue(body.distractor_3);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ ok: false, error: 'CAPTCHA item not found' });
}

function handleCaptchaDelete(body) {
  var secret = getSecret();
  if (!body.token || body.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  if (!body.id) {
    return jsonResponse({ ok: false, error: 'Missing id' });
  }

  var sheet = getCaptchaSheet();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      sheet.deleteRow(i + 1);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ ok: false, error: 'CAPTCHA item not found' });
}

function handleCaptchaImport(body) {
  var secret = getSecret();
  if (!body.token || body.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return jsonResponse({ ok: false, error: 'Missing or empty items array' });
  }

  var sheet = getCaptchaSheet();
  var lastRow = sheet.getLastRow();
  var nextId = lastRow < 2 ? 1 : Number(sheet.getRange(lastRow, 1).getValue()) + 1;
  var count = 0;

  for (var i = 0; i < body.items.length; i++) {
    var item = body.items[i];
    if (!item.target_word || !item.correct_answer || !item.distractor_1 || !item.distractor_2 || !item.distractor_3) {
      continue; // skip invalid items
    }
    sheet.appendRow([
      nextId,
      item.target_word,
      item.correct_answer,
      item.distractor_1,
      item.distractor_2,
      item.distractor_3
    ]);
    nextId++;
    count++;
  }

  return jsonResponse({ ok: true, imported: count });
}
