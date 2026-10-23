"""Export only previously archived prediction days using already downloaded archives.
No network access; preserves the result source hash and official trifecta payout.
"""
import argparse, hashlib, json, re, unicodedata
from pathlib import Path
from annual_history import unpack, parse_results
from datetime import date, datetime, timezone, timedelta


def payouts(text):
    venue = None
    race = None
    values = {}
    for raw in text.splitlines():
        line = unicodedata.normalize('NFKC', raw)
        match = re.match(r'^(\d{2})KBGN', line)
        if match:
            venue = match[1]
            race = None
            continue
        if re.match(r'^\d{2}KEND', line):
            venue = race = None
            continue
        match = re.match(r'^\s*(\d{1,2})R\s+.+?H\d{3,4}m', line)
        if match:
            race = int(match[1])
        match = re.match(r'^\s*3連単\s+([1-6]-[1-6]-[1-6])\s+([\d,]+)(?:\s|$)', line)
        if match and venue and race:
            key = (venue, race)
            value = {'combo': match[1], 'yen': int(match[2].replace(',', ''))}
            if key in values and values[key] != value:
                # Dead heats / multiple settlements must not become a single payout.
                values[key] = None
            elif key not in values:
                values[key] = value
    return values


def export_results(annual_directory, verification_directory):
    manifest = json.loads((annual_directory / 'manifest.json').read_text())
    sources = {s['date']: s for s in manifest['sources']}
    snapshot_root = verification_directory / 'snapshots'
    days = sorted(p.name for p in snapshot_root.iterdir() if p.is_dir()) if snapshot_root.exists() else []
    saved = 0
    existing = 0
    missing = []
    today = datetime.now(timezone(timedelta(hours=9))).date().isoformat()
    for day in days:
        # Directory names are untrusted inputs as well as result dates.
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) or date.fromisoformat(day).isoformat() != day:
            raise ValueError('Invalid saved prediction day')
        if day >= today:
            continue
        destination = verification_directory / 'results' / f'{day}.json'
        digest_file = destination.with_suffix('.sha256')
        if destination.exists():
            if not digest_file.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != digest_file.read_text().strip():
                raise ValueError('Stored result integrity mismatch: ' + day)
        source = sources.get(day)
        archive = annual_directory / 'archives' / ('k' + day[2:].replace('-', '') + '.lzh')
        if not source or not archive.exists():
            if destination.exists():
                existing += 1
            else:
                missing.append(day)
            continue
        data = archive.read_bytes()
        if hashlib.sha256(data).hexdigest() != source['sha256']:
            raise ValueError('Official result archive hash mismatch: ' + day)
        text = unpack(data)
        amounts = payouts(text)
        # Reparse the hash-verified archive; days/*.json is an unrelated cache.
        records, errors = parse_results(text, date.fromisoformat(day))
        if errors:
            raise ValueError('Official result parsing failed: ' + day)
        for race in records:
            race['source'] = {'url': source['url'], 'sha256': source['sha256']}
            amount = amounts.get((race['venue_code'], race['race_no']))
            race['payout'] = {**amount, 'source_url': source['url'], 'source_sha256': source['sha256']} if amount else None
        serialized = json.dumps(records, ensure_ascii=False, separators=(',', ':')).encode()
        if destination.exists():
            if destination.read_bytes() != serialized:
                raise ValueError('Official result changed after first save: ' + day)
            existing += 1
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open('xb') as output:
            output.write(serialized)
        with digest_file.open('x') as output:
            output.write(hashlib.sha256(serialized).hexdigest() + '\n')
        saved += 1
    return {'saved_days': saved, 'existing_days': existing, 'unavailable_days': missing}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--annual-directory', type=Path, default=Path('site/cache/annual-history'))
    parser.add_argument('--verification-directory', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(export_results(args.annual_directory, args.verification_directory)))
