#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir=${1:-"$project_dir/dist"}
version=$(node -p "require('$project_dir/package.json').version")
stage_dir=$(mktemp -d "${TMPDIR:-/tmp}/amazing-marvin-mcpb.XXXXXX")
trap 'rm -rf "$stage_dir"' EXIT HUP INT TERM

mkdir -p "$stage_dir/extension" "$output_dir"
output_dir=$(CDPATH= cd -- "$output_dir" && pwd)
cp "$project_dir/manifest.json" "$project_dir/server.js" "$project_dir/package.json" "$project_dir/package-lock.json" "$project_dir/.mcpbignore" "$project_dir/LICENSE" "$stage_dir/extension/"
cd "$stage_dir/extension"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
npx --yes @anthropic-ai/mcpb@2.1.2 validate manifest.json
npx --yes @anthropic-ai/mcpb@2.1.2 pack . "$output_dir/amazing-marvin-$version.mcpb"
printf '%s\n' "$output_dir/amazing-marvin-$version.mcpb"
