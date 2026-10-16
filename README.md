# Zhost

Free Telegram bot hosting on Cloudflare Workers.

**Author:** Zaw Myo Naing

---

## What is this?

Zhost turns a single Cloudflare Worker into a hosting backend for Telegram bots.
Each bot gets its own config — commands, menu buttons, auto-replies — stored in
Cloudflare KV. Telegram sends updates to a webhook; the Worker looks up the
bot's config and sends the right reply back.

- **Free** — Cloudflare Workers free tier (100,000 requests/day)
- **Serverless** — no servers, no maintenance
- **24/7** — always on
- **Multi-bot** — one Worker hosts many bots

---

## Features

- Multi-bot support with isolated configs
- Slash commands (`/start`, `/help`, custom)
- Reply keyboard menu buttons
- Inline button callbacks
- Auto-reply rules (contains, exact, regex, starts, ends)
- Welcome message with placeholders (`{bot_name}`, `{user_name}`, `{date}`)
- Webhook secret verification
- Sync commands to Telegram (`setMyCommands`)
- Test connection endpoint (`/api/ping`)

---

## Setup

### 1. Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free)
- [Node.js](https://nodejs.org) 18+ installed
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### 2. Clone and install

```bash
git clone https://github.com/YOUR-USERNAME/zhost.git
cd zhost
npm install