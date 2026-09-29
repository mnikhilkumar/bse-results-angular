const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const port = process.env.PORT || 3000;

function adaptResponse(res) {
  return {
    status(code) { res.statusCode = code; return this; },
    setHeader(name, value) { res.setHeader(name, value); return this; },
    send(body) { if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(body); }
  };
}

const server = http.createServer(async (req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/api/health') {
    res.writeHead(200, {'content-type':'application/json'});
    return res.end(JSON.stringify({ok:true, service:'bse-company-results-api'}));
  }
  if (p === '/api/event-calendar') {
    try {
      const handler = require(path.join(root, 'api/event-calendar.js'));
      return handler(req, adaptResponse(res));
    } catch (e) {
      res.writeHead(500, {'content-type':'application/json'});
      return res.end(JSON.stringify({message:e.message}));
    }
  }
  const file = p === '/' ? path.join(root, 'README.md') : path.join(root, 'dist', 'bse-company-results-angular', p);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) { res.writeHead(200); return fs.createReadStream(file).pipe(res); }
  res.writeHead(404); res.end('Not found');
});
server.listen(port, () => console.log(`BSE API server listening on ${port}`));
