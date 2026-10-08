#!/bin/bash
# Runs at login (LaunchAgent installed by install.sh). Re-applies Spicetify if Spotify updated
# itself and wiped the mods. Logs to ~/.spicetify/npv-repair.log.

EXT="nowPlayingVisualizer.js"
SPICE_DIR="$HOME/.spicetify"
SPICE="$SPICE_DIR/spicetify"
STATE="$SPICE_DIR/npv-spotify-version.txt"
LOG="$SPICE_DIR/npv-repair.log"
log() { echo "$(date '+%Y-%m-%dT%H:%M:%S')  $1" >> "$LOG"; }

[ -x "$SPICE" ] || SPICE=$(command -v spicetify) || exit 0
APP=""
for p in "/Applications/Spotify.app" "$HOME/Applications/Spotify.app"; do [ -d "$p" ] && APP="$p" && break; done
[ -n "$APP" ] || exit 0

version=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist" 2>/dev/null)
stored=$(cat "$STATE" 2>/dev/null)
index="$APP/Contents/Resources/Apps/xpui/index.html"
if [ "$version" = "$stored" ] && grep -q "$EXT" "$index" 2>/dev/null; then exit 0; fi

log "Spotify $stored -> $version; repairing"
# Patching fetches a CSS map online, and the network may not be up right after login.
for attempt in 1 2 3 4; do
  for args in "backup apply" "restore backup apply" "apply"; do
    # shellcheck disable=SC2086
    out=$("$SPICE" $args 2>&1)
    if [ $? -eq 0 ] && ! printf '%s' "$out" | grep -qiE '^[[:space:]]*(error|fatal)([[:space:]]|$)'; then
      echo "$version" > "$STATE"
      log "repaired with: spicetify $args"
      exit 0
    fi
  done
  log "attempt $attempt failed: $(printf '%s' "$out" | grep -v 'Patching files' | tail -n 3 | tr '\n' ' ')"
  sleep 30
done
exit 1
