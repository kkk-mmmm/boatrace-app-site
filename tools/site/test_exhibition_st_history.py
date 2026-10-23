import unittest
from datetime import date
from exhibition_st_history import aggregate,collect_recent,daily
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory
class GapTests(unittest.TestCase):
 def test_signed_gap_dedup_exclusion_and_window(self):
  entry={'racer_id':'1234','lane':1,'exhibition_st':-.03,'exhibition_st_status':'F','actual_st':.1,'actual_st_status':'NORMAL'}
  r={'date':'2026-10-21','venue_code':'01','race_no':1,'entries':[entry]}
  bad={**r,'race_no':2,'entries':[{**entry,'actual_st_status':'F'}]}
  old={**r,'date':'2025-01-01'};future={**r,'date':'2026-10-23'}
  p,rows=aggregate([r,r,bad,old,future],date(2026,10,22));s=p['players']['1234'];self.assertEqual(s['n'],1);self.assertAlmostEqual(s['sum'],.13);self.assertAlmostEqual(s['sum_squares'],.13**2);self.assertEqual(p['paired_starts'],1)
  with self.assertRaises(ValueError):aggregate([r,{**r,'entries':[{**entry,'actual_st':.2}]}],date(2026,10,22))
 def test_course_history_distinguishes_exhibition_from_actual_and_does_not_infer_lane(self):
  e={'racer_id':'1234','lane':1,'exhibition_st':.1,'exhibition_st_status':'NORMAL','actual_st':.2,'actual_st_status':'NORMAL'}
  r={'date':'2026-10-21','venue_code':'01','race_no':1,'entries':[{**e,'exhibition_course':2,'actual_course':3}]}
  absent={**r,'race_no':2,'entries':[e]};invalid={**r,'race_no':3,'entries':[{**e,'exhibition_course':True,'actual_course':7}]}
  p,_=aggregate([r,absent,invalid],date(2026,10,22));s=p['players']['1234']
  self.assertEqual(s['n'],3);self.assertEqual(set(s['actual_courses']),{'3'});self.assertEqual(set(s['exhibition_courses']),{'2'})
  self.assertEqual(s['actual_courses']['3']['n'],1);self.assertAlmostEqual(s['actual_courses']['3']['sum'],.1)
  enriched,rows=aggregate([{**r,'entries':[e]},r],date(2026,10,22));self.assertEqual(enriched['paired_starts'],1);self.assertEqual(enriched['players']['1234']['actual_courses']['3']['n'],1)
  self.assertEqual(rows[0]['entries'][0]['actual_course'],3)
  with self.assertRaises(ValueError):aggregate([r,{**r,'entries':[{**e,'actual_course':4}]}],date(2026,10,22))
 def test_catchup_selects_recent_missing_days_with_a_budget_and_skips_confirmed_rows(self):
  e={'racer_id':'1234','lane':1,'exhibition_st':.1,'exhibition_st_status':'NORMAL','actual_st':.2,'actual_st_status':'NORMAL'}
  def race(day,n=1):return {'date':day,'venue_code':'01','race_no':n,'entries':[e]}
  known=race('2026-10-22');pending=[known,race('2026-10-22',2),race('2026-10-21'),race('2026-10-20'),race('2026-10-01'),race('2026-10-23')]
  sources=[{'date':day,'sha256':'a'*64} for day in ['2026-10-20','2026-10-21','2026-10-22']]
  calls=[]
  def acquire(rows,through,cache,source):calls.append((str(through),[r['race_no'] for r in rows],source['date']));return rows,[]
  with patch('exhibition_st_history.daily',side_effect=acquire):
   rows,failures,meta=collect_recent(pending,[known],date(2026,10,22),Path('/unused'),sources,max_races=2)
  self.assertEqual(calls,[('2026-10-22',[2],'2026-10-22'),('2026-10-21',[1],'2026-10-21')]);self.assertEqual(len(rows),2);self.assertEqual(failures,[]);self.assertEqual(meta['deferred_races'],1)
  with patch('exhibition_st_history.daily') as acquire:
   with self.assertRaises(ValueError):collect_recent(pending,[known],date(2026,10,22),Path('/unused'),[],max_races=2)
   acquire.assert_not_called()
  with self.assertRaises(ValueError):collect_recent([],[],date(2026,10,22),Path('/unused'),[],lookback_days=31)
 def test_course_values_are_retained_only_after_identity_check_and_bad_cache_is_retryable(self):
  entry={'racer_id':'1234','lane':1,'actual_st':.2,'actual_st_status':'NORMAL','actual_course':3}
  race={'date':'2026-10-22','venue_code':'01','race_no':1,'entries':[entry]}
  page='<table><tr><td class="is-boatColor1">1</td><td><a href="/?toban=1234">選手</a></td></tr></table>'
  shown={1:{'exhibition_st':.1,'exhibition_st_status':'NORMAL','exhibition_course':2}}
  def fetch(url):return ('User-agent: *\nAllow: /' if url.endswith('robots.txt') else page, {})
  with TemporaryDirectory() as directory,patch('exhibition_st_history.fetch',side_effect=fetch),patch('exhibition_st_history.exhibition',return_value=shown),patch('exhibition_st_history.time.sleep'):
   cache=Path(directory);rows,failures=daily([race],date(2026,10,22),cache,{'sha256':'a'*64})
   self.assertEqual(failures,[]);self.assertEqual(rows[0]['entries'][0]['actual_course'],3);self.assertEqual(rows[0]['entries'][0]['exhibition_course'],2)
   bad={**race,'entries':[{**entry,'racer_id':'9999'}]};rows,failures=daily([bad],date(2026,10,22),cache,{})
   self.assertEqual(rows,[]);self.assertEqual(len(failures),1);self.assertFalse((cache/'2026-10-22-01-1.html').exists())
if __name__=='__main__':unittest.main()
