import base64
import tempfile
import unittest
from pathlib import Path
from prepare_site_config import prepare


class PrepareSiteConfigTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.site = Path(self.directory.name)
        for name in ['account-config.js', 'account.js', 'account-data.js', 'app.css']:
            (self.site / name).touch()
        (self.site / 'vendor').mkdir()
        (self.site / 'vendor/supabase.min.js').touch()
        (self.site / 'index.html').write_text('<link href="app.css?v=old"><script src="vendor/supabase.min.js"></script><script src="account-config.js"></script><script src="account-data.js"></script><script src="account.js?v=old"></script><a href="https://example.com/remote.js">remote</a>', encoding='utf-8')
        self.version = 'a' * 40

    def test_every_local_dependency_gets_the_same_commit_version(self):
        prepare(self.site, 'https://fixture.supabase.co', 'sb_publishable_fixture', self.version)
        html = (self.site / 'index.html').read_text(encoding='utf-8')
        for name in ['app.css', 'vendor/supabase.min.js', 'account-config.js', 'account-data.js', 'account.js']:
            self.assertIn(name + '?v=' + self.version, html)
        self.assertIn('https://example.com/remote.js', html)
        self.assertNotIn('v=old', html)

    def test_blank_configuration_remains_supported(self):
        prepare(self.site, '', '', self.version)
        self.assertIn('"supabaseUrl": ""', (self.site / 'account-config.js').read_text())

    def test_secret_and_service_role_keys_are_rejected(self):
        claims = base64.urlsafe_b64encode(b'{"role":"service_role"}').decode().rstrip('=')
        for key in ['sb_secret_fixture', 'header.' + claims + '.signature']:
            with self.assertRaises(ValueError):
                prepare(self.site, 'https://fixture.supabase.co', key, self.version)

    def test_incomplete_or_untrusted_configuration_is_rejected(self):
        for url, key in [('https://fixture.supabase.co', ''), ('https://fixture.supabase.co.evil.test', 'sb_publishable_fixture')]:
            with self.assertRaises(ValueError):
                prepare(self.site, url, key, self.version)


if __name__ == '__main__':
    unittest.main()
