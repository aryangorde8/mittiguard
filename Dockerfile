FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY . ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "--env-file-if-exists=.env", "server.mjs"]
