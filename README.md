# Discord → n8n Webhook Bot

A Discord bot that forwards channel messages to n8n (or any webhook URL) on a per-channel basis. Admins configure a webhook URL per channel using slash commands; every new message in that channel is then POSTed to the webhook as JSON.

## Features

- Per-channel webhook configuration — different channels can point to different n8n workflows
- Slash commands with permission checks (`Manage Channels` required)
- SSRF protection — only public HTTPS URLs are accepted
- Zero-database setup — config is stored in a local `webhooks.json` file
- Lightweight: only three dependencies (`discord.js`, `axios`, `dotenv`)

## Slash Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `/setup <webhook_url>` | Configure a webhook for the current channel | Manage Channels |
| `/remove` | Remove the webhook from the current channel | Manage Channels |
| `/status` | Show whether this channel has a webhook configured | Everyone |

## Webhook Payload

Every message triggers a POST to the configured URL with this JSON body:

```json
{
  "event": "message_create",
  "messageId": "123456789",
  "content": "Hello world",
  "author": {
    "id": "111",
    "username": "john",
    "displayName": "John Doe"
  },
  "channel": { "id": "222", "name": "general" },
  "guild": { "id": "333", "name": "My Server" },
  "attachments": [],
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## Setup

### 1. Get Your Bot Credentials

In the [Discord Developer Portal](https://discord.com/developers/applications), open your existing application:

- **Bot Token** → Bot section → Reset Token
- **Application ID** → General Information → Application ID

Make sure **Message Content Intent** is enabled under Bot → Privileged Gateway Intents.

### 2. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_id_here
```

### 4. Install and Run (local)

```bash
npm install
npm start
```

---

## Deploy to Google Cloud

### Option A — Compute Engine VM (recommended for 24/7 bots)

The simplest option. The free-tier **e2-micro** instance is enough.

```bash
# 1. Create a VM (free tier: us-central1, us-west1, or us-east1)
gcloud compute instances create discord-bot \
  --machine-type=e2-micro \
  --zone=us-central1-a \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --tags=http-server

# 2. SSH into the VM
gcloud compute ssh discord-bot --zone=us-central1-a

# 3. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Clone this repo
git clone https://github.com/YOUR_USERNAME/n8n_discord_trigger_bot.git
cd n8n_discord_trigger_bot

# 5. Install dependencies and configure
npm install --omit=dev
cp .env.example .env
nano .env   # fill in your tokens

# 6. Run as a background service with PM2
sudo npm install -g pm2
pm2 start index.js --name discord-bot
pm2 startup          # follow the printed command to enable autostart
pm2 save
```

The bot will restart automatically if the VM reboots.

### Option B — Cloud Run (containerized)

Cloud Run is serverless but **requires min-instances=1** to keep the Discord WebSocket alive.

```bash
# Build and push the image
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/discord-bot

# Deploy (min-instances=1 prevents cold starts from dropping the connection)
gcloud run deploy discord-bot \
  --image gcr.io/YOUR_PROJECT_ID/discord-bot \
  --platform managed \
  --region us-central1 \
  --min-instances 1 \
  --set-env-vars DISCORD_TOKEN=xxx,DISCORD_CLIENT_ID=yyy
```

> **Note:** Cloud Run's file system is ephemeral. `webhooks.json` is lost on each restart.  
> Mount a Cloud Storage FUSE bucket or switch to Firestore/Cloud SQL if you need persistence across restarts.

---

## Project Structure

```
index.js          # Bot entry point — event handlers and slash commands
package.json
.env.example      # Template for required environment variables
webhooks.json     # Auto-generated at runtime (not committed to git)
```
