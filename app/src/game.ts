import '@fontsource-variable/manrope';
import './app.css';
import { mount } from 'svelte';
import GameMenu from './GameMenu.svelte';

// Меню поверх игры: свой прозрачный слой во весь монитор игры (окно «game»)
if (!import.meta.env.DEV) window.addEventListener('contextmenu', (e) => e.preventDefault());

export default mount(GameMenu, { target: document.getElementById('app')! });
