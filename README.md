# Multi-Model Roundtable

A local browser app where you talk to Gemini, Grok, and ChatGPT in one shared transcript. The server enforces the turn order, and each model receives the full conversation so far before responding.

## Run it

1. Copy `.env.example` to `.env`.
2. Add your keys:
   - `OPENAI_API_KEY`
   - `GEMINI_API_KEY`
   - `XAI_API_KEY`
   - `ROUNDTABLE_PASSWORD`
   - `SESSION_SECRET`
3. Start the app:

```bash
npm start
```

Open `http://localhost:4177`.

If `ROUNDTABLE_PASSWORD` is set, the browser will ask for it before allowing messages or model turns. Production deploys require the password and session secret.

## How turns work

- You can message the whole room at any time.
- `Next model turn` calls only the next model in the selected order.
- `Run one round` calls each selected model once, sequentially.
- Models are instructed not to speak for each other or invent future turns.
- The transcript is held in local server memory and clears when you restart or press `Reset`.

## Current API shape

- ChatGPT uses OpenAI `/v1/responses`.
- Grok uses xAI `/v1/responses`.
- Gemini uses Google Gemini `/v1beta/interactions` with `store: false`.

The app keeps API keys out of browser JavaScript. They are read only by the local Node server.

## Public Deployment

See [DEPLOY.md](./DEPLOY.md) for the public deployment checklist, required secrets, and Render/Railway/Fly.io instructions.
