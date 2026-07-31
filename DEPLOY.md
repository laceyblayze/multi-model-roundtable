# Public Deployment Checklist

This app can be public on the web after you set a room password, store API keys as host secrets, and keep rate limits in place.

## Required Environment Variables

Set these in your hosting provider's secret/environment settings. Do not commit them to Git.

```bash
NODE_ENV=production
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
XAI_API_KEY=xai-...
ROUNDTABLE_PASSWORD=your-private-room-password
SESSION_SECRET=a-long-random-secret-at-least-32-characters
MODEL_TURNS_PER_HOUR=30
USER_MESSAGES_PER_HOUR=120
MAX_TRANSCRIPT_MESSAGES=200
```

Generate a session secret locally with:

```bash
openssl rand -base64 48
```

## Render

This project includes `render.yaml`, so Render can create the web service from a Blueprint.

1. Push this folder to a GitHub repo.
2. In Render, click **New +** then **Blueprint**.
3. Connect the repo and select the branch.
4. Render reads `render.yaml` automatically.
5. Fill the secret values Render prompts for:
   - `OPENAI_API_KEY`
   - `GEMINI_API_KEY`
   - `XAI_API_KEY`
   - `ROUNDTABLE_PASSWORD`
   - `SESSION_SECRET`
6. Deploy.
7. Open `/api/health` on the Render URL. It should return `ok: true`.

## Railway

1. Create a new Railway project from the GitHub repo.
2. Add every required environment variable above.
3. Railway usually detects Node automatically.
4. Set the start command to `npm start` if prompted.
5. Deploy and test `/api/health`.

## Fly.io

Create `fly.toml` with your app name, then set secrets:

```bash
fly secrets set NODE_ENV=production
fly secrets set OPENAI_API_KEY=sk-...
fly secrets set GEMINI_API_KEY=...
fly secrets set XAI_API_KEY=xai-...
fly secrets set ROUNDTABLE_PASSWORD=...
fly secrets set SESSION_SECRET=...
fly secrets set MODEL_TURNS_PER_HOUR=30
fly secrets set USER_MESSAGES_PER_HOUR=120
fly secrets set MAX_TRANSCRIPT_MESSAGES=200
fly deploy
```

## What Is Hardened

- API keys only live on the server.
- Visitors must enter `ROUNDTABLE_PASSWORD` before using the room.
- Sessions use signed, HTTP-only cookies.
- Production refuses to start if critical secrets are missing.
- Each session has hourly limits for user messages and model turns.
- The transcript is capped so prompt size cannot grow forever.

## Still Worth Adding Later

- Real user accounts if multiple groups need separate rooms.
- Database-backed transcripts if you want history after restarts.
- Admin controls for clearing sessions and changing limits without redeploying.
- Provider-side spending caps in OpenAI, Google, and xAI billing dashboards.
