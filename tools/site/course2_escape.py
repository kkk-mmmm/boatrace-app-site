"""Observed 2-course escape support rates; outcomes, not causal assistance."""
import argparse,json
from datetime import date,timedelta
from pathlib import Path


def aggregate(races, through):
    end=date.fromisoformat(through);start=end-timedelta(days=364)
    lane2={'n':0,'one_wins':0,'players':{}}
    players={};population={'n':0,'escape':0,'second_sashi':0};seen=set()
    for race in races:
        day=date.fromisoformat(race['date'])
        if not start<=day<=end:continue
        key=(race['date'],race['venue_code'],race['race_no'])
        if key in seen:raise ValueError('Duplicate race')
        seen.add(key);entries=race.get('entries',[])
        if (len(entries)==6 and {e.get('lane') for e in entries}==set(range(1,7))
                and {e.get('finish') for e in entries}==set(range(1,7))
                and all(type(e.get('lane')) is int and type(e.get('finish')) is int and e.get('finish_status')=='NORMAL' for e in entries)):
            first=next(e for e in entries if e['lane']==1)
            second=next(e for e in entries if e['lane']==2)
            identity=str(second.get('racer_id',''))
            if len(identity)==4 and identity.isascii() and identity.isdigit():
                player=lane2['players'].setdefault(identity,{'n':0,'one_wins':0})
                for stats in (lane2,player):
                    stats['n']+=1;stats['one_wins']+=int(first['finish']==1)
        if len(entries)!=6 or {e.get('actual_course') for e in entries}!=set(range(1,7)):continue
        if {e.get('finish') for e in entries}!=set(range(1,7)) or any(e.get('finish_status')!='NORMAL' or e.get('actual_st_status')!='NORMAL' for e in entries):continue
        one=next(e for e in entries if e['actual_course']==1)
        two=next(e for e in entries if e['actual_course']==2)
        if one.get('lane')!=1:continue
        identity=str(two.get('racer_id',''))
        if len(identity)!=4 or not identity.isdigit():continue
        escaped=one['finish']==1 and race.get('kimarite')=='逃げ'
        sashi=two['finish']==1 and race.get('kimarite')=='差し'
        player=players.setdefault(identity,{'n':0,'escape':0,'second_sashi':0})
        for stats in (player,population):
            stats['n']+=1;stats['escape']+=int(escaped);stats['second_sashi']+=int(sashi)
    prior=population['escape']/population['n'] if population['n'] else None
    for stats in players.values():
        stats['escape_rate']=stats['escape']/stats['n']
        stats['smoothed_escape_rate']=(stats['escape']+20*prior)/(stats['n']+20)
    return {'schema_version':1,'lane2_support':lane2,'lane2_definition':'枠番2号艇の選手ごとに1号艇が1着となった割合。正常完走6艇レース。実進入や決まり手で絞らない。','from':str(start),'through':str(end),'population':population,'players':players,
        'definition':'実進入2コースの選手ごとに、1号艇が実進入1コースから逃げで勝った割合。正常6艇レースだけ。因果的なアシストや差しの試行率ではない。'}


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('races',type=Path);p.add_argument('--through',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=aggregate(json.loads(a.races.read_text()),a.through);a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
