# Call of AI — Battle Royale (Node + Socket.IO, sem build step)
FROM node:20-alpine

WORKDIR /app

# só dependências de produção (express + socket.io)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    RANK_FILE=/data/br-rank.json

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
