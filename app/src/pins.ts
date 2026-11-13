import '@fontsource-variable/manrope';
import './app.css';
import { mount } from 'svelte';
import Pins from './Pins.svelte';

window.addEventListener('contextmenu', (e) => e.preventDefault());

export default mount(Pins, { target: document.getElementById('pins')! });
