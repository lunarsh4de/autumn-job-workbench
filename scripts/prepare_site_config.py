"""Embed public account settings and version local script/style URLs for Pages."""
import base64
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit


def prepare(site: Path, url: str, key: str, version: str) -> None:
    url, key = url.strip(), key.strip()
    if bool(url) != bool(key):
        raise ValueError("Configure both public Supabase variables, or leave both empty.")
    if not re.fullmatch(r"[a-f0-9]{40}", version):
        raise ValueError("Use a full Git commit SHA for the static asset version.")
    if url:
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or not parsed.hostname or not parsed.hostname.endswith('.supabase.co') or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/') or parsed.port not in (None, 443):
            raise ValueError("PUBLIC_SUPABASE_URL must be an HTTPS *.supabase.co project URL without credentials, query or path.")
        if not key.startswith('sb_publishable_'):
            try:
                parts = key.split('.')
                claims = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
                allowed = len(parts) == 3 and claims.get('role') == 'anon'
            except Exception:
                allowed = False
            if not allowed:
                raise ValueError("Only a Supabase publishable/anon public key may be embedded in the site.")
    config = {'supabaseUrl': url, 'publishableKey': key, 'redirectUrl': 'https://lunarsh4de.github.io/autumn-job-workbench/'}
    (site / 'account-config.js').write_text('globalThis.WorkbenchAccountConfig = Object.freeze(' + json.dumps(config) + ');\n', encoding='utf-8')
    html = (site / 'index.html').read_text(encoding='utf-8')

    def version_asset(match):
        prefix, reference, quote = match.groups()
        if reference.startswith(('https:', 'http:', '//', 'data:', '#', 'mailto:')):
            return match.group(0)
        asset = reference.split('?', 1)[0].split('#', 1)[0]
        if not asset.endswith(('.js', '.css')):
            return match.group(0)
        return prefix + asset + '?v=' + version + quote

    html = re.sub(r'''((?:src|href)=["'])([^"']+)(["'])''', version_asset, html)
    for reference in re.findall(r'''(?:src|href)=["']([^"']+)["']''', html):
        if reference.startswith(('https:', 'http:', '//', '#', 'data:', 'mailto:')):
            continue
        asset = reference.split('?', 1)[0].split('#', 1)[0]
        if asset and not (site / asset).is_file():
            raise ValueError('Missing static asset: ' + asset)
    (site / 'index.html').write_text(html, encoding='utf-8')
    print('Static assets verified; account configuration ' + ('enabled.' if url else 'disabled (public variables absent).'))


if __name__ == '__main__':
    prepare(Path('_site'), os.environ.get('PUBLIC_SUPABASE_URL', ''), os.environ.get('PUBLIC_SUPABASE_PUBLISHABLE_KEY', ''), os.environ.get('GITHUB_SHA', ''))
