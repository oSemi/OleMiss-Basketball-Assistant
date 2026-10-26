# Ole Miss Men's Basketball Manager Assistant

This package adds an AI chat assistant and shared checklist storage to the 2026–27 checklist app.

## Before deploying
This is a deployment-ready starter, not a live hosted website. It needs a Node.js host, a persistent disk for SQLite (or a managed database), and an OpenAI API key. The assistant API key must only be configured as a server environment variable, never in `public/index.html`.

## Environment variables
- `OPENAI_API_KEY`: OpenAI API key for the server.
- `TEAM_ACCESS_CODE`: a long, private team passcode shared only with the 11 managers.
- `OPENAI_MODEL`: optional, defaults to `gpt-4.1-mini`.
- `PORT`: optional, host usually sets this.
- `DB_PATH`: optional path to persistent SQLite database file. Use a persistent disk on your host.

## Run locally
1. Install a current Node.js LTS release.
2. In this folder, run `npm install`.
3. Set `OPENAI_API_KEY` and `TEAM_ACCESS_CODE` in your terminal environment.
4. Run `npm start`.
5. Open `http://localhost:3000`.

Example environment setup (macOS/Linux):
```bash
export OPENAI_API_KEY="your-api-key"
export TEAM_ACCESS_CODE="a-long-private-team-code"
npm install
npm start
```

## What is shared
Checklist completion, manager assignments, and the small set of non-confidential metadata are stored on the server in SQLite. All managers who have the team access code use the same state. Use a host with persistent disk storage, otherwise SQLite data can be lost on redeploy.

## Security and limitations
- The team code is a shared access gate, not individual manager accounts. Anyone who obtains it can view and edit the shared checklist.
- Do not put the team code into a public source repository.
- The assistant uses the server's stored checkbox and assignment data, not unverified claims from chat.
- The assistant does not mark tasks complete; managers update checkboxes themselves.
- Do not enter confidential scouting reports, play cards, injury details, or internal coaching plans.
- Rate limiting is enabled on API endpoints. For a production deployment, consider individual logins, role-based access, audit logs, and a managed database with backups.
- The last source photo was unreadable; the assistant is instructed not to invent those missing assignments.
- The schedule is transcribed from the user-provided screenshot and must be checked against the official Operations itinerary.

## Deploy
Deploy the folder to a Node.js hosting provider that supports environment variables and persistent storage. Set the variables above in the host dashboard. Do not use static-only hosting for this version because the assistant and shared database require a server.
