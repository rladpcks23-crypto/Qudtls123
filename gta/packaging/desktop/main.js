// 네온 하버 PC판: PC용 HTML을 창 하나에 띄운다. F11 = 전체화면.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    title: '네온 하버',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#0a0e17',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
