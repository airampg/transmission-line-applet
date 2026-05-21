# Transmission-line reactive power applet

**Live app:** <https://airampg.github.io/transmission-line-applet/>

Interactive React applet for visualising the reactive power absorption/injection of a balanced three-phase transmission line using a nominal-pi model in per unit.

## Features

- 220 kV and 400 kV normalised line parameter sets.
- Per-unit formulation with MW/MVAr display based on selected MVA base.
- Adjustable line length, sending-end voltage, and receiving-end load.
- Reactive-power balance separating series absorption and shunt injection.
- Load sweeps for line reactive power and receiving-end voltage.
- Zoom, pan, and manual MW-range controls on plots.

## Transmission-line parameter source

The 220 kV and 400 kV normalised positive-sequence line parameters are taken from:

Government of Spain, “Transmission Network Development Criteria,” *Official State Gazette* (BOE), 9 Apr. 2005. [Online]. Available: <https://www.boe.es/diario_boe/txt.php?id=BOE-A-2005-5757> (in Spanish).

## Development

```bash
npm install
npx vite --host 0.0.0.0
```

## Build

```bash
npm install
npx vite build
```

## Deployment

This repository is configured to deploy to GitHub Pages using GitHub Actions.

The site is published at:

```text
https://airampg.github.io/transmission-line-applet/
```
