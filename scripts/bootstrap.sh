#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_URL="https://github.com/mouse233/localsend-kotlin.git"
UPSTREAM_COMMIT="53fbdad7e3e123ded9eb1e0ef5fc2b6b34d59e16"
DEST="upstream-app"

if [[ -e "$DEST" ]]; then
  echo "Refusing to overwrite $DEST; rename or remove the existing generated folder first." >&2
  exit 1
fi

echo "Cloning LocalSend Kotlin as the ShareDit foundation..."
git clone --no-checkout "$UPSTREAM_URL" "$DEST"
git -C "$DEST" checkout --detach "$UPSTREAM_COMMIT"

python3 - <<'PY'
from pathlib import Path
import re

gradle = Path("upstream-app/app/build.gradle.kts")
source = gradle.read_text(encoding="utf-8")
old = 'applicationId = "io.github.mouse233.localsendkotlin"'
if source.count(old) != 1:
    raise SystemExit("Expected upstream applicationId was not found exactly once; stopping.")
gradle.write_text(source.replace(old, 'applicationId = "app.sharedit.mobile"'), encoding="utf-8")

strings = Path("upstream-app/app/src/main/res/values/strings.xml")
source = strings.read_text(encoding="utf-8")
for name in ("app_name", "quick_settings_tile_label"):
    pattern = rf'(<string name="{name}">)(.*?)(</string>)'
    source, count = re.subn(pattern, lambda m: m.group(1) + "ShareDit" + m.group(3), source, count=1)
    if count != 1:
        raise SystemExit(f"Expected resource {name} was not found; stopping.")
strings.write_text(source, encoding="utf-8")
PY

chmod +x "$DEST/gradlew"
echo "ShareDit starter ready in $DEST"
echo "Build: cd $DEST && ./gradlew assembleDebug"
echo "Upstream LICENSE and NOTICE retained."
