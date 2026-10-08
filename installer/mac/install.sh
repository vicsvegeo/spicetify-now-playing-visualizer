#!/bin/bash
# Now Playing Visualizer - macOS installer.
#   curl -fsSL https://raw.githubusercontent.com/vicsvegeo/spicetify-now-playing-visualizer/main/installer/mac/install.sh | bash
# Installs Spotify (if needed), Spicetify, the Spicetify Marketplace and the visualizer, and adds
# a login item that re-applies everything after Spotify updates itself.
# Written for the bash 3.2 that ships with macOS.

set -u

OWNER="vicsvegeo"
REPO="spicetify-now-playing-visualizer"
EXT="nowPlayingVisualizer.js"
RAW="https://raw.githubusercontent.com/$OWNER/$REPO/main"
SPICE_DIR="$HOME/.spicetify"
SPICE="$SPICE_DIR/spicetify"
AGENT_ID="com.github.$OWNER.nowplayingvisualizer"
AGENT="$HOME/Library/LaunchAgents/$AGENT_ID.plist"
REPAIR="$SPICE_DIR/npv-repair.sh"

bold=$(printf '\033[1m'); green=$(printf '\033[32m'); red=$(printf '\033[31m'); dim=$(printf '\033[2m'); reset=$(printf '\033[0m')
step() { printf '%s\n' "${bold}==>${reset} $1"; }
ok()   { printf '%s\n' "${green}✓${reset} $1"; }
fail() { printf '\n%s\n' "${red}✗ $1${reset}"; exit 1; }
# Prompts read from the terminal even though the script itself arrives through a pipe.
ask()  { printf '%s' "$1 [Y/n] "; read -r reply < /dev/tty; case "$reply" in [nN]*) return 1 ;; *) return 0 ;; esac; }
wait_enter() { printf '%s' "$1 "; read -r _ < /dev/tty; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS. On Windows, use NowPlayingVisualizer-Setup.exe from the Releases page."
[ "$(id -u)" -ne 0 ] || fail "Please run this without sudo."

spotify_app() {
  for p in "/Applications/Spotify.app" "$HOME/Applications/Spotify.app"; do
    [ -d "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

# Runs spicetify and fails on its "error"/"fatal" lines too, not only on the exit code.
spice() {
  out=$("$SPICE" "$@" 2>&1); code=$?
  if [ $code -ne 0 ] || printf '%s' "$out" | grep -qiE '^[[:space:]]*(error|fatal)([[:space:]]|$)'; then return 1; fi
  return 0
}

explain_permission() {
  cat <<EOF

${bold}macOS blocked Terminal from changing the Spotify app.${reset}
To allow it:
  1. Open ${bold}System Settings → Privacy & Security → App Management${reset}
  2. Turn on ${bold}Terminal${reset}
  3. Run the install command again.
EOF
}

apply_with_fallbacks() {
  for args in "backup apply" "restore backup apply" "apply"; do
    # shellcheck disable=SC2086
    if spice $args; then return 0; fi
    printf '%s\n' "${dim}   (\"spicetify $args\" didn't work, trying another way...)${reset}"
  done
  printf '%s\n' "$out" | grep -v "Patching files" | tail -n 12
  if printf '%s' "$out" | grep -qiE 'operation not permitted|permission denied'; then explain_permission; fi
  return 1
}

printf '\n%s\n\n' "${bold}Now Playing Visualizer${reset} — turns Spotify's album art into a live visualizer."

# 1. Spotify
if ! APP=$(spotify_app); then
  step "Downloading Spotify..."
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/SpotifyInstaller.zip" "https://download.scdn.co/SpotifyInstaller.zip" || fail "Couldn't download Spotify. Check your internet connection."
  ditto -x -k "$tmp/SpotifyInstaller.zip" "$tmp" || fail "Couldn't unpack the Spotify installer."
  installer_app=$(find "$tmp" -maxdepth 1 -name "*.app" | head -n 1)
  [ -n "$installer_app" ] || fail "The Spotify download didn't contain an installer."
  step "Installing Spotify (a Spotify window will open)..."
  open "$installer_app"
  for _ in $(seq 1 180); do APP=$(spotify_app) && break; sleep 2; done
  APP=$(spotify_app) || fail "Spotify didn't finish installing. Install it from spotify.com, then run this again."
  rm -rf "$tmp"
fi
ok "Spotify found: $APP"

# 2. Spicetify needs Spotify to have been opened and logged in once.
PREFS="$HOME/Library/Application Support/Spotify/prefs"
if [ ! -f "$PREFS" ]; then
  open -a "$APP"
  wait_enter "Spotify is open. Log in (or sign up), then come back here and press Enter..."
  [ -f "$PREFS" ] || { sleep 5; [ -f "$PREFS" ]; } || fail "Spotify hasn't been set up yet. Open Spotify, log in, then run this again."
fi

# 3. Spicetify
if [ ! -x "$SPICE" ]; then
  if command -v spicetify >/dev/null 2>&1; then
    SPICE=$(command -v spicetify)
  else
    step "Downloading Spicetify..."
    case $(uname -m) in arm64) target="darwin-arm64" ;; *) target="darwin-amd64" ;; esac
    tag=$(curl -fsSL -H 'Accept: application/json' https://github.com/spicetify/cli/releases/latest | sed -E 's/.*"tag_name":"v?([^"]+)".*/\1/')
    [ -n "$tag" ] || fail "Couldn't find the latest Spicetify version. Check your internet connection."
    mkdir -p "$SPICE_DIR"
    curl -fsSL -o "$SPICE_DIR/spicetify.tar.gz" "https://github.com/spicetify/cli/releases/download/v$tag/spicetify-$tag-$target.tar.gz" \
      || fail "Couldn't download Spicetify."
    tar xzf "$SPICE_DIR/spicetify.tar.gz" -C "$SPICE_DIR" && rm -f "$SPICE_DIR/spicetify.tar.gz"
    chmod +x "$SPICE"
    # Put spicetify on the PATH for future terminals, like its official installer does.
    rc="$HOME/.zshrc"; case "${SHELL:-}" in *bash) rc="$HOME/.bash_profile" ;; esac
    grep -q "$SPICE_DIR" "$rc" 2>/dev/null || printf '\nexport PATH=$PATH:%s\n' "$SPICE_DIR" >> "$rc"
  fi
fi
ok "Spicetify ready"
USERDATA=$("$SPICE" path userdata 2>/dev/null | tail -n 1)
[ -d "$USERDATA" ] || USERDATA="$HOME/.config/spicetify"

# 4. Marketplace (same steps as its official install script)
if [ ! -f "$USERDATA/CustomApps/marketplace/index.js" ]; then
  step "Installing the Spicetify Marketplace..."
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/marketplace.zip" "https://github.com/spicetify/marketplace/releases/latest/download/marketplace.zip" \
    || fail "Couldn't download the Marketplace."
  ditto -x -k "$tmp/marketplace.zip" "$tmp/x"
  mkdir -p "$USERDATA/CustomApps"
  rm -rf "$USERDATA/CustomApps/marketplace"
  if [ -d "$tmp/x/marketplace-dist" ]; then mv "$tmp/x/marketplace-dist" "$USERDATA/CustomApps/marketplace"; else mv "$tmp/x" "$USERDATA/CustomApps/marketplace"; fi
  rm -rf "$tmp"
fi
"$SPICE" config custom_apps spicetify-marketplace- -q >/dev/null 2>&1
"$SPICE" config custom_apps 2>/dev/null | grep -qx "marketplace" || "$SPICE" config custom_apps marketplace >/dev/null 2>&1
"$SPICE" config inject_css 1 replace_colors 1 >/dev/null 2>&1
if "$SPICE" path -s 2>&1 | grep -qiE '(^|[^a-z])(fatal|error)([^a-z]|$)'; then
  # No theme set: Marketplace needs its placeholder theme to be able to install themes.
  mkdir -p "$USERDATA/Themes/marketplace"
  curl -fsSL -o "$USERDATA/Themes/marketplace/color.ini" "https://raw.githubusercontent.com/spicetify/marketplace/main/resources/color.ini"
  "$SPICE" config current_theme marketplace >/dev/null 2>&1
fi
ok "Marketplace ready"

# 5. The visualizer (always the latest version, so running this again = updating)
step "Downloading the visualizer..."
mkdir -p "$USERDATA/Extensions"
curl -fsSL -o "$USERDATA/Extensions/$EXT" "$RAW/$EXT" || fail "Couldn't download the visualizer."
"$SPICE" config extensions 2>/dev/null | grep -qx "$EXT" || "$SPICE" config extensions "$EXT" >/dev/null 2>&1

# 6. Patch Spotify
step "Adding everything to Spotify (Spotify will restart)..."
apply_with_fallbacks || fail "Spicetify couldn't patch Spotify (see the message above)."
ok "Visualizer installed"

# 7. Auto-repair after Spotify updates
if ask "Automatically repair after Spotify updates? (recommended)"; then
  curl -fsSL -o "$REPAIR" "$RAW/installer/mac/repair.sh" && chmod +x "$REPAIR"
  /usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist" > "$SPICE_DIR/npv-spotify-version.txt" 2>/dev/null
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AGENT_ID</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$REPAIR</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
  launchctl unload "$AGENT" >/dev/null 2>&1
  launchctl load "$AGENT" >/dev/null 2>&1
  ok "Auto-repair is on: the visualizer comes back by itself after Spotify updates."
fi

printf '\n%s\n\n' "${green}${bold}All done!${reset} Open the Now Playing view in Spotify (the panel on the right) and play a song."
