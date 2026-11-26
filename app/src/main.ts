import '@fontsource-variable/manrope';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

// Контекстное меню браузера (Обновить, Просмотреть код) в программе не нужно
if (!import.meta.env.DEV) window.addEventListener('contextmenu', (e) => e.preventDefault());

// МАКЕТ: варианты внешнего вида ?skin=a|b|c
const skin = import.meta.env.DEV ? new URLSearchParams(location.search).get('skin') : null;
if (skin) { document.documentElement.dataset.skin = skin; void import('./skins.css'); }

export default mount(App, { target: document.getElementById('app')! });
