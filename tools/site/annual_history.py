"""Official daily result archives: one file per day, not three pages per race."""
import argparse,ctypes,ctypes.util,hashlib,json,time,threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date,timedelta
from pathlib import Path
from urllib.request import Request,urlopen


def unpack(data):
    lib=ctypes.CDLL(ctypes.util.find_library('archive') or 'libarchive.so.13')
    lib.archive_read_new.restype=ctypes.c_void_p
    for name in ['archive_read_support_filter_all','archive_read_support_format_all','archive_read_free']:
        getattr(lib,name).argtypes=[ctypes.c_void_p]
    lib.archive_read_open_memory.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t]
    lib.archive_read_next_header.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_void_p)]
    lib.archive_read_data.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t]
    lib.archive_read_data.restype=ctypes.c_ssize_t
    handle=lib.archive_read_new();buffer=ctypes.create_string_buffer(data);output=[]
    try:
        lib.archive_read_support_filter_all(handle);lib.archive_read_support_format_all(handle)
        if lib.archive_read_open_memory(handle,buffer,len(data))!=0:raise ValueError('履歴アーカイブを開けません')
        entry=ctypes.c_void_p()
        while lib.archive_read_next_header(handle,ctypes.byref(entry))==0:
            chunks=[];total=0
            while True:
                block=ctypes.create_string_buffer(65536);size=lib.archive_read_data(handle,block,len(block))
                if size<0:raise ValueError('履歴アーカイブが壊れています')
                if not size:break
                total+=size
                if total>16*1024*1024:raise ValueError('履歴の展開上限超過')
                chunks.append(block.raw[:size])
            output.append(b''.join(chunks).decode('cp932'))
        if not output:raise ValueError('履歴アーカイブが空です')
        return '\n'.join(output)
    finally:lib.archive_read_free(handle)


_gate=threading.Lock()
_next_start=0

def download(day,folder):
    key=day.strftime('%y%m%d');url=f'https://www1.mbrace.or.jp/od2/K/{day:%Y%m}/k{key}.lzh'
    folder.mkdir(parents=True,exist_ok=True);file=folder/f'k{key}.lzh'
    if not file.exists():
        global _next_start
        with _gate:
            delay=max(0,_next_start-time.monotonic());_next_start=max(time.monotonic(),_next_start)+1
        if delay:time.sleep(delay)
        with urlopen(Request(url,headers={'User-Agent':'boatrace-app/0.3 (+https://github.com/kkk-mmmm/boatrace-app-site)'}),timeout=30) as r:data=r.read(2*1024*1024)
        if len(data)>=2*1024*1024:raise ValueError('履歴応答の上限超過')
        unpack(data);file.write_bytes(data)
    data=file.read_bytes();return unpack(data),{'url':url,'sha256':hashlib.sha256(data).hexdigest()}



def parse_results(text,day,*,include_environment=False):
    import re,unicodedata
    races=[];errors=[];venue=None;meeting_day=None;race=None
    def flush():
        nonlocal race
        if race is None:return
        if len(race['entries'])==6 and len({e['lane'] for e in race['entries']})==6 and len({e['racer_id'] for e in race['entries']})==6:
            normal=all(e['actual_st_status']=='NORMAL' and e['actual_st'] is not None for e in race['entries'])
            for e in race['entries']:
                e['start_rank']=(1+sum(x['actual_st']<e['actual_st'] for x in race['entries'])+(sum(x['actual_st']==e['actual_st'] for x in race['entries'])-1)/2) if normal else None
            races.append(race)
        elif race['entries']:errors.append({'venue_code':venue,'race_no':race['race_no'],'reason':'結果行を6艇分確認できません'})
        race=None
    for raw in text.splitlines():
        line=unicodedata.normalize('NFKC',raw)
        m=re.match(r'^(\d{2})KBGN',line)
        if m:flush();venue=m[1];meeting_day=None;continue
        if re.match(r'^\d{2}KEND',line):flush();venue=None;continue
        m=re.search(r'第\s*(\d+)日',line)
        if m and race is None:meeting_day=int(m[1])
        m=re.match(r'^\s*(\d{1,2})R\s+(.+?)H\d{3,4}m',line)
        if m:
            flush()
            if venue is None:raise ValueError('結果に場番号がありません')
            label=m[2].strip();phase='SEMI_FINAL' if '準優' in label else 'FINAL' if '優勝戦' in label else 'QUALIFYING' if '予選' in label else 'OTHER'
            race={'date':day.isoformat(),'venue_code':venue,'race_no':int(m[1]),'context':{'meeting_day':meeting_day,'phase':phase},'kimarite':None,'entries':[]}
            weather=re.search(r'風\s*([^\s]+)\s+(\d+(?:\.\d+)?)m\s+波\s*(\d+(?:\.\d+)?)cm',line)
            if include_environment and weather:race['environment']={'kind':'RESULT_REPORTED','wind_direction_key':'COMPASS:'+weather[1],'wind_speed_mps':float(weather[2]),'wave_height_cm':float(weather[3]),'fetched_at':None}
            continue
        if race is None:continue
        if 'スタートタイミング' in line or 'レースタイム' in line:
            m=re.search(r'(まくり差し|逃げ|差し|まくり|抜き|恵まれ)',line)
            if m:race['kimarite']=m[1]
        m=re.match(r'^\s*(\d{2}|[A-Z]\d?)\s+([1-6])\s+(\d{4})\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(\d\.\d{2})\s+(?:([1-6])\s+)?([FL]?)\s*(\d?\.\d{2}|\.)',line)
        if not m:
            abnormal=re.match(r'^\s*([A-Z]\d?)\s+([1-6])\s+(\d{4})\s+',line)
            if abnormal:race['entries'].append({'lane':int(abnormal[2]),'racer_id':abnormal[3],'finish':None,'finish_status':abnormal[1],'actual_course':None,'actual_st':None,'actual_st_status':abnormal[1][0],'exhibition_time':None,'start_rank':None})
            continue
        status='NORMAL' if m[1] in {'01','02','03','04','05','06'} else m[1]
        st=float(m[10]) if m[10]!='.' else None
        flag=m[9] or ('F' if status.startswith('F') else 'L' if status.startswith('L') else 'NORMAL')
        race['entries'].append({'lane':int(m[2]),'racer_id':m[3],'finish':int(m[1]) if status=='NORMAL' else None,'finish_status':status,
            'actual_course':int(m[8]) if m[8] else None,'actual_st':st if flag=='NORMAL' else None,'actual_st_status':flag,
            'exhibition_time':float(m[7]),'start_rank':None})
    flush()
    header_dates=set(re.findall(r'(20\d{2})/\s*(\d{1,2})/\s*(\d{1,2})',text))
    if races and (not header_dates or any(date(int(y),int(m),int(d))!=day for y,m,d in header_dates)):raise ValueError('結果アーカイブの日付が一致しません')
    keys=[(r['venue_code'],r['race_no']) for r in races]
    if len(set(keys))!=len(keys):raise ValueError('結果のレースが重複しています')
    return races,errors


def acquire_year(end,folder):
    start=end-timedelta(days=364);records=[];sources=[];failures=[];excluded=[]
    # Overlap TLS latency without exceeding one new archive request/second.
    def prefetch(offset):
        try:download(start+timedelta(days=offset),folder/'archives')
        except Exception:pass
    with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(prefetch,range(365)))
    for offset in range(365):
        day=start+timedelta(days=offset)
        try:
            text,source=download(day,folder/'archives');races,errors=parse_results(text,day,include_environment=True)
            excluded.extend({'date':str(day),**error} for error in errors)
            destination=folder/'days'/f'{day}.json';destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_text(json.dumps(races,ensure_ascii=False,separators=(',',':')))
            records.extend(races);sources.append({'date':str(day),**source,'races':len(races)})
        except Exception as e:failures.append({'date':str(day),'error':str(e)})
        if offset%30==0:print('::notice title=Annual history progress::'+json.dumps({'days':offset+1,'races':len(records),'failed_days':len(failures)}),flush=True)

    report={'schema_version':3,'from':str(start),'through':str(end),'days':len(sources),'races':len(records),'sources':sources,'failures':failures,'excluded_races':excluded}
    folder.mkdir(parents=True,exist_ok=True);(folder/'manifest.json').write_text(json.dumps(report,ensure_ascii=False,separators=(',',':')))
    print('::notice title=Annual archive diagnostics::'+json.dumps({'failed_days':len(failures),'failure_examples':failures[:4],'excluded_races':len(excluded),'excluded_examples':excluded[:4]},ensure_ascii=False),flush=True)
    if failures:raise ValueError(f'1年履歴に欠損日があります: {json.dumps(failures[:4],ensure_ascii=False)}')
    if len(excluded)>max(10,len(records)*.02):raise ValueError('解析不能レースが2%を超えたためモデル作成を停止しました')
    (folder/'races.json').write_text(json.dumps(records,ensure_ascii=False,separators=(',',':')))
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--probe',type=date.fromisoformat);p.add_argument('--end',type=date.fromisoformat);p.add_argument('--directory',type=Path,default=Path('site/cache/annual-history'));args=p.parse_args()
    if args.probe:
        text,source=download(args.probe,args.directory);races,errors=parse_results(text,args.probe)
        print('::notice title=Annual parser probe::'+json.dumps({'races':len(races),'errors':errors[:5],'sample':races[:2]},ensure_ascii=False))
    elif args.end:
        report=acquire_year(args.end,args.directory);print('::notice title=Annual history coverage::'+json.dumps({k:report[k] for k in ['from','through','days','races']}))
