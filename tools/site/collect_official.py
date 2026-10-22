"""公式HTMLを正規化する。予想計算・公開処理は行わない。"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import time
import threading
import unicodedata
from urllib.parse import parse_qs, urlparse
from urllib.robotparser import RobotFileParser
from probe_official import ORIGIN, USER_AGENT, Structure, fetch
from race_context import race_context, daily_metadata, exhibition


def require(ok, message):
    if not ok:
        raise ValueError(message)


class RequestGate:
    """Space request starts, while allowing slow responses to overlap."""
    def __init__(self):
        self.lock = threading.Lock()
        self.next_start = 0

    def wait(self):
        with self.lock:
            delay = self.next_start - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self.next_start = time.monotonic() + 1


def acquire_pages(tasks, acquire):
    """At most three connections within a venue; keep failures per page."""
    def one(url):
        try:
            return acquire(url)
        except Exception as error:
            return error
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {key: pool.submit(one, url) for key, url in tasks.items()}
        return {key: future.result() for key, future in futures.items()}


def normalized(value):
    return unicodedata.normalize('NFKC', value).strip()


def tokens(cell):
    return [normalized(x) for x in cell['text'].splitlines() if x.strip()]


def number(value):
    value = normalized(value).replace(',', '')
    if not re.fullmatch(r'(?:\d+(?:\.\d+)?|\.\d+)', value):
        return None
    result = float(value)
    return result if math.isfinite(result) else None


def parse_page(text):
    page = Structure()
    page.feed(text)
    page.raw_html = text
    return page


VENUES = json.loads((Path(__file__).resolve().parents[1] / 'prerace/venues.json').read_text())
VENUE_CODES = {v['code'] for v in VENUES}


def meeting_codes(page, date):
    headings = ' '.join(c['text'] for t in page.tables for row in t['rows'][:1] for c in row)
    require('進行状況' in headings and 'ボート' in headings, '公式開催一覧の構造を確認できません')
    meetings = set()
    for link in page.links:
        url = urlparse(link['url'])
        query = parse_qs(url.query)
        if url.hostname == 'www.boatrace.jp' and url.path == '/owpc/pc/race/raceindex' and query.get('hd') == [date.replace('-', '')]:
            code = query.get('jcd', [None])[0]
            require(code in VENUE_CODES, '開催場コードが不正です')
            meetings.add(code)
    require(meetings, '開催場の一覧が空のため非開催とは断定できません')
    return meetings


def meeting_status(page, date, venue_code='01'):
    require(venue_code in VENUE_CODES, '場コードが不正です')
    return 'OPEN' if venue_code in meeting_codes(page, date) else 'NO_MEETING'


def deadlines(page, date):
    for table in page.tables:
        for row in table['rows']:
            if row and normalized(row[0]['text']) == '締切予定時刻':
                require(len(row) == 13, '締切時刻の件数が12件ではありません')
                return {i: f'{date}T{normalized(cell["text"])}:00+09:00'
                        if re.fullmatch(r'\d{2}:\d{2}', normalized(cell['text'])) else None
                        for i, cell in enumerate(row[1:], 1)}
    raise ValueError('公式締切を取得できません')


def entries(page):
    rows = [row for table in page.tables for row in table['rows']
            if row and row[0]['attrs'].get('rowspan') == '4'
            and re.search(r'\bis-boatColor[1-6]\b', row[0]['attrs'].get('class', ''))]
    require(len(rows) == 6, '6艇分の出走表を確認できません')
    result = []
    for row in rows:
        require(len(row) >= 8, '出走表の列数が違います')
        lane = int(normalized(row[0]['text']))
        identity = tokens(row[2])
        person = re.search(r'(\d{4})\s*/\s*(A1|A2|B1|B2)\s+(.+)', ' '.join(identity))
        require(person is not None, '選手情報を取得できません')
        # Name is the first nonempty line after the class line. Preserve names,
        # and never infer a numeric field from another column when it is absent.
        class_index = next((i for i, value in enumerate(identity) if re.search(r'/\s*(A1|A2|B1|B2)$', value)), None)
        require(class_index is not None and class_index + 1 < len(identity), '選手名を確認できません')
        start = tokens(row[3])
        require(len(start) >= 2 and re.fullmatch(r'F\d+', start[0]) and re.fullmatch(r'L\d+', start[1]), '平均ST欄の構造が違います')
        national, local, motor, boat = (tokens(row[i]) for i in range(4, 8))
        result.append({'lane': lane, 'racer_id':person[1], 'name': ' '.join(identity[class_index + 1].split()), 'class': person[2],
                       'national_win_rate': number(national[0]) if national else None,
                       'local_win_rate': number(local[0]) if local else None,
                       'motor_2rate': number(motor[1]) if len(motor) > 1 else None,
                       'boat_2rate': number(boat[1]) if len(boat) > 1 else None,
                       'avg_st': number(start[2]) if len(start) > 2 else None})
    require(sorted(x['lane'] for x in result) == list(range(1, 7)), '出走表の艇番が重複・欠落しています')
    return sorted(result, key=lambda x: x['lane'])


def expand_rows(rows):
    active = {}
    output = []
    for row in rows:
        cells = {column: cell for column, (cell, left) in active.items()}
        next_active = {column: (cell, left - 1) for column, (cell, left) in active.items() if left > 1}
        cursor = 0
        for cell in row:
            while cursor in cells:
                cursor += 1
            colspan = int(cell['attrs'].get('colspan', '1'))
            rowspan = int(cell['attrs'].get('rowspan', '1'))
            require(1 <= colspan <= 30 and 1 <= rowspan <= 30, 'テーブルの結合数が不正です')
            for column in range(cursor, cursor + colspan):
                require(column not in cells, 'テーブルの列が重複しています')
                cells[column] = cell
                if rowspan > 1:
                    next_active[column] = (cell, rowspan - 1)
            cursor += colspan
        output.append([cells.get(i) for i in range(max(cells, default=-1) + 1)])
        active = next_active
    return output


def odds(page):
    candidates = [t for t in page.tables if any('oddsPoint' in c['attrs'].get('class', '') for row in t['rows'] for c in row)]
    if not candidates:
        text = ''.join(page.text)
        if 'データはありません' in text or 'データがありません' in text:
            return []
        raise ValueError('3連単オッズの構造を確認できません')
    require(len(candidates) == 1 and len(candidates[0]['rows']) == 21, '3連単オッズの行数が不正です')
    header = candidates[0]['rows'][0]
    require([normalized(c['text']) for c in header[::2]] == ['1', '2', '3', '4', '5', '6'], '3連単の1着の並びが違います')
    result = []
    for row in expand_rows(candidates[0]['rows'][1:]):
        require(len(row) == 18 and all(cell is not None for cell in row), '3連単オッズの列数が違います')
        for first in range(1, 7):
            second, third, value = row[(first - 1) * 3:first * 3]
            second, third = normalized(second['text']), normalized(third['text'])
            require(second in '123456' and len(second) == 1 and third in '123456' and len(third) == 1, 'オッズの艇番が不正です')
            require(len({str(first), second, third}) == 3, 'オッズの艇番が重複しています')
            multiplier = number(value['text'])
            if multiplier is not None and multiplier != 0:
                require(multiplier >= 1, 'オッズ倍率が不正です')
                result.append({'combo': f'{first}-{second}-{third}', 'odds': multiplier})
    require(len({x['combo'] for x in result}) == len(result), 'オッズの買い目が重複しています')
    return result


def collect_index(destination):
    now = datetime.now(timezone.utc)
    date = now.astimezone(timezone(timedelta(hours=9))).date().isoformat()
    robot_text, _ = fetch(ORIGIN + '/robots.txt')
    robots = RobotFileParser()
    robots.parse(robot_text.splitlines())
    url = ORIGIN + '/owpc/pc/race/index?hd=' + date.replace('-', '')
    require(robots.can_fetch(USER_AGENT, url), 'robots.txtで取得対象外のページです')
    time.sleep(1)
    text, _ = fetch(url)
    retrieved = datetime.now(timezone.utc).isoformat()
    sha = hashlib.sha256(text.encode('utf-8')).hexdigest()
    evidence = destination.parent / date / 'evidence' / (sha + '.html')
    evidence.parent.mkdir(parents=True, exist_ok=True)
    if not evidence.exists():
        evidence.write_text(text, encoding='utf-8')
    return {'date': date, 'attempted_at': now.isoformat(), 'completed_at': retrieved,
            'robots_text': robot_text, 'meeting_codes': sorted(meeting_codes(parse_page(text), date)),
            'index_source': {'url': url, 'retrieved_at': retrieved, 'evidence_file': str(evidence), 'sha256': sha}}


def collect(destination, venue_code='01', index=None):
    require(venue_code in VENUE_CODES, '場コードが不正です')
    now = datetime.now(timezone.utc)
    date = now.astimezone(timezone(timedelta(hours=9))).date().isoformat()
    result = {'date': date, 'venue_code': venue_code, 'attempted_at': now.isoformat(), 'meeting_status': 'UNKNOWN', 'races': []}
    raw_dir = destination.parent / date / 'venues' / venue_code / 'evidence'
    raw_dir.mkdir(parents=True, exist_ok=True)
    index = index if index is not None else collect_index(destination)
    require(index.get('date') == date and not index.get('error'), '当日の公式開催一覧がありません')
    index_time = datetime.fromisoformat(index['completed_at'])
    age = (datetime.now(timezone.utc) - index_time).total_seconds()
    require(0 <= age < 1800, '公式開催一覧の取得時刻が不正・古すぎます')
    source = index['index_source']
    require(source['url'] == ORIGIN + '/owpc/pc/race/index?hd=' + date.replace('-', ''), '開催一覧のURLが違います')
    raw_index = Path(source['evidence_file']).read_bytes()
    require(hashlib.sha256(raw_index).hexdigest() == source['sha256'], '開催一覧の原資料が変更されています')
    robots = RobotFileParser()
    robots.parse(index['robots_text'].splitlines())

    gate = RequestGate()

    def acquire(url):
        require(robots.can_fetch(USER_AGENT, url), 'robots.txtで取得対象外のページです')
        gate.wait()
        text, _ = fetch(url)
        retrieved = datetime.now(timezone.utc).isoformat()
        sha = hashlib.sha256(text.encode('utf-8')).hexdigest()
        evidence = raw_dir / (sha + '.html')
        if not evidence.exists():
            evidence.write_text(text, encoding='utf-8')
        return parse_page(text), {'url': url, 'retrieved_at': retrieved, 'evidence_file': str(evidence), 'sha256': sha}

    result['index_source'] = source
    result['meeting'] = daily_metadata(raw_index.decode('utf-8'), date, venue_code)
    result['meeting_status'] = meeting_status(parse_page(raw_index.decode('utf-8')), date, venue_code)
    if result['meeting_status'] == 'NO_MEETING':
        result['completed_at'] = datetime.now(timezone.utc).isoformat()
        return result
    prefix = ORIGIN + '/owpc/pc/race/'
    query = '?hd=' + date.replace('-', '') + '&jcd=' + venue_code + '&rno='
    first_page, first_source = acquire(prefix + 'racelist' + query + '1')
    first_context = race_context(first_page.raw_html,date,venue_code)
    result['meeting'].update({k:first_context[k] for k in ['meeting_day','day_label','meeting_id','series_start']})
    times = deadlines(first_page, date)
    tasks = {}
    for n in range(1, 13):
        if not times[n] or datetime.now(timezone.utc) >= datetime.fromisoformat(times[n]):
            continue
        for kind in ('racelist', 'beforeinfo', 'odds3t'):
            if kind == 'racelist' and n == 1:
                continue
            tasks[(n, kind)] = prefix + kind + query + str(n)
    pages = acquire_pages(tasks, acquire)

    def acquired(n, kind):
        value = (first_page, first_source) if n == 1 and kind == 'racelist' else pages[(n, kind)]
        if isinstance(value, Exception):
            raise value
        return value

    for n in range(1, 13):
        item = {'race_no': n, 'deadline_at': times[n], 'input': None, 'odds': None, 'issue': None}
        result['races'].append(item)
        if not times[n]:
            item['issue'] = '公式締切を確認できません'
            continue
        if datetime.now(timezone.utc) >= datetime.fromisoformat(times[n]):
            item['closed'] = True
            continue
        try:
            page, source = acquired(n, 'racelist')
            require(deadlines(page, date)[n] == times[n], '公式締切が取得中に変更されました')
            item['input'] = {'date': date, 'venue_code': venue_code, 'race_no': n, 'deadline_at': times[n],
                             'input_source_url': source['url'], 'input_fetched_at': source['retrieved_at'],
                             'result_not_seen': True, 'context':race_context(page.raw_html,date,venue_code), 'entries': entries(page), 'odds': None}
            item['input_source'] = source
            try:
                before, before_source = acquired(n, 'beforeinfo')
                display = exhibition(before)
                for boat in item['input']['entries']:
                    boat.update(display.get(boat['lane'],{}))
                item['exhibition_source'] = before_source
            except Exception as error:
                item['exhibition_issue'] = str(error)
            odds_page, odds_source = acquired(n, 'odds3t')
            values = odds(odds_page)
            if values:
                item['odds'] = {'source_url': odds_source['url'], 'fetched_at': odds_source['retrieved_at'], 'items': values}
                item['odds_source'] = odds_source
            else:
                item['issue'] = '公式オッズは未提供です'
        except Exception as error:
            item['issue'] = str(error)
    result['completed_at'] = datetime.now(timezone.utc).isoformat()
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--venue', default='01', choices=sorted(VENUE_CODES))
    parser.add_argument('--index-only', action='store_true')
    parser.add_argument('--index-input', type=Path)
    args = parser.parse_args()
    try:
        if args.index_only:
            result = collect_index(args.output)
        else:
            index = json.loads(args.index_input.read_text()) if args.index_input else None
            result = collect(args.output, args.venue, index)
    except Exception as error:
        result = {'date': datetime.now(timezone(timedelta(hours=9))).date().isoformat(), 'venue_code': args.venue,
                  'attempted_at': datetime.now(timezone.utc).isoformat(), 'error': str(error)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
