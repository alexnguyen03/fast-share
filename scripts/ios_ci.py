#!/usr/bin/env python3
"""Prepare and export the signed iOS app on a macOS CI runner.

`entitlements` attaches the app-group file to the main target.
`sign` installs Ad Hoc profiles and points the share extension at its profile.
`export` copies an IPA, or exports the archive with both profiles.
"""

import base64
import json
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

APP_BUNDLE = "com.alexnguyen03.fastshare"
SHARE_BUNDLE = "com.alexnguyen03.fastshare.share"
APP_GROUP = "group.com.alexnguyen03.fastshare"


def repo_root():
    return Path(__file__).resolve().parent.parent


def project_path(root):
    return root / "src-tauri" / "gen" / "apple" / "fast-share.xcodeproj" / "project.pbxproj"


def signing_path(root):
    return root / "src-tauri" / "gen" / "apple" / "signing.json"


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)


def object_blocks(text, isa):
    needle = f"isa = {isa};"
    start = 0
    while True:
        at = text.find(needle, start)
        if at < 0:
            return
        brace = text.rfind("{", 0, at)
        if brace < 0:
            fail(f"Xcode project has an {isa} without an opening brace.")
        depth = 0
        end = None
        for index in range(brace, len(text)):
            char = text[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    break
        if end is None:
            fail("Xcode project has unbalanced braces.")
        yield brace, end
        start = end


def bundle_identifier(block):
    marker = "PRODUCT_BUNDLE_IDENTIFIER = "
    at = block.find(marker)
    if at < 0:
        return None
    value = block[at + len(marker) :].split(";", 1)[0].strip().strip('"')
    return value


def insert_build_settings(block, lines):
    marker = "buildSettings = {"
    at = block.find(marker)
    if at < 0:
        fail("An Xcode build configuration has no buildSettings.")
    addition = "".join(f"\n\t\t\t\t{line}" for line in lines)
    return block[: at + len(marker)] + addition + block[at + len(marker) :]


def patch_configurations(text, bundle_id, lines, label):
    updated = text
    shift = 0
    patched = 0
    for brace, end in object_blocks(text, "XCBuildConfiguration"):
        block = text[brace:end]
        if bundle_identifier(block) != bundle_id:
            continue
        if all(line in block for line in lines):
            patched += 1
            continue
        missing = [line for line in lines if line not in block]
        replacement = insert_build_settings(block, missing)
        brace += shift
        end += shift
        updated = updated[:brace] + replacement + updated[end:]
        shift += len(replacement) - (end - brace)
        patched += 1
    if patched == 0:
        fail(f"The generated Xcode project has no {label} target ({bundle_id}).")
    return updated


def attach_entitlements(project):
    root = repo_root()
    source = root / "share-extension" / "App.entitlements"
    destination = project.parent.parent / "App.entitlements"
    if not source.is_file():
        fail(f"Missing {source}.")
    destination.write_bytes(source.read_bytes())
    text = project.read_text()
    text = patch_configurations(
        text,
        APP_BUNDLE,
        ["CODE_SIGN_ENTITLEMENTS = App.entitlements;"],
        "app",
    )
    project.write_text(text)
    print(f"App group {APP_GROUP} is on the main iOS target.")


def decode_profile(label, env_name):
    raw = "".join(os.environ.get(env_name, "").split())
    if not raw:
        fail(f"Missing {env_name}. See README, Device builds.")
    try:
        data = base64.b64decode(raw, validate=True)
    except Exception:
        fail(f"{env_name} is not valid base64.")
    directory = Path(os.environ.get("RUNNER_TEMP", "/tmp"))
    directory.mkdir(parents=True, exist_ok=True)
    blob = directory / f"{label}.mobileprovision"
    blob.write_bytes(data)
    try:
        decoded = subprocess.check_output(["security", "cms", "-D", "-i", str(blob)])
    except subprocess.CalledProcessError:
        fail(f"Could not read the {label} provisioning profile.")
    profile = plistlib.loads(decoded)
    name = profile.get("Name")
    uuid = profile.get("UUID")
    teams = profile.get("TeamIdentifier") or []
    if not name or not uuid or not teams:
        fail(f"The {label} provisioning profile is missing its name, UUID, or team.")
    if any(char in name for char in '"\\'):
        fail(f"Rename the {label} profile so its name has no quotes or backslashes.")
    if profile.get("ProvisionsAllDevices"):
        fail(f"The {label} profile is an enterprise profile. Create an Ad Hoc profile.")
    if "ProvisionedDevices" not in profile:
        fail(
            f"The {label} profile lists no devices. Create an Ad Hoc profile that includes this iPhone."
        )
    if profile.get("Entitlements", {}).get("get-task-allow") is True:
        fail(
            f"The {label} profile is a development profile. Create an Ad Hoc profile with an Apple Distribution certificate."
        )
    application_id = profile.get("Entitlements", {}).get("application-identifier", "")
    groups = profile.get("Entitlements", {}).get("com.apple.security.application-groups") or []
    if APP_GROUP not in groups:
        fail(f"The {label} profile does not include {APP_GROUP}. Enable App Groups on that App ID.")
    return {
        "name": name,
        "uuid": uuid,
        "team": teams[0],
        "application_id": application_id,
        "data": data,
    }


def install_profile(profile):
    folder = Path.home() / "Library" / "MobileDevice" / "Provisioning Profiles"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{profile['uuid']}.mobileprovision").write_bytes(profile["data"])


def profile_matches(application_id, bundle_id):
    return application_id == bundle_id or str(application_id).endswith("." + bundle_id)


def sign_extension(project):
    app = decode_profile("app", "IOS_MOBILE_PROVISION")
    share = decode_profile("share", "IOS_SHARE_MOBILE_PROVISION")
    if app["team"] != share["team"]:
        fail("The app and share-extension profiles are from different Apple teams.")
    if not profile_matches(app["application_id"], APP_BUNDLE):
        fail(
            f"IOS_MOBILE_PROVISION is for {app['application_id']}. Expected {APP_BUNDLE}."
        )
    if not profile_matches(share["application_id"], SHARE_BUNDLE):
        fail(
            f"IOS_SHARE_MOBILE_PROVISION is for {share['application_id']}. Expected {SHARE_BUNDLE}."
        )
    install_profile(app)
    install_profile(share)
    identity = os.environ.get("IOS_CODE_SIGN_IDENTITY", "Apple Distribution")
    lines = [
        "CODE_SIGN_STYLE = Manual;",
        f"DEVELOPMENT_TEAM = {share['team']};",
        f'"CODE_SIGN_IDENTITY[sdk=iphoneos*]" = "{identity}";',
        f'"PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]" = "{share["name"]}";',
    ]
    text = patch_configurations(project.read_text(), SHARE_BUNDLE, lines, "share extension")
    project.write_text(text)
    payload = {
        "teamId": app["team"],
        "appProfile": app["name"],
        "shareProfile": share["name"],
    }
    path = signing_path(repo_root())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))
    runner_temp = os.environ.get("RUNNER_TEMP")
    if runner_temp:
        temp_copy = Path(runner_temp) / "fast-share-signing.json"
        temp_copy.write_text(json.dumps(payload))
    github_env = os.environ.get("GITHUB_ENV")
    if github_env:
        with open(github_env, "a", encoding="utf-8") as handle:
            handle.write(f"APPLE_DEVELOPMENT_TEAM={app['team']}\n")
            handle.write(f"TAURI_APPLE_DEVELOPMENT_TEAM={app['team']}\n")
    print(f"Share extension will sign with {share['name']}.")


def newest(paths):
    found = [path for path in paths if path.exists()]
    if not found:
        return None
    return max(found, key=lambda path: path.stat().st_mtime)


def collect(root, pattern):
    roots = [
        root / "src-tauri" / "gen" / "apple",
        Path.home() / "Library" / "Developer" / "Xcode" / "Archives",
    ]
    found = []
    for base in roots:
        if not base.exists():
            continue
        for path in base.rglob(pattern):
            if ".xcarchive" in path.parts and path.suffix == ".ipa":
                continue
            found.append(path)
    return found


def xcode_methods():
    version = subprocess.check_output(["xcodebuild", "-version"], text=True)
    number = version.splitlines()[0].split()[1]
    parts = number.split(".")
    major = int(parts[0])
    minor = int(parts[1]) if len(parts) > 1 else 0
    if major > 15 or (major == 15 and minor >= 4):
        return ["release-testing", "ad-hoc"]
    return ["ad-hoc", "release-testing"]


def export_ipa():
    root = repo_root()
    destination_dir = root / "src-tauri" / "gen" / "apple" / "build"
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / "FastShare.ipa"
    ipa = newest(collect(root, "*.ipa"))
    if ipa is not None:
        if ipa.resolve() != destination.resolve():
            shutil.copyfile(ipa, destination)
        print(f"IPA: {destination}")
        return
    archive = newest(collect(root, "*.xcarchive"))
    if archive is None:
        fail("The iOS build did not produce an IPA or an Xcode archive.")
    saved = signing_path(root)
    if not saved.is_file():
        runner_temp = os.environ.get("RUNNER_TEMP")
        if runner_temp:
            saved = Path(runner_temp) / "fast-share-signing.json"
    if not saved.is_file():
        fail("Missing signing.json. The profile install step did not finish.")
    signing = json.loads(saved.read_text())
    export_root = destination_dir / "export"
    last_status = 1
    for method in xcode_methods():
        if export_root.exists():
            shutil.rmtree(export_root)
        export_root.mkdir(parents=True)
        options = export_root / "ExportOptions.plist"
        plistlib.dump(
            {
                "method": method,
                "signingStyle": "manual",
                "teamID": signing["teamId"],
                "provisioningProfiles": {
                    APP_BUNDLE: signing["appProfile"],
                    SHARE_BUNDLE: signing["shareProfile"],
                },
            },
            options,
            fmt=plistlib.FMT_XML,
        )
        print(f"Exporting {archive.name} with method {method}.")
        result = subprocess.run(
            [
                "xcodebuild",
                "-exportArchive",
                "-archivePath",
                str(archive),
                "-exportPath",
                str(export_root),
                "-exportOptionsPlist",
                str(options),
            ]
        )
        last_status = result.returncode
        produced = newest(export_root.rglob("*.ipa"))
        if result.returncode == 0 and produced is not None:
            shutil.copyfile(produced, destination)
            print(f"IPA: {destination}")
            return
    fail(f"xcodebuild export failed with status {last_status}.")


def main():
    if len(sys.argv) < 2:
        fail("Usage: ios_ci.py entitlements|sign|export [project.pbxproj]")
    command = sys.argv[1]
    project = Path(sys.argv[2]) if len(sys.argv) > 2 else project_path(repo_root())
    if command == "entitlements":
        if not project.is_file():
            fail(f"No generated iOS project at {project}.")
        attach_entitlements(project)
        return
    if command == "sign":
        if not project.is_file():
            fail("Run tauri ios init and scripts/setup-ios-share-extension.sh first.")
        sign_extension(project)
        return
    if command == "export":
        export_ipa()
        return
    fail(f"Unknown command {command}.")


if __name__ == "__main__":
    main()
