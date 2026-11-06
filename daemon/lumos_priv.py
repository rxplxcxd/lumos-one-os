#!/usr/bin/env python3
"""lumos-priv — tiny, whitelisted privileged helper for lumosd (installed to /usr/lib/lumos/lumos-priv,
allowed via /etc/sudoers.d/lumos for the kiosk user only). Every argument is validated; no shell."""
import glob
import os
import re
import shutil
import subprocess
import sys

HOWDY_COMPARE = [p for p in ("/lib/security/howdy/compare.py", "/usr/lib/security/howdy/compare.py", "/usr/lib64/security/howdy/compare.py") if os.path.exists(p)]


def die(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def write(path, value):
    with open(path, "w") as f:
        f.write(str(value))


def user_arg(u):
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", u):
        die("invalid user")
    caller = os.environ.get("SUDO_USER")
    if caller and caller != u:
        die("may only act on the calling user")
    return u


def run(cmd, **kw):
    if not shutil.which(cmd[0]) and not os.path.exists(cmd[0]):
        die(f"{cmd[0]} not installed", 127)
    return subprocess.run(cmd, **kw).returncode


def main(argv):
    if not argv:
        die("usage: lumos-priv <op> …")
    op, args = argv[0], argv[1:]

    if op == "tdp":
        vendor, watts = args[0], int(args[1])
        if not 4 <= watts <= 30:
            die("tdp out of range")
        if vendor == "amd":
            mw = watts * 1000
            return run(["ryzenadj", f"--stapm-limit={mw}", f"--slow-limit={mw}", f"--fast-limit={mw + 5000}"])
        for zone in glob.glob("/sys/class/powercap/intel-rapl:0"):
            write(f"{zone}/constraint_0_power_limit_uw", watts * 1_000_000)
            write(f"{zone}/constraint_1_power_limit_uw", (watts + 5) * 1_000_000)
        return 0

    if op == "fan":
        duty = args[0]
        tool = shutil.which("framework_tool") or shutil.which("ectool")
        if not tool:
            die("framework_tool/ectool not installed", 127)
        if duty == "auto":
            return run([tool, "--autofanctrl"] if tool.endswith("framework_tool") else [tool, "autofanctrl"])
        d = int(duty)
        if not 0 <= d <= 100:
            die("duty out of range")
        return run([tool, "--fansetduty", str(d)] if tool.endswith("framework_tool") else [tool, "fanduty", str(d)])

    if op == "platform-profile":
        if args[0] not in ("low-power", "balanced", "performance"):
            die("invalid profile")
        write("/sys/firmware/acpi/platform_profile", args[0])
        return 0

    if op == "charge-limit":
        lim = int(args[0])
        if not 50 <= lim <= 100:
            die("limit out of range")
        paths = glob.glob("/sys/class/power_supply/BAT*/charge_control_end_threshold")
        if paths:
            for p in paths:
                write(p, lim)
            return 0
        return run(["framework_tool", "--charge-limit", str(lim)])

    if op == "brightness":
        raw = int(args[0])
        for bl in glob.glob("/sys/class/backlight/*"):
            mx = int(open(f"{bl}/max_brightness").read())
            write(f"{bl}/brightness", max(1, min(mx, raw)))
            return 0
        die("no backlight")

    if op == "faceid-verify":
        user = user_arg(args[0])
        if not HOWDY_COMPARE:
            die("howdy compare.py not found", 127)
        # Howdy exit codes are passed through: 0 ok, 10 no model, 11 timeout/no match, 12 abort, 13 too dark, 14 bad device
        return run([sys.executable, HOWDY_COMPARE[0], user])

    if op in ("faceid-list", "faceid-add", "faceid-remove", "faceid-clear"):
        user = user_arg(args[0])
        if op == "faceid-list":
            return run(["howdy", "-U", user, "list"])
        if op == "faceid-add":
            label = args[1] if len(args) > 1 else "Lumos"
            if not re.fullmatch(r"[\w äöüÄÖÜß.-]{1,40}", label):
                die("invalid label")
            return subprocess.run(["howdy", "-U", user, "add"], input=f"{label}\n", text=True).returncode
        if op == "faceid-remove":
            mid = args[1]
            if not mid.isdigit():
                die("invalid id")
            return run(["howdy", "-U", user, "-y", "remove", mid])
        return run(["howdy", "-U", user, "-y", "clear"])

    if op == "pacman-cache-clean":
        rc = run(["paccache", "-rk1"])
        run(["paccache", "-ruk0"])
        return rc

    die(f"unknown op {op}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
