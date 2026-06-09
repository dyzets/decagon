import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import icon from "../../resources/icon.png?asset";
import { registerIpcHandlers } from "./ipc";

// electron-vite injects these env vars during dev to point at the dev server.
const DEV_SERVER_URL = process.env["ELECTRON_RENDERER_URL"];

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    title: "Decagon",
    icon,
    webPreferences: {
      // Security: isolate the renderer; only the preload bridge is exposed.
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Open external links in the system browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
