"""Список получателей рассылок: файл в репозитории, затем Firestore.

ПОЧЕМУ ФАЙЛ ПЕРВЫЙ
Файл рядом с кодом работает всегда: без сервисного аккаунта, без сети,
без настроек CI. Рассылка — критичный процесс, и он не должен зависеть от
внешней инфраструктуры. Firestore остаётся вторым источником: он удобен
для просмотра и правки из приложения, но не обязателен для отправки.

ИСТОРИЯ
Сначала списки жили только в txt. Потом их перенесли в Firestore и убрали
файлы из репозитория — тогда боевые запуски в GitHub Actions начали падать:
база не читалась, а запасного файла не было вовсе. Порядок восстановлен:
файл — основа, база — дополнение.

ФОРМАТ ДОКУМЕНТА
    mail_lists/<uid> = {
        ownerUid: str,
        addresses: [{email, name?, kind, active, addedAt?}],
        updatedAt: <timestamp>,
    }
kind: ukhta | sety | debt | lemur — к какой рассылке относится адрес.
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
        kind: 'ukhta', 'sety', 'debt' или 'lemur'.
        fallback_file: путь к txt со списком (по одному адресу на строку).

    Returns:
        Список адресов без дублей, в исходном порядке.
    """
    # 1. Файл в репозитории — основной источник: не зависит от настроек CI.
    if fallback_file is not None:
        from_file = _read_from_file(kind, fallback_file, required=False)
        if from_file:
            logger.info(f"Получатели «{kind}» из файла: {len(from_file)}")
            return from_file

    # 2. Firestore — если файла нет или он пуст.
    from_firestore = _read_from_firestore(kind)
    if from_firestore:
        logger.info(f"Получатели «{kind}» из Firestore: {len(from_firestore)}")
        return from_firestore

    raise RuntimeError(
        f"Список получателей «{kind}» пуст: нет ни файла-списка, ни адресов "
        "в приложении. Заполните файл в репозитории или список «Списки»."
    )


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


def _read_from_file(kind: str, fallback_file, required: bool = True) -> list[str]:
    """Адреса из txt-файла.

    required=False — файла может не быть: тогда возвращается пустой список,
    и вызывающий код пробует следующий источник (Firestore). Так список
    живёт в репозитории, но не мешает рассылкам без своего файла.
    """
    from pathlib import Path

    if fallback_file is None:
        return []

    path = Path(fallback_file)
    if not path.exists():
        if required:
            raise RuntimeError(
                f"Файл со списком получателей «{kind}» не найден: {path}. "
                "Заполните файл в репозитории или список «Списки» в приложении."
            )
        return []

    lines = path.read_text(encoding="utf-8").splitlines()
    recipients = [
        line.strip() for line in lines
        if line.strip() and not line.strip().startswith("#")
    ]
    if not recipients and required:
        raise RuntimeError(f"Список получателей пуст: {path}")

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
