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
   - `ADMIN_PASSWORD`
3. Start the app:

```bash
npm start
```

Open `http://localhost:4177`.

If `ROUNDTABLE_PASSWORD` is set, the browser will ask for it before allowing messages or model turns. Production deploys require the password and session secret.

If `DATABASE_URL` is set, transcript messages and limit settings are stored in PostgreSQL and survive restarts. Without it, the app uses in-memory storage for local development.

## How turns work

- You can message the whole room at any time.
- `Next model turn` calls only the next model in the selected order.
- `Run one round` calls each selected model once, sequentially.
- Models are instructed not to speak for each other or invent future turns.
- The transcript is held in local server memory and clears when you restart or press `Reset`.
- On Render, the transcript is stored in PostgreSQL when provisioned through `render.yaml`.

## Admin

Use the Admin panel to unlock live controls with `ADMIN_PASSWORD`.

- Change hourly model-turn and user-message limits without redeploying.
- Change the transcript cap without redeploying.
- Clear transcript history.
- Clear active sessions.

## Current API shape

- ChatGPT uses OpenAI `/v1/responses`.
- Grok uses xAI `/v1/responses`.
- Gemini uses Google Gemini `/v1beta/interactions` with `store: false`.

The app keeps API keys out of browser JavaScript. They are read only by the local Node server.

## Public Deployment

See [DEPLOY.md](./DEPLOY.md) for the public deployment checklist, required secrets, and Render/Railway/Fly.io instructions.
