"""Official pre-race context; unknown fields remain None, never guessed from race number."""
from html.parser import HTMLParser
from datetime import date as Date
import re
import unicodedata
from urllib.parse import urlparse, parse_qs


def norm(text):
    return ' '.join(unicodedata.normalize('NFKC', text).split())


class Node:
    def __init__(self, tag='', attrs=None, parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, attrs or {}, parent, []

    @property
    def text(self):
        return norm(' '.join(c.text if isinstance(c, Node) else c for c in self.children))

    def has(self, cls):
        return cls in self.attrs.get('class', '').split()

    def find(self, predicate):
        return [c for c in self.walk() if predicate(c)]

    def walk(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.walk()


class Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs), self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                return

    def handle_data(self, text):
        if not any(n.tag in {'script','style'} for n in self.stack):
            self.stack[-1].children.append(text)


GRADE = {'is-SGa':'SG','is-SGb':'SG','is-G1a':'PG1','is-G1b':'G1',
         'is-G2a':'G2','is-G2b':'G2','is-G3a':'G3','is-G3b':'G3','is-ippan':'一般'}
PERIOD = {'is-morning':'モーニング','is-nighter':'ナイター','is-summer':'サマータイム','is-midnight':'ミッドナイト'}


def grade(node):
    values = {v for k, v in GRADE.items() if node.has(k)}
    return next(iter(values)) if len(values) == 1 else None


def daily_metadata(text, date, venue_code):
    doc = Document(text).root
    result = {'grade':None,'day_label':None,'meeting_day':None,'schedule_type':None,'title':None}
    matches = []
    for row in doc.find(lambda n: n.tag == 'tr'):
        for link in row.find(lambda n: n.tag == 'a'):
            url = urlparse(link.attrs.get('href',''))
            q = parse_qs(url.query)
            if url.path == '/owpc/pc/race/raceindex' and q.get('jcd') == [venue_code] and q.get('hd') == [date.replace('-','')]:
                matches.append((row, link))
    if len(matches) != 1:
        return result
    row, link = matches[0]
    result['title'] = link.text
    cells = [c for c in row.children if isinstance(c,Node) and c.tag in {'td','th'}]
    grades = [(i,grade(c)) for i,c in enumerate(cells) if grade(c)]
    if len(grades) == 1:
        i,result['grade'] = grades[0]
        if i+1 < len(cells):
            cell = cells[i+1]
            periods = [v for k,v in PERIOD.items() if cell.has(k)]
            if len(periods) == 1:
                result['schedule_type'] = periods[0]
            elif not cell.attrs.get('class','').strip() and not cell.text:
                result['schedule_type'] = 'デイ'
    for cell in cells:
        m = re.search(r'(初日|最終日|\d+日目)$',cell.text)
        if m:
            result['day_label'] = m[1]
            result['meeting_day'] = 1 if m[1] == '初日' else int(m[1][:-2]) if m[1].endswith('日目') else None
    return result


def race_context(text, date, venue_code):
    doc = Document(text).root
    titles = doc.find(lambda n: n.has('heading2_titleName'))
    headers = doc.find(lambda n: n.has('heading2_title'))
    detail = doc.find(lambda n: n.has('title16_titleDetail__add2020'))
    tabs = doc.find(lambda n: n.has('tab2_tabs'))
    result = {'meeting_day':None,'day_label':None,'meeting_id':None,'series_start':None,
              'phase':'UNKNOWN','race_label':None,'grade':grade(headers[0]) if len(headers)==1 else None,
              'title':titles[0].text if len(titles)==1 else None}
    if len(detail) == 1:
        label = re.sub(r'\s*\d{3,4}m.*$','',detail[0].text).strip()
        result['race_label'] = label
        result['phase'] = 'SEMI_FINAL' if '準優勝戦' in label else 'FINAL' if '優勝戦' in label else 'QUALIFYING' if '予選' in label else 'OTHER'
    if len(tabs) == 1:
        days = [n for n in tabs[0].children if isinstance(n,Node) and n.tag=='li']
        active = [i for i,n in enumerate(days) if n.has('is-active1') or n.has('is-active2')]
        if len(active) == 1:
            i=active[0];label=days[i].text
            day = re.search(r'(初日|最終日|\d+日目)$',label)
            target = re.search(r'(\d+)月(\d+)日',label)
            if day and target and (int(target[1]),int(target[2])) == (int(date[5:7]),int(date[8:10])):
                result['day_label'] = day[1]
                # Final-day number comes from the official day tabs, not calendar subtraction.
                result['meeting_day'] = 1 if day[1]=='初日' else i+1 if day[1]=='最終日' else int(day[1][:-2])
                first = re.search(r'(\d+)月(\d+)日.*初日$',days[0].text)
                if first:
                    year=int(date[:4])-(int(first[1])>int(date[5:7]))
                    start=Date(year,int(first[1]),int(first[2])).isoformat()
                    if start<=date:
                        result['series_start']=start
                        result['meeting_id']=venue_code+'_'+start.replace('-','')
    return result


def starts(page, heading):
    tables=[t for t in page.tables if t['rows'] and norm(t['rows'][0][0]['text'])==heading]
    if not tables:
        return {}
    if len(tables)!=1:
        raise ValueError('スタート情報の表が複数あります')
    rows = tables[0]['rows'][2:] if heading=='スタート展示' else tables[0]['rows'][1:]
    if len(rows)!=6:
        # Not yet provided, cancellations, missing/withdrawn boats are not fabricated.
        return {}
    result={}
    for course,row in enumerate(rows,1):
        text=norm(' '.join(c['text'] for c in row))
        m=re.match(r'^([1-6])\s+([FL]?)(\d?\.\d{2})(?:\s|$)',text)
        if not m:
            if not text or re.match(r'^[1-6]\s*$',text):continue
            raise ValueError('スタート情報の艇番・STを確認できません')
        lane=int(m[1]);value=float(m[3])*(-1 if m[2]=='F' else 1)
        if lane in result or not -.5<=value<=2:
            raise ValueError('スタート情報の重複・範囲外です')
        result[lane]={'course':course,'st':value,'status':m[2] or 'NORMAL'}
    return result


def exhibition(page):
    rows=[r for t in page.tables for r in t['rows'] if r and r[0]['attrs'].get('rowspan')=='4'
          and re.search(r'\bis-boatColor[1-6]\b',r[0]['attrs'].get('class',''))]
    if not rows:return {}
    if len(rows)!=6:raise ValueError('展示の出走表が6艇分ありません')
    start=starts(page,'スタート展示');result={}
    for row in rows:
        lane=int(norm(row[0]['text']));value=norm(row[4]['text'])
        time=float(value) if re.fullmatch(r'\d\.\d{2}',value) else None
        if time is not None and not 5<=time<=9:raise ValueError('展示タイムが範囲外です')
        result[lane]={'exhibition_time':time,'exhibition_st':start.get(lane,{}).get('st'),
                      'exhibition_course':start.get(lane,{}).get('course'),'exhibition_st_status':start.get(lane,{}).get('status')}
    if set(result)!=set(range(1,7)):raise ValueError('展示の艇番が不正です')
    return result


def results(page):
    tables=[t for t in page.tables if t['rows'] and [norm(c['text']) for c in t['rows'][0]][:3]==['着','枠','ボートレーサー']]
    if len(tables)!=1:raise ValueError('確定結果の着順表がありません')
    start=starts(page,'スタート情報');result={}
    for row in tables[0]['rows'][1:]:
        if len(row)!=4:raise ValueError('確定結果の列数が違います')
        lane=int(norm(row[1]['text']));identity=re.match(r'^(\d{4})\s',norm(row[2]['text']));rank=norm(row[0]['text'])
        if lane in result or not identity:raise ValueError('結果の艇番・登録番号が不正です')
        result[lane]={'racer_id':identity[1],'finish':int(rank) if rank in '123456' else None,'finish_status':rank,
                      'actual_st':start.get(lane,{}).get('st'),'actual_course':start.get(lane,{}).get('course'),
                      'actual_st_status':start.get(lane,{}).get('status')}
    if set(result)!=set(range(1,7)):raise ValueError('確定結果が6艇分ありません')
    return result
