# Astro Comment System with Google Sheets

A lightweight, self-hosted comment system for Astro static sites using Google Sheets as a database and Google Apps Script as an API. Supports English, French, and Spanish.

## Architecture

```
Visitor → Astro Component → Google Apps Script (Web App) → Google Sheets
```

## Setup

### 1. Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Rename the first sheet tab to **`comments`**
3. Add headers in row 1:

| A  | B         | C          | D      | E     | F       | G      |
|----|-----------|------------|--------|-------|---------|--------|
| id | timestamp | page_slug  | author | email | content | status |

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

### 4. Integrate in your pages

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

### 5. Admin moderation

Navigate to `/admin/comments` on your site. Enter your `SECRET_TOKEN` to load and moderate pending comments.

## File Structure

```
├── google-apps-script/
│   └── Code.gs              # Google Apps Script (paste into script editor)
├── src/
│   ├── components/
│   │   └── Comments.astro    # Comment display + submission form
│   ├── i18n/
│   │   └── comments.ts       # Translations (EN/FR/ES)
│   ├── layouts/
│   │   └── BaseLayout.astro  # Example layout
│   └── pages/
│       ├── index.astro       # Example page with comments
│       └── admin/
│           └── comments.astro # Admin moderation panel
├── .env.example
├── astro.config.mjs
├── package.json
└── README.md
```

## Features

- **No external dependencies**: vanilla JS, no framework in client-side code
- **Spam protection**: honeypot field
- **Moderation**: all comments require approval before being displayed
- **Privacy**: email addresses are never exposed publicly
- **i18n**: English, French, Spanish out of the box
- **SSG compatible**: comments are fetched at build time, with client-side form submission
- **Accessible**: semantic HTML, proper labels, keyboard navigation

## Security Notes

- The `SECRET_TOKEN` is never exposed in client-side code
- The admin page sends the token only when explicitly entered by the admin
- Email addresses are stored in the sheet but never returned in the public API
- The honeypot field silently rejects automated submissions
- Content is HTML-escaped when rendered
