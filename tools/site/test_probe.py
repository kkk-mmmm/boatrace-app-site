import unittest
from unittest.mock import Mock, patch
from email.message import Message
import http.client
import probe_official as probe
from probe_official import Structure


class StructureTests(unittest.TestCase):
    def test_preserves_table_identity_spans_and_missing_values(self):
        parser = Structure()
        parser.feed('<table class="races"><tr><td rowspan="4">1</td><td>F0<br>L0<br>—</td>'
                    '<td><a href="/owpc/pc/race/raceresult?hd=20300101">選手</a></td></tr></table>')
        self.assertEqual(parser.tables[0]['attrs']['class'], 'races')
        self.assertEqual(parser.tables[0]['rows'][0][0]['attrs']['rowspan'], '4')
        self.assertEqual(parser.tables[0]['rows'][0][1]['text'], 'F0\nL0\n—')
        self.assertEqual(parser.links[0]['text'], '選手')
        self.assertTrue(parser.links[0]['url'].startswith('https://www.boatrace.jp/'))


class TransportTests(unittest.TestCase):
    def setUp(self):
        probe.close_transport()
        self.addCleanup(probe.close_transport)

    def response(self, body=b'official', status=200, close=False, location=None):
        headers=Message();headers['Content-Type']='text/html; charset=utf-8'
        if location:headers['Location']=location
        return Mock(read=Mock(return_value=body),headers=headers,status=status,reason='test',will_close=close)

    @patch.object(probe,'getproxies',return_value={})
    @patch.object(probe.http.client,'HTTPSConnection')
    def test_two_reads_reuse_tls_connection(self, factory, _):
        connection=factory.return_value
        connection.getresponse.side_effect=[self.response(),self.response('日本語'.encode())]
        self.assertEqual(probe.fetch(probe.ORIGIN+'/a')[0],'official')
        self.assertEqual(probe.fetch(probe.ORIGIN+'/b?hd=20261022')[0],'日本語')
        factory.assert_called_once_with('www.boatrace.jp',timeout=25)
        self.assertEqual(connection.request.call_args.args[:2],('GET','/b?hd=20261022'))

    @patch.object(probe.http.client,'HTTPSConnection')
    def test_server_close_and_stale_socket_reconnect(self, factory):
        first,second,third=Mock(),Mock(),Mock();factory.side_effect=[first,second,third]
        first.getresponse.return_value=self.response(close=True)
        second.request.side_effect=http.client.RemoteDisconnected()
        third.getresponse.return_value=self.response()
        with patch.object(probe.time,'sleep'):
            probe.fetch_persistent(probe.ORIGIN+'/a');probe.fetch_persistent(probe.ORIGIN+'/b')
        self.assertEqual(factory.call_count,3);first.close.assert_called_once();second.close.assert_called_once()

    @patch.object(probe.http.client,'HTTPSConnection')
    def test_redirect_cannot_leave_official_https_host(self, factory):
        factory.return_value.getresponse.return_value=self.response(status=302,location='https://example.com/')
        with patch.object(probe.time,'sleep'):
            with self.assertRaisesRegex(ValueError,'リダイレクト'):probe.fetch_persistent(probe.ORIGIN+'/a')
        self.assertEqual(factory.return_value.request.call_count,1)

    @patch.object(probe.http.client,'HTTPSConnection')
    def test_oversize_or_http_error_does_not_return_data(self, factory):
        factory.return_value.getresponse.return_value=self.response(b'x'*(3*1024*1024+1))
        with self.assertRaisesRegex(ValueError,'大きすぎ'):probe.fetch_persistent(probe.ORIGIN+'/a')
        factory.return_value.getresponse.return_value=self.response(status=403)
        with self.assertRaises(probe.HTTPError):probe.fetch_persistent(probe.ORIGIN+'/a')

    @patch.object(probe,'urlopen')
    @patch.object(probe,'getproxies',return_value={'https':'http://proxy.invalid'})
    def test_managed_proxy_preserves_urllib_transport(self, _, opener):
        response=opener.return_value.__enter__.return_value
        response.url=probe.ORIGIN+'/a';response.read.return_value=b'official';response.headers=self.response().headers
        self.assertEqual(probe.fetch(probe.ORIGIN+'/a')[0],'official');opener.assert_called_once()

    def test_rejects_plain_http_and_other_hosts(self):
        for url in ['http://www.boatrace.jp/a','https://example.com/a','https://www.boatrace.jp:444/a']:
            with self.assertRaises(ValueError):probe.fetch(url)


if __name__ == '__main__':
    unittest.main()
