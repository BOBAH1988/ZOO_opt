"""Список получателей рассылок: Firestore с откатом на текстовый файл.

ЗАЧЕМ
Раньше получатели жили только в .txt внутри репозитория, и чтобы добавить
клиента или убрать лишнего, приходилось править файл руками. Теперь список
ведётся в приложении (страница «Списки»): Firestore, документ mail_lists/<uid>.

ПОЧЕМУ С ОТКАТОМ
Если Firebase недоступен или сервисный аккаунт не задан, рассылка не должна
падать: список берётся из прежнего txt. Так старые запуски продолжают
работать, пока список в базе не заполнен.

ФОРМАТ ДОКУМЕНТА
    mail_lists/<uid> = {
        ownerUid: str,
        addresses: [{email, name?, kind, active, addedAt?}],
        updatedAt: <timestamp>,
    }
kind: ukhta | sety | debt — к какой рассылке относится адрес.
"""

import logging
import os

logger = logging.getLogger("mail-automation.mail_list")

COLLECTION = "mail_lists"
_FIRESTORE_CLIENT = None


def _get_client():
    """Клиент Firestore или None, если сервисный аккаунт не настроен."""
    global _FIRESTORE_CLIENT
    if _FIRESTORE_CLIENT is not None:
        return _FIRESTORE_CLIENT

    if not os.environ.get("FIREBASE_SERVICE_ACCOUNT"):
        return None

    try:
        import json

        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            sa_info = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
            firebase_admin.initialize_app(credentials.Certificate(sa_info))
        _FIRESTORE_CLIENT = firestore.client()
        return _FIRESTORE_CLIENT
    except Exception as exc:
        logger.warning(f"Firestore недоступен ({exc}) — список берём из файла")
        return None


def _owner_uid() -> str | None:
    """Чей список читать: email владельца, под которым его создали в приложении."""
    return os.environ.get("MAIL_LIST_OWNER") or os.environ.get("OWNER_UID") or None


def load_recipients(kind: str, fallback_file) -> list[str]:
    """Адреса рассылки kind: из Firestore, иначе из файла.

    Args:
        kind: 'ukhta', 'sety' или 'debt'.
        fallback_file: путь к txt со списком (по одному адресу на строку).

    Returns:
        Список адресов без дублей, в исходном порядке.
    """
    from_firestore = _read_from_firestore(kind)
    if from_firestore:
        logger.info(f"Получатели «{kind}» из Firestore: {len(from_firestore)}")
        return from_firestore

    return _read_from_file(kind, fallback_file)


def _has_kind(item: dict, kind: str) -> bool:
    """Запись относится к сценарию kind — в новой (kinds) или старой (kind) модели."""
    kinds = item.get("kinds")
    if isinstance(kinds, list):
        return kind in kinds
    return item.get("kind") == kind


def _read_from_firestore(kind: str) -> list[str]:
    db = _get_client()
    owner = _owner_uid()
    if db is None or not owner:
        return []

    try:
        snapshot = db.collection(COLLECTION).document(owner).get()
        if not snapshot.exists:
            return []
        addresses = (snapshot.to_dict() or {}).get("addresses") or []
    except Exception as exc:
        logger.warning(f"Не удалось прочитать список из Firestore: {exc}")
        return []

    result: list[str] = []
    seen: set[str] = set()
    for item in addresses:
        if not isinstance(item, dict) or item.get("active") is False:
            continue

        # Новая модель: kinds — массив сценариев у одной записи.
        # Старая модель: kind — одно значение. Поддержаны обе.
        if not _has_kind(item, kind):
            continue

        email = str(item.get("email") or "").strip()
        key = email.lower()
        if not email or key in seen:
            continue
        seen.add(key)
        result.append(email)
    return result


def _read_from_file(kind: str, fallback_file) -> list[str]:
    from pathlib import Path

    path = Path(fallback_file)
    if not path.exists():
        raise RuntimeError(
            f"Список получателей «{kind}» пуст: в Firestore нет адресов, "
            f"а файл {path} не найден. Заполните список на странице «Списки»."
        )

    lines = path.read_text(encoding="utf-8").splitlines()
    recipients = [
        line.strip() for line in lines
        if line.strip() and not line.strip().startswith("#")
    ]
    if not recipients:
        raise RuntimeError(f"Список получателей пуст: {path}")

    logger.info(f"Получатели «{kind}» из файла {path.name}: {len(recipients)}")
    return recipients


def load_debt_clients(fallback_file) -> list[tuple[str, str]]:
    """Пары «имя клиента — адрес» для отчёта по дебиторке.

    В Firestore у адреса есть поле name; в файле строка вида «Имя - email».
    """
    db = _get_client()
    owner = _owner_uid()
    if db is not None and owner:
        try:
            snapshot = db.collection(COLLECTION).document(owner).get()
            if snapshot.exists:
                addresses = (snapshot.to_dict() or {}).get("addresses") or []
                pairs = [
                    (str(item.get("name") or item.get("email") or "").strip(),
                     str(item.get("email") or "").strip())
                    for item in addresses
                    if isinstance(item, dict)
                    and _has_kind(item, "debt")
                    and item.get("active") is not False
                    and item.get("email")
                ]
                if pairs:
                    logger.info(f"Клиенты дебиторки из Firestore: {len(pairs)}")
                    return pairs
        except Exception as exc:
            logger.warning(f"Не удалось прочитать дебиторку из Firestore: {exc}")

    from pathlib import Path

    path = Path(fallback_file)
    result: list[tuple[str, str]] = []
    if not path.exists():
        return result
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or " - " not in line:
            continue
        name, addr = line.rsplit(" - ", 1)
        result.append((name.replace(".xls", "").strip(), addr.strip()))
    return result
