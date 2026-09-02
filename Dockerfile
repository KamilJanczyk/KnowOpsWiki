FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache git
COPY package*.json ./
RUN npm install
COPY server.mjs build_navigation.mjs backup_wiki.mjs build_knowops.mjs add_page.mjs ./
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && chown -R appuser:appgroup /app
USER appuser
EXPOSE 9000
CMD ["node", "server.mjs"]
