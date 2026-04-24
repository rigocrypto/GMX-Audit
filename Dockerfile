FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV START_CMD="npm run deliverable --"

ENTRYPOINT ["sh", "-lc", "$START_CMD"]
