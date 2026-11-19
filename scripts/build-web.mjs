// Собирает веб-часть Говоруна в папку www/ — её Capacitor кладёт внутрь Android-приложения.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const OUT = 'www';
const FILES = ['index.html', 'style.css', 'js', 'icon.svg', 'fonts', 'manifest.webmanifest'];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for (const f of FILES) cpSync(f, `${OUT}/${f}`, { recursive: true });
// Ядро Capacitor: добавляет window.Capacitor.registerPlugin, без него нативные плагины не работают.
mkdirSync(`${OUT}/js/vendor`, { recursive: true });
cpSync('node_modules/@capacitor/core/dist/capacitor.js', `${OUT}/js/vendor/capacitor.js`);
console.log(`Готово: ${FILES.join(', ')} → ${OUT}/`);
