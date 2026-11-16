"""Автоматическая работа с логами GitHub Actions.

Скачивает логи запусков через GitHub CLI (gh) и разбирает их: находит
фактическое время старта, задержку относительно расписания, какие проекты
запустились и что было найдено в почте.

Использование:
    python3 tools/fetch_logs.py list [N]        # последние N запусков (по умолчанию 20)
    python3 tools/fetch_logs.py fetch <run-id>  # скачать лог запуска в logs/<run-id>.log
    python3 tools/fetch_logs.py analyze         # разобрать все скачанные логи в logs/
    python3 tools/fetch_logs.py auth_help       # инструкция: как дать доступ один раз

Что требуется: ничего. Токен берётся автоматически: сначала `gh auth token`,
если gh не авторизован — сохранённые git-учётные данные macOS (тот же PAT,
который используется для push). Ничего вводить вручную не нужно.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

REPO = "BOBAH1988/mail-automation"
LOGS_DIR = Path(__file__).resolve().parent.parent / "logs"
GH = "/opt/homebrew/bin/gh" if Path("/opt/homebrew/bin/gh").exists() else "gh"

# --- helpers -------------------------------------------------------------


_TOKEN_CACHE: str | None = None


def get_token() -> str | None:
    """Токен для API: `gh auth token`, затем git-credential (PAT от push).

    Токен НИКОГДА не печатается — используется только как GH_TOKEN.
    """
    global _TOKEN_CACHE
    if _TOKEN_CACHE is not None:
        return _TOKEN_CACHE or None
    # 1. Авторизованный gh (если когда-нибудь будет).
    res = run_gh(["auth", "token"], use_token=False)
    if res.returncode == 0 and res.stdout.strip():
        _TOKEN_CACHE = res.stdout.strip().splitlines()[-1].strip()
        return _TOKEN_CACHE
    # 2. Учётные данные git для github.com (macOS keychain): PAT, которым
    #    делается push. gh auth login требует скоуп read:org, которого у него
    #    нет, но для чтения логов приватного репо достаточно GH_TOKEN.
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_ASKPASS="/bin/true")
    res = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True, env=env, timeout=30,
    )
    tok = None
    for line in res.stdout.splitlines():
        if line.startswith("password="):
            tok = line.split("=", 1)[1].strip()
            break
    _TOKEN_CACHE = tok or ""
    return tok


def run_gh(args: list[str], use_token: bool = True) -> subprocess.CompletedProcess:
    """Выполняет gh с заданными аргументами (с токеном из хранилищ, если есть)."""
    env = os.environ.copy()
    if use_token:
        tok = get_token()
        if tok:
            env["GH_TOKEN"] = tok
    return subprocess.run(
        [GH, *args], capture_output=True, text=True, timeout=180, env=env
    )


def check_auth() -> bool:
    """Проверяет наличие рабочего токена. Если нет — печатает инструкцию."""
    if get_token():
        return True
    print("❌ Не найден токен GitHub (ни в gh, ни в связке ключей git).")
    print("Один раз любым из способов:")
    print("  a) /opt/homebrew/bin/gh auth login   (диалог, браузер)")
    print("  b) git push из этого репо — пароль сохранится сам, и инструмент")
    print("     подхватит его автоматически.")
    return False


# --- команды -------------------------------------------------------------


def cmd_list(n: int) -> None:
    """Показывает последние n запусков всех workflow."""
    if not check_auth():
        sys.exit(1)
    res = run_gh(["run", "list", "--repo", REPO, "--limit", str(n)])
    if res.returncode != 0:
        print(f"Ошибка gh: {res.stderr}")
        sys.exit(1)
    print(res.stdout)
    print("\nЧтобы скачать лог конкретного запуска:")
    print("  python3 tools/fetch_logs.py fetch <run-id>\n")


def cmd_fetch(run_id: str) -> None:
    """Скачивает полный лог запуска в logs/<run-id>.log."""
    if not check_auth():
        sys.exit(1)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    out = LOGS_DIR / f"{run_id}.log"
    print(f"Скачиваю лог запуска {run_id} ...")
    res = run_gh(["run", "view", run_id, "--repo", REPO, "--log"])
    if res.returncode != 0:
        print(f"Ошибка: {res.stderr}")
        sys.exit(1)
    out.write_text(res.stdout, encoding="utf-8")
    print(f"Сохранено: {out} ({len(res.stdout)} символов)")


_GH_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*")


def clean(line: str) -> str:
    """Отрезает служебный префикс лога GitHub (шаг + таймстемп)."""
    line = line.split("\t")[-1] if "\t" in line else line
    return _GH_TS.sub("", line).strip()


def _parse_log(path: Path) -> dict:
    """Разбирает лог запуска и возвращает сводку по значащим строкам."""
    text = path.read_text(encoding="utf-8", errors="replace")
    info = {
        "path": path.name,
        "msk_time": [],
        "to_run": [],
        "no_unread": [],
        "already_today": [],
        "sent": [],
        "tracebacks": [],
        "no_jobs": False,
        "proj_ran": [],
    }
    for line in text.splitlines():
        # Фактическое время, которое увидел скрипт (самое честное).
        if "Текущее время (МСК)" in line:
            m = re.search(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", line)
            if m:
                info["msk_time"].append(m.group(0))
        if "К запуску:" in line:
            info["to_run"].append(clean(line))
        if "Непрочитанное письмо не найдено" in line:
            info["no_unread"].append(clean(line))
        if "уже приходило" in line or "уже было" in line:
            info["already_today"].append(clean(line))
        if "отправлено" in line and ("Письмо" in line or "уведомление" in line.lower()):
            info["sent"].append(clean(line))
        if "Traceback" in line or "Error" in line:
            info["tracebacks"].append(clean(line))
        if "незавершён" in line or "Сейчас нет проектов" in line:
            info["no_jobs"] = True
    # Имена проектов, которые действительно отработали (полоса "▶ ..."):
    info["proj_ran"] = sorted(set(
        m.group(1) for m in
        (re.search(r"▶ (.+?)\s+\[(\w+)\]", x) for x in text.splitlines())
        if m
    ))
    return info


def cmd_analyze() -> None:
    """Разбирает все скачанные логи в logs/ и печатает сводку."""
    log_files = sorted(LOGS_DIR.glob("*.log"))
    if not log_files:
        print("В папке logs/ нет *.log файлов. Сначала: "
              "python3 tools/fetch_logs.py fetch <run-id>")
        sys.exit(1)
    for path in log_files:
        i = _parse_log(path)
        print("=" * 70)
        print(f"Лог: {i['path']}")
        if i["msk_time"]:
            print(f"  Время (МСК) в скрипте: {i['msk_time']}")
        if i["to_run"]:
            print(f"  Запущено проектов: {', '.join(i['to_run'])}")
        if i["proj_ran"]:
            print(f"  Отработали проекты: {', '.join(i['proj_ran'])}")
        if i["no_jobs"]:
            print("  ⚠️ Проектов к запуску сейчас нет (вне окон времени)")
        if i["no_unread"]:
            print(f"  🚫 Не было непрочитанного письма: {len(i['no_unread'])} раз")
        if i["already_today"]:
            print(f"  🔁 Уже обработано сегодня: {len(i['already_today'])} раз")
        if i["sent"]:
            print(f"  📤 Отправлено писем: {len(i['sent'])}")
            for s in i["sent"][:5]:
                print(f"       {s}")
        if i["tracebacks"]:
            print(f"  ❌ Ошибки/трассировки: {len(i['tracebacks'])}")
            for t in i["tracebacks"][:5]:
                print(f"       {t}")


def cmd_auth_help() -> None:
    """Печатает инструкцию по авторизации gh."""
    check_auth()


# --- main ----------------------------------------------------------------


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "list":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 20
        cmd_list(n)
    elif cmd == "fetch":
        if len(sys.argv) < 3:
            print("Нужен run-id запуска. См. 'list'.")
            sys.exit(1)
        cmd_fetch(sys.argv[2])
    elif cmd == "analyze":
        cmd_analyze()
    elif cmd == "auth_help":
        cmd_auth_help()
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
