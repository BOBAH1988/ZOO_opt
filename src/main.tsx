import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initFirebase } from './firebase';
import { AuthProvider } from './context/AuthContext';
import { initPWAInstallCapture } from './lib/pwaInstall';

// Перехватываем событие установки PWA до монтирования React,
// чтобы не пропустить beforeinstallprompt.
initPWAInstallCapture();

// Инициализация Firebase (если сконфигурировано).
try {
  initFirebase();
} catch {
  // Ошибка инициализации Firebase не должна ломать всё приложение;
  // AuthProvider сам отобразит ошибку конфигурации.
}

// Регистрация Service Worker для PWA (только в production-сборке).
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      const swUrl = `${import.meta.env.BASE_URL}sw.js`;
      navigator.serviceWorker.register(swUrl).catch(() => {
        // Регистрация SW не критична для основной функциональности
      });
    });
  } else {
    // В dev-режиме ранее зарегистрированный service worker может отдавать
    // устаревшие HTML/JS из кэша и приводить к «вечной загрузке».
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch(() => {
        // Игнорируем: очистка SW не критична
      });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);