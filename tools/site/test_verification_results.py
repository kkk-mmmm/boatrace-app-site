import hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from verification_results import payouts,export_results


class VerificationResultsTests(unittest.TestCase):
    def test_official_payouts_use_detailed_race_and_venue(self):
        text=(Path(__file__).parent/'fixtures/annual-results.txt').read_text()
        values=payouts(text)
        self.assertEqual(values[('23',1)],{'combo':'2-4-1','yen':17520})
        self.assertEqual(values[('23',2)],{'combo':'4-3-5','yen':3690})
        self.assertEqual(len(values),2)
        self.assertIsNone(payouts('23KBGN\n 1R 予選 H1800m\n ３連単 1-2-3 1000 人気 1\n ３連単 1-3-2 1000 人気 1')[('23',1)])

    def test_only_saved_days_are_exported_once_without_network(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);annual=root/'annual';store=root/'store'
            (annual/'archives').mkdir(parents=True);(annual/'days').mkdir()
            (store/'snapshots/2026-10-21').mkdir(parents=True)
            data=b'official fixture';source={'date':'2026-10-21','url':'https://www1.mbrace.or.jp/od2/K/202610/k261021.lzh','sha256':hashlib.sha256(data).hexdigest()}
            (annual/'manifest.json').write_text(json.dumps({'sources':[source]}))
            (annual/'archives/k261021.lzh').write_bytes(data)
            race={'date':'2026-10-21','venue_code':'23','race_no':1,'entries':[]}
            (annual/'days/2026-10-21.json').write_text(json.dumps([race]))
            text=(Path(__file__).parent/'fixtures/annual-results.txt').read_text()
            with patch('verification_results.unpack',return_value=text):
                self.assertEqual(export_results(annual,store)['saved_days'],1)
                saved=(store/'results/2026-10-21.json').read_bytes()
                self.assertEqual(json.loads(saved)[0]['payout']['yen'],17520)
                self.assertEqual(export_results(annual,store)['existing_days'],1)
                self.assertEqual((store/'results/2026-10-21.json').read_bytes(),saved)
                (store/'results/2026-10-21.json').unlink()
                (annual/'archives/k261021.lzh').write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError,'hash mismatch'):
                    export_results(annual,store)


if __name__=='__main__':unittest.main()
