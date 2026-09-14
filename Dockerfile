FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache git zip su-exec
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi
COPY server.mjs build_navigation.mjs backup_wiki.mjs cve_engine.mjs build_knowops.mjs add_page.mjs ./
COPY scripts/ ./scripts/
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && chown -R node:node /app
EXPOSE 9000
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.mjs"]
