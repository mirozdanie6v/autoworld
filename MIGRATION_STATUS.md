# Migration status

Source snapshot: `f9c87829591ff97d4f5e4223c875a96a7329a51a`

Included:
- current AutoWorld UI and branding assets;
- Yandex/YDB backend and normalization code;
- Telegram bot, outbox, relay and lifecycle tooling;
- fixed three-admin access control;
- manager Telegram autofill;
- lead/application deletion flow;
- catalog import data and tooling;
- AutoWorld/YDB regression tests;
- Yandex infrastructure and deployment workflows;
- legacy Cloudflare/D1 Worker compatibility config required by regression tests.

Intentionally excluded:
- UNIQ Smart Rent UI/backend/domain code;
- UNIQ motorcycle fleet media;
- PET NIKA / True Surf / unrelated workflows;
- historical preview screenshots;
- one-off hidden trigger marker files.

Production deployment remains manual until this repository has its own GitHub secrets/variables and the Yandex OIDC trust is verified for the new repository.
