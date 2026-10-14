# AWG Timeweb SSH — GitHub-only generation and encrypted storage

Tracked in [VII-171](https://linear.app/viiversion/issue/VII-171) / [PR #41](https://github.com/mirozdanie6v/autoworld/pull/41).

You do **not** need Termux, a desktop, PuTTY, or another installed app to create the key. The private key is created only inside an ephemeral GitHub Actions runner. This is staging access, not an authorization to change live DNS or webhooks.

## One-time user setup

1. Open [GitHub Actions Secrets](https://github.com/mirozdanie6v/autoworld/settings/secrets/actions) -> **New repository secret**.
2. **Name**: `AWG_SSH_KEY_WRAP_PASSPHRASE`.
3. **Value**: a unique, genuinely random **40+ character** passphrase. Minimum accepted by the generator is 32 characters. Save it separately in a trusted password manager. **Never paste it into a chat, issue, commit, variable, public form or workflow log.** Do not reuse the Timeweb API token or a GitHub password.
4. Visit [Generate AWG Timeweb SSH (encrypted)](https://github.com/mirozdanie6v/autoworld/actions/runs/38585551291) and click **Re-run all jobs** after adding the secret. This workflow previously ran in prerequisite-only mode and **did not create a key** because the secret was absent.
5. Open the completed run summary. The generated **public** SSH key (one line beginning with `ssh-ed25519`) is shown in the summary and logs. Copy the entire line into [GitHub Actions Variables](https://github.com/mirozdanie6v/autoworld/settings/variables/actions) as `AWG_TIMEWEB_SSH_PUBLIC_KEY`. A public key is safe to copy; a private key is not.
6. Download the `awg-timeweb-ssh-encrypted` artifact from the run and keep a **second, private backup copy** outside GitHub. The artifact contains ONLY `id_ed25519.encrypted.json` (AES-256-GCM private key, scrypt key derivation) and `id_ed25519.pub`. It is not a plaintext private key.

## Storage and future connections

- **Private key**: encrypted inside the Actions artifact. It is never printed into workflow logs or stored in repository code.
- **Wrapping password**: GitHub Actions Secret `AWG_SSH_KEY_WRAP_PASSPHRASE`; GitHub does not reveal it after saving. Keep a separate recovery copy yourself.
- **Public key**: GitHub Actions Variable `AWG_TIMEWEB_SSH_PUBLIC_KEY`, for `scripts/prepare-awg-timeweb.mjs` to inject into the new server's `cloud-init`.
- **Retention**: GitHub Actions artifacts are temporary (configured here for 90 days, potentially limited by repository policy), not permanent secret storage. Download the encrypted archive as a second backup before expiry. The key cannot be reconstructed after losing both ciphertext and password. The public repository means others with read access may access artifact files, but the private part remains encrypted; a truly random high-entropy password is essential.
- **Future automated SSH**: a controlled GitHub workflow can download the encrypted artifact and, in an ephemeral runner only, use `AWG_SSH_KEY_WRAP_PASSPHRASE` with `scripts/awg-timeweb-ssh-keyring.mjs open <encrypted.json> <temporary-key-file>` to obtain an SSH key with 0600 permissions. The private file must be deleted at the end. Do not emit or upload plaintext keys to logs/artifacts.
- **Key rotation**: rerunning generation creates **a different key pair**. If the server was already provisioned, its `authorized_keys` must be updated through a verified administrator path before replacing the old key. Do not silently rotate keys.

## Next step after generation

Use the read-only Timeweb tariff check and the existing staging provision workflow, with `create_server=false` first. Creation is a separate paid operation and should only occur after verifying IPv4, backups and S3 costs within the agreed ceiling. Never run a workflow containing untrusted PR code with access to this wrapping secret.

This generation workflow was added on a feature branch. GitHub's manual Run workflow button generally requires the workflow to be present on the default branch; for the branch-only workflow, use **Re-run all jobs** on the already existing feature-branch run linked above. No server is created by the SSH key generator.
