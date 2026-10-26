"""Publish trusted scheduled model data through PR checks; never bypass main rules."""
import json
import os
import re
import subprocess
import time


def allowed_changes(files):
    exact = {
        'models/annual/current.json', 'models/annual/validation.json', 'models/annual/coverage.json',
        'models/exhibition-st/current.json', 'models/exhibition-st/records.json',
        'models/exhibition-st/last-update.json', 'site/releases.json', '.github/publication.json',
    }
    candidate = r'models/monthly-candidates/\d{4}-\d{2}/(?:current|validation|review|decision|previous-coefficients)\.json'
    return bool(files) and all(f in exact or re.fullmatch(candidate, f) for f in files)


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def main():
    run_id, attempt = os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT']
    if not run_id.isdigit() or not attempt.isdigit():
        raise ValueError('Invalid workflow run identity')
    command('git', 'fetch', 'origin', 'main')
    head = command('git', 'rev-parse', 'HEAD')
    files = command('git', 'diff', '--name-only', 'origin/main...HEAD').splitlines()
    if not files:
        return
    if not allowed_changes(files):
        raise ValueError('Automatic data PR contains files outside the data allowlist')
    if command('node', 'site/check-approval.mjs') != 'approved=true':
        raise ValueError('Publication approval is invalid')
    branch = f'automation/daily-history-{run_id}-{attempt}'
    command('git', 'push', 'origin', f'HEAD:refs/heads/{branch}')
    body = ('## 更新内容\n終了済み公式結果に基づく日次履歴と、検証条件を満たした場合のみ月次係数を更新します。'
            '\n\n## 検証\nmain-pr-checksの成功と、更新対象がデータ・生成履歴・公開確認だけであることを確認して取り込みます。'
            '\nコード変更を含む場合やチェックに失敗した場合は自動で取り込みません。')
    pr = command('gh', 'pr', 'create', '--base', 'main', '--head', branch,
                 '--title', 'Refresh validated daily player history', '--body', body)
    print(f'Data PR: {pr}', flush=True)
    # GITHUB_TOKEN-created PR events do not start other workflows. Explicitly
    # dispatch the SAME required check on this exact head, with no secrets.
    command('gh', 'workflow', 'run', 'main-pr-checks.yml', '--ref', branch)
    check_run = None
    for _ in range(24):
        runs = json.loads(command('gh', 'run', 'list', '--workflow', 'main-pr-checks.yml',
                                 '--branch', branch, '--event', 'workflow_dispatch',
                                 '--json', 'databaseId,headSha', '--limit', '10'))
        check_run = next((r['databaseId'] for r in runs if r['headSha'] == head), None)
        if check_run:
            break
        time.sleep(5)
    if not check_run:
        raise RuntimeError('Required checks were not started; the data PR remains open')
    subprocess.run(['gh', 'run', 'watch', str(check_run), '--interval', '10', '--exit-status'],
                   check=True, timeout=1200)
    command('gh', 'pr', 'merge', pr, '--merge', '--match-head-commit', head, '--delete-branch')
    print('Validated data PR merged without an administrative bypass', flush=True)


if __name__ == '__main__':
    main()
