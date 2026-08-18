FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3210
ENV HOST=0.0.0.0

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /app/data

EXPOSE 3210

CMD ["node", "server.js"]

