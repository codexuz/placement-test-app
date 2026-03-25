# Placement Test App (React + Tailwind + Vite)

Professional multi-level placement test interface with three selectable tracks:

- Kids
- Level 1
- Level 2

The app includes:

- Selection flow and pre-test intro screen
- Timed quiz interface
- Per-question progress indicator
- Score summary screen
- Telegram result delivery
- JSON-based question banks loaded from `public/tests`

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Start development server:

```bash
npm run dev
```

3. Build production bundle:

```bash
npm run build
```

## Telegram setup

Create a `.env` file in the project root and set:

```env
VITE_TELEGRAM_BOT_TOKEN=your_bot_token
VITE_TELEGRAM_CHAT_ID=your_chat_id
```

Note: This is currently client-side integration for quick delivery. For production, route Telegram requests through a backend API to keep the token private.

## Test content structure

Test data is loaded from:

- `public/tests/kids.json`
- `public/tests/level1.json`
- `public/tests/level2.json`

Expected shape:

```json
{
  "id": "level1",
  "title": "Level 1 Placement Test",
  "shortTitle": "Level 1",
  "description": "...",
  "sourceDoc": "test 2.docx",
  "timeLimitMinutes": 30,
  "instructions": ["..."],
  "questions": [
    {
      "id": "l1_1",
      "prompt": "Question text",
      "options": ["A", "B", "C", "D"],
      "answerIndex": 1
    }
  ]
}
```

Replace these JSON files with exact parsed content from your DOCX test sources when needed.
