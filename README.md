# 🎂 Well Wisher - WhatsApp Birthday Notification Bot

An automated WhatsApp birthday notification bot for your college group built with **Node.js**, **whatsapp-web.js**, and **node-cron**. Uses WhatsApp Web's `LocalAuth` strategy to persist session logins so you only need to scan the QR code once.

---

## 🚀 Features

- **Persistent Authentication**: Uses `LocalAuth` to store session credentials locally inside `.wwebjs_auth`. No repeated QR scans across restarts.
- **Group ID Discovery Utility**: Built-in interactive scan function to list all active WhatsApp groups and their unique serialized IDs (`@g.us`).
- **Flexible Birthday Database**: Reads `birthdays.json` supporting both `MM-DD` and `YYYY-MM-DD` formats with custom greetings or fallbacks.
- **Daily Automated Schedule**: Uses `node-cron` to automatically trigger greetings at midnight (`00:00`) in your specified timezone.
- **Resilient & Safe**: Validates JSON data on each run, handles connection drops with automatic reconnection, and prevents crashes from bad data or API rate limits.
- **Testing Modes**: Test run mode to verify messages immediately without waiting for midnight.

---

## 🛠 Tech Stack

- **Node.js** (v18+)
- [**whatsapp-web.js**](https://github.com/pedroslopez/whatsapp-web.js) - WhatsApp Web API client via Puppeteer
- [**qrcode-terminal**](https://github.com/gtanner/qrcode-terminal) - Displays WhatsApp QR code directly in the terminal
- [**node-cron**](https://github.com/node-cron/node-cron) - Task scheduler for the daily midnight check

---

## 📁 Project Structure

```
well-wisher-ws-bot/
├── .gitignore          # Ignores node_modules, .wwebjs_auth session, cache
├── birthdays.json      # Birthday list & custom greetings
├── index.js            # Main bot logic, client handlers, and scheduler
├── package.json        # Dependencies and scripts
└── README.md           # Documentation & instructions
```

---

## 📦 Installation

1. **Clone the repository and enter the directory**:
   ```bash
   cd well-wisher-ws-bot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

---

## 🔍 Step-by-Step: Extracting Your College Group ID

WhatsApp groups use a special serialized ID ending in `@g.us` (e.g., `120363023456789012@g.us`). Follow these steps to find your college group's exact ID:

1. **Run the group identification utility**:
   ```bash
   npm run list-groups
   ```
   *(Or run `node index.js --list-groups`)*

2. **Scan the terminal QR code**:
   - A QR code will appear in your terminal.
   - Open WhatsApp on your phone > **Settings** (or 3 dots on Android) > **Linked Devices** > **Link a Device**.
   - Point your phone camera at the terminal QR code.

3. **Locate your group in the output list**:
   Once connected, the bot will print all your active groups:
   ```text
   ======================================================
   📋 ACTIVE WHATSAPP GROUPS & SERIALIZED IDs
   ======================================================
   Found 3 active group(s):

   1. Name: "Batch of 2026 - CS Dept"
      Group ID: 120363023456789012@g.us
      Unread Messages: 0
      ---------------------------------------------------
   2. Name: "College Project Team"
      Group ID: 120363098765432100@g.us
      Unread Messages: 4
      ---------------------------------------------------
   ```

4. **Copy the Group ID**:
   Copy the string next to `Group ID` (e.g., `120363023456789012@g.us`).

5. **Configure `index.js`**:
   Open `index.js` and paste it into the `TARGET_GROUP_ID` variable:
   ```javascript
   const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || '120363023456789012@g.us';
   ```
   *(Alternatively, you can provide it via an environment variable `TARGET_GROUP_ID=...`)*

---

## 📅 Configuring `birthdays.json`

Add your friends' names and dates of birth in `birthdays.json`. Supported formats for `dob` are `MM-DD` or `YYYY-MM-DD`:

```json
[
  {
    "name": "Aarav Sharma",
    "dob": "11-05",
    "customMessage": "🎉 Happy Birthday Aarav! 🎂 Wishing you an amazing year ahead! 🚀"
  },
  {
    "name": "Priya Patel",
    "dob": "2002-08-15",
    "customMessage": null
  }
]
```

- **`name`**: Friend's name (required).
- **`dob`**: Date of birth (required, format: `"MM-DD"` or `"YYYY-MM-DD"`).
- **`customMessage`**: (Optional) A custom greeting. If set to `null` or omitted, the bot uses a festive default message.

---

## 🚀 Running the Bot

### 1. Test Run (Immediate Check)
To test sending a message right away without waiting until midnight:
```bash
npm run test-run
```
*(Or `node index.js --test-run`)*

### 2. Normal Production Run
To start the bot and keep it running for midnight triggers:
```bash
npm start
```

### 3. Background Execution with PM2 (Recommended)
To keep the bot running 24/7 on a server or computer:
```bash
# Install PM2 globally
npm install -g pm2

# Start bot process
pm2 start index.js --name "birthday-bot"

# Save configuration for automatic reboot restart
pm2 save
pm2 startup
```

---

## ⚙️ Configuration Options

You can adjust these settings at the top of [index.js](file:///Users/auxalus/Desktop/projects/well-wisher-ws-bot/index.js) or via environment variables:

| Variable | Default Value | Description |
|---|---|---|
| `TARGET_GROUP_ID` | `'YOUR_COLLEGE_GROUP_ID@g.us'` | Serialized WhatsApp Group ID |
| `CRON_SCHEDULE` | `'0 0 * * *'` | Cron schedule expression (Midnight daily) |
| `TIMEZONE` | `'Asia/Kolkata'` | Timezone for the cron trigger |

---

## 🛠 Troubleshooting

- **Session Expiry / Logout**: If your session is invalidated or disconnected, WhatsApp credentials will be cleared. If you see authentication errors, simply delete the `.wwebjs_auth` directory and re-run to scan a fresh QR code:
  ```bash
  rm -rf .wwebjs_auth
  npm start
  ```
- **Puppeteer Sandbox issues on Linux/VPS**: Ensure standard Chromium packages (`libnss3`, `libatk-bridge2.0-0`, `libx11-xcb1`, etc.) are installed on your Linux machine.
