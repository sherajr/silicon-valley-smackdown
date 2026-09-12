import { build } from 'vite';

// Do not inherit a website's VITE_BASE when packaging the desktop app.
await build({ base: './' });
