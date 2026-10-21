"""Collect yesterday's completed races and retain a rolling window of sourced history."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
from urllib.robotparser import RobotFileParser
from collect_history import acquire_history
from collect_official import parse_page,meeting_codes,require
from probe_official import ORIGIN,USER_AGENT,fetch


def collect_yesterday(directory,window_days=90):
    yesterday=datetime.now(timezone(timedelta(hours=9))).date()-timedelta(days=1)
    date=yesterday.isoformat();url=f'{ORIGIN}/owpc/pc/race/index?hd={date.replace("-","")}'
    policy,_=fetch(ORIGIN+'/robots.txt');robots=RobotFileParser();robots.parse(policy.splitlines())
    require(robots.can_fetch(USER_AGENT,url),'robots.txtで取得対象外です')
    html,_=fetch(url);codes=meeting_codes(parse_page(html),date)
    directory.mkdir(parents=True,exist_ok=True);failures=[]
    covered={}
    for file in directory.glob('*.json'):
        existing=json.loads(file.read_text())
        if existing.get('kind')=='RETROSPECTIVE_HISTORY':
            for race in existing['races']:
                if race['date']==date:covered.setdefault(race['venue_code'],set()).add(race['race_no'])
    def collect_venue(code):
        if len(covered.get(code,set()))==12:return []
        destination=directory/f'{date}-{code}.json'
        previous=json.loads(destination.read_text()) if destination.exists() else None
        if previous and len(previous['races'])==12 and not previous['failures']:return []
        result=acquire_history(code,yesterday,yesterday,destination)
        return [{'venue_code':code,**failure} for failure in result['failures']]
    # Serial requests within each venue; at most three venues at once.
    with ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(collect_venue,sorted(codes)):failures.extend(result)
    cutoff=(yesterday-timedelta(days=window_days-1)).isoformat()
    files=[];retained_sources=set()
    for file in sorted(directory.glob('*.json')):
        value=json.loads(file.read_text())
        if value.get('kind')!='RETROSPECTIVE_HISTORY':continue
        if value['end']<cutoff:file.unlink()
        else:
            files.append(str(file))
            for race in value['races']:
                retained_sources.update(source['sha256'] for source in race.get('sources',{}).values())
    for source in (directory/'sources').glob('*'):
        if source.suffix=='.html' and source.stem not in retained_sources:source.unlink()
        elif source.suffix=='.json' and json.loads(source.read_text()).get('sha256') not in retained_sources:source.unlink()
    # Retain raw sources referenced by the rolling history; cache eviction is not a backup.
    manifest={'date':date,'files':files,'failures':failures,'window_days':window_days}
    (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--directory',type=Path,default=Path('site/cache/model-history'))
    args=parser.parse_args()
    try:
        report=collect_yesterday(args.directory);print(json.dumps({'date':report['date'],'history_files':len(report['files']),'failures':len(report['failures'])}))
        if report['failures']:parser.exit(1,'完了結果の取得に失敗したレースがあります。モデルは更新しません。\n')
    except Exception as error:parser.exit(1,str(error)+'\n')
