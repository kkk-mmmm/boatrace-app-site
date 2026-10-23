import unittest
from datetime import date
from exhibition_st_history import aggregate
class GapTests(unittest.TestCase):
 def test_signed_gap_dedup_exclusion_and_window(self):
  entry={'racer_id':'1234','lane':1,'exhibition_st':-.03,'exhibition_st_status':'F','actual_st':.1,'actual_st_status':'NORMAL'}
  r={'date':'2026-10-21','venue_code':'01','race_no':1,'entries':[entry]}
  bad={**r,'race_no':2,'entries':[{**entry,'actual_st_status':'F'}]}
  old={**r,'date':'2025-01-01'};future={**r,'date':'2026-10-23'}
  p,rows=aggregate([r,r,bad,old,future],date(2026,10,22));s=p['players']['1234'];self.assertEqual(s['n'],1);self.assertAlmostEqual(s['sum'],.13);self.assertAlmostEqual(s['sum_squares'],.13**2);self.assertEqual(p['paired_starts'],1)
  with self.assertRaises(ValueError):aggregate([r,{**r,'entries':[{**entry,'actual_st':.2}]}],date(2026,10,22))
if __name__=='__main__':unittest.main()
