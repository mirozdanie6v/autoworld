#!/usr/bin/env bash
set -euo pipefail
umask 077

# Read only. Resolve the public key from the latest successful encrypted key artifact.
# Never print or unpack an unencrypted private key.
test -n "${GH_TOKEN:-}" || { echo "GITHUB_TOKEN_required" >&2; exit 1; }
test -n "${GITHUB_REPOSITORY:-}" || { echo "GITHUB_REPOSITORY_required" >&2; exit 1; }
test -n "${GITHUB_ENV:-}" || { echo "GITHUB_ENV_required" >&2; exit 1; }

artifact_json=$(gh api "/repos/$GITHUB_REPOSITORY/actions/artifacts?name=awg-timeweb-ssh-encrypted&per_page=100")
artifact_id=$(node -e '
  const a=JSON.parse(process.argv[1]).artifacts||[];
  const selected=a.filter(x=>!x.expired&&x.name==="awg-timeweb-ssh-encrypted"&&
    x.workflow_run?.head_branch==="feature/awg-timeweb-fresh-install-20261014")
    .sort((x,y)=>String(y.created_at).localeCompare(String(x.created_at)))[0];
  if(!selected)process.exit(1);
  console.log(selected.id);
' "$artifact_json") || { echo 'No unexpired approved AWG encrypted SSH artifact' >&2; exit 1; }
run_id=$(node -e '
  const a=JSON.parse(process.argv[1]).artifacts||[];
  const x=a.find(v=>String(v.id)===process.argv[2]);
  if(!x?.workflow_run?.id)process.exit(1);
  console.log(x.workflow_run.id);
' "$artifact_json" "$artifact_id")

run_ok=$(gh api "/repos/$GITHUB_REPOSITORY/actions/runs/$run_id" --jq '.conclusion=="success" and .name=="Generate AWG Timeweb SSH (encrypted)"')
test "$run_ok" = true || { echo "SSH artifact source workflow is not verified" >&2; exit 1; }

temp_dir=$(mktemp -d "$RUNNER_TEMP/awg-ssh-artifact-XXXXXX")
trap 'rm -rf "$temp_dir"' EXIT
gh run download "$run_id" --name awg-timeweb-ssh-encrypted --dir "$temp_dir" >/dev/null
test -s "$temp_dir/id_ed25519.pub" && test -s "$temp_dir/id_ed25519.encrypted.json" || {
  echo 'SSH public key or encrypted envelope missing from artifact' >&2; exit 1;
}
node --input-type=module - "$temp_dir" "$GITHUB_ENV" <<'NODE'
import {readFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
const dir=process.argv[2],githubEnv=process.argv[3];
const key=(await readFile(path.join(dir,'id_ed25519.pub'),'utf8')).trim();
const envelope=JSON.parse(await readFile(path.join(dir,'id_ed25519.encrypted.json'),'utf8'));
if(!/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]*)?$/.test(key)||
   envelope.format!=='awg-timeweb-ed25519-v1'||envelope.publicKey!==key||
   envelope.algorithm!=='aes-256-gcm'){
  throw new Error('SSH artifact envelope does not match the public key');
}
await appendFile(githubEnv,'AWG_TIMEWEB_SSH_PUBLIC_KEY='+key+'\n');
NODE
echo "AWG Timeweb public SSH key was securely resolved from verified encrypted artifact, run $run_id"
ssh-keygen -lf "$temp_dir/id_ed25519.pub"
