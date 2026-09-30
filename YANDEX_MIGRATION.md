# AUTO SALE → Yandex Cloud migration

## Current state

Cloudflare production remains unchanged. The public demo runs on Yandex Cloud at:

- `https://auto-sale-demo.viiversion.com`
- API Gateway: `auto-sale-demo` / `d5d7e3tivcgnbe167btb`
- Serverless Container: `auto-sale-staging` / `bba01u6g86lg2q49p34d`
- YDB Serverless persistence
- Yandex Object Storage for catalog media

The demo currently uses public read/write mode for application data because it is a demonstration environment. Durable staff authentication is still a later production-hardening step.

## Yandex Cloud resources

- Cloud: `cloud-monsoon-954`
- Folder: `auto-sale`
- Folder ID: `b1g8u8vqkgehvtbj8n13`
- Container Registry: `auto-sale-registry`
- Registry ID: `crptu0l7jn0iui8b8laa`
- Serverless Container: `auto-sale-staging`
- Container ID: `bba01u6g86lg2q49p34d`
- API Gateway: `auto-sale-demo`
- API Gateway ID: `d5d7e3tivcgnbe167btb`
- Managed certificate: `auto-sale-demo-viiversion`
- Certificate ID: `fpqca11j683rem8j8jfn`
- Object Storage bucket: `viiversion-auto-sale-media`
- Runtime service account: `auto-sale-runtime`
- Runtime SA ID: `aje8o9ric0d20k11521r`
- GitHub deploy service account: `auto-sale-github`
- Deploy SA ID: `aje775bcl6hgp40eu8of`
- Workload identity federation: `auto-sale-github`

## Persistence

Application state is stored in YDB Serverless via `YDB_CONNECTION_STRING`.

YDB stores structured data only:
- leads;
- quotes;
- orders;
- notes;
- team;
- catalog metadata;
- media URLs.

Catalog image binaries are not stored in YDB.

## Catalog media

Local catalog images are uploaded through the application backend:

`POST /api/auto-sale/media`

The backend:
1. receives the compressed image from the browser;
2. authenticates to Yandex Cloud through the runtime service-account metadata token;
3. writes the object into `viiversion-auto-sale-media`;
4. returns the public object URL;
5. saves only that URL in YDB.

Object layout:

`cars/<car-id>/<category>-<timestamp>-<name>-<suffix>.<ext>`

Supported categories:
- `main`;
- `interior`;
- `other`.

The bucket allows public object reads for the demo catalog. Uploads and deletes go only through the AUTO SALE backend/runtime identity. Anonymous bucket listing is disabled.

Validated live flow:
- local main photo upload;
- multiple interior photo uploads;
- other photo upload;
- public object read;
- URL-only persistence in YDB;
- client gallery rendering;
- object deletion and test-state cleanup.

## GitHub repository variables

- `YC_FOLDER_ID`
- `YC_DEPLOY_SA_ID`
- `YC_RUNTIME_SA_ID`
- `YC_REGISTRY_ID`
- `YC_CONTAINER_NAME = auto-sale-staging`
- `YDB_CONNECTION_STRING`

The media bucket name is currently fixed in the deploy workflow as:

`AUTO_SALE_MEDIA_BUCKET=viiversion-auto-sale-media`

No permanent Yandex access key is stored in GitHub. Deployment uses GitHub OIDC → Yandex workload identity federation.

## Service-account access

### auto-sale-github

Deployment/provisioning access includes:
- `iam.serviceAccounts.user`;
- `container-registry.images.pusher`;
- `vpc.user`;
- `serverless-containers.editor`;
- `ydb.editor`;
- `api-gateway.editor`;
- `certificate-manager.editor`;
- `storage.admin` for Object Storage provisioning.

### auto-sale-runtime

Runtime access includes:
- `container-registry.images.puller`;
- `ydb.editor`;
- `lockbox.payloadViewer`;
- full control on the AUTO SALE media bucket through the bucket ACL.

## Deployment

Workflow: `Deploy AUTO SALE to Yandex staging`

Branch: `prototype/auto-sale-usa`

The workflow is manual-only after release cleanup.

Each deployment:
1. validates the application;
2. exchanges GitHub OIDC for a Yandex IAM token;
3. builds and pushes the container image;
4. generates the staging API credential;
5. deploys a Serverless Container revision;
6. enables public demo state read/write;
7. configures `AUTO_SALE_MEDIA_BUCKET`;
8. verifies YDB and Object Storage health;
9. runs the reversible lead → quote → deposit → order → logistics → handoff E2E;
10. restores the pre-test application state.

Deployments no longer re-import Cloudflare state automatically, so Yandex demo changes are not overwritten on every deploy.

## Verified public endpoints

- Demo: `https://auto-sale-demo.viiversion.com`
- Health: `https://auto-sale-demo.viiversion.com/api/health`
- Gateway default domain: `https://d5d7e3tivcgnbe167btb.nnekmrav.apigw.yandexcloud.net/`

Expected health includes:

- `persistence: "ydb-serverless"`
- `writeMode: "public-demo"`
- `mediaStorage: "object-storage"`
- `mediaBucket: "viiversion-auto-sale-media"`

## Remaining production-hardening work

Before treating the demo as production:
1. add durable staff authentication and authorization;
2. restrict state writes by role;
3. decide whether catalog media should remain public or move to signed/private delivery;
4. optionally add CDN/custom media domain;
5. add backup/retention policy for catalog media;
6. run final security and browser E2E audit;
7. only then plan any Cloudflare production cutover or decommissioning.
