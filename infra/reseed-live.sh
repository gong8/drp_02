#!/usr/bin/env bash
# Wipe + reinstall the demo seed on a deployed BeThere API (no redeploy). Requires ADMIN_RESET_TOKEN
# in the environment (kept out of git); override the target with BETHERE_API_URL.
set -euo pipefail
BASE="${BETHERE_API_URL:-https://96mgvmgcbj.us-east-1.awsapprunner.com}"
: "${ADMIN_RESET_TOKEN:?Set ADMIN_RESET_TOKEN in your environment (it is not committed).}"
echo "Reseeding ${BASE} ..."
curl -fsS -X POST "${BASE}/admin/reseed" -H "x-admin-token: ${ADMIN_RESET_TOKEN}"
echo
echo "Done."
