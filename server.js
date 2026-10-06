const http = require('http');
// Ajusta o caminho/nome do ficheiro do handler caso o tenhas renomeado
const handler = require('./src/http/tfastHandler');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
  handler(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(
    `TFast addon running on http://${HOST}:${PORT}/manifest.json`
  );
});
