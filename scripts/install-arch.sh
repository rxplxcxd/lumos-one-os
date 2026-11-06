#!/usr/bin/env bash
# Lumos One — Arch Linux installer for the handheld (Framework 13 mainboard).
# Run as root on a fresh Arch install with network:  sudo bash scripts/install-arch.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
KIOSK_USER="${LUMOS_USER:-lumos}"
ROOT=/opt/lumos
VERSION="$(node -p "require('$REPO/package.json').version" 2>/dev/null || echo 1.0.0)"

[[ $EUID -eq 0 ]] || { echo "bitte als root ausführen"; exit 1; }

echo "==> Pakete installieren"
pacman -Syu --needed --noconfirm \
  base-devel git nodejs npm python python-pip python-websockets python-pyserial python-evdev python-opencv python-cryptography \
  gamescope xorg-xwayland xorg-xprop mesa vulkan-radeon libva-mesa-driver \
  pipewire pipewire-pulse wireplumber playerctl \
  networkmanager bluez bluez-utils flatpak v4l-utils greetd \
  power-profiles-daemon pacman-contrib

# AUR helpers for hardware tools (Howdy, ryzenadj, framework_tool, IR emitter, BLE)
if ! command -v yay >/dev/null; then
  echo "==> yay (AUR-Helper) bauen"
  sudo -u "${SUDO_USER:-nobody}" bash -c 'cd /tmp && rm -rf yay-bin && git clone https://aur.archlinux.org/yay-bin.git && cd yay-bin && makepkg -si --noconfirm' || echo "!! yay konnte nicht gebaut werden – AUR-Pakete manuell installieren"
fi
if command -v yay >/dev/null; then
  sudo -u "${SUDO_USER:-root}" yay -S --needed --noconfirm howdy-bin ryzenadj-git framework-system-git linux-enable-ir-emitter python-bleak python-sdnotify xpadneo-dkms || true
fi

echo "==> Benutzer $KIOSK_USER"
id "$KIOSK_USER" &>/dev/null || useradd -m -G input,video,uucp,audio "$KIOSK_USER"
usermod -aG input,video,uucp,audio "$KIOSK_USER"

echo "==> Shell bauen"
cd "$REPO"
sudo -u "${SUDO_USER:-root}" npm ci
sudo -u "${SUDO_USER:-root}" npx vite build
sudo -u "${SUDO_USER:-root}" npx electron-builder --linux dir

echo "==> Release $VERSION nach $ROOT installieren (atomar)"
REL="$ROOT/releases/$VERSION"
install -d "$ROOT/releases" "$ROOT/cache"
rm -rf "$REL.tmp"
install -d "$REL.tmp"
cp -a release/linux-unpacked "$REL.tmp/shell"
cp -a daemon updater shared system "$REL.tmp/"
find "$REL.tmp" -name __pycache__ -prune -exec rm -rf {} +
mv -T "$REL.tmp" "$REL"
ln -sfn "releases/$VERSION" "$ROOT/.current.tmp" && mv -T "$ROOT/.current.tmp" "$ROOT/current"
# lumosd (running as the kiosk user) installs OTA updates into /opt/lumos
chown -R "$KIOSK_USER": "$ROOT"

echo "==> Systemintegration"
install -Dm755 daemon/lumos_priv.py /usr/lib/lumos/lumos-priv
install -Dm755 system/session/lumos-session /usr/bin/lumos-session
install -Dm644 system/session/lumos.desktop /usr/share/wayland-sessions/lumos.desktop
install -Dm644 shared/haptics.json /usr/share/lumos/haptics.json
install -Dm644 system/udev/99-lumos.rules /etc/udev/rules.d/99-lumos.rules
install -Dm644 system/udev/70-lumos-controllers.rules /etc/udev/rules.d/70-lumos-controllers.rules
# third-party controller drivers: xpad, hid-playstation, hid-nintendo ship with the Arch kernel
printf 'xpad\nhid_playstation\nhid_nintendo\n' > /etc/modules-load.d/lumos-controllers.conf
install -Dm440 system/sudoers.d/lumos /etc/sudoers.d/lumos
sed -i "s/^lumos /$KIOSK_USER /; s/Defaults:lumos/Defaults:$KIOSK_USER/" /etc/sudoers.d/lumos
visudo -cf /etc/sudoers.d/lumos
install -Dm644 system/lumosd.toml /etc/lumos/lumosd.toml
install -Dm644 system/systemd/user/lumosd.service /usr/lib/systemd/user/lumosd.service
install -Dm644 system/systemd/system/lumos-update-cleanup.service /etc/systemd/system/lumos-update-cleanup.service
install -Dm644 system/systemd/system/lumos-update-cleanup.timer /etc/systemd/system/lumos-update-cleanup.timer
install -Dm600 system/network/lumos-usb4.nmconnection /etc/NetworkManager/system-connections/lumos-usb4.nmconnection
sed "s/user = \"lumos\"/user = \"$KIOSK_USER\"/" system/greetd/config.toml > /etc/greetd/config.toml
[[ -f /usr/share/lumos/update-signing.pub ]] || echo "!! /usr/share/lumos/update-signing.pub fehlt – OTA-Updates werden erst mit dem öffentlichen Release-Schlüssel akzeptiert"

udevadm control --reload && udevadm trigger
systemctl enable NetworkManager bluetooth power-profiles-daemon greetd lumos-update-cleanup.timer
sudo -u "$KIOSK_USER" flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo || true
loginctl enable-linger "$KIOSK_USER"
sudo -u "$KIOSK_USER" XDG_RUNTIME_DIR="/run/user/$(id -u "$KIOSK_USER")" systemctl --user enable lumosd.service || true

echo
echo "Fertig. Nächste Schritte:"
echo "  1. Face ID:   sudo howdy config  (device_path = IR-Kamera), danach in Lumos → Einstellungen → Face ID einrichten"
echo "  2. Firmware:  cd firmware && pio run -e joy-left -t upload && pio run -e joy-right -t upload"
echo "  3. Neustart:  reboot  → bootet direkt in Lumos One"
