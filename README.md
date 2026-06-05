# FIFA World Cup WhatsApp Betting Game ⚽🏆

This project implements a fully automated FIFA World Cup betting game for friends. It uses a **Google Sheet** as the database, **Google Apps Script** for orchestrating scheduled backend jobs (morning polls, vote collections, and game settlements), and a **Node.js VM Server** running `whatsapp-web.js` to send polls, count votes, and post results directly to a WhatsApp Group.

---

## Architecture Overview

1. **Football-Data.org API**: Supplies match schedules, current scores, and finished game data.
2. **Google Sheet (DB)**: Keeps track of player balances, match lists, bets, and game states.
3. **Google Apps Script (Orchestrator)**: Runs automated cron triggers to fetch games, send polls via the WhatsApp VM, download user votes at the deadline, deduct/distribute coins, and post live tables.
4. **Node.js Express VM (WhatsApp Proxy)**: Manages a headless WhatsApp Web browser instance. It exposes REST APIs for the Apps Script to interface with WhatsApp.

---

## 🛠️ Step 1: Google Sheet Setup

1. Create a brand new Google Sheet.
2. Create four tabs (sheets) with the exact names and headers below:

### 1. `Config`
Used for game configurations. Keep it simple; the script will initialize or read values:
* Column A: `Key`
* Column B: `Value`
* Add these rows (or let the script append them on first run):
  * `FOOTBALL_DATA_API_KEY`: *(Your football-data.org API key)*
  * `WHATSAPP_SERVER_URL`: `http://<your-vm-ip>:<port>` *(e.g. `http://192.168.1.100:3000`)*
  * `WHATSAPP_API_TOKEN`: *(A random secure secret token you generate to authenticate requests)*
  * `WHATSAPP_GROUP_ID`: *(Leave blank initially; you will retrieve this using the menu later)*

### 2. `Players`
* Columns: `Player Name` | `WhatsApp ID` | `Coins Balance`
* Add your friends here.
  * **WhatsApp ID** must be their phone number with the country code followed by `@c.us` (e.g. `31612345678@c.us` for a Dutch number or `32470123456@c.us` for a Belgian number).
  * Initialize the `Coins Balance` to `125` for everyone.

### 3. `Games`
* Columns: `Game ID` | `Date Time (UTC)` | `Stage` | `Home Team` | `Away Team` | `Status` | `Score Home` | `Score Away` | `Result` | `Bet Cost` | `Poll Message ID` | `Settled`
* *(No rows needed; Apps Script will populate this automatically each morning)*

### 4. `Bets`
* Columns: `Game ID` | `Player Name` | `WhatsApp ID` | `Bet Option` | `Coins Bet` | `Winnings` | `Result` | `Settled`
* *(No rows needed; Apps Script will populate this at 17:00 daily)*

---

## 💻 Step 2: Google Apps Script Installation

1. In your Google Sheet, click **Extensions** -> **Apps Script**.
2. Create the following files and copy-paste the corresponding code from the `apps-script/` directory of this repository:
   - `Config.gs` (handles reading/writing sheet configs)
   - `Sheets.gs` (database read/write operations)
   - `FootballData.gs` (integrates Football-Data.org API)
   - `WhatsApp.gs` (calls your WhatsApp proxy server)
   - `GameEngine.gs` (handles bet math, coin distributions, and standings text formatting)
   - `Scheduler.gs` (orchestrates daily cron jobs)
   - `UI.gs` (creates the Sheets Custom Menu)
3. Click the gear icon (**Project Settings** ⚙️) on the left sidebar:
   - **CRITICAL**: Set the **Time zone** to `(GMT+02:00) Brussels` (or `Europe/Brussels`). The scheduler dates depend on this timezone to calculate 09:00 and 17:00 Brussels time correctly.
4. Save the project.
5. Close and reopen your Google Sheet. You will now see a new menu in the top bar: **⚽ WC Betting Game**.

---

## 🌐 Step 3: Deploy WhatsApp VM Server

You will run the Node.js server on a VM (Ubuntu, Debian, macOS, etc.) that remains on and connected to the internet.

### 1. Install Dependencies
Make sure Node.js (v18+) is installed on your VM.
Transfer the `whatsapp-server/` folder to the VM and install dependencies:
```bash
cd whatsapp-server
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the `whatsapp-server/` folder:
```env
PORT=3000
WHATSAPP_API_TOKEN=your_secure_random_token_here
```
*(Make sure the `WHATSAPP_API_TOKEN` matches the value you entered in the Google Sheet's Config sheet).*

### 3. Start the Server and Link WhatsApp
Start the server:
```bash
npm start
```
1. In a web browser on your computer/phone, open `http://<your-vm-ip>:3000/qr`.
2. A QR code will display on the webpage (and inside your terminal if running interactively).
3. Open WhatsApp on your phone, go to **Linked Devices** -> **Link a Device**, and scan the QR code.
4. Once paired, the server console and web page will update to status: `CONNECTED`.
5. Keep the server running continuously using a process manager like **PM2**:
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name "whatsapp-betting-server"
   pm2 save
   pm2 startup
   ```

---

## 🚀 Step 4: Configure Game ID & Initialize Triggers

Once the server is connected:

1. Open your Google Sheet.
2. Go to the **⚽ WC Betting Game** menu -> Click **List WhatsApp JIDs / Chat IDs**.
3. A popup will load displaying all your recent chats and their unique IDs (JIDs).
4. Locate the group chat where you want to play the game, copy its JID (e.g. `1203630248382@g.us`), and paste it into the **Config** sheet under `WHATSAPP_GROUP_ID`.
5. Go to the **⚽ WC Betting Game** menu -> Click **Initialize daily triggers**.
   - This sets up the automatic Apps Script schedules:
     - Morning Job: Runs at **09:00 Brussels time** (sends today's polls).
     - Deadline Job: Runs at **17:00 Brussels time** (closes polls, records bets, posts summary).
     - Settlement Job: Runs **every 15 minutes** (settles completed matches and updates balances).

---

## 🎮 Gameplay & Betting Rules

- **Coins**: Every player starts with **125 coins**.
- **Bet Costs by Stage**:
  - `GROUP_STAGE`: **1 coin** per game.
  - `ROUND_OF_16`: **2 coins** per game.
  - `QUARTER_FINALS`: **4 coins** per game.
  - `SEMI_FINALS` & `THIRD_PLACE`: **8 coins** per game.
  - `FINAL`: **32 coins** per game.
- **Polls**:
  - Posted at **09:00 Brussels time**.
  - Group stage polls offer 3 options: **[Home Team, Away Team, Draw]**.
  - Knockout stage polls offer 2 options: **[Home Team, Away Team]** (betting on who progresses).
- **Deadline**:
  - Votes close at **17:00 Brussels time**.
  - The poll message is deleted from the group, preventing any further voting.
  - **No-Voters**: Any player who did not vote before the deadline loses their coins for that match (they are deducted from their balance), but their coins **are burned/discarded** and are *not* added to the winning pool.
- **Settlement**:
  - Once a match completes on Football-Data.org (status `FINISHED`):
    - The correct predictors split the pool of losing bets.
    - Specifically: Every participant loses the bet cost $B$. The incorrect voters' coins are pooled ($|Losers| \times B$). This pool is divided equally among the correct predictors ($|Winners|$).
    - If no one predicts correctly, all bets for that match are burned.
    - If everyone predicts correctly, no coins change hands (everyone gets their bet back).
    - Results and updated standings are immediately sent to the WhatsApp group.

---

## 🧪 Manual Testing Menu Options

If you need to test the setups, use the custom menu options:
- **Run morning poll setup (09:00)**: Simulates the 09:00 AM run. Instantly retrieves today's games and posts polls to the configured chat.
- **Run deadline close & collect (17:00)**: Simulates the 05:00 PM deadline. Closes polls, registers the bets, and deletes the poll messages.
- **Run settlement check (scores)**: Triggers the check for finished games to score them immediately.
- **Send test poll to specific JID**: Allows you to send a single-choice poll to any phone number or group ID to test layout.
- **Send test message to specific JID**: Send a text message to a specific number to verify connection.
