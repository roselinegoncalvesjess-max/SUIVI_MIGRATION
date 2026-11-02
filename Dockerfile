# Image unique : construit l'interface React puis la sert avec l'API Node.js.
FROM node:22-alpine AS client
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=4000 CLIENT_DIST=/app/public
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /client/dist ./public
EXPOSE 4000
USER node
CMD ["sh", "-c", "node src/scripts/init.js && node src/index.js"]
