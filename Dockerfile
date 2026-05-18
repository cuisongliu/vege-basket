FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
RUN printf '%s\n' \
  '{"type":"module","dependencies":{"bcryptjs":"^3.0.3","cors":"^2.8.6","dotenv":"^17.4.2","express":"^5.2.1","pg":"^8.20.0"}}' \
  > package.json \
  && npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
USER node
EXPOSE 8787
CMD ["node", "server/index.ts"]
