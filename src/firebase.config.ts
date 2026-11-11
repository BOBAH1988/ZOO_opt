/**
 * Конфигурация Firebase.
 *
 * ВНИМАНИЕ: Этот файл содержит только ПУБЛИЧНЫЕ параметры веб-конфигурации Firebase.
 * Здесь НЕ должно быть секретов, токенов, GitHub App credentials или приватных ключей.
 *
 * Перед запуском проекта замените placeholder-значения на реальные из консоли Firebase:
 *   Настройки проекта → Общие → Ваши приложения → Веб-приложение (</>).
 *
 * См. раздел "Настройка для публикации" в README.
 */
export const firebaseConfig = {
  // Пример (замените на реальные значения):
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

export const isFirebaseConfigured = () => {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
};