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
- Python keyword, string, and comment highlighting, line numbers, and a highlighted caret line
- A yellow arrow for the paused debugger line and red dots for breakpoints
- Stop, reset with Ctrl+D, Worker replacement, and output limits (no execution deadline during alpha)
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

## Workspace layout

At widths of 960px or more, the workspace has three panes: project files and examples on the left,
the editor and output/REPL in the center, and live devices on the right. Drag or use arrow keys to resize
the center/device boundary and the editor/REPL boundary. Narrower windows stack the panes vertically.

The file tree starts expanded. Open “File operations / ZIP” for file creation, save-as, renaming,
deletion, and ZIP transfer. Examples from the library or a device card open as “Untitled” tabs,
keeping your existing code. Choose “Save active tab”, select a directory, enter a file name, and click Save.
A successful save adds the file to the tree and renames the tab. A tab with a file path saves to that file;
“Save active tab as…” always opens the chooser. The editor's save button uses the same flow.
Untitled tabs remain browser drafts, including after reload, and are excluded from the file tree and ZIP
until named. Create new directories using the file operations before selecting them in the chooser.
Cancellation or failed storage writes preserve the unnamed draft.
Expand the multiline REPL input only when needed.
The multi-device example list displays consecutive rows without blank spacing between them.

“Devices and wiring” opens a dedicated wiring view. Return with “Back to workspace”. Navigation preserves
the Worker, editor, REPL draft, Python variables, and pending wiring edits. Applying wiring still recreates
the Worker. Stop and Restart remain available in the wiring view. Device cards use content-dependent heights
and two columns when the device pane is wide enough. Collapsing a card leaves its simulation running.
The existing saved device order is preserved; card collapse and multiline input visibility are page-local.

## Editor and debugger

While paused, use `b 10` in the pdb command field to set a breakpoint on line 10, and `cl 10` to remove it.
Use `cl` alone to clear every breakpoint. Breakpoints are reset when execution ends or the runtime restarts.

During alpha, scripts, REPL code, and debug runs have no execution deadline. Long computations and input
waits can continue beyond the former ten-second limit. Stop an infinite loop with **Stop** or Cmd/Ctrl+C
inside the REPL; use **Restart** after stopping. A silent loop can keep consuming local CPU until stopped.
The host retains an optional watchdog, while the output, Python heap, and file-size limits remain active.
YM2203 reservations now support up to about 49.7 days, including native repetition for a 24-hour performance.
See [ADR 0045 (Japanese)](docs/adr/0045-disable-the-default-execution-deadline-for-alpha.md).

## Project files and ZIP


**Project files** shows folders and files below `/project` as a tree. Click a folder to expand or
collapse it; double-click a file or press Enter to open it. Use arrow keys to navigate and the left/right
keys to collapse or expand folders. **Create file** opens an empty **Untitled** tab.
Select the parent directory (or `/project` for the root), then use **Create directory** to enter its name.
When a file is selected, the new directory is created beside it in its parent directory. **Rename** opens a dialog for the selected entry's
name, keeping its parent directory. **Delete** removes the selected entry; non-empty directories require
confirmation before deleting all descendants. **Move** lets you choose a destination directory while
keeping the name. It moves all descendants and updates open tab paths. A directory cannot move into itself
or a descendant, and existing entries are never overwritten. The `/project` root cannot be renamed, moved or deleted.
Files can also be dragged onto a directory row, or onto `/project` to move them to the root. Dropping onto
the current parent or dragging from outside the tree does not move anything. Use **Move** if dragging is unavailable.
Tabs matching their saved files close without confirmation. Changed and untitled tabs ask whether to
close without saving. Unsaved tabs display a leading `●`, such as `●blink.py`; successful file saves
remove it. Reverting to the saved content also removes it. Automatic recovery backups keep all unsaved
tabs marked, including `●Untitled`. Closing a tab keeps its saved file; discarding changes
preserves the saved content. Closing an untitled tab discards its
draft, so save it as a file first if you want to keep it.
Restoring the initial sample changes the editor and keeps project files.

After 400 ms, editor changes are automatically backed up as recovery drafts, separately from file contents.
Reopening the page restores named and untitled drafts, the active tab, and unsaved markers. Only explicit
**Save active tab** writes editor contents to a file. Running executes the current buffer; imports and
`open()` use saved files. Untitled tabs remain browser drafts until **Save active tab** assigns a
directory and file name; they are excluded from the file tree and ZIP export until then. Create a directory
through file operations before choosing it in the save dialog. Files written by Python,
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

**Download ZIP** exports saved files as an ordinary uncompressed ZIP, including binary data and empty
directories. Unsaved edits and untitled drafts are excluded; explicitly save each tab you want to include.
Extract, edit and re-zip files on your PC to import them again.
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

## FM + SSG audio prototype

In the normal workspace, use the connection editor to connect **YM2203 sound module (experimental)**
and apply the connections. The audio engine prepares automatically and the speaker starts muted.
Toggle **Mute** on its device card to unmute, open its sample, and run it.
It uses I2C0 / 0x44, SDA=GP8, SCL=GP9. Connections and code use the normal persistence;
the speaker starts muted after a reload or reconnection. Disconnecting closes the audio engine.
Mute affects the speaker output only; it does not stop playback or change the volume slider.
Opening the sound sample also adds an editable project-local Python driver. It provides three FM presets,
MIDI notes and rests, immediate notes, and short scheduled melodies. Existing custom driver files are preserved.
See the [driver guide (Japanese)](docs/devices/ym2203-driver.md).
The separate **Ensemble sample** schedules melody, accompaniment, and bass across three FM and three SSG channels on one timeline.
**Patch sample** adds Python control over all four FM operators, algorithm and feedback, plus SSG noise and envelope settings.
**Patch editor** shows operator connections, lets you audition edited settings, and exports them to a new Python tab.
The exported tab is unsaved. Use **Save** and choose a path to include it in project files and ZIP exports.
**Audition mode** offers a short 1.5-second preview or continuous audition that follows setting changes until stopped.
Closing the editor or moving to a background tab also stops continuous audition. FM envelope decay follows the patch settings.
**Music sample** opens the complete 12.02-second, three-channel FM version of the public CC0 piece **Pocket Signal**.
Change `REPEAT_MS = None` to `REPEAT_MS = 24 * 60 * 60 * 1000` for a 24-hour repeat.
The audio engine reuses a pattern of at most 131,071 events; memory does not grow with playback duration.
Opening a sample upgrades exact known bundled libraries and restarts the runtime; custom edits remain protected.
For conflicts, **Back up and update** keeps original files and unsaved drafts in `ym2203-backups/` before updating.
Its instruments and score are editable, with source and license notices retained in the code.
See the [adaptation and provenance guide (Japanese)](docs/devices/pocket-signal.md).
The card distinguishes sent commands, worklet acceptance and audio processing, and shows reservation time, event progress and completion.
Both `sound.volume(50)` in Python (range 0–100) and **Speaker volume** affect the output. A peak limiter bounds loud ensembles.
Output is stronger than in the initial prototype; start with a lower setting after updating and adjust it to taste.

The main samples are FM / SSG voices, Simple MML, and a streaming BIN player.
Ensemble, patch controls and Pocket Signal remain as additional examples.
See the [WYM1 binary format](docs/devices/ym2203-bin-format.md) and
[conversion prompt](docs/devices/ym2203-conversion-prompt.md).

Store locally generated playback-test BINs, import ZIPs, input logs and conversion records in
`local-test-data/ym2203/<test-name>/`. The entire directory is ignored by Git and excluded from
the remote repository and bundled samples. It is a storage location separate from caches.

Open `/fm-prototype.html`, enable audio, and run the sample to hear an I2C-controlled YM2203 module.
The sample plays C–D–E–F–G–F–E–D–C using FM alone, then SSG alone, at the same pitch and tempo.
Python can finish while playback continues. Stop, restart, mute, bounded scheduling, and failure recovery
are included. This prototype does not persist edits or emulate BUSY, timers, IRQ, CSM, or analog circuitry.
See [the prototype guide](docs/devices/ym2203-prototype.md) for the I2C contract and rebuild commands.
