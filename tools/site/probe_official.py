"""GitHub Actionsから公式サイトの接続・構造を確認する。サイト公開は行わない。"""
import argparse
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import time
from urllib.parse import parse_qs, urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

ORIGIN = 'https://www.boatrace.jp'
USER_AGENT = 'boatrace-app/0.1 (+https://github.com/kkk-mmmm/boatrace-app)'


class Structure(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.stack = []
        self.row = None
        self.cell = None
        self.links = []
        self.link = None
        self.text = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style'):
            self.ignored += 1
        if tag == 'table':
            table = {'attrs': attrs, 'rows': []}
            self.tables.append(table)
            self.stack.append(table)
        elif tag == 'tr' and self.stack:
            self.row = []
            self.stack[-1]['rows'].append(self.row)
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = {'tag': tag, 'attrs': attrs, 'text': ''}
            self.row.append(self.cell)
        elif tag == 'br' and self.cell is not None:
            self.cell['text'] += '\n'
        if tag == 'a':
            self.link = {'url': urljoin(ORIGIN, attrs.get('href', '')), 'text': ''}
            self.links.append(self.link)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.ignored = max(0, self.ignored - 1)
        if tag in ('td', 'th'):
            self.cell = None
        elif tag == 'tr':
            self.row = None
        elif tag == 'table' and self.stack:
            self.stack.pop()
        elif tag == 'a':
            self.link = None

    def handle_data(self, data):
        if self.ignored:
            return
        self.text.append(data)
        if self.cell is not None:
            self.cell['text'] += data
        if self.link is not None:
            self.link['text'] += data


def fetch(url):
    if urlparse(url).hostname != 'www.boatrace.jp':
        raise ValueError('対象外のホスト')
    with urlopen(Request(url, headers={'User-Agent': USER_AGENT}), timeout=25) as response:
        if urlparse(response.url).hostname != 'www.boatrace.jp':
            raise ValueError('対象外へのリダイレクト')
        raw = response.read(3 * 1024 * 1024 + 1)
        if len(raw) > 3 * 1024 * 1024:
            raise ValueError('応答が大きすぎます')
        return raw.decode(response.headers.get_content_charset() or 'utf-8'), dict(response.headers)


def probe():
    output = {'checked_at': datetime.now(timezone.utc).isoformat(), 'pages': [], 'terms_links': []}
    robot_text, _ = fetch(ORIGIN + '/robots.txt')
    output['robots_txt'] = robot_text
    robots = RobotFileParser()
    robots.parse(robot_text.splitlines())
    today = datetime.now(timezone(timedelta(hours=9))).date()
    dates = [today.strftime('%Y%m%d'), (today - timedelta(days=1)).strftime('%Y%m%d')]
    urls = [ORIGIN + '/', ORIGIN + '/owpc/pc/extra/policy.html', ORIGIN + f'/owpc/pc/race/index?hd={dates[0]}']
    for day in dates:
        for kind in ('racelist', 'odds3t'):
            urls.append(ORIGIN + f'/owpc/pc/race/{kind}?hd={day}&jcd=01&rno=1')
    for url in urls:
        page = {'url': url}
        output['pages'].append(page)
        if not robots.can_fetch(USER_AGENT, url):
            page['error'] = 'robots.txtで取得対象外'
            continue
        try:
            text, headers = fetch(url)
            parser = Structure()
            parser.feed(text)
            for table in parser.tables:
                for row in table['rows']:
                    for cell in row:
                        cell['text'] = cell['text'].strip()[:500]
            page.update(status='ok', content_type=headers.get('Content-Type'), tables=parser.tables,
                        no_data='データはありません' in text,
                        text=' '.join(' '.join(parser.text).split()), links=parser.links)
            output['terms_links'].extend(link for link in parser.links
                                         if any(word in link['text'] for word in ('利用規約', '著作権', 'ご利用に', 'ポリシー')))
        except Exception as error:
            page['error'] = str(error)
        time.sleep(1)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = probe()
    except Exception as error:
        result = {'checked_at': datetime.now(timezone.utc).isoformat(), 'error': str(error)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
