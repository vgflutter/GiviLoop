const { app, BrowserWindow } = require('electron');
const readline = require('node:readline');
const profileArg = process.argv.find(value => value.startsWith('--poc-profile='));
if (!profileArg) throw new Error('The PoC requires its own temporary user-data directory.');
app.setPath('userData', profileArg.slice('--poc-profile='.length));
let win;
app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false, width: 1400, height: 1000,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadURL('about:blank');
});
readline.createInterface({ input: process.stdin }).on('line', async line => {
  if (line !== 'close') return;
  await win?.webContents.session.cookies.flushStore();
  win?.webContents.session.flushStorageData();
  win?.destroy();
  app.quit();
});
app.on('window-all-closed', () => {});
