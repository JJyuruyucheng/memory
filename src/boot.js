// Keep this entry independent of the module graph so a failed import can recover.
(() => {
  import('./main.js').catch(() => {
    const app = document.getElementById('app');
    if (!app) return;
    const screen = document.createElement('main'); screen.className = 'boot';
    const image = document.createElement('img'); image.src = './assets/mark.svg'; image.alt = ''; image.width = 48; image.height = 48;
    const title = document.createElement('h1'); title.textContent = '页面组件暂时没能加载';
    const message = document.createElement('p'); message.textContent = '请检查网络后重试。';
    const retry = document.createElement('button'); retry.className = 'secondary'; retry.type = 'button'; retry.textContent = '重新打开';
    // A full retry starts a fresh module graph; no session or private data is removed.
    retry.addEventListener('click', () => globalThis.location.reload());
    screen.append(image, title, message, retry); app.replaceChildren(screen);
  });
})();
