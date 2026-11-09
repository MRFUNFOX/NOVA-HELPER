import '@fontsource-variable/manrope';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

// Контекстное меню браузера (Обновить, Просмотреть код) в программе не нужно
if (!import.meta.env.DEV) window.addEventListener('contextmenu', (e) => e.preventDefault());

export default mount(App, { target: document.getElementById('app')! });
