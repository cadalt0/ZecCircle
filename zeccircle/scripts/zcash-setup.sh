#!/usr/bin/env bash
# Sets up the bot's Zcash TESTNET wallets with zcash-devtool (https://github.com/zcash/zcash-devtool).
#
#   1. builds zcash-devtool (inside a Docker rust container if cargo isn't installed)
#   2. creates the bot wallet      -> receives /fund deposits, pays for purchases
#   3. creates a "settlement" wallet -> stands in for the swap deposit address on testnet
#   4. prints both addresses
#
# Run from the zeccircle/ directory:   bash scripts/zcash-setup.sh
# Everything lands in ./data (gitignored). Keep it private: identity.txt decrypts the wallet seed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS_DIR="$(cd "$ROOT/.." && pwd)/tools"
BIN="$TOOLS_DIR/bin/zcash-devtool"
BOT_WALLET="$ROOT/data/zcash-wallet"
SINK_WALLET="$ROOT/data/zcash-settlement"
SERVER="${ZCASH_SERVER:-zecrocks}"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- 1. build
if [[ ! -x "$BIN" ]]; then
  mkdir -p "$TOOLS_DIR/bin"
  if command -v cargo >/dev/null; then
    log "Building zcash-devtool with local cargo (takes a while)"
    cargo install --locked --git https://github.com/zcash/zcash-devtool --root "$TOOLS_DIR" zcash-devtool
  elif command -v docker >/dev/null; then
    log "Building zcash-devtool in a rust:1-bookworm container (takes a while)"
    docker run --rm \
      -v "$TOOLS_DIR:/out" \
      -v zeccircle-cargo-registry:/usr/local/cargo/registry \
      rust:1-bookworm \
      bash -c "cargo install --locked --git https://github.com/zcash/zcash-devtool --root /out zcash-devtool && chown -R $(id -u):$(id -g) /out"
  else
    echo "Need either cargo (https://rustup.rs) or docker to build zcash-devtool." >&2
    exit 1
  fi
fi
"$BIN" --help >/dev/null
log "zcash-devtool ready: $BIN"

# ---------------------------------------------------------------- 2/3. wallets
init_wallet() {
  local dir="$1" name="$2"
  if [[ -f "$dir/data.sqlite" ]]; then
    echo "Wallet already exists in $dir (skipping init)"
    return
  fi
  mkdir -p "$dir"
  log "Creating testnet wallet '$name' in $dir"
  # Empty line on stdin = generate a new mnemonic. Birthday defaults to the current chain tip,
  # so the first sync is quick.
  printf '\n' | "$BIN" wallet -w "$dir" init --name "$name" -i "$dir/identity.txt" -n test -s "$SERVER"
}

init_wallet "$BOT_WALLET" "zeccircle-bot"
init_wallet "$SINK_WALLET" "zeccircle-settlement"

log "Syncing (first sync can take a minute)"
"$BIN" wallet -w "$BOT_WALLET" sync -s "$SERVER"
"$BIN" wallet -w "$SINK_WALLET" sync -s "$SERVER"

addr() { "$BIN" wallet -w "$1" list-addresses | sed -n 's/.*Default Address: *//p' | head -1; }
BOT_ADDR="$(addr "$BOT_WALLET")"
SINK_ADDR="$(addr "$SINK_WALLET")"

# ---------------------------------------------------------------- 4. summary
cat <<EOF

========================================================================
Bot wallet address (members /fund this; ask a mentor for TAZ here):
  $BOT_ADDR

Settlement address (test purchases are paid here; on mainnet this becomes
the swap deposit address):
  $SINK_ADDR

Add to .env:
  ZCASH_MODE=testnet
  ZCASH_SETTLEMENT_ADDRESS=$SINK_ADDR

Check the settlement wallet received payments:
  $BIN wallet -w $SINK_WALLET sync && $BIN wallet -w $SINK_WALLET balance
========================================================================
EOF
