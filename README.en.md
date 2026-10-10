# MicroPython Web Lab

[日本語](README.md) | **English**

MicroPython Web Lab is an unofficial development and learning environment that runs MicroPython in a
Dedicated Web Worker in your browser. It is not an official project of the MicroPython project,
MicroPython.org, Raspberry Pi Ltd, or any device manufacturer mentioned here, and does not imply an
affiliation with or endorsement by any of them.

Raspberry Pi is a trademark of Raspberry Pi Ltd.

## First use

Browsers without saved code open the First experiment screen. Press Run to blink the built-in LED,
then change 500 to 200 in `interval_ms = 500` and run it again. Open workspace to use the device list,
wiring editor, debugger, and REPL. Stop, error output, and restart remain available in the simple screen. Press Esc, then Tab to leave the editor.

Choose Try a button to open a sample that reads the virtual push button for eight seconds after Run.
Press and release the button repeatedly; each state change prints `Button: pressed` or `Button: released`
in Output and REPL. Run the script again to repeat the test.

Switching screens preserves code, Python runtime state, and wiring. Your screen choice is saved as an
independent browser-local preference. Existing saved projects and local Device development default to
the full workspace. Reopening First experiment prepares a sample tab without replacing existing code.
Guide progress restarts on reload while edited code is retained. Invalid saved editor data keeps the
workspace visible with the existing error message.

## Key features

- A browser-based MicroPython REPL
- A multi-tab code editor with normal and debug execution
- Stop, reset with Ctrl+D, Worker replacement, and runtime and output limits
- Functional GPIO, ADC, PWM, I2C, SPI, and UART models for the Pico 2 W
- Virtual-device wiring and sample code
- Browser-local storage for editor content and connection settings
- Japanese and English user interfaces

This is not a complete MCU or electronic-circuit simulator. It does not reproduce instruction-level or
clock-level behavior or electrical characteristics. Components such as LEDs are functional models that
include resistors and other details needed for learning exercises.

Pressing Ctrl+D at an empty primary REPL prompt replaces the Worker and resets Python variables and
execution state while preserving editor content and connection settings. Pressing Ctrl+D at an empty
continuation prompt executes the multiline input instead. Combined standard output and standard error are
limited to 100,000 characters, after which the runtime recovers automatically.

In the full workspace, when the window is too short, scroll the page to keep working. At widths of 960px or more,
the code area retains about ten visible lines and the REPL about six. Use Normal, Expand editor,
or Expand REPL in the workspace toolbar to change views without losing code, unfinished input,
or runtime state. Below 960px, expanded views also hide the virtual board until you return to Normal.
Views apply only to the current page and return to Normal after reload.
Stop stays at the top while scrolling within the workspace.

## Project files and ZIP

**Project files** shows folders and files below `/project` as a tree. Click a folder to expand or
collapse it; double-click a file or press Enter to open it. Use arrow keys to navigate and the left/right
keys to collapse or expand folders. Select an entry to save editor contents to a path, create directories,
rename entries, and delete files or empty directories. Closing a tab keeps its saved file.
Restoring the initial sample changes the editor and keeps project files.

Editor changes are autosaved; **Save in this browser** saves immediately. Files written by Python,
including binary files, deletions, and renames, are saved to IndexedDB and restored after browser or
Worker restarts. Save failures appear in the save status. Forced stops and abnormal page exits can
lose changes that have not finished saving. Concurrent browser windows use the last saved state.

The initial working directory is `/project`; imports search `/project` and `/project/lib`.
Save `drivers/__init__.py` and `drivers/sensor.py` to use `from drivers.sensor import Sensor`.
Imported modules remain cached after edits: restart, or press Ctrl+D at the empty main prompt,
to reload them. Debug stepping covers the selected file.

File contents are limited to 4 MiB in total, with at most 1,024 files/directories and 240 UTF-8 bytes
per relative path. Python growth is checked before allocation and raises a no-space `OSError`.
Names are case-sensitive; ordinary file writes are limited to `/project`.

**Download ZIP** saves all editor tabs before exporting ordinary uncompressed ZIP contents, including
binary data and empty directories. Extract, edit and re-zip files on your PC to import them again.
ZIP paths map to `/project`; select an import source directory to remove a containing folder.
After validation and confirmation, importing replaces all project files and editor tabs without
running code. Connections and runtime state are not included. Failed imports preserve the current project.

Imports support stored/Deflate entries and UTF-8 flagged or ASCII names. Encryption, split archives,
ZIP64 and symlinks are unsupported. Input is limited to 8 MiB, expanded contents to 4 MiB,
entries to 1,024 and processing to 15 seconds. Deflate requires the browser's
`DecompressionStream("deflate-raw")`; unsupported environments report an import error.

See [ADR 0035](docs/adr/0035-add-a-persistent-project-filesystem.md) for architecture and migration details.

## Public alpha and supported environments

This project is in public alpha. The UI, features, and browser storage format may change. Editor content
and connection settings are stored only in the browser and are not synchronized between devices or backed
up on the server. Keep a separate copy of important code in case browser data is cleared or the storage
format changes.

The public alpha supports Chrome and Edge on Windows 11, and Chrome, Firefox, and Safari on macOS running
on Apple Silicon. Intel Macs are not supported. See
[Browser and OS verification (Japanese)](docs/browser-compatibility.md) for the tested OS and browser
versions, verification scope, and unverified areas such as IME composition, touch input, and GPU-specific
behavior.

## Development environment

Use the Node.js and pnpm versions pinned by this project. The following commands set up and start the
development server without modifying your global environment:

```sh
./scripts/setup-node.sh
./scripts/use-node.sh pnpm install --frozen-lockfile
./scripts/use-node.sh pnpm dev
```

Open `http://127.0.0.1:4173/` in a browser. Because the app uses `SharedArrayBuffer`, the development server
and production deployment must send security headers including COOP and COEP.

## Verification

```sh
./scripts/use-node.sh pnpm check
```

You can also run the unit tests, type checking and build, and browser tests separately:

```sh
./scripts/use-node.sh pnpm test
./scripts/use-node.sh pnpm build
./scripts/use-node.sh pnpm test:e2e
```

See [Browser and OS verification (Japanese)](docs/browser-compatibility.md) for instructions covering the
release versions of Chrome, Edge, Firefox, and Safari on supported operating systems.

## Static deployment

Run `./scripts/use-node.sh pnpm build:sakura` to produce a distribution for Sakura Rental Server. The
deployment workflow also supports Basic-authenticated rehearsals. See the
[deployment guide (Japanese)](docs/deployment.md) for deployment, HTTPS configuration, and post-deployment
verification.

## Security and privacy

MicroPython code runs in the browser. During normal use, editor content and REPL history are not sent to
the server. User code is not given access to the DOM, unrestricted networking, or all browser storage.
Browser-side execution alone does not, however, guarantee a complete sandbox.

See the [threat model (Japanese)](docs/threat-model.md) for the trust boundaries and known limitations, and
[SECURITY.md](SECURITY.md) (Japanese) for vulnerability reporting instructions.

See the [architecture overview (Japanese)](docs/architecture.md) for the current structure and the
responsibilities of each layer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (Japanese) and [AGENTS.md](AGENTS.md) (Japanese) for development
policies and verification requirements. See the
[Device API v1 specification (Japanese)](docs/device-api-v1.md) and
[device development guide (Japanese)](docs/device-development.md) for the virtual-device contract and local
verification workflow.

See [SUPPORT.md](SUPPORT.md) (Japanese) for the scope of bug reports, feature proposals, and general
questions, as well as requests for which a response is not guaranteed. Public release changes are recorded
in [CHANGELOG.md](CHANGELOG.md) (Japanese).

## License

This repository is licensed under the MIT License. The bundled MicroPython artifacts and third-party code
remain subject to their respective licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
(Japanese), the license notices in each directory, and the version metadata for details.
