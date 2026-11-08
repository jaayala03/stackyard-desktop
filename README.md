<h1 align="center">Stackyard Desktop</h1>

<p align="center">
Local web development environments powered by <a href="https://ddev.com">DDEV</a>, in a native desktop app for
<b>Windows, macOS and Linux</b>.
</p>

Cross-platform rewrite of [Stackyard](https://github.com/jaayala03/stackyard) (GTK, Linux only) using
**Electron + React + TypeScript**. Terminal: xterm.js + node-pty.

## Status

Early work in progress (v0.1). Already in:

- Project list with live status, search and auto refresh
- Start / stop / restart / delete, open URL, folder and editor, `ddev ssh`, logs
- Create, clone or add an existing project (Laravel, WordPress, Symfony, Drupal, CodeIgniter, CakePHP, Craft, PHP…)
- Embedded terminal for every job
- English and Spanish, light and dark themes

Still to port from the GTK app: Git tab, code editor, `.env` editor, snapshots, database import/export,
Node.js projects, pm2 Deploy tab, tray icon, share/tunnels, update check.

## Requirements

[Docker](https://www.docker.com/products/docker-desktop/) and [DDEV](https://ddev.readthedocs.io/en/stable/users/install/)
installed (on Windows, DDEV with Docker Desktop or WSL2). The app tells you if either is missing.

## Development

```bash
npm install
npm run dev        # run with hot reload
npm test           # unit tests
npm run typecheck
npm run dist:win   # installer in dist/ (also dist:linux, dist:mac)
```

New projects are created by default in `D:\laragon\www` on Windows (when it exists) and `~/projects` elsewhere;
change it in Settings.

## License

MIT
