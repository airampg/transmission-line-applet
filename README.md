# Transmission-line reactive power applet

Interactive React applet for visualising the reactive power absorption/injection of a balanced three-phase transmission line using a nominal-pi model in per unit.

## Features

- 220 kV and 400 kV normalised line parameter sets.
- Per-unit formulation with MW/MVAr display based on selected MVA base.
- Adjustable line length, sending-end voltage, and receiving-end load.
- Reactive-power balance separating series absorption and shunt injection.
- Load sweeps for line reactive power and receiving-end voltage.
- Zoom, pan, and manual MW-range controls on plots.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deployment

This repository is configured to deploy to GitHub Pages using GitHub Actions.
