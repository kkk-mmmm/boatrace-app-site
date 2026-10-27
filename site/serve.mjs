import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {root} from './data.mjs';

export function createSiteServer(directory = path.join(root, 'site/dist')) {
  return http.createServer((request, response) => {
    if (request.method !== 'GET') {response.writeHead(405); response.end(); return;}
    const url = new URL(request.url, 'http://localhost');
    // Serve under the same project subpath as GitHub Pages.
    let name = url.pathname.replace(/^\/(?:boatrace-app|boatrace-app-site)(?=\/)/, '').replace(/^\//, '') || 'index.html';
    if(/^venues\/(?:0[1-9]|1\d|2[0-4])\/$/.test(name))name+='index.html';
    if(/^(about|guide|verification)\/$/.test(name))name+='index.html';
    const allowed = ['index.html', 'style.css', 'app.mjs', 'view.mjs', 'odds-live.mjs', 'development.mjs','race-context.mjs','race-metrics.mjs','charts.mjs','verification-data.mjs','verification-page.mjs','experiments-view.mjs','data/experiments.json','data/verification.json', 'data/current.json', 'data/archive.json', 'data/odds-config.json', 'data/odds-targets.json','favicon.svg','favicon-32.png','apple-touch-icon.png','icon-192.png','icon-512.png','social-card.png','site.webmanifest','sitemap.xml','robots.txt'];
    if (!allowed.includes(name) && !/^(about|guide|verification)\/index\.html$/.test(name) && !/^venues\/(?:0[1-9]|1\d|2[0-4])\/index\.html$/.test(name) && !/^data\/experiments\/[a-z0-9-]+\/\d{4}-\d{2}-\d{2}\.json$/.test(name) && !/^data\/venues\/(?:0[1-9]|1\d|2[0-4])\.json$/.test(name)) {response.writeHead(404); response.end(); return;}
    const file = path.join(directory, name);
    const type = name.endsWith('.txt')?'text/plain':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':name.endsWith('.xml')?'application/xml':name.endsWith('.webmanifest')?'application/manifest+json':name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'text/html';
    try {
      const content = fs.readFileSync(file);
      response.writeHead(200, {'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      response.end(content);
    } catch {response.writeHead(404); response.end();}
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createSiteServer();
  server.listen(Number(process.env.BOATRACE_SITE_PORT || 4173), '127.0.0.1', () => console.log('Public site local check: port ' + server.address().port));
}
