"""Read-only public delivery diagnostics. A spoofed UA does not prove Google access."""
import json
import urllib.request
import xml.etree.ElementTree as ET
from urllib.parse import urlparse
from datetime import datetime, timezone
from pathlib import Path

BASE = 'https://funeyomi.win/'
def inspect_sitemap(body):
    root = ET.fromstring(body)
    if root.tag != '{http://www.sitemaps.org/schemas/sitemap/0.9}urlset':
        raise ValueError('Expected sitemap urlset with standard namespace')
    urls = [e.text for e in root.findall('{*}url/{*}loc')]
    if not urls or len(urls) != len(set(urls)):
        raise ValueError('Empty or duplicate sitemap URLs')
    for url in urls:
        p = urlparse(url)
        if p.scheme != 'https' or p.netloc != 'funeyomi.win' or p.query or p.fragment:
            raise ValueError('Unexpected sitemap URL')
    return urls

def diagnose(fetcher=urllib.request.urlopen):
    report = {'checked_at': datetime.now(timezone.utc).isoformat(), 'checks': [],
              'note': 'HTTP diagnostics only. Search Console indexing and real Googlebot access remain unverified.'}
    for agent in ['Mozilla/5.0', 'Googlebot']:
        for name in ['robots.txt', 'sitemap.xml', '']:
            check = {'url': BASE + name, 'user_agent': agent, 'ok': False}
            try:
                with fetcher(urllib.request.Request(BASE + name, headers={'User-Agent': agent}), timeout=25) as r:
                    body = r.read(2000000)
                    check.update(status=r.status, final_url=r.url, content_type=r.headers.get('Content-Type', ''), bytes=len(body))
                    if r.status != 200 or r.url != BASE + name:
                        raise ValueError('Non-200 or unexpected redirect target')
                    if 'noindex' in r.headers.get('X-Robots-Tag', '').lower():
                        raise ValueError('X-Robots-Tag noindex')
                    if name == 'sitemap.xml':
                        check['urls'] = len(inspect_sitemap(body))
                        if not any(t in check['content_type'].lower() for t in ['application/xml', 'text/xml']):
                            raise ValueError('Unexpected XML MIME type')
                    if name == 'robots.txt':
                        text = body.decode('utf-8')
                        if 'Sitemap: ' + BASE + 'sitemap.xml' not in text:
                            raise ValueError('Missing Sitemap directive')
                        if any(line.strip().lower() == 'disallow: /' for line in text.splitlines()):
                            raise ValueError('Root crawl disallow; inspect user-agent groups')
                    check['ok'] = True
            except Exception as error:
                check['error'] = str(error)
                check['error_type'] = type(error).__name__
            report['checks'].append(check)
    report['ok'] = all(c['ok'] for c in report['checks'])
    return report

if __name__ == '__main__':
    report = diagnose()
    Path('search-delivery.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))
    raise SystemExit(0 if report['ok'] else 1)
