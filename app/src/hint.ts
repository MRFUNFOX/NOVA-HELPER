import '@fontsource-variable/manrope';
import './app.css';
import { mount } from 'svelte';
import Hint from './Hint.svelte';

window.addEventListener('contextmenu', (e) => e.preventDefault());

export default mount(Hint, { target: document.getElementById('hint')! });
