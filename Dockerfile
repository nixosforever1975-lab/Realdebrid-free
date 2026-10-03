FROM node:22-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080 \
    PROVIDER_BASE=https://tfast.giize.com/da24a5d4 \
    PROVIDER_PATH_PREFIX=""

EXPOSE 8080

CMD ["node", "server.js"]
