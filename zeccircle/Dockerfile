# ZecCircle bot image (also what Heroku runs). Build with scripts/heroku-deploy.sh, which first copies
# the prebuilt zcash-devtool binary into ./bin (it is ~100 MB, so it is not kept in git).

# ---- build stage: install deps, compile TypeScript, drop dev dependencies
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    ZCASH_DEVTOOL_PATH=/app/bin/zcash-devtool \
    ZCASH_WALLET_DIR=/app/data/zcash-wallet
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# zcash-devtool is a prebuilt Linux x86_64 binary (built on Debian bookworm, so glibc-compatible).
COPY bin/zcash-devtool ./bin/zcash-devtool
# The wallet folder lives on the container's temporary disk. It is rebuilt from the seed stored in the
# database on every start, so losing it (Heroku restarts daily) is fine on testnet.
RUN chmod +x ./bin/zcash-devtool && mkdir -p /app/data && chown -R node:node /app
USER node
CMD ["node", "dist/index.js"]
