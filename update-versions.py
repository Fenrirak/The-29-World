"""Updates the ?v=... version numbers on every page of The 29 World.

WHEN TO RUN IT: after you change any .js or .css file, and before you upload
the site. From this folder:

    python update-versions.py

(or double-click this file in Windows Explorer).

WHAT IT DOES: every page loads its scripts and styles like
`data-core.js?v=1a2b3c4d`. Browsers (phones especially) keep their own copy of
each file, and only fetch it again when that ?v= part changes. This script
gives every .js/.css file a version made from its own contents (a short
fingerprint), and writes it into every page that uses the file. So:

  - a file you changed gets a new version, and every browser picks up the new
    copy straight away;
  - a file you didn't change keeps its version, so browsers keep using the copy
    they already have (faster pages, nothing re-downloaded for no reason);
  - running it when nothing has changed does nothing at all.

    python update-versions.py --check   only reports whether anything is out
                                        of date (exit code 1 if so); changes
                                        nothing.

Only files in this folder are touched; nothing is uploaded anywhere.
"""
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def asset_files():
    """Every .js/.css file in the site folder, by name."""
    return {p.name: p for p in ROOT.iterdir() if p.is_file() and p.suffix in (".js", ".css")}


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def rewrite(text, versions):
    """Sets ?v= on every quoted reference to a local .js/.css file, e.g.
    src="data-core.js?v=1" or 'sidebar-nav.css'. A name only matches when it's
    the whole quoted string, so "core.js" can never match inside "data-core.js"."""
    names = "|".join(re.escape(n) for n in sorted(versions, key=len, reverse=True))
    pattern = re.compile(r"""(["'])(%s)(?:\?v=[^"'\s]*)?\1""" % names)
    return pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={versions[m.group(2)]}{m.group(1)}", text)


def files_that_reference_assets():
    return sorted(ROOT.glob("*.html")) + sorted(ROOT.glob("*.js"))


def main():
    check_only = "--check" in sys.argv
    changed_files = set()

    # A .js file can itself name another file (settings-menu.js names the
    # sidebar files), and updating that name changes the .js file's own
    # fingerprint — so repeat until nothing moves. Two or three rounds is
    # always enough.
    for _ in range(10):
        versions = {name: fingerprint(p) for name, p in asset_files().items()}
        changed_this_round = False
        for page in files_that_reference_assets():
            old = page.read_bytes().decode("utf-8")
            new = rewrite(old, versions)
            if new != old:
                changed_files.add(page.name)
                changed_this_round = True
                if not check_only:
                    page.write_bytes(new.encode("utf-8"))
        if check_only or not changed_this_round:
            break

    if check_only:
        if changed_files:
            print("Out of date - run `python update-versions.py`. Files that would change:")
            for name in sorted(changed_files):
                print("   ", name)
            return 1
        print("All version numbers are up to date.")
        return 0

    if changed_files:
        print("Updated version numbers in:")
        for name in sorted(changed_files):
            print("   ", name)
        print("\nDone. Upload the whole folder as usual.")
    else:
        print("Everything was already up to date - nothing changed.")
    return 0


if __name__ == "__main__":
    code = main()
    # When double-clicked in Windows Explorer, keep the window open long
    # enough to read the result.
    if sys.platform == "win32" and sys.stdin and sys.stdin.isatty() and "--no-pause" not in sys.argv and "--check" not in sys.argv:
        try:
            input("\nPress Enter to close...")
        except EOFError:
            pass
    sys.exit(code)
