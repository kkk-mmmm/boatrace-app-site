"""Acquire completed historical races, with immutable source hashes and explicit retrospective provenance."""
import argparse
from datetime import datetime,timedelta,timezone,date as Date
import hashlib
import json
from pathlib import Path
import time
from urllib.robotparser import RobotFileParser
from collect_official import parse_page,entries,deadlines,require,VENUE_CODES
from race_context import race_context,exhibition,results
from probe_official import ORIGIN,USER_AGENT,fetch


def acquire_history(venue_code,start,end,destination,race_numbers=range(1,13)):
    today=datetime.now(timezone(timedelta(hours=9))).date()
    require(venue_code in VENUE_CODES and start<=end<today and (end-start).days<366,'対象場・過去の期間が不正です')
    require(len(set(race_numbers))==len(race_numbers) and all(1<=n<=12 for n in race_numbers),'レース番号が不正です')
    root=destination.parent/'sources';root.mkdir(parents=True,exist_ok=True)
    robot_text,_=fetch(ORIGIN+'/robots.txt');robots=RobotFileParser();robots.parse(robot_text.splitlines())

    def acquire(url):
        require(robots.can_fetch(USER_AGENT,url),'robots.txtで取得対象外です')
        key=hashlib.sha256(url.encode()).hexdigest();meta=root/(key+'.json')
        if meta.exists():
            source=json.loads(meta.read_text());text=(root/(source['sha256']+'.html')).read_text()
            require(source['url']==url and hashlib.sha256(text.encode()).hexdigest()==source['sha256'],'履歴の原資料が変更されています')
        else:
            text,_=fetch(url);time.sleep(1)
            sha=hashlib.sha256(text.encode()).hexdigest();raw=root/(sha+'.html')
            if not raw.exists():raw.write_text(text)
            source={'url':url,'sha256':sha,'observed_at':datetime.now(timezone.utc).isoformat(),
                    'published_at':None,'evidence_file':str(raw)}
            meta.write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n')
        return parse_page(text),source

    record={'schema_version':1,'kind':'RETROSPECTIVE_HISTORY','venue_code':venue_code,'start':start.isoformat(),'end':end.isoformat(),
            'acquired_at':datetime.now(timezone.utc).isoformat(),'timing_proof':'NOT_PROVEN_PRERACE','races':[],'failures':[]}
    day=start
    while day<=end:
        date=day.isoformat()
        for n in race_numbers:
            try:
                sources={};pages={}
                for kind in ['racelist','beforeinfo','raceresult']:
                    url=f'{ORIGIN}/owpc/pc/race/{kind}?hd={date.replace("-","")}&jcd={venue_code}&rno={n}'
                    pages[kind],sources[kind]=acquire(url)
                boats=entries(pages['racelist']);display=exhibition(pages['beforeinfo']);actual=results(pages['raceresult'])
                for boat in boats:
                    require(boat['racer_id']==actual[boat['lane']]['racer_id'],'出走表と結果の登録番号が一致しません')
                    boat.update(display.get(boat['lane'],{}));boat.update(actual[boat['lane']])
                    # Qualification pressure is unknown without independently sourced pre-race conditions.
                    boat['qualification_pressure']=None
                race={'date':date,'venue_code':venue_code,'race_no':n,'deadline_at':deadlines(pages['racelist'],date)[n],
                      'context':race_context(pages['racelist'].raw_html,date,venue_code),'entries':boats,'sources':sources}
                record['races'].append(race)
            except Exception as error:
                record['failures'].append({'date':date,'race_no':n,'error':str(error)})
            destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_text(json.dumps(record,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
        print(json.dumps({'venue_code':venue_code,'date':date,'races':len(record['races']),'failed':len(record['failures'])}),flush=True)
        day+=timedelta(days=1)
    return record


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--venue',required=True,choices=sorted(VENUE_CODES))
    parser.add_argument('--start',required=True,type=Date.fromisoformat)
    parser.add_argument('--end',required=True,type=Date.fromisoformat)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--races',default=','.join(map(str,range(1,13))))
    args=parser.parse_args()
    try:acquire_history(args.venue,args.start,args.end,args.output,[int(n) for n in args.races.split(',')])
    except Exception as error:parser.exit(1,str(error)+'\n')
