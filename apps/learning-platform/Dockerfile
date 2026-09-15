FROM node:22.23.1-bookworm-slim AS builder

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/learning-platform/package.json apps/learning-platform/package.json
RUN npm ci --workspace @hermes/learning-platform --include-workspace-root=false

COPY apps/learning-platform apps/learning-platform
COPY docs/learning-platform docs/learning-platform
COPY docs/agent-harness-learning docs/agent-harness-learning
COPY docs/learning-spaces docs/learning-spaces
RUN npm run build --workspace @hermes/learning-platform

FROM node:22.23.1-bookworm-slim AS runner

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=4317 \
    LEARNING_REPO_ROOT=/workspace \
    LEARNING_DATA_DIR=/data

COPY --from=builder --chown=node:node /workspace/apps/learning-platform/.next/standalone ./
COPY --from=builder --chown=node:node /workspace/apps/learning-platform/.next/static ./apps/learning-platform/.next/static
COPY --from=builder --chown=node:node /workspace/package.json ./package.json
RUN mkdir /data && chown node:node /data

USER node
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4317/api/spaces').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/learning-platform/server.js"]
