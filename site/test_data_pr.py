import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('data_pr', Path(__file__).with_name('merge-data-pr.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DataPrSecurity(unittest.TestCase):
    def test_daily_and_monthly_data_only(self):
        self.assertTrue(module.allowed_changes(['models/annual/current.json']))
        self.assertTrue(module.allowed_changes(['models/exhibition-st/records.json',
            'models/monthly-candidates/2026-10/previous-coefficients.json',
            'site/releases.json', '.github/publication.json']))

    def test_runtime_workflow_and_unknown_files_are_not_automatically_merged(self):
        for file in ['.github/workflows/main-pr-checks.yml', 'site/public/app.mjs',
                     'models/annual/new-script.mjs', 'models/monthly-candidates/2026-10/../../worker.mjs',
                     'models/monthly-candidates/2026-10/current.json/evil', 'README.md']:
            with self.subTest(file=file):
                self.assertFalse(module.allowed_changes(['models/annual/current.json', file]))
        self.assertFalse(module.allowed_changes([]))


if __name__ == '__main__':
    unittest.main()
