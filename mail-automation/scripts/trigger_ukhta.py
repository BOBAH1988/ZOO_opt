#!/usr/bin/env python3
"""
Внешний триггер для workflow Проекта 2 (Ухта).

GitHub Actions cron ненадёжен: задержки очереди до 3–5 часов,
из 16 слотов выполняются 1–2. Этот скрипт запускается из
локального crontab и триггерит workflow вручную через GitHub API,
обходя планировщик GitHub.

Настройка:
  1. Получите PAT с scope `workflow` (GitHub → Settings → Developer settings →
     Personal access tokens → Generate new token).
  2. Экспортируйте токен:
       export GH_TOKEN=your_token_here
  3. Добавьте в crontab (macOS — `crontab -e`):
       # Ухта: каждые 30 мин в 7:00–10:30 по Пн и Вт (МСК)
       0,30 7-10 * * 1,2  /usr/bin/python3 /путь/scripts/trigger_ukhta.py
       # запасной слот: 10:00–11:00
       0,30 10-11 * * 1,2 /usr/bin/python3 /путь/scripts/trigger_ukhta.py

  Или используйте `gh auth login` и `gh workflow run` вместо этого скрипта.

Повторные запуски не создают дублей: workflow имеет
concurrency.group = "mail-automation" с cancel-in-progress: false,
поэтому если предыдущий запуск ещё идёт — новый не стартует.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime, timedelta

REPO_OWNER = "BOBAH1988"
REPO_NAME = "mail-automation"
WORKFLOW_FILE = "weekly_mon_tue.yml"
BRANCH = "main"

WORKFLOW_DAYS = {0, 1}  # понедельник=0, вторник=1

WINDOW_START = (7, 0)
WINDOW_END = (10, 30)


def in_window(hm: tuple[int, int], start: tuple[int, int], end: tuple[int, int]) -> bool:
    h, m = hm
    return start <= (h, m) < end


def should_trigger() -> bool:
    """Проверка: сегодня понедельник или вторник, и время в окне."""
    utc_now = datetime.now(UTC)
    msk = utc_now + timedelta(hours=3)
    weekday = msk.weekday()
    now_hm = (msk.hour, msk.minute)

    if weekday not in WORKFLOW_DAYS:
        return False
    return in_window(now_hm, WINDOW_START, WINDOW_END)


def trigger_workflow() -> bool:
    token = os.environ.get("GH_TOKEN")
    if not token:
        print("GH_TOKEN не задан", file=sys.stderr)
        return False

    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/actions/workflows/{WORKFLOW_FILE}/dispatches"
    payload = json.dumps({
        "ref": BRANCH,
        "inputs": {
            "ignore_window": "true",
            "only": "ukhta",
        },
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github.v3+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"Workflow triggered: {REPO_OWNER}/{REPO_NAME} ({resp.status})")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        print(f"Ошибка {e.code}: {body}", file=sys.stderr)
        return False


def main() -> int:
    if not should_trigger():
        print("Сейчас время/день не подходит для запуска Ухты — пропуск.")
        return 0

    ok = trigger_workflow()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
