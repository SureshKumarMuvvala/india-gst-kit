#!/bin/sh
# Invoked by changesets/action as `publish:`. Only runs when there is something
# to publish, so the Version Packages PR works without NPM_TOKEN.
set -eu

if [ -z "${NODE_AUTH_TOKEN:-}" ]; then
  echo "::error title=NPM_TOKEN missing::Add the NPM_TOKEN repository secret, then re-run."
  exit 1
fi

exec pnpm exec changeset publish
