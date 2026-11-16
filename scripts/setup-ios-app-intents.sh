#!/usr/bin/env bash
# Attach the repository's Swift AppIntent to the generated iOS app target.
# The generated Xcode project is intentionally not checked in.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
source_file="$root/app-intents/SendImagesIntent.swift"
apple_dir="$root/src-tauri/gen/apple"
project_path="$apple_dir/fast-share.xcodeproj/project.pbxproj"
project_dir="$apple_dir/fast-share.xcodeproj"
destination_dir="$apple_dir/AppIntents"
destination="$destination_dir/SendImagesIntent.swift"

if [[ ! -f "$source_file" ]]; then
  echo "Missing $source_file." >&2
  exit 1
fi
if [[ ! -f "$project_path" ]]; then
  echo "No generated iOS project yet. Run \`npm run tauri ios init\`, then run this script again." >&2
  exit 1
fi

mkdir -p "$destination_dir"
cp "$source_file" "$destination"

if ! ruby -e 'require "xcodeproj"' 2>/dev/null; then
  echo "Installing the xcodeproj Ruby gem..."
  if ! gem install --user-install xcodeproj --no-document; then
    echo "Could not install the xcodeproj Ruby gem. Bundle it into the generated Apple toolchain first." >&2
    exit 1
  fi
fi

ruby - "$project_dir" <<'RUBY'
require "xcodeproj"

project_dir = ARGV.fetch(0)
project = Xcodeproj::Project.open(project_dir)
file_path = "AppIntents/SendImagesIntent.swift"
file = project.files.find { |candidate| candidate.path == file_path }
file ||= project.main_group.new_file(file_path)

application_targets = project.targets.select do |target|
  target.product_type == "com.apple.product-type.application"
end

if application_targets.empty?
  raise "Could not find the main iOS application target in #{project_dir}."
end
if application_targets.length > 1
  raise "Found more than one iOS application target in #{project_dir}: #{application_targets.map(&:name).join(', ')}."
end

target = application_targets.first
unless target.source_build_phase.files_references.include?(file)
  target.add_file_references([file])
  project.save
  puts "Attached SendImagesIntent.swift to the main iOS app target."
else
  puts "SendImagesIntent.swift is already attached to the main iOS app target."
end
RUBY
