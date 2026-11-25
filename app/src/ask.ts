import '@fontsource-variable/manrope';
import './app.css';
import { mount } from 'svelte';
import Ask from './Ask.svelte';

window.addEventListener('contextmenu', (e) => e.preventDefault());

export default mount(Ask, { target: document.getElementById('ask')! });
