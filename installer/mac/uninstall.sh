#!/bin/bash
# Now Playing Visualizer - macOS uninstaller.
#   curl -fsSL https://raw.githubusercontent.com/vicsvegeo/spicetify-now-playing-visualizer/main/installer/mac/uninstall.sh | bash

OWNER="vicsvegeo"
EXT="nowPlayingVisualizer.js"
SPICE_DIR="$HOME/.spicetify"
SPICE="$SPICE_DIR/spicetify"
AGENT="$HOME/Library/LaunchAgents/com.github.$OWNER.nowplayingvisualizer.plist"

[ -x "$SPICE" ] || SPICE=$(command -v spicetify)

# Auto-repair
launchctl unload "$AGENT" >/dev/null 2>&1
rm -f "$AGENT" "$SPICE_DIR/npv-repair.sh" "$SPICE_DIR/npv-spotify-version.txt" "$SPICE_DIR/npv-repair.log"

if [ -z "$SPICE" ] || [ ! -x "$SPICE" ]; then
  echo "Spicetify isn't installed, so there's nothing else to remove."
  exit 0
fi
USERDATA=$("$SPICE" path userdata 2>/dev/null | tail -n 1)

printf '%s' "Put Spotify completely back to normal? This also removes Spicetify, the Marketplace and anything installed from it. [y/N] "
read -r reply < /dev/tty
case "$reply" in
  [yY]*)
    "$SPICE" restore
    [ -d "$USERDATA" ] && rm -rf "$USERDATA"
    rm -rf "$SPICE_DIR"
    echo "Done. Spotify is back to normal."
    ;;
  *)
    "$SPICE" config extensions "$EXT-" >/dev/null 2>&1
    [ -n "$USERDATA" ] && rm -f "$USERDATA/Extensions/$EXT"
    "$SPICE" apply
    echo "Done. The visualizer has been removed."
    ;;
esac
