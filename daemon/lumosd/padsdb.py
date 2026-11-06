"""Known third-party controllers: (vendor, product) → model name, button-label family, kernel driver."""
from __future__ import annotations

# family: xbox | playstation | nintendo | generic ; driver is informational (shown in settings)
MODELS: dict[tuple[int, int | None], tuple[str, str, str]] = {
    (0x045E, 0x028E): ("Xbox 360 Controller", "xbox", "xpad"),
    (0x045E, 0x02EA): ("Xbox One Controller", "xbox", "xpad"),
    (0x045E, 0x0B12): ("Xbox Series X|S Controller", "xbox", "xpad"),
    (0x045E, 0x0B13): ("Xbox Wireless Controller", "xbox", "xpad / xpadneo"),
    (0x045E, 0x0B20): ("Xbox Wireless Controller", "xbox", "xpadneo"),
    (0x045E, 0x0B00): ("Xbox Elite Series 2", "xbox", "xpad"),
    (0x045E, None): ("Microsoft Controller", "xbox", "xpad"),
    (0x054C, 0x05C4): ("DualShock 4", "playstation", "hid-playstation"),
    (0x054C, 0x09CC): ("DualShock 4 (v2)", "playstation", "hid-playstation"),
    (0x054C, 0x0CE6): ("DualSense", "playstation", "hid-playstation"),
    (0x054C, 0x0DF2): ("DualSense Edge", "playstation", "hid-playstation"),
    (0x054C, None): ("PlayStation Controller", "playstation", "hid-playstation"),
    (0x057E, 0x2009): ("Switch Pro Controller", "nintendo", "hid-nintendo"),
    (0x057E, 0x2006): ("Joy-Con (L)", "nintendo", "hid-nintendo"),
    (0x057E, 0x2007): ("Joy-Con (R)", "nintendo", "hid-nintendo"),
    (0x057E, None): ("Nintendo Controller", "nintendo", "hid-nintendo"),
    (0x2DC8, None): ("8BitDo Controller", "nintendo", "xpad / hid-generic"),
    (0x0F0D, None): ("HORI Controller", "nintendo", "hid-generic"),
    (0x0E6F, None): ("PDP Controller", "xbox", "xpad"),
    (0x24C6, None): ("PowerA Controller", "xbox", "xpad"),
    (0x20D6, None): ("PowerA Switch Controller", "nintendo", "hid-generic"),
    (0x046D, 0xC21D): ("Logitech F310", "xbox", "xpad"),
    (0x046D, 0xC21F): ("Logitech F710", "xbox", "xpad"),
    (0x1532, None): ("Razer Controller", "xbox", "xpad"),
    (0x0738, None): ("Mad Catz Controller", "xbox", "xpad"),
    (0x28DE, None): ("Valve Steam Controller", "xbox", "hid-steam"),
    (0x3537, None): ("GameSir Controller", "xbox", "xpad"),
    (0x0079, None): ("Generic USB Gamepad", "generic", "hid-generic"),
}


def classify(vendor: int, product: int, name: str = "") -> dict:
    hit = MODELS.get((vendor, product)) or MODELS.get((vendor, None))
    n = name.lower()
    if not hit:
        if any(k in n for k in ("xbox", "x-box", "xinput", "microsoft")):
            hit = (name, "xbox", "xpad")
        elif any(k in n for k in ("pro controller", "nintendo", "switch", "joy-con")):
            hit = (name, "nintendo", "hid-nintendo")
        elif any(k in n for k in ("dualsense", "dualshock", "playstation")) or n.startswith("wireless controller"):
            hit = (name, "playstation", "hid-playstation")
        else:
            hit = (name or "USB-Controller", "generic", "hid-generic")
    model, family, driver = hit
    return {"model": model, "family": family, "driver": driver}
