from lumosd.flatpak import ProgressParser

SAMPLE = (
    "Looking for matches…\r\n"
    "        ID                         Branch  Op  Remote   Download\r\n"
    " 1.     org.gnome.Platform         45      i   flathub  < 340 MB\r\n"
    " 2.     org.gnome.Calculator       stable  i   flathub  < 4 MB\r\n\r\n"
    "Installing 1/2… \x1b[32m████████▌\x1b[0m            42%  3.2 MB/s  00:12\r"
    "Installing 1/2… ████████████████████ 100%  3.4 MB/s  00:00\r\n"
    "Installing 2/2… ██████▋              33%  2,0 MB/s  00:03\r"
)


def test_overall_progress_is_monotonic_and_weighted():
    p = ProgressParser("install")
    seen = []
    for ch in SAMPLE.split("\r"):
        if p.feed(ch + "\r"):
            seen.append(round(p.percent, 1))
    assert seen == sorted(seen)
    assert abs(p.percent - (1 + 0.33) / 2 * 100) < 0.01
    assert p.stage == "Installieren 2/2"
    assert p.speed == "2.0 MB/s"


def test_completion_and_error_text():
    p = ProgressParser("install")
    p.feed("Installing 1/1… 100%\nInstallation complete.\n")
    assert p.percent == 100
    e = ProgressParser("install")
    e.feed("Looking for matches…\nerror: Nothing matches org.foo.Bar in remote flathub\n")
    assert e.error_text() == "Nothing matches org.foo.Bar in remote flathub"
