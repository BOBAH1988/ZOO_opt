/**
 * Копирование текста в буфер обмена.
 *
 * ОСНОВНОЙ И ЗАПАСНОЙ ПУТЬ
 * navigator.clipboard доступен только в защищённом контексте (https или
 * localhost). Приложение открывают и по http, и из локальной сети — там API
 * нет, и без запасного варианта кнопка молча ничего не делает. Поэтому при
 * отсутствии API или отказе браузера текст копируется через скрытую область
 * и execCommand('copy').
 *
 * Возвращает true, если копирование удалось: вызывающему коду нужно показать
 * пользователю результат, а не гадать.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Браузер запретил доступ — пробуем запасной путь ниже.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
