const http = require('http');
// Ajusta o caminho se mudaste o nome do ficheiro do handler
const handler = require('./src/http/realdebridfreeHandler');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
  handler(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(
    `realdebrid free addon running on http://${HOST}:${PORT}/manifest.json`
  );
});
