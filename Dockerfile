# Isabella Genesis — Production Dockerfile (P1 hardening)
# Base mínima, non-root, dependencias fijadas por lockfile, SBOM-ready.
# Seguridad: non-root (uid 1000), alpine mínimo (NO distroless: conserva
# node + dumb-init), HEALTHCHECK, readOnlyRootFilesystem (K8s),
# seccomp=RuntimeDefault (K8s securityContext.seccompProfile.type), no-new-privileges.
# Node 24 alineado con engines.node ("24.x") y con CI (NODE_VERSION 24.11.0).
FROM node:26.10.0-alpine AS base
RUN apk add --no-cache dumb-init
WORKDIR /app
# Non-root user (uid 1000)
RUN addgroup -S isabella && adduser -S isabella -G isabella
# Dependencies (pinned via pnpm-lock.yaml)
COPY pnpm-lock.yaml package.json ./
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate && pnpm install --frozen-lockfile --prod=false
COPY . .
RUN pnpm run build
# Runtime minimal — solo artefactos de producción
FROM node:26.10.0-alpine AS runtime
LABEL org.opencontainers.image.title="isabella-ai-genesis" \
      org.opencontainers.image.description="Isabella AI Genesis — federated sovereign AI (SBOM CycloneDX: ejecutar pnpm sbom en CI y adjuntarlo al release; no se embebe en la imagen)"
RUN apk add --no-cache dumb-init && addgroup -S isabella && adduser -S isabella -G isabella
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Copiar artefactos con ownership correcto (least privilege).
# Nota: `COPY src dst1 dst2` con dos destinos no compila; un solo destino.
COPY --from=base --chown=isabella:isabella /app/.output ./.output
COPY --from=base --chown=isabella:isabella /app/package.json ./package.json
COPY --from=base --chown=isabella:isabella /app/pnpm-lock.yaml ./pnpm-lock.yaml
# seccomp: RuntimeDefault se aplica vía K8s securityContext.seccompProfile.type=RuntimeDefault
# y vía Docker --security-opt seccomp=<profile>. No se embebe en imagen.
USER isabella
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://localhost:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", ".output/server/index.mjs"]
