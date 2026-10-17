const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const INDEX_FILE = 'index.html';
const PORT = process.env.PORT || 3002;
const PUBLIC_FILES = [INDEX_FILE, 'about.html', 'services.html', 'rice.html', 'projects.html', 'contact.html', 'icon.svg'];
const PUBLIC_DIRS = ['css', 'js', 'img', 'portal'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  // A malformed escape like %E0%A4%A makes decodeURIComponent throw; left
  // uncaught, that one request takes the whole server down.
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
    return;
  }
  if (urlPath === '/') urlPath = '/' + INDEX_FILE;
  if (urlPath === '/portal' || urlPath === '/portal/') urlPath = '/portal/index.html';

  // Only serve what the site itself uses — the same set a static host would
  // publish — never .git/, sql/, backups or this file. Checked on
  // the path relative to ROOT, so a sibling folder whose name merely
  // starts the same (kanam-logistics-old) can't slip past a prefix test.
  const filePath = path.normalize(path.join(ROOT, urlPath));
  const rel = path.relative(ROOT, filePath);
  const top = rel.split(path.sep)[0];
  const isPublic = !rel.startsWith('..') && !path.isAbsolute(rel) &&
    (PUBLIC_FILES.includes(rel) || (PUBLIC_DIRS.includes(top) && rel !== top));
  if (!isPublic) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + urlPath);
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Kanam Logistics running at http://localhost:${PORT}`);
});
