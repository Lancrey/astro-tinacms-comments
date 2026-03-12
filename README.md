# Astro Comment System with Google Sheets

A lightweight, self-hosted comment system for Astro static sites using Google Sheets as a database and Google Apps Script as an API. Supports English, French, and Spanish.

## Architecture

```
Visitor → Astro Component → Google Apps Script (Web App) → Google Sheets
```

**Security flow for CAPTCHA (stateless, HMAC-signed):**

```
1. Client loads form  →  GET ?action=captcha  →  Apps Script picks random challenge
2. Apps Script returns: target_word, shuffled choices[], signed challenge_token
   (token = HMAC-SHA256 of captcha_id|correct_answer|expiry, using SECRET_TOKEN as key)
3. User selects an answer (correct answer is NOT in the HTML/JS — only the 4 shuffled labels)
4. Client submits: comment data + challenge_token + captcha_answer
5. Apps Script verifies HMAC signature, checks expiry, compares answer → accept or reject
```

## Setup

### 1. Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Create a tab named **`comments`** with headers in row 1:

| A  | B         | C          | D      | E     | F       | G      |
|----|-----------|------------|--------|-------|---------|--------|
| id | timestamp | page_slug  | author | email | content | status |

3. Create a second tab named **`captcha`** with headers in row 1:

| A  | B           | C              | D            | E            | F            |
|----|-------------|----------------|--------------|--------------|--------------|
| id | target_word | correct_answer | distractor_1 | distractor_2 | distractor_3 |

4. Note the **Sheet ID** from the URL: `https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit`

### 2. Deploy Google Apps Script

1. Go to [Google Apps Script](https://script.google.com) and create a new project
2. Replace the contents of `Code.gs` with the file from `google-apps-script/Code.gs`
3. Go to **Project Settings** (gear icon) → **Script Properties** → Add:
   - `SHEET_ID` = your Google Sheet ID
   - `SECRET_TOKEN` = a strong random token for admin access (e.g. generate with `openssl rand -hex 32`)
4. Click **Deploy** → **New deployment**
5. Select type: **Web app**
6. Configure:
   - **Execute as**: Me
   - **Who has access**: Anyone
7. Click **Deploy** and authorize when prompted
8. Copy the **Web app URL** (ends with `/exec`)

### 3. Configure Astro

1. Create a `.env` file at the project root:

```env
PUBLIC_COMMENTS_API_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
```

2. Install dependencies and run:

```bash
npm install
npm run dev
```

### 4. Add CAPTCHA items

Navigate to `/admin/captcha` on your site. Enter your `SECRET_TOKEN`, then either:

- **Add items manually** using the form
- **Bulk import** by pasting JSON or CSV

**JSON format:**
```json
[
  {
    "target_word": "Broom",
    "correct_answer": "Floor",
    "distractor_1": "Toilet",
    "distractor_2": "Aladdin",
    "distractor_3": "Dance"
  }
]
```

**CSV format:**
```
target_word,correct_answer,distractor_1,distractor_2,distractor_3
Broom,Floor,Toilet,Aladdin,Dance
Umbrella,Rain,Sun,Car,Book
```

### 5. Integrate in your pages

```astro
---
import Comments from '../components/Comments.astro';
const slug = Astro.url.pathname;
---

<Comments slug={slug} />
```

You can pass an explicit language:

```astro
<Comments slug={slug} lang="fr" />
```

Supported languages: `en`, `fr`, `es`. By default, the language is detected from the URL path (`/fr/...` → French, `/es/...` → Spanish, otherwise English).

### 6. Admin

- **Comment moderation**: `/admin/comments` — approve or reject pending comments
- **CAPTCHA management**: `/admin/captcha` — add, edit, delete, or bulk-import CAPTCHA items

## File Structure

```
├── google-apps-script/
│   └── Code.gs              # Google Apps Script (paste into script editor)
├── src/
│   ├── components/
│   │   └── Comments.astro    # Comment display + form + CAPTCHA challenge
│   ├── i18n/
│   │   └── comments.ts       # Translations (EN/FR/ES)
│   ├── layouts/
│   │   └── BaseLayout.astro  # Example layout
│   └── pages/
│       ├── index.astro       # Example page with comments
│       └── admin/
│           ├── comments.astro # Comment moderation panel
│           └── captcha.astro  # CAPTCHA CRUD + bulk import
├── .env.example
├── astro.config.mjs
├── package.json
└── README.md
```

## Features

- **No external dependencies**: vanilla JS, no framework in client-side code
- **Custom semantic CAPTCHA**: association-based challenges (e.g. "Broom" → "Floor")
- **Secure CAPTCHA**: correct answer never sent to client; HMAC-signed tokens with 10-minute expiry
- **Honeypot**: additional anti-spam layer (hidden field)
- **Moderation**: all comments require approval before display
- **Privacy**: email addresses never exposed in public API
- **i18n**: English, French, Spanish
- **SSG compatible**: comments fetched at build time, CAPTCHA + form handled client-side
- **CAPTCHA admin**: full CRUD + bulk JSON/CSV import

## CAPTCHA Security Model

The CAPTCHA system uses **HMAC-SHA256 signed tokens** to avoid the need for server-side sessions (Apps Script is stateless):

1. **No answer in HTML/JS**: The client only receives `target_word` and 4 shuffled `choices`. There is no CSS class, data attribute, or JS variable that reveals the correct answer.
2. **Signed token**: The challenge token contains `captcha_id|correct_answer|expiry` signed with `SECRET_TOKEN` via HMAC-SHA256. It cannot be forged or tampered with.
3. **Expiry**: Tokens expire after 10 minutes.
4. **Server verification**: On submission, Apps Script decodes the token, verifies the HMAC signature, checks expiry, and compares the user's answer.
5. **On failure**: A new challenge is automatically loaded, preventing brute-force.
