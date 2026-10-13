# Image de Fibre Guardian (version codex/). À construire depuis la racine du dépôt :
#   docker build -f codex/Dockerfile -t fibre-guardian .
# Aucune dépendance npm : Node 22 suffit (module node:sqlite).
FROM node:22-slim
ENV NODE_ENV=production \
    GUARDIAN_PROXY=1 \
    GUARDIAN_DATA_DIR=/data \
    PORT=8080
WORKDIR /app
# Seuls les dossiers servis par l'application sont copiés (pas de secrets, pas de base locale).
COPY codex ./codex
COPY src ./src
COPY vendor ./vendor
COPY icon.svg config.js ./
RUN rm -rf codex/.local && mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "codex/serveur-local.cjs"]
