"""Collect all venues with one index and a shared request-start rate limit."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time
from collect_official import collect, collect_index, RequestGate, VENUES

ROOT = Path(__file__).resolve().parents[2]


def collect_all(cache=Path('site/cache'), staging=Path('site/staging'), venues=VENUES):
    started = time.monotonic()
    cache.mkdir(parents=True, exist_ok=True)
    staging.mkdir(parents=True, exist_ok=True)
    # Eight venues may wait for slow responses; at most four requests start
    # each second globally, and each venue retains its one-second interval.
    global_gate = RequestGate(.25)
    index = collect_index(cache / 'incoming-index.json')

    def worker(venue):
        code = venue['code']
        destination = cache / f'incoming-{code}.json'
        try:
            value = collect(destination, code, index, global_gate)
        except Exception as error:
            value = {'date': index['date'], 'venue_code': code,
                     'attempted_at': datetime.now(timezone.utc).isoformat(), 'error': str(error)}
        destination.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+'\n')
        update = subprocess.run(['node', 'site/update.mjs', str(destination)], cwd=ROOT, capture_output=True, text=True)
        command = ['node', 'site/snapshot.mjs', code, str(staging / f'{code}.json')]
        if update.returncode:
            command.append('--failed')
        snapshot = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        if snapshot.returncode:
            raise RuntimeError(f'{code}: public snapshot failed: {snapshot.stderr}')
        public_file = staging / f'{code}.json'
        public = json.loads(public_file.read_text()) if public_file.exists() else {}
        result = {'venue_code': code, 'meeting_status': value.get('meeting_status', 'UNKNOWN'),
                  'races': len(value.get('races', [])), 'failed': bool(value.get('error') or update.returncode),
                  'update_status': public.get('update', {}).get('status'),
                  'predicted_races': sum(bool(r.get('items')) for r in public.get('races', [])),
                  'races_with_odds': sum(bool((r.get('odds') or {}).get('items')) for r in public.get('races', [])),
                  'error': value.get('error') or (update.stderr[:500] if update.returncode else None)}
        print(json.dumps(result, ensure_ascii=False), flush=True)
        return result

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(worker, venues))
    return {'date': index['date'], 'venues': results, 'failed_venues': sum(v['failed'] for v in results),
            'max_venues': 8, 'max_responses_per_venue': 3, 'max_request_starts_per_second': 4,
            'elapsed_seconds': round(time.monotonic() - started, 3)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('site/cache'))
    parser.add_argument('--staging', type=Path, default=Path('site/staging'))
    args = parser.parse_args()
    try:
        print('::notice title=Full collection::'+json.dumps(collect_all(args.cache.resolve(), args.staging.resolve()), ensure_ascii=False))
    except Exception as error:
        parser.exit(1, str(error)+'\n')
