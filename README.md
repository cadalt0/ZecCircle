# ZecCircle

Share funds privately with the people you trust. Fund one shielded Zcash wallet, invite family and friends, set per-member limits, and let them spend on Bitrefill (food, groceries, gift cards, top-ups, eSIMs) through a Telegram bot.


# ZecCircle: the bot

**The family card, without the card.** A Telegram bot where a family or small group shares one budget, funded with private (shielded) Zcash. Members just chat what they need ("recharge my Jio ₹10"); an AI agent buys it from Bitrefill within limits the circle owner sets, and the code or top-up arrives in the chat.

This README is the complete guide to **setting up and testing the bot on Zcash mainnet** (real ZEC, real Bitrefill purchases). Follow it top to bottom; the full test walk-through is in [section 6](#6-mainnet-test-walkthrough).

> **This moves real money.** Test mode is limited by hardcoded rules (two products, $5 total, two swaps; see [Hard limits](#hard-limits)). Even so, delivered gift cards and top-ups cannot be refunded. Start with the smallest amounts, as described below.

---

## Contents

1. [How it works](#how-it-works)
2. [What you need](#what-you-need)
3. [Setup](#setup): accounts and keys, install, build the wallet tool, configure, run
4. [Mainnet test walkthrough](#6-mainnet-test-walkthrough)
5. [Commands](#commands)
6. [Hard limits](#hard-limits)
7. [Watching and verifying](#watching-and-verifying)
8. [Troubleshooting](#troubleshooting)
9. [Security and privacy](#security-and-privacy)
10. [Project layout](#project-layout) · [Tests](#tests) · [Deploying](#deploying) · [Known limitations](#known-limitations)

---

## How it works

```
 Member (Telegram)                    The bot                          The outside world
 ─────────────────                    ───────                          ─────────────────
 "recharge +91 98765 43210 ₹10"  ──►  Claude agent reads the request
                                      and proposes ONE purchase
                                              │
                                      Rules check (plain code, not the AI):
                                      allowed item? price? member limit?
                                      circle cap? $5 live budget?
                                              │  within limits → buy now
                                              │  over the member's limit → owner taps Approve/Reject
                                              ▼
                                      Reserve the circle's ZEC
                                              │
                                      1. Bitrefill: create a $2 "USD store credit" invoice (USDC on Base)
                                      2. NEAR Intents (1Click): quote exactly 2.00 USDC to that address
                                      3. Send ~0.00155 ZEC from the bot wallet to 1Click ──────────►  1Click swaps ZEC → USDC
                                      4. Wait for the swap, then for Bitrefill's credit     ◄────────  USDC lands at Bitrefill (Base)
                                              │
                                      Create + pay the purchase invoice from the Bitrefill balance
                                              │
 "🎁 Flipkart India is ready!        ◄──  Poll until Bitrefill says "delivered", then send the code
  Order #7 · Bitrefill invoice …"          privately to the member (forwarding blocked)
```

Key ideas:

- **One bot wallet, one shielded address per circle.** `/fund` shows the circle's own shielded address; anything sent there is credited to that circle. Per-circle balances are bookkeeping in the database.
- **The AI never moves money.** It can search, look up your orders and *propose* a purchase. Rules written in code decide what is allowed. The hardcoded live rules cannot be changed by the AI, the chat or the database.
- **Paying with ZEC means leaving the shielded pool for one hop.** Bitrefill doesn't accept ZEC, so the bot swaps a small amount through NEAR Intents, which only takes a transparent deposit. See [Security and privacy](#security-and-privacy).
- **Every step is recorded** (database, logs, optional Telegram log group) and swaps are resumable: after a restart the bot keeps following a swap whose ZEC was already sent, and never sends twice.

---

## What you need

| Thing | Why | Cost |
| --- | --- | --- |
| A computer with **Node.js 24+** and **Docker** (or Rust) | Run the bot; build the Zcash wallet tool | free |
| A **Telegram** account (two are better for testing) | Talk to the bot; a second account plays "member" | free |
| **Anthropic API key** | The shopping agent (Claude) | cents for this test |
| **Bitrefill account** with an API key and a **USD balance** | The shop | a few dollars of credit |
| **Neon** (or any Postgres) database | Circles, purchases, swap state, the wallet seed | free tier |
| **About 0.004 ZEC** (~$5) in a wallet you control | Funds two test swaps incl. fees | ~$5 |

---

## Setup

### 1. Accounts and keys

**1.1 Telegram bot token.** In Telegram open [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name and username, and copy the token (`123456789:AA…`). → `TELEGRAM_BOT_TOKEN`

**1.2 Anthropic API key.** Create one at [platform.claude.com](https://platform.claude.com). → `ANTHROPIC_API_KEY`

**1.3 Postgres.** Create a free project at [neon.tech](https://neon.tech), open *Connection details* and copy the connection string (it ends in `?sslmode=require`). The bot creates its tables automatically on first start. → `DATABASE_URL`

**1.4 Bitrefill.** This part has two traps, so read it carefully.

1. Sign in at [bitrefill.com](https://www.bitrefill.com) and create an API key under *Account → Developers*. → `BITREFILL_API_KEY`
2. Note the **email of that account**. → `BITREFILL_ACCOUNT_EMAIL` (swapped ZEC arrives there as USD store credit)
3. **Make USD your primary balance** in your account settings. A Bitrefill account has separate sub-balances (USD, EUR, BTC). The REST API only reports and spends the *primary* one. If it is BTC, prices come back in satoshis and the bot refuses to buy.
4. Have a few dollars of **USD credit** on the account (event credits or a top-up). The swap adds $2 of store credit per purchase, but a small buffer avoids surprises.

Check that it works:

```bash
curl -s -H "Authorization: Bearer $BITREFILL_API_KEY" https://api.bitrefill.com/v2/accounts/balance
# expect: {"data":{"balance":2500,"currency":"USD"}, ...}   (balance is in cents: 2500 = $25.00)
```

### 2. Install

```bash
git clone <this repo> && cd <repo>/zeccircle
node --version        # must be v24 or newer
npm install
npm run build         # compiles TypeScript to dist/
```

### 3. Build the Zcash wallet tool

The bot controls its wallet through [`zcash-devtool`](https://github.com/zcash/zcash-devtool), the Zcash project's command-line wallet. It publishes no binaries, so you compile it once (about 15–20 minutes). The bot expects it at `../tools/bin/zcash-devtool` (a `tools/` folder next to `zeccircle/`).

Build it with Docker (nothing is installed on your machine):

```bash
mkdir -p ../tools/bin
docker run --rm \
  -v "$(cd .. && pwd)/tools:/out" \
  -v zeccircle-cargo-registry:/usr/local/cargo/registry \
  rust:1-bookworm \
  bash -c "cargo install --locked --git https://github.com/zcash/zcash-devtool --root /out zcash-devtool \
           && chown -R $(id -u):$(id -g) /out"

../tools/bin/zcash-devtool --help      # should print the command list
```

*Alternative:* `bash scripts/zcash-setup.sh` does the same build, and also creates two **testnet** wallets under `data/` that this mainnet guide doesn't use (ignore them). If you have Rust installed, `cargo install --locked --git https://github.com/zcash/zcash-devtool --root ../tools zcash-devtool` works too.

If you keep the binary somewhere else, set `ZCASH_DEVTOOL_PATH` in `.env`.

### 4. Configure

```bash
cp .env.example .env
```

Fill in `.env`. For mainnet these are the settings that matter (everything else has a sensible default and is documented in the file):

| Variable | Value | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | from BotFather | |
| `ANTHROPIC_API_KEY` | from Anthropic | |
| `BITREFILL_API_KEY` | from Bitrefill | |
| `BITREFILL_ACCOUNT_EMAIL` | your Bitrefill email | where the swapped $2 credit lands |
| `DATABASE_URL` | Postgres URL | `…?sslmode=require` |
| `BITREFILL_MODE` | `live` | real purchases |
| `ZCASH_MODE` | `mainnet` | real ZEC. Requires `BITREFILL_MODE=live` and `BITREFILL_ACCOUNT_EMAIL` or the bot refuses to start. |
| `ZCASH_EXPLORER_TX_URL` | `https://3xpl.com/zcash/transaction/{txid}` | links in receipts (the default mainnet explorer did not show our transactions) |
| `ADMIN_TELEGRAM_IDS` | optional | only for following *every* circle's logs; owners don't need it |

Startup validates the whole file and lists every problem at once.

### 5. Run

> **Use `npm start`, not `npm run dev`, for anything with real money.** `npm run dev` restarts the bot whenever a source file changes, and a restart in the middle of a purchase cancels it (the ZEC swap still completes and the credit still arrives, but that purchase is not bought).

```bash
npm run build
npm start
```

What you should see in the first minute:

```
INFO  zcash wallet bootstrap done      wallet: "created"
WARN  BITREFILL_MODE=live: REAL purchases on, limited by the hardcoded rules   allowed: [₹10 Jio talktime top-up, ₹50 Flipkart gift card]  totalCeiling: $5.00
INFO  zcash wallet ready               network: "main"  address: "u1…"
WARN  ZCASH_MODE=mainnet: REAL ZEC. …  zecPriceUsd: "1307.60"  swapUsd: "$2.00"  maxZecPerSwap: "0.00250000"  maxSwaps: 2
INFO  bot started                      username: "YourBot"
```

**First start on mainnet creates the bot's wallet** in `data/zcash-mainnet-wallet/` and **saves its seed phrase to the `wallet_seed` table** in your database. On later starts (or on a fresh machine with an empty `data/` folder) the wallet is rebuilt from that seed.

**Back up the seed now**, before you put money in. It lives only in your database and in the wallet folder:

```bash
../tools/bin/zcash-devtool wallet -w data/zcash-mainnet-wallet display-mnemonic -i data/zcash-mainnet-wallet/identity.txt --enable
```

Store the 24 words offline. Anyone with them (or with database access) can spend the bot's ZEC.

Stop the bot with `Ctrl+C`; it waits for in-flight purchases to settle.

---

## 6. Mainnet test walkthrough

Plan for **about 30–40 minutes**, mostly waiting for confirmations. You need two Telegram accounts for the full flow: **Owner** (you) and **Member** (a friend, or your second account).

### 6.0 Budget and safety

- One test purchase costs about **$2.03 of ZEC plus a ~$0.20 network fee**. The unused part of the $2 credit stays in your Bitrefill balance.
- The bot allows **2 swaps in total** and **$5 of real spending in total** (counted in the database, so restarts don't reset them).
- Top-ups go to a **real phone**. Use a Jio number you control. Gift card codes are cash: don't screen-record them.
- Bitrefill's own daily caps apply: 5 phone top-ups and 15 gift cards per account.

### 6.1 Create the circle (Owner)

In a private chat with the bot:

```
/newcircle Test Family      # you become the owner
/invite 1                   # one-time link, valid 24h; send it to the Member
```

The Member opens the link and joins instantly (no approval). You get "👋 … joined". By default a new member can spend **$2 per purchase and $5 per month**; the circle cap is **$10 per month**. Change them any time:

```
/members                    # list members with ids and spend
/setlimit 2 1 3             # member #2: $1 per purchase, $3 per month
/circlelimit 20             # circle cap
```

### 6.2 Turn on the live log (optional but strongly recommended)

Create a Telegram **group**, add the bot, and as the circle owner send `/circlelogs` in the group. Every action then appears as a short message there: invoices, swap steps, transaction ids. See [Commands](#commands) for channels and `off`.

### 6.3 Fund the circle (Owner)

```
/fund 0.004
```

The bot sends a QR code and a payment link for the **circle's mainnet shielded address** (starts with `u1…`). From your own Zcash wallet (Zashi, Zodl, …) send about **0.004 ZEC** there. The memo is optional. Make sure you copy the address `/fund` shows, not the address in the startup log.

What happens:

| When | You see |
| --- | --- |
| a minute or two | "💰 Incoming 0.004 ZEC … Waiting for confirmations…" |
| ~10 confirmations (about **12 minutes** on mainnet) | "✅ 0.004 ZEC confirmed … Circle balance …" |

Check with `/wallet` (balance, pending, recent deposits). **Don't buy before it says confirmed**: the wallet only spends other people's funds after 10 confirmations, and the bot refuses early purchases with a clear message.

### 6.4 First real purchase: ₹50 Flipkart card (Member or Owner)

Flipkart needs no phone number and costs the least. Message the bot:

```
buy a ₹50 Flipkart gift card
```

Expected, in order:

1. The agent replies in one line and the bot posts **"🛒 Buying now"**.
2. Log group (if on): `purchase.confirmed` → `bitrefill.invoice` → `swap.invoice_created` (the $2 store-credit invoice, USDC on Base) → `swap.dry_quote` → `swap.quoted` (e.g. 0.00155 ZEC → 2.0 USDC) → `swap.deposit_sent` (**your ZEC leaves the wallet; keep the txid**).
3. Chat: **"🔄 Paying with ZEC: swapping 0.00155 ZEC → 2.0 USDC … about 8 minutes."**
4. ~8 minutes later: `swap.status SUCCESS`, then `swap.credited`; chat: **"💱 Swap complete…"** then **"✅ Swap done: Bitrefill store credit received. Buying now…"**
5. `zec.payment_sent` → `purchase.paid` → `purchase.completed`.
6. Chat: **"🎁 Flipkart India is ready!"** with the code, then `Order #N · Bitrefill invoice …` and `Paid 0.00155 ZEC (mainnet) · <txid> · Swapped via NEAR Intents → 2.00 USDC → Bitrefill store credit`.

**Don't restart the bot or edit files while the swap is running.**

### 6.5 Second purchase: ₹10 Jio top-up

Only if the swap limit allows (default: 2 swaps in total). Send:

```
recharge my Jio number +91 98765 43210 with ₹10
```

Spaces and dashes in the number are removed and `91` is added; any valid Indian mobile number is accepted (the bot trusts the member that it is on Jio). A top-up has no code: the balance lands on the phone and the chat says "Top-up sent to 91…".

### 6.6 Verify everything

| Check | How |
| --- | --- |
| Receipt in chat | the 🎁 message: order number, Bitrefill invoice id, ZEC txid |
| Ask the bot | "where did you buy that? I need the id" → it answers from the real order record |
| History | `/history` (members: own purchases; owner: whole circle) |
| ZEC leaving the wallet | `../tools/bin/zcash-devtool wallet -w data/zcash-mainnet-wallet list-tx` |
| Swap on NEAR Intents | `https://explorer.near-intents.org/transactions/<1Click deposit address>` (address is in the `swap.quoted` log) |
| USDC arriving at Bitrefill | the Base transaction hash from 1Click's status (see [Watching and verifying](#watching-and-verifying)) |
| Bitrefill side | invoice status `all_delivered`; balance up by $2 then down by the item price |

### 6.7 Test the guardrails (no money needed)

These cost nothing because the bot refuses before anything is paid:

- **Anything else:** "buy an Amazon gift card" → *"Test mode: I can only buy a ₹10 Jio talktime top-up or a ₹50 Flipkart gift card right now."*
- **Over a member limit:** as owner `/setlimit <member id> 0.4 3`, then have the member ask for the ₹50 card ($0.56). The owner gets **Approve / Reject** buttons and nothing is bought until approval.
- **Not enough ZEC:** with an empty circle, any purchase is refused with how much ZEC is missing.
- **Bad phone number:** "recharge 12345" → asks for a valid Indian mobile number.
- **Paused circle:** `/pausecircle`, then try to buy → refused. `/resumecircle` to undo.
- **Kick:** `/kick <id>` removes a member and cancels their open requests.

---

## Commands

Everything is in private chat with the bot unless noted.

| Command | Who | What it does |
| --- | --- | --- |
| *(plain text)* | members | talk to the shopping agent |
| `/help` | all | what you can do |
| `/me` | members | your limits and spend this month |
| `/history` | members / owner | your purchases / the whole circle's |
| `/fund [amount]` | members | QR + payment link to the circle's shielded address |
| `/wallet` | members | circle ZEC balance, pending and recent deposits |
| `/reset` | members | forget the current conversation |
| `/leave` | members | leave the circle |
| `/newcircle <name>` | anyone | create a circle (you become its owner) |
| `/invite [joins]` | owner | one-time link (default 1 join; e.g. `/invite 3`), valid 24h |
| `/revokeinvites` | owner | cancel unused links |
| `/members` | owner | list members, ids, limits, spend |
| `/setlimit <id> <per-purchase> <monthly>` | owner | e.g. `/setlimit 2 1 3` |
| `/circlelimit <monthly>` | owner | circle-wide monthly cap |
| `/pause <id>` · `/resume <id>` | owner | pause or resume one member |
| `/pausecircle` · `/resumecircle` | owner | stop or restart all spending |
| `/kick <id>` | owner | remove a member (asks first) |
| `/circle` | owner | circle overview |
| `/circlelogs` | owner | **in a group:** send logs for *your circle* to that group. **In a private chat:** get a one-time code to use in a channel |
| `/circlelogs <CODE>` | owner | in a group/channel: turn logs on with a code |
| `/circlelogs off` | owner | stop logs in that chat |
| `/circlelogs all` | bot admin | follow every circle (needs `ADMIN_TELEGRAM_IDS`) |
| `/whoami` | all | show your Telegram id |

Logs are per circle: a chat only receives the circle(s) it was registered for. Gift card codes and keys are never logged; phone numbers are masked.

---

## Hard limits

These are constants in the source, not settings: the AI, the chat and the database cannot change them. They apply to mainnet.

| Rule | Value | File |
| --- | --- | --- |
| Products that can be bought | **₹10 Jio talktime top-up** (`reliance-jio-india-bundles`, "₹7.47 Talktime Top-Up") and **₹50 Flipkart gift card** (`flipkart-india<&>50`) | `src/domain/live-purchase-rules.ts` |
| Max price per item | Jio $0.50, Flipkart $1.00 | same |
| Total real spending, ever | **$5.00** (all circles) | same |
| Swap size | exactly **$2.00** of USDC per swap | `src/domain/mainnet-swap-rules.ts` |
| Swaps in total | **2** | same |
| Max ZEC per swap | 0.0025 ZEC; quote at most 8% over $2 | same |
| Bitrefill invoice | must be exactly 2.00 USDC on Base, valid ≥ 40 more minutes | same |
| Quote | must pay *our* invoice address and refund to *our* address | `src/services/funding/swap-settlement.ts` |
| Other circle rules | per-purchase and monthly member limits, circle cap, owner approval above a member's limit | `src/domain/policy.ts` |

**Raising them** is a code change: edit `LIVE_ITEMS`, `LIVE_TOTAL_SPEND_CEILING_MINOR` or `MAX_SWAPS_TOTAL`, then `npm run build` and restart. The counters come from the database, so to rerun a limit test from zero, use a fresh database.

**How much ZEC the circle needs.** Before each swap the bot reserves the swap input plus margin (about **0.00196 ZEC** at ~$1,300/ZEC) and refuses the purchase if the circle has less. A swap really sends ~0.00155 ZEC plus a 0.00015 ZEC network fee. So **0.0023 ZEC covers one swap, 0.004 ZEC covers two.** A swap that fails before any ZEC is sent doesn't use up the swap limit.

---

## Watching and verifying

**Bot wallet, from the command line** (stop the bot first, or wait a moment; two programs shouldn't touch the wallet at once):

```bash
W=data/zcash-mainnet-wallet
../tools/bin/zcash-devtool wallet -w $W sync -s zecrocks
../tools/bin/zcash-devtool wallet -w $W balance
../tools/bin/zcash-devtool wallet -w $W list-tx
../tools/bin/zcash-devtool wallet -w $W list-addresses
```

A swap payment appears as a transaction with one **transparent** output (to 1Click's address) plus shielded change.

**Database** (`psql "$DATABASE_URL"`):

```sql
-- every purchase and what happened to it
SELECT id, status, product_name, fulfilment_mode, invoice_id, paid_at, left(failure_reason, 80) FROM purchases ORDER BY id DESC LIMIT 10;
-- every swap: our side + 1Click's status
SELECT id, purchase_id, status, last_swap_status, amount_in_zat, deposit_address, deposit_txid, bitrefill_invoice_id FROM zec_swaps ORDER BY id;
-- ZEC deposits and payments (the network column keeps testnet and mainnet apart)
SELECT network, status, amount_zat, txid FROM zec_deposits ORDER BY id DESC LIMIT 10;
SELECT network, status, amount_zat, txid FROM zec_payments ORDER BY id DESC LIMIT 10;
-- audit trail
SELECT created_at, action, details FROM audit_log ORDER BY id DESC LIMIT 30;
```

**A swap's public details** (the Base transaction where USDC reached Bitrefill):

```bash
curl -s "https://1click.chaindefuser.com/v0/status?depositAddress=<1Click deposit address from the swap.quoted log>"
# → status, swapDetails.destinationChainTxHashes[0].hash   → https://basescan.org/tx/<hash>
```

**Bitrefill:**

```bash
curl -s -H "Authorization: Bearer $BITREFILL_API_KEY" https://api.bitrefill.com/v2/invoices/<invoice id>
# a finished order shows status "all_delivered"; "not_delivered" just means "not finished yet"
```

---

## Troubleshooting

| What you see | Cause and fix |
| --- | --- |
| `Invalid environment configuration:` at startup | A required setting is missing or inconsistent. The message lists every problem. `ZCASH_MODE=mainnet` needs `BITREFILL_MODE=live` and `BITREFILL_ACCOUNT_EMAIL`. |
| `zcash-devtool not found at …` | Build the wallet tool ([step 3](#3-build-the-zcash-wallet-tool)) or set `ZCASH_DEVTOOL_PATH`. |
| Bitrefill balance `0`, currency `BTC`, or prices in thousands | Your primary Bitrefill balance is BTC. Make **USD** primary ([step 1.4](#1-accounts-and-keys)). |
| "The circle wallet has X ZEC but this needs Y ZEC" | Not enough ZEC credited. `/fund` more. One swap needs ~0.002 ZEC available. |
| "…ZEC has arrived but is not spendable yet…" | The wallet needs ~10 confirmations (~12 min on mainnet). Your own change after a swap needs 3. Wait and ask again; nothing was charged. |
| "The mainnet test limit of 2 swaps has been reached" / "…$5 test budget … used up" | Working as designed. See [Hard limits](#hard-limits) to raise them. |
| "Interrupted before payment. Nothing was charged" | The bot restarted mid-purchase (usually `npm run dev` auto-restart). If a swap had started, its USDC still lands as Bitrefill credit; use `npm start`. |
| "Test mode: I can only buy …" | The request wasn't one of the two allowed items. |
| Telegram `ETIMEDOUT` / "could not reach Telegram" | Your connection dropped. Telegram calls are retried automatically; the bot keeps polling. |
| `Conflict: terminated by other getUpdates request` | Two copies of the bot are running with the same token. Stop one. |
| Swap `REFUNDED` / `FAILED` in the log | 1Click returns the ZEC to the bot wallet's **transparent** address (minus about $0.42). Shield it again with `zcash-devtool wallet -w … shield`, or leave it. Nothing was bought. |
| Receipt links say "not found" | Set `ZCASH_EXPLORER_TX_URL=https://3xpl.com/zcash/transaction/{txid}`. |
| `/circlelogs` does nothing | Only a circle's **owner** can turn logs on. In a group, add the bot first. In a channel, use the code from the private chat and make the bot an admin that can post. |
| A deposit never shows up | You paid an address other than the one `/fund` shows, or the amount is still unconfirmed (`/wallet`). The memo is only a fallback. |
| Bitrefill top-up says it's out of daily quota | Bitrefill allows 5 phone top-ups and 15 gift cards per account per day. |

---

## Security and privacy

- **Custodial, on purpose, for now.** One wallet holds every circle's funds. Its **seed phrase is stored in plain text in your database** (`wallet_seed` table) so the wallet can be rebuilt on any machine. Anyone with database access can spend it. Keep only small amounts in it, protect the database, and never run two bots with the same seed.
- **`data/zcash-mainnet-wallet/identity.txt`** decrypts the wallet's local seed file. `data/` and `.env` are git-ignored; keep it that way.
- **Secrets are redacted from logs**: bot tokens, database passwords and Anthropic keys never appear, including in error output.
- **What stays private:** deposits go to a per-circle shielded address (sender, amount and memo hidden); who is in a circle and what they buy never touches a blockchain; gift card codes are delivered privately (forwarding blocked) and never logged.
- **What is revealed:** the swap's ZEC leaves the shielded pool to 1Click's transparent address (that amount and time are public); NEAR Intents, Bitrefill, Telegram, Anthropic (what members type, including phone numbers), your database host and the light-wallet server each see part of the picture. The full privacy and trust note is in the project submission.
- **Rotate** the Telegram token, Anthropic key, Bitrefill key and database password if they were ever pasted anywhere.
- `zcash-devtool` is a prototyping tool and unaudited. This project is a hackathon build: treat it accordingly.

---

## Project layout

```
zeccircle/
├── src/
│   ├── index.ts                 start-up: checks, wallet, bot, shutdown
│   ├── app.ts                   composition root: builds and wires everything
│   ├── config/env.ts            validated settings (all env vars)
│   ├── bot/                     Telegram layer: commands, buttons, notifications, log channel
│   ├── agent/                   Claude shopping agent: prompt, tools, conversation memory
│   ├── domain/                  rules: member/circle policy, hardcoded live + swap limits
│   ├── services/
│   │   ├── circle.service.ts    circles, invites, members, limits
│   │   ├── purchase.service.ts  purchase lifecycle (propose → confirm → pay → deliver)
│   │   ├── purchase-guard.ts    hard real-money checks at three points
│   │   ├── funding/             Zcash funding: deposits, reservations, the mainnet swap
│   │   └── activity/            developer activity feed
│   ├── integrations/
│   │   ├── bitrefill/           REST client, MCP client (store credit), pricing, mock
│   │   ├── near-intents/        1Click swap API client
│   │   └── zcash/               zcash-devtool wallet wrapper, seed bootstrap, ZIP-321, units
│   ├── repositories/            all SQL (Postgres)
│   ├── db/                      connection pool, transactions, migrations
│   └── lib/                     money, phone numbers, redaction, rate limiting, logging
├── test/                        118 tests (run on an in-process Postgres)
├── scripts/                     zcash-setup.sh (build the wallet tool), heroku-deploy.sh
├── Dockerfile · heroku.yml      container image / Heroku worker
└── .env.example                 settings template
```

Database migrations run automatically at start-up and are safe to run from several instances at once. Money is stored as integers (cents, zatoshis), never floats. Circle-level money steps take a database lock per circle, and the real-spending ceiling takes a global lock, so concurrent requests cannot overspend.

---

## Tests

```bash
npm test            # 118 tests, no network, no keys, no money needed
npm run typecheck
```

They cover the rules, the purchase flow, the swap safety checks (wrong amount, wrong address, expiring invoice, refunds, restart behaviour), network separation of testnet/mainnet records, log routing and permissions, and the agent's order lookup. The tests run against a real Postgres engine in memory, so the SQL is exercised as in production.

---

## Deploying

The bot is a single long-running process (it polls Telegram; no public URL or port needed). **Run exactly one copy.**

- **Any host with Node 24 and persistent disk:** `npm run build && npm start`, with the wallet tool in place.
- **Docker / Heroku:** the `Dockerfile` bundles the compiled app and the `zcash-devtool` binary (`scripts/heroku-deploy.sh <app>` copies it in, builds and releases a `worker` dyno). The container's disk is temporary, which is fine: on every start the wallet is rebuilt from the seed stored in the database and re-scanned from its birthday height. Set the same variables as `.env` in the host's config.

---

## Known limitations

- **Custodial and plain-text seed** (see [Security](#security-and-privacy)); a threshold-signature or per-owner-wallet design is the planned fix.
- **One transparent hop** per purchase (NEAR Intents accepts only transparent deposits for ZEC), and swaps are $2 minimum because of 1Click's ~$1.74 floor, so a $0.56 item still costs a $2 swap. The unused credit stays in your Bitrefill balance and is not yet reused automatically.
- **Two products only** in this test configuration; the catalogue code supports more, but the live rules intentionally don't.
- **A swap takes about 8 minutes**, and the delivery wait is 45 minutes before the bot stops waiting (it keeps watching the swap in the background).
- **`zcash-devtool` is unaudited**, and wallet sync goes through `zec.rocks` directly. Routing it through Nym is possible (`ZCASH_CONNECTION=socks5://…`) but not set up here.
- **Mainnet explorer coverage varies**; use the `ZCASH_EXPLORER_TX_URL` setting if links don't resolve.
