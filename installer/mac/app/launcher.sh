#!/bin/bash
# Executable of "Now Playing Visualizer Installer.app".
# Asks Install / Uninstall in a native dialog, then runs the matching script from GitHub in a
# Terminal window, so people can see progress and answer its questions. It writes a fresh
# .command file and opens that in Terminal, which (unlike scripting Terminal) needs no
# "wants to control Terminal" permission.

RAW="https://raw.githubusercontent.com/vicsvegeo/spicetify-now-playing-visualizer/main/installer/mac"

choice=$(osascript <<'EOF'
try
  set r to display dialog "Now Playing Visualizer turns the album art in Spotify's Now Playing view into a live, beat-synced visualizer." & return & return & "A Terminal window will open to show the progress." with title "Now Playing Visualizer" buttons {"Cancel", "Uninstall", "Install"} default button "Install" cancel button "Cancel" with icon note
  return button returned of r
on error
  return "Cancel"
end try
EOF
)

case "$choice" in
  Install) script="install.sh" ;;
  Uninstall) script="uninstall.sh" ;;
  *) exit 0 ;;
esac

cmd="$(mktemp -d)/now-playing-visualizer.command"
cat > "$cmd" <<EOF
#!/bin/bash
clear
curl -fsSL "$RAW/$script" | bash
echo
read -n 1 -s -r -p "Press any key to close this window."
rm -f "\$0"
EOF
chmod +x "$cmd"
open -a Terminal "$cmd"
