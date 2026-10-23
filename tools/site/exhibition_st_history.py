"""Pair official exhibition ST with completed normal starts; never infer absent ST."""
import argparse,hashlib,json,re,time
from datetime import date,timedelta,datetime,timezone
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from urllib.robotparser import RobotFileParser
from race_context import Document,exhibition,results,norm
from collect_official import parse_page
from probe_official import ORIGIN,USER_AGENT,fetch

def eligible(entry):
    return (re.fullmatch(r'\d{4}',str(entry.get('racer_id',''))) and entry.get('actual_st_status')=='NORMAL'
        and entry.get('exhibition_st_status') in ('NORMAL','F')
        and all(isinstance(entry.get(k),(int,float)) and not isinstance(entry.get(k),bool) for k in ('exhibition_st','actual_st'))
        and -.5<=entry['exhibition_st']<=1 and 0<=entry['actual_st']<1)

def aggregate(records,through):
    start=through-timedelta(days=364);players={};unique={}
    for record in records:
        if not str(start)<=record['date']<=str(through):continue
        key=(record['date'],record['venue_code'],record['race_no'])
        if key in unique:
            if unique[key]['entries']!=record['entries']:raise ValueError('同一レースのSTが一致しません')
            continue
        unique[key]=record
        for e in record['entries']:
            if not eligible(e):continue
            s=players.setdefault(e['racer_id'],{'n':0,'sum':0.,'sum_squares':0.,'from':record['date'],'through':record['date']})
            gap=e['actual_st']-e['exhibition_st'];s['n']+=1;s['sum']+=gap;s['sum_squares']+=gap*gap
            s['from']=min(s['from'],record['date']);s['through']=max(s['through'],record['date'])
    return {'schema_version':1,'kind':'EXHIBITION_ST_PAIRED_HISTORY','window_from':str(start),'through':str(through),
            'races':len(unique),'paired_starts':sum(s['n'] for s in players.values()),'players':players},list(unique.values())

def seed(folder):
    result=[]
    for file in sorted(folder.glob('*.json')):
        data=json.loads(file.read_text())
        if data.get('kind')!='RETROSPECTIVE_HISTORY':continue
        for race in data['races']:
            sources={};pages={}
            for kind in ('beforeinfo','raceresult','racelist'):
                source=race['sources'][kind];raw=Path(source['evidence_file']).read_bytes()
                if hashlib.sha256(raw).hexdigest()!=source['sha256']:raise ValueError('原資料のハッシュが一致しません')
                sources[kind]={'url':source['url'],'sha256':source['sha256']};pages[kind]=parse_page(raw.decode())
            shown=exhibition(pages['beforeinfo']);actual=results(pages['raceresult'])
            for e in race['entries']:
                official=actual.get(e['lane'],{});display=shown.get(e['lane'],{})
                if official.get('racer_id')!=e['racer_id'] or any(e.get(k)!=official.get(k) for k in ('actual_st','actual_st_status')) or any(e.get(k)!=display.get(k) for k in ('exhibition_st','exhibition_st_status')):raise ValueError('保存値と原資料のSTが一致しません')
            result.append({'date':race['date'],'venue_code':race['venue_code'],'race_no':race['race_no'],
                'entries':[{k:e.get(k) for k in ('racer_id','lane','exhibition_st','exhibition_st_status','actual_st','actual_st_status')} for e in race['entries']], 'sources':sources})
    return result

def daily(races,through,cache,archive_source):
    cache.mkdir(parents=True,exist_ok=True);robots=RobotFileParser();robots.parse(fetch(ORIGIN+'/robots.txt')[0].splitlines());records=[];failures=[]
    for race in races:
        if race['date']!=str(through):continue
        code=race['venue_code'];n=race['race_no'];url=f'{ORIGIN}/owpc/pc/race/beforeinfo?hd={through:%Y%m%d}&jcd={code}&rno={n}'
        try:
            if not robots.can_fetch(USER_AGENT,url):raise ValueError('robots.txtで取得対象外です')
            file=cache/f'{through}-{code}-{n}.html'
            if file.exists():text=file.read_text()
            else:text=fetch(url)[0];file.write_text(text);time.sleep(1)
            display=exhibition(parse_page(text));ids={}
            for row in Document(text).root.find(lambda node:node.tag=='tr'):
                cells=[c for c in row.children if hasattr(c,'tag') and c.tag=='td']
                if not cells or not re.search(r'\bis-boatColor[1-6]\b',cells[0].attrs.get('class','')):continue
                for link in row.find(lambda node:node.tag=='a'):
                    values=parse_qs(urlparse(link.attrs.get('href','')).query)
                    if re.fullmatch(r'\d{4}',values.get('toban',[''])[0]):ids[int(norm(cells[0].text))]=values['toban'][0]
            entries=[]
            for e in race['entries']:
                if ids.get(e['lane'])!=e['racer_id']:raise ValueError('展示と結果の登録番号が一致しません')
                item={k:e.get(k) for k in ('racer_id','lane','actual_st','actual_st_status')};item.update({k:display.get(e['lane'],{}).get(k) for k in ('exhibition_st','exhibition_st_status')});entries.append(item)
            if not any(eligible(e) for e in entries):raise ValueError('展示STと正常な本番STの組を確認できません')
            records.append({'date':str(through),'venue_code':code,'race_no':n,'entries':entries,
                'sources':{'beforeinfo':{'url':url,'sha256':hashlib.sha256(text.encode()).hexdigest()},'raceresult_archive':archive_source}})
        except Exception as error:failures.append({'date':str(through),'venue_code':code,'race_no':n,'error':str(error)})
    return records,failures

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--seed',type=Path);parser.add_argument('--annual-races',type=Path);parser.add_argument('--through',type=date.fromisoformat,default=datetime.now(timezone(timedelta(hours=9))).date()-timedelta(days=1));parser.add_argument('--directory',type=Path,default=Path('models/exhibition-st'));parser.add_argument('--cache',type=Path,default=Path('site/cache/exhibition-st'))
    args=parser.parse_args()
    if args.through>=datetime.now(timezone(timedelta(hours=9))).date():parser.error('完了した過去日だけが対象です')
    args.directory.mkdir(parents=True,exist_ok=True);file=args.directory/'records.json';records=json.loads(file.read_text()) if file.exists() else [];failures=[]
    if args.seed:records.extend(seed(args.seed))
    if args.annual_races:
        manifest=json.loads(args.annual_races.with_name('manifest.json').read_text());archive_source=next((s for s in manifest['sources'] if s['date']==str(args.through)),None)
        if not archive_source or not re.fullmatch(r'[a-f0-9]{64}',archive_source.get('sha256','')):raise ValueError('結果アーカイブの出典がありません')
        known={(r['date'],r['venue_code'],r['race_no']) for r in records};pending=[r for r in json.loads(args.annual_races.read_text()) if (r['date'],r['venue_code'],r['race_no']) not in known]
        rows,failures=daily(pending,args.through,args.cache,archive_source)
        # A successfully rechecked race replaces its previous copy, never double counts.
        keys={(r['date'],r['venue_code'],r['race_no']) for r in rows};records=[r for r in records if (r['date'],r['venue_code'],r['race_no']) not in keys]+rows
    profile,records=aggregate(records,args.through)
    if not profile['paired_starts']:raise ValueError('照合できたSTがありません')
    file.write_text(json.dumps(sorted(records,key=lambda r:(r['date'],r['venue_code'],r['race_no'])),ensure_ascii=False,separators=(',',':'))+'\n')
    (args.directory/'current.json').write_text(json.dumps(profile,ensure_ascii=False,separators=(',',':'))+'\n')
    (args.directory/'last-update.json').write_text(json.dumps({'through':str(args.through),'failures':failures,'paired_starts':profile['paired_starts']},ensure_ascii=False)+'\n')
    print('::notice title=Paired exhibition ST::'+json.dumps({'through':str(args.through),'races':profile['races'],'paired_starts':profile['paired_starts'],'players':len(profile['players']),'failed_races':len(failures)}))
