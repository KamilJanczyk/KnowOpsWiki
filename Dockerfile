FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache git
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; else npm install --omit=dev --ignore-scripts; fi
COPY server.mjs build_navigation.mjs backup_wiki.mjs build_knowops.mjs add_page.mjs ./
RUN chown -R node:node /app
USER node
EXPOSE 9000
CMD ["node", "server.mjs"]
