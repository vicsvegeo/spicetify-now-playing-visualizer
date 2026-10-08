# Now Playing Visualizer

Turns the album art in Spotify's **Now Playing** view into a live, beat-synced visualizer, right where the cover normally is.

![The visualizer in Spotify's full screen view](docs/preview.jpg)

- **Side panel:** a ring of bars around a spinning cover, pulsing on every beat, in colors taken from the album art.
- **Songs with a looping Canvas video:** the visualizer replaces the video. A **Switch to Canvas / Switch to visualizer** button lets you flip between them.
- **Expanded view and full screen:** a much bigger version with a starfield, particle bursts, shockwaves and a full-width spectrum. Turn it on and off with the **bars** button in the top-right mode switcher, next to Spotify's own artwork, Canvas and lyrics buttons.

<img src="docs/panel.jpg" alt="The visualizer in the side panel" width="360">

---

## Install

### Already using the Spicetify Marketplace?
Open **Marketplace** in Spotify's sidebar → **Extensions** → search **Now Playing Visualizer** → **Install**.

### Windows
1. Download **[NowPlayingVisualizer-Setup.exe](https://github.com/vicsvegeo/spicetify-now-playing-visualizer/releases/latest/download/NowPlayingVisualizer-Setup.exe)**.
2. Double-click it.
   If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. It shows that for any free app that hasn't paid for a code-signing certificate. Everything it does is in [`installer/windows/Setup.cs`](installer/windows/Setup.cs).
3. Click **Install** and follow the prompts. Spotify will restart with the visualizer.

The installer sets up everything it needs: the normal Spotify app (if you have the Microsoft Store version, it asks before swapping it), [Spicetify](https://spicetify.app) and the Spicetify Marketplace.

### Mac
1. Open **Terminal**: press <kbd>⌘ Cmd</kbd> + <kbd>Space</kbd>, type `Terminal`, press <kbd>Enter</kbd>.
2. Copy this line, paste it into Terminal, and press <kbd>Enter</kbd>:
   ```
   curl -fsSL https://raw.githubusercontent.com/vicsvegeo/spicetify-now-playing-visualizer/main/installer/mac/install.sh | bash
   ```
3. Answer the questions it asks. Spotify will restart with the visualizer.

If it says **macOS blocked Terminal from changing the Spotify app**, open **System Settings → Privacy & Security → App Management**, turn on **Terminal**, and run the line again.

---

## When Spotify updates
Spotify updates remove all mods, including this one. If you left **auto-repair** on during install, it puts the visualizer back by itself the next time you log in to your computer.

To fix it right away, run the installer again (Windows), or paste the install line again (Mac).

## Uninstall
- **Windows:** run `NowPlayingVisualizer-Setup.exe` and click **Uninstall**.
- **Mac:** paste this into Terminal:
  ```
  curl -fsSL https://raw.githubusercontent.com/vicsvegeo/spicetify-now-playing-visualizer/main/installer/mac/uninstall.sh | bash
  ```
- **Marketplace:** Marketplace → Extensions → Now Playing Visualizer → **Remove**.

Each one asks whether to remove just the visualizer or put Spotify completely back to normal.

---

## Questions

**Some songs only show a faint, slow ring.**
The visualizer follows Spotify's own analysis of each song (beats, loudness, pitch). Spotify doesn't have that for every song. When a song is missing it, the visualizer looks for another release of the same recording (same title, artist and length) and uses that one's analysis. If there isn't one, it falls back to a gentle idle animation.

**Does it react to my volume or EQ?**
No. It follows Spotify's analysis of the song in time with playback, not the sound coming out of your speakers.

**Does it work with themes and other extensions?**
It should. It only draws over the cover art and adds two buttons. If something clashes, please [open an issue](https://github.com/vicsvegeo/spicetify-now-playing-visualizer/issues).

**It stopped working after a Spotify update.**
Run the installer again first. If it's still broken, Spotify may have changed its layout. Please [open an issue](https://github.com/vicsvegeo/spicetify-now-playing-visualizer/issues) with your Spotify version (Spotify menu → About).

---

## For developers
- [`nowPlayingVisualizer.js`](nowPlayingVisualizer.js) is the whole extension: one file with no dependencies, drawn on a 2D canvas.
- Manual install: copy it into your Spicetify `Extensions` folder, then run `spicetify config extensions nowPlayingVisualizer.js` and `spicetify apply`.
- The Windows installer builds with the C# compiler that ships with Windows: `powershell -ExecutionPolicy Bypass -File installer\windows\build.ps1`.

Built on [Spicetify](https://spicetify.app). Not affiliated with Spotify.

## License
[MIT](LICENSE)
