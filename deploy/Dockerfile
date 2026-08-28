FROM node:22-bookworm-slim AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund --workspaces=false \
    && npm cache clean --force

FROM node:22-bookworm-slim
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="AIRenOS Foundation API" \
      org.opencontainers.image.description="Provider-neutral AIRenOS Foundation runtime" \
      org.opencontainers.image.revision="$VCS_REF"
ENV HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY db ./db
COPY deploy ./deploy
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","--experimental-strip-types","deploy/runtime-entry.ts"]
