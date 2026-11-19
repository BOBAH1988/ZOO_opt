"""Хранилище снапшота прайса между запусками.

ЗАЧЕМ
Лист «Нет на остатке 2 недели» держится на сравнении текущего прайса с
прайсом прошлой недели. В GitHub Actions каждый запуск — чистая среда,
поэтому файл на диске не переживёт неделю. Firestore же живёт вне машины.

КАК РАБОТАЕТ
- Если задан FIREBASE_SERVICE_ACCOUNT, снапшот читается и пишется в
  Firestore, коллекция residues_snapshots, документ last_week_pricelist.
- Иначе (локальный запуск без ключа) — атомарный текстовый файл в data/.
  Так проект остаётся работоспособным без облака, а в CI работает облако.

ЛЮБАЯ ОШИБКА НЕ РОЖДАЕТ ОТКАЗ
Нет сети, протух ключ, нет прав — снапшот считается отсутствующим, и отчёт
строится без листа «2 недели», а не падает целиком. Сбой вспомогательной
проверки не должен отменять сам заказ.
"""

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger("mail-automation.residues.storage")

COLLECTION = "residues_snapshots"
DOCUMENT = "last_week_pricelist"

_firestore_db = None


def _get_firestore_db():
    """Клиент Firestore или None, если Firebase не настроен/недоступен."""
    global _firestore_db
    if _firestore_db is not None:
        return _firestore_db

    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not sa_json:
        return None

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(json.loads(sa_json)))
        _firestore_db = firestore.client()
        return _firestore_db
    except Exception as exc:
        logger.warning(f"Firestore недоступен ({exc}) — снапшот не сохранится")
        return None


def _local_path(project_dir: Path) -> Path:
    return project_dir / "data" / "last_week_pricelist.txt"


def load_previous(project_dir: Path) -> set[str] | None:
    """Артикулы прайса прошлой недели. None — снапшота ещё нет."""
    db = _get_firestore_db()
    if db is not None:
        try:
            snapshot = db.collection(COLLECTION).document(DOCUMENT).get()
            if snapshot.exists:
                return set(snapshot.to_dict().get("artikuls") or [])
            return None
        except Exception as exc:
            logger.warning(f"Не удалось прочитать снапшот из Firestore: {exc}")

    path = _local_path(project_dir)
    if not path.exists():
        return None
    return {line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def save_current(project_dir: Path, artikuls: set[str]) -> None:
    """Запомнить артикулы текущего прайса — на следующей неделе они «прошлые»."""
    db = _get_firestore_db()
    if db is not None:
        try:
            db.collection(COLLECTION).document(DOCUMENT).set({
                "artikuls": sorted(artikuls),
                "count": len(artikuls),
            })
            return
        except Exception as exc:
            logger.warning(f"Не удалось записать снапшот в Firestore: {exc}")

    path = _local_path(project_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(sorted(artikuls)), encoding="utf-8")
