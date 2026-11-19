"""Обработчик очереди запусков из приложения (Firestore `run_requests`).

Зачем нужен
-----------
Кнопки «Запустить» в приложении ходят в серверный API (Cloudflare Worker).
Из некоторых сетей адрес Worker недоступен: запрос висит до таймаута.
Тогда клиент пишет заявку в `run_requests`, а этот скрипт (workflow
«Очередь запусков», расписание каждые 5 минут) забирает заявку и выполняет
тот же сценарий. GitHub и Firestore доступны там, где Worker — нет.

Что делает
----------
1. Берёт заявки со статусом `pending` (не больше MAX_PER_RUN за прогон).
2. Атомарно переводит заявку в `running`, чтобы два прогона не взяли одну.
3. Выполняет сценарий тем же кодом, что и профильный workflow
   (`run_all.py` с теми же аргументами и переменными окружения).
4. Пишет итог: `done` или `failed`, текст ошибки и время завершения.
5. Зависшие `running` старше STALE_MINUTES помечает `failed`, чтобы заявка
   не осталась в работе навсегда.

Требуются переменные окружения:
    FIREBASE_SERVICE_ACCOUNT — JSON сервисного аккаунта Firebase
    MAILRU_LOGIN, MAILRU_APP_PASSWORD, NOTIFY_EMAIL — как у остальных сценариев
    MAIL_RECIPIENTS — для рассылок (необязательно)
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import firebase_admin
from firebase_admin import credentials, firestore

COLLECTION = "run_requests"
MAX_PER_RUN = 5
STALE_MINUTES = 40
MESSAGE_LIMIT = 1500

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
SALES_REPORT_PATH = os.path.join(
    "mail-automation", "project residues", "Весь ассортимент за 3 мес.xlsx"
)

GROUP_BY_WORKFLOW = {
    "weekly_mon_tue": "mon_tue",
    "weekly_wed": "wed",
    "weekly_fri": "fri",
}

ALLOWED_INVOICE_PROJECTS = {"clients", "payments"}


def _init_firestore():
    if not firebase_admin._apps:
        raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
        if not raw:
            raise RuntimeError("Переменная окружения FIREBASE_SERVICE_ACCOUNT не задана")
        firebase_admin.initialize_app(credentials.Certificate(json.loads(raw)))
    return firestore.client()


def _bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("true", "1", "yes", "да")


def _as_text(value) -> str:
    return str(value).strip() if value is not None else ""


def _base_env(inputs: dict) -> dict:
    return {
        "TEST_MODE": "true" if _bool(inputs.get("test_mode")) else "false",
        # Профильные workflow подставляют MANUAL_RUN для ручных запусков:
        # так сценарии не ждут окна расписания.
        "MANUAL_RUN": "true",
    }


def plan_steps(workflow_id: str, inputs: dict):
    """Возвращает список шагов [(аргументы, env)] и признак коммита отчёта.

    `None` означает, что сценарий в очереди не поддерживается.
    """
    only = _as_text(inputs.get("only"))
    base = _base_env(inputs)

    if workflow_id == "kpi_sales":
        env = dict(base, OWNER_UID=_as_text(inputs.get("owner_uid")))
        return [(["run_all.py", "--only", "kpi"], env)], False

    group = GROUP_BY_WORKFLOW.get(workflow_id)
    if group:
        if only:
            args = ["run_all.py", "--only", only]
        else:
            args = ["run_all.py", "--group", group]
            if _bool(inputs.get("ignore_window"), default=True):
                args.append("--ignore-window")
        return [(args, base)], False

    if workflow_id == "weekly_tue":
        if only:
            args = ["run_all.py", "--only", only]
        else:
            args = ["run_all.py", "--only", "ukhta"]
            if _bool(inputs.get("ignore_window"), default=True):
                args.append("--ignore-window")
        return [(args, base)], False

    if workflow_id == "weekly_sety_price":
        skip = "true" if _bool(inputs.get("skip_if_sent"), default=True) else "false"
        env = dict(base, SKIP_IF_SENT=skip)
        return [
            (["run_all.py", "--only", "sety"], env),
            (["run_all.py", "--only", "mamedov"], env),
        ], False

    if workflow_id == "weekly_residues":
        return [(["run_all.py", "--only", "residues"], base)], False

    if workflow_id == "git_check_invoices":
        raw = _as_text(inputs.get("project")) or "clients,payments"
        projects = [p.strip() for p in raw.split(",") if p.strip()]
        steps = [
            (["run_all.py", "--only", project], base)
            for project in projects
            if project in ALLOWED_INVOICE_PROJECTS
        ]
        return (steps or None), False

    if workflow_id == "update_sales_report":
        return [(["update_sales_report.py"], {})], True

    return None


def run_steps(steps) -> tuple[int, str]:
    """Выполняет шаги по порядку. Возвращает (код, хвост вывода)."""
    output = []
    for args, extra_env in steps:
        env = dict(os.environ, **extra_env)
        completed = subprocess.run(
            [sys.executable, *args],
            cwd=SCRIPT_DIR,
            env=env,
            capture_output=True,
            text=True,
        )
        output.append(f"$ {' '.join(args)}\n{completed.stdout}{completed.stderr}")
        if completed.returncode != 0:
            return completed.returncode, "\n".join(output)
    return 0, "\n".join(output)


def commit_sales_report() -> str:
    """Коммитит обновлённый отчёт, если файл изменился."""

    def git(*args):
        return subprocess.run(
            ["git", *args], cwd=REPO_ROOT, capture_output=True, text=True
        )

    if not os.path.exists(os.path.join(REPO_ROOT, SALES_REPORT_PATH)):
        return "файл отчёта не создан — коммит пропущен"

    git("config", "user.name", "GitHub Actions")
    git("config", "user.email", "actions@github.com")
    git("add", SALES_REPORT_PATH)
    if git("diff", "--cached", "--quiet").returncode == 0:
        return "изменений нет"

    commit = git("commit", "-m", "chore: обновить отчёт о продажах за 3 мес.")
    if commit.returncode != 0:
        return f"коммит не создан: {commit.stderr.strip()[:300]}"

    push = git("push")
    if push.returncode != 0:
        return f"push не выполнен: {push.stderr.strip()[:300]}"
    return "отчёт закоммичен"


def _tail(text: str, limit: int = MESSAGE_LIMIT) -> str:
    text = text.strip()
    return text if len(text) <= limit else "…" + text[-limit:]


def _claim(transaction, doc_ref):
    """Атомарно переводит заявку pending → running. Возвращает данные или None."""
    snapshot = doc_ref.get(transaction=transaction)
    data = snapshot.to_dict() if snapshot.exists else None
    if not data or data.get("status") != "pending":
        return None
    transaction.update(
        doc_ref,
        {"status": "running", "startedAt": firestore.SERVER_TIMESTAMP,
         "updatedAt": firestore.SERVER_TIMESTAMP},
    )
    return data


def _finish(doc_ref, status: str, message: str) -> None:
    doc_ref.update(
        {
            "status": status,
            "message": _tail(message),
            "finishedAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
    )


def _fail_stale(db) -> None:
    """Заявки, зависшие в running дольше STALE_MINUTES, помечаем failed."""
    deadline = datetime.now(timezone.utc) - timedelta(minutes=STALE_MINUTES)
    for snapshot in db.collection(COLLECTION).where("status", "==", "running").stream():
        data = snapshot.to_dict() or {}
        started = data.get("startedAt")
        if started is not None and started < deadline:
            _finish(snapshot.reference, "failed", "Заявка зависла в работе и снята автоматически.")


def process_one(db, snapshot) -> None:
    doc_ref = snapshot.reference

    transaction = db.transaction()
    data = _claim(transaction, doc_ref)
    transaction.commit()
    if data is None:
        return

    workflow_id = str(data.get("workflowId") or "")
    inputs = data.get("inputs") or {}
    plan = plan_steps(workflow_id, inputs)

    if not plan:
        _finish(doc_ref, "failed", f"Сценарий «{workflow_id}» в очереди не поддерживается.")
        return

    steps, commit_needed = plan
    try:
        code, output = run_steps(steps)
    except Exception as exc:  # noqa: BLE001 — статус важнее типа ошибки
        _finish(doc_ref, "failed", f"Запуск не удался: {exc}")
        return

    if code != 0:
        _finish(doc_ref, "failed", f"Сценарий завершился с кодом {code}.\n{output}")
        return

    message = f"Сценарий «{workflow_id}» выполнен."
    if commit_needed:
        message += " " + commit_sales_report()
    _finish(doc_ref, "done", message + "\n" + output)


def main() -> int:
    db = _init_firestore()
    _fail_stale(db)

    pending = list(
        db.collection(COLLECTION).where("status", "==", "pending").limit(MAX_PER_RUN).stream()
    )
    if not pending:
        print("Очередь пуста.")
        return 0

    for snapshot in pending:
        process_one(db, snapshot)
    print(f"Обработано заявок: {len(pending)}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
