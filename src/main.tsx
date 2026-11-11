import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { initFirebase } from './firebase';
import { AuthProvider } from './context/AuthContext';

// Инициализация Firebase (если сконфигурирован).
initFirebase();

// Регистрация Service Worker для PWA (только в production-сборке/поддерживаемом окружении).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Регистрация SW не критична для основной функциональности
    });
  });
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