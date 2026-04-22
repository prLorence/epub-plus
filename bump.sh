#!/usr/bin/env bash
set -euo pipefail

usage() {
	echo "Usage: $0 <version> [-c]"
	echo "  <version>  Semver version string (e.g. 2.3.0)"
	echo "  -c         Commit the version bump"
	exit 1
}

[[ $# -lt 1 ]] && usage

VERSION=""
COMMIT=false

for arg in "$@"; do
	case "$arg" in
		-c) COMMIT=true ;;
		-*) usage ;;
		*)  VERSION="$arg" ;;
	esac
done

[[ -z "$VERSION" ]] && usage

# 1. Update package.json version
npm pkg set version="$VERSION"
echo "Updated package.json to $VERSION"

# 2. Run the version script (updates manifest.json + versions.json)
npm run version
echo "Ran npm run version"

git tag "$VERSION"
git push origin "$VERSION"

# 3. Commit if -c was passed
if $COMMIT; then
	git add package.json manifest.json versions.json
	git commit -m "chore: version bump"
	echo "Committed: chore: version bump"
fi
