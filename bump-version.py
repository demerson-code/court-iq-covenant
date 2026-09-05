"""Bump APP_VERSION and the ?v= cache-busters in one go.
Usage: python bump-version.py            -> today's date + next counter
       python bump-version.py 2026.09.06-1
"""
import io, re, sys, datetime
files = ["app.js", "index.html"]
cur = re.search(r"const APP_VERSION = '([^']+)'", io.open("app.js", encoding="utf-8").read()).group(1)
if len(sys.argv) > 1:
    new = sys.argv[1]
else:
    today = datetime.date.today().strftime("%Y.%m.%d")
    n = int(cur.split("-")[1]) + 1 if cur.startswith(today) else 1
    new = f"{today}-{n}"
for f in files:
    s = io.open(f, encoding="utf-8").read().replace(cur, new)
    io.open(f, "w", encoding="utf-8", newline="\n").write(s)
print(cur, "->", new)
