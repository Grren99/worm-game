import { state } from './core/state.js';
import { elements } from './core/elements.js';
import { AudioManager } from './core/audio.js';
import { UIManager } from './core/ui.js';
import { InputManager } from './core/input.js';
import { Renderer } from './core/renderer.js';
import { NetworkController } from './core/network.js';
import { HighlightLibrary } from './core/highlights.js';

const socket = io({ transports: ['websocket'] });

const audio = new AudioManager(state);
const highlightLibrary = new HighlightLibrary();
const ui = new UIManager({ state, elements, socket, audio, highlightLibrary });
const renderer = new Renderer({ state, elements });
const input = new InputManager({ state, socket, elements, ui });
const network = new NetworkController({ state, socket, ui, audio, renderer });

ui.init();
input.init();
network.init();
renderer.start();

window.addEventListener('beforeunload', () => {
  ui.dispose();
});
