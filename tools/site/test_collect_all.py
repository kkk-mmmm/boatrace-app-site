import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import unittest
from unittest.mock import patch
from collect_all import collect_all


class BatchTests(unittest.TestCase):
    def setUp(self):
        printer=patch('collect_all.print');printer.start();self.addCleanup(printer.stop)

    def test_one_index_shared_across_24_venues_and_failure_isolated(self):
        seen=[];lock=threading.Lock();index={'date':'2030-01-01'}
        def acquire(destination, code, shared, gate):
            self.assertIs(shared,index);self.assertEqual(gate.interval,.25)
            with lock:seen.append(code)
            if code=='06':raise ValueError('unavailable')
            return {'date':index['date'],'venue_code':code,'meeting_status':'NO_MEETING','races':[]}
        with tempfile.TemporaryDirectory() as tmp,patch('collect_all.collect_index',return_value=index) as planner,patch('collect_all.collect',side_effect=acquire),patch('collect_all.subprocess.run',return_value=SimpleNamespace(returncode=0,stderr='')) as node:
            result=collect_all(Path(tmp)/'cache',Path(tmp)/'staging')
            self.assertEqual(planner.call_count,1);self.assertEqual(len(set(seen)),24)
            self.assertEqual(result['failed_venues'],1);self.assertEqual(node.call_count,48)
            self.assertEqual(json.loads((Path(tmp)/'cache/incoming-06.json').read_text())['error'],'unavailable')

    def test_at_most_eight_venue_workers(self):
        barrier=threading.Barrier(8);lock=threading.Lock();active=[0];peak=[0]
        def acquire(destination, code, shared, gate):
            with lock:active[0]+=1;peak[0]=max(peak[0],active[0])
            barrier.wait(timeout=5)
            with lock:active[0]-=1
            return {'date':'2030-01-01','meeting_status':'NO_MEETING','races':[]}
        with tempfile.TemporaryDirectory() as tmp,patch('collect_all.collect_index',return_value={'date':'2030-01-01'}),patch('collect_all.collect',side_effect=acquire),patch('collect_all.subprocess.run',return_value=SimpleNamespace(returncode=0,stderr='')):
            collect_all(Path(tmp)/'cache',Path(tmp)/'staging',[{'code':f'{n:02}'} for n in range(1,17)])
        self.assertEqual(peak[0],8)

    def test_update_failure_projects_failed_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp,patch('collect_all.collect_index',return_value={'date':'2030-01-01'}),patch('collect_all.collect',return_value={'date':'2030-01-01','races':[]}),patch('collect_all.subprocess.run',side_effect=[SimpleNamespace(returncode=1,stderr='bad'),SimpleNamespace(returncode=0,stderr='')]) as node:
            report=collect_all(Path(tmp)/'cache',Path(tmp)/'staging',[{'code':'06'}])
            self.assertEqual(report['failed_venues'],1);self.assertEqual(node.call_args.args[0][-1],'--failed')

    def test_public_race_without_odds_is_counted_as_missing(self):
        def node(command, **_):
            if command[1]=='site/snapshot.mjs':
                Path(command[3]).write_text(json.dumps({'update':{'status':'OK'},'races':[{'items':[],'odds':None}]}))
            return SimpleNamespace(returncode=0,stderr='')
        with tempfile.TemporaryDirectory() as tmp,patch('collect_all.collect_index',return_value={'date':'2030-01-01'}),patch('collect_all.collect',return_value={'date':'2030-01-01','races':[]}),patch('collect_all.subprocess.run',side_effect=node):
            report=collect_all(Path(tmp)/'cache',Path(tmp)/'staging',[{'code':'06'}])
            self.assertEqual(report['failed_venues'],0);self.assertEqual(report['venues'][0]['races_with_odds'],0)


if __name__=='__main__':unittest.main()
