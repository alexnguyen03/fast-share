#!/usr/bin/env bash
# Reattach the iOS share extension after `npm run tauri ios init`.
# The Swift source of truth is share-extension/. src-tauri/gen is generated.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source_dir="$root/share-extension"
apple_dir="$root/src-tauri/gen/apple"
project="$apple_dir/fast-share.xcodeproj/project.pbxproj"

if [[ ! -f "$project" ]]; then
  echo "No generated iOS project yet. Run \`npm run tauri ios init\`, then run this script again."
  exit 0
fi

dest="$apple_dir/ShareExtension"
mkdir -p "$dest"
cp "$source_dir/ShareViewController.swift" "$dest/ShareViewController.swift"
cp "$source_dir/Info.plist" "$dest/Info.plist"
cp "$source_dir/ShareExt.entitlements" "$dest/ShareExt.entitlements"
cp "$source_dir/App.entitlements" "$apple_dir/App.entitlements"

python3 - "$project" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
if "com.alexnguyen03.fastshare.share" in text:
    print("Share extension target is already attached.")
    raise SystemExit(0)

ids = {
    "build": "F5E0A1B2C3D4E5F607182001",
    "swift": "F5E0A1B2C3D4E5F607182002",
    "plist": "F5E0A1B2C3D4E5F607182003",
    "ent": "F5E0A1B2C3D4E5F607182004",
    "product": "F5E0A1B2C3D4E5F607182005",
    "group": "F5E0A1B2C3D4E5F607182006",
    "target": "F5E0A1B2C3D4E5F607182007",
    "sources": "F5E0A1B2C3D4E5F607182008",
    "resources": "F5E0A1B2C3D4E5F607182009",
    "debug": "F5E0A1B2C3D4E5F60718200A",
    "release": "F5E0A1B2C3D4E5F60718200B",
    "list": "F5E0A1B2C3D4E5F60718200C",
    "embed": "F5E0A1B2C3D4E5F60718200D",
    "embed_file": "F5E0A1B2C3D4E5F60718200E",
}
# Xcode ids are 24 hex chars. The labels above are 24 chars.
for key, value in ids.items():
    if len(value) != 24:
        raise SystemExit(f"{key} id must be 24 characters, got {len(value)}")

blocks = {
    "PBXBuildFile": f"""
		{ids['build']} /* ShareViewController.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {ids['swift']}; }};
		{ids['embed_file']} /* ShareExtension.appex in Embed Foundation Extensions */ = {{isa = PBXBuildFile; fileRef = {ids['product']}; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};
""",
    "PBXFileReference": f"""
		{ids['swift']} /* ShareViewController.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ShareViewController.swift; sourceTree = "<group>"; }};
		{ids['plist']} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};
		{ids['ent']} /* ShareExt.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = ShareExt.entitlements; sourceTree = "<group>"; }};
		{ids['product']} /* ShareExtension.appex */ = {{isa = PBXFileReference; explicitFileType = "wrapper.app-extension"; includeInIndex = 0; path = ShareExtension.appex; sourceTree = BUILT_PRODUCTS_DIR; }};
""",
    "PBXGroup": f"""
		{ids['group']} /* ShareExtension */ = {{
			isa = PBXGroup;
			children = (
				{ids['swift']} /* ShareViewController.swift */,
				{ids['plist']} /* Info.plist */,
				{ids['ent']} /* ShareExt.entitlements */,
			);
			path = ShareExtension;
			sourceTree = "<group>";
		}};
""",
    "PBXNativeTarget": f"""
		{ids['target']} /* ShareExtension */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {ids['list']};
			buildPhases = (
				{ids['sources']} /* Sources */,
				{ids['resources']} /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = ShareExtension;
			productName = ShareExtension;
			productReference = {ids['product']};
			productType = "com.apple.product-type.app-extension";
		}};
""",
    "PBXSourcesBuildPhase": f"""
		{ids['sources']} /* Sources */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{ids['build']} /* ShareViewController.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
""",
    "PBXResourcesBuildPhase": f"""
		{ids['resources']} /* Resources */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
""",
    "PBXCopyFilesBuildPhase": f"""
		{ids['embed']} /* Embed Foundation Extensions */ = {{
			isa = PBXCopyFilesBuildPhase;
			buildActionMask = 2147483647;
			dstPath = "";
			dstSubfolderSpec = 13;
			files = (
				{ids['embed_file']} /* ShareExtension.appex in Embed Foundation Extensions */,
			);
			name = "Embed Foundation Extensions";
			runOnlyForDeploymentPostprocessing = 0;
		}};
""",
    "XCBuildConfiguration": f"""
		{ids['debug']} /* Debug */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = ShareExtension/ShareExt.entitlements;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = ShareExtension/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 13.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.alexnguyen03.fastshare.share;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = debug;
		}};
		{ids['release']} /* release */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = ShareExtension/ShareExt.entitlements;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = ShareExtension/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 13.0;
				PRODUCT_BUNDLE_IDENTIFIER = com.alexnguyen03.fastshare.share;
				PRODUCT_NAME = "$(TARGET_NAME)";
				SKIP_INSTALL = YES;
				SWIFT_VERSION = 5.0;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = release;
		}};
""",
    "XCConfigurationList": f"""
		{ids['list']} /* Build configuration list for PBXNativeTarget "ShareExtension" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{ids['debug']} /* debug */,
				{ids['release']} /* release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = release;
		}};
""",
}

def insert_section(text, section, block):
    begin = f"/* Begin {section} section */"
    if begin in text:
        return text.replace(begin, begin + block, 1)
    created = f"\n/* Begin {section} section */{block}/* End {section} section */\n"
    for anchor in (
        "/* End PBXResourcesBuildPhase section */",
        "/* End PBXSourcesBuildPhase section */",
        "/* End PBXNativeTarget section */",
        "/* Begin PBXProject section */",
    ):
        if anchor in text:
            return text.replace(anchor, anchor + "\n" + created, 1)
    raise SystemExit(f"This Xcode project has no {section} section and no place to add one.")

updated = text
for section, block in blocks.items():
    updated = insert_section(updated, section, block)

main_group = None
for line in updated.splitlines():
    stripped = line.strip()
    if stripped.startswith("mainGroup = "):
        main_group = stripped.split("=", 1)[1].strip().rstrip(";").split(" ")[0]
        break
if not main_group:
    raise SystemExit("Could not find the Xcode main group.")

needle = f"{main_group} /* "
group_at = updated.find(needle)
if group_at < 0:
    group_at = updated.find(f"{main_group} = {{")
if group_at < 0:
    raise SystemExit("Could not find the main group block.")
children = updated.find("children = (", group_at)
if children < 0:
    raise SystemExit("Could not find the main group children.")
updated = updated[: children + len("children = (")] + f"\n\t\t\t\t{ids['group']} /* ShareExtension */," + updated[children + len("children = ("):]

targets = updated.find("targets = (")
if targets < 0:
    raise SystemExit("Could not find the project targets.")
updated = updated[: targets + len("targets = (")] + f"\n\t\t\t\t{ids['target']} /* ShareExtension */," + updated[targets + len("targets = ("):]

products = updated.find("/* Products */ = {")
if products < 0:
    raise SystemExit("Could not find the Products group.")
product_children = updated.find("children = (", products)
updated = updated[: product_children + len("children = (")] + f"\n\t\t\t\t{ids['product']} /* ShareExtension.appex */," + updated[product_children + len("children = ("):]

app_type = updated.find('productType = "com.apple.product-type.application"')
app_target = updated.rfind("isa = PBXNativeTarget;", 0, app_type)
phases = updated.find("buildPhases = (", app_target)
if app_type < 0 or app_target < 0 or phases < 0 or phases > app_type:
    raise SystemExit("Could not find the app target build phases.")
updated = updated[: phases + len("buildPhases = (")] + f"\n\t\t\t\t{ids['embed']} /* Embed Foundation Extensions */," + updated[phases + len("buildPhases = ("):]

path.write_text(updated)
print("Attached the ShareExtension target.")
PY

python3 "$root/scripts/ios_ci.py" entitlements "$project"
