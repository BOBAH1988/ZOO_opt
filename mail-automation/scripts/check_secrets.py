"""
Диагностика секретов MAILRU_LOGIN / MAILRU_APP_PASSWORD —
проверяет "форму" значений, не раскрывая сами значения в логах.
"""
import os

login = os.environ.get("MAILRU_LOGIN", "")
app_password = os.environ.get("MAILRU_APP_PASSWORD", "")

print("=== Диагностика MAILRU_LOGIN ===")
print(f"Длина: {len(login)} символов")
print(f"Содержит '@': {'да' if '@' in login else 'НЕТ — это подозрительно!'}")
print(f"Есть пробел в начале/конце: {'ДА — это ошибка!' if login != login.strip() else 'нет'}")
print(f"Есть перенос строки: {'ДА — это ошибка!' if chr(10) in login or chr(13) in login else 'нет'}")
print()
print("=== Диагностика MAILRU_APP_PASSWORD ===")
print(f"Длина: {len(app_password)} символов")
print(f"Есть пробел в начале/конце: {'ДА — это ошибка!' if app_password != app_password.strip() else 'нет'}")
print(f"Есть перенос строки: {'ДА — это ошибка!' if chr(10) in app_password or chr(13) in app_password else 'нет'}")
print(f"Содержит только допустимые символы (буквы/цифры): "
      f"{'да' if app_password.strip().isalnum() else 'НЕТ — есть спецсимволы, возможно норм, но проверьте'}")
print()
print("Пароли приложений mail.ru обычно 16 символов, только строчные латинские буквы.")
looks_typical = len(app_password.strip()) == 16 and app_password.strip().isalpha()
print(f"Похоже на типичный формат: {'да' if looks_typical else 'нет — проверьте внимательнее'}")
