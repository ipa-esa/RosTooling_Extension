#!/usr/bin/env bash
set -euo pipefail

# Resolves the RosTooling Maven version argument for Gradle builds in CI and release workflows.
# Usage:
#   rostooling-version.sh [<requested>]     Resolve "", "devel", or an exact version to Gradle args.
#   rostooling-version.sh --ci [<file>]     Use build.gradle's version if published, else newest "devel" SNAPSHOT.

METADATA_URL="${ROSTOOLING_METADATA_URL:-https://maven.pkg.github.com/ipa-esa/RosTooling/de/fraunhofer/ipa/ros/de.fraunhofer.ipa.ros/maven-metadata.xml}"

usage() {
  cat >&2 <<'EOF'
Usage:
  rostooling-version.sh [<requested>]
  rostooling-version.sh --ci [<build.gradle>]

Environment:
  TOKEN  GitHub token (GPR_KEY) with read:packages on ipa-esa/RosTooling.
EOF
  exit 2
}

fetch_versions() {
  if [ -z "${TOKEN:-}" ]; then
    echo "::error::GPR_KEY secret/token is required to read RosTooling packages from GitHub Packages (ipa-esa/RosTooling)." >&2
    exit 1
  fi
  local xml
  if ! xml=$(curl -sf -u "x:$TOKEN" "$METADATA_URL"); then
    echo "::error::Failed to fetch RosTooling maven-metadata.xml from GitHub Packages." >&2
    exit 1
  fi
  printf '%s\n' "$xml" | grep -o '<version>[^<]*</version>' | sed 's:</\?version>::g'
}

resolve_devel() {
  local versions="$1"
  local snapshot release
  snapshot=$(printf '%s\n' "$versions" | grep -- '-SNAPSHOT$' | sort -V | tail -1 || true)
  release=$(printf '%s\n' "$versions" | grep -v -- '-SNAPSHOT$' | sort -V | tail -1 || true)
  if [ -z "$snapshot" ] || { [ -n "$release" ] && [ "$(printf '%s\n%s\n' "${snapshot%-SNAPSHOT}" "$release" | sort -V | tail -1)" = "$release" ]; }; then
    echo "::error::No RosTooling devel SNAPSHOT newer than release ${release:-none} (newest SNAPSHOT: ${snapshot:-none}). Push to RosTooling devel first." >&2
    exit 1
  fi
  printf '%s\n' "$snapshot"
}

format_gradle_args() {
  local version="$1"
  [ -n "$version" ] || return 0
  local args="-ProstoolingVersion=$version"
  case "$version" in
    *-SNAPSHOT) args="$args --refresh-dependencies" ;;
  esac
  printf '%s\n' "$args"
}

read_build_gradle_version() {
  local gradle_file="${1:-build.gradle}"
  if [ ! -f "$gradle_file" ]; then
    echo "::error::build.gradle not found at: $gradle_file" >&2
    exit 1
  fi
  local v
  v=$(sed -nE "s/.*project\.findProperty\('rostoolingVersion'\)[[:space:]]*\?:[[:space:]]*'([^']+)'.*/\1/p" "$gradle_file" | head -n1)
  if [ -z "$v" ]; then
    echo "::error::Could not determine default rostoolingVersion from $gradle_file." >&2
    exit 1
  fi
  printf '%s\n' "$v"
}

case "${1:-}" in
  -h|--help)
    usage
    ;;
  --ci)
    [ "$#" -le 2 ] || usage
    gradle_file="${2:-build.gradle}"
    default_version=$(read_build_gradle_version "$gradle_file")
    versions=$(fetch_versions)
    if printf '%s\n' "$versions" | grep -qxF "$default_version"; then
      case "$default_version" in
        *-SNAPSHOT) echo "--refresh-dependencies" ;;
      esac
      exit 0
    fi
    echo "RosTooling $default_version is not published in GitHub Packages; resolving newest devel SNAPSHOT." >&2
    snapshot=$(resolve_devel "$versions")
    format_gradle_args "$snapshot"
    ;;
  *)
    [ "$#" -le 1 ] || usage
    requested="${1:-}"
    if [ -z "$requested" ]; then
      exit 0
    fi
    if [ "$requested" = "devel" ]; then
      versions=$(fetch_versions)
      version=$(resolve_devel "$versions")
    else
      version="$requested"
    fi
    format_gradle_args "$version"
    ;;
esac
