import unittest
from check_search_delivery import inspect_sitemap, diagnose
class CheckSearchDelivery(unittest.TestCase):
    def test_xml_validation(self):
        good = b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://funeyomi.win/</loc></url></urlset>'
        self.assertEqual(inspect_sitemap(good), ['https://funeyomi.win/'])
        for bad in [b'<html>failure</html>',good.replace(b'funeyomi.win',b'other.example'),good.replace(b'<url>',b'<url><loc>https://funeyomi.win/</loc>')]:
            with self.assertRaises(ValueError):
                inspect_sitemap(bad)
    def test_network_failure_is_not_success(self):
        def fail(*args, **kwargs):
            raise OSError('Network unavailable')
        report = diagnose(fail)
        self.assertFalse(report['ok'])
        self.assertEqual(len(report['checks']),6)
        self.assertTrue(all(c['error_type']=='OSError' for c in report['checks']))
if __name__=='__main__': unittest.main()
