/**
 * Google Apps Script — Comment System API
 *
 * Deploy as Web App (Execute as: Me, Access: Anyone)
 *
 * Script Properties required:
 *   SHEET_ID      — Google Sheet ID
 *   SECRET_TOKEN  — Admin moderation token
 */

function getSheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID not configured in Script Properties');
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName('comments');
  if (!sheet) throw new Error('Sheet "comments" not found');
  return sheet;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── GET ────────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    var params = e.parameter || {};

    // Admin route: return pending comments
    if (params.action === 'admin') {
      return handleAdminGet(params);
    }

    // Public route: return approved comments for a page
    return handlePublicGet(params);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleAdminGet(params) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
  if (!params.token || params.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  var sheet = getSheet();
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

function handlePublicGet(params) {
  var page = params.page;
  if (!page) {
    return jsonResponse([]);
  }

  var sheet = getSheet();
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

// ─── POST ───────────────────────────────────────────────────────────────────────

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // Moderation route
    if (body.action === 'moderate') {
      return handleModerate(body);
    }

    // Public route: submit a comment
    return handleSubmit(body);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleModerate(body) {
  var secret = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
  if (!body.token || body.token !== secret) {
    return jsonResponse({ ok: false, error: 'Invalid token' });
  }

  if (!body.id || (body.status !== 'approved' && body.status !== 'rejected')) {
    return jsonResponse({ ok: false, error: 'Invalid parameters: id and status (approved|rejected) required' });
  }

  var sheet = getSheet();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(body.id)) {
      sheet.getRange(i + 1, 7).setValue(body.status);
      return jsonResponse({ ok: true });
    }
  }

  return jsonResponse({ ok: false, error: 'Comment not found' });
}

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

  var sheet = getSheet();
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
