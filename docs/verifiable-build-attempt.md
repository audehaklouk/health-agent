# Verifiable Build Attempt — 2026-05-12

## Summary

- **Build submitted**: succeeded
- **Build ID**: `2c8c4a42-bed8-4936-91a3-4bdceec16f6d`
- **Image digest**: `sha256:057e2c8eeb69725353ccfb7921779cf126beddf9ad295552626c5894e649330b`
- **Image tag**: `docker.io/eigenlayer/eigencloud-containers:0decca6311c6295052b4bb2b52828d7ed30d1c86-1778573054`
- **Source commit**: `0decca6311c6295052b4bb2b52828d7ed30d1c86`
- **Provenance**: signature verified
- **Upgrade to running app**: BLOCKED — `PushPermissionError` pushing `-layered` image to `docker.io/eigenlayer/eigencloud-containers`. We do not have push access to EigenLayer's Docker Hub namespace.

## What worked

1. `ecloud compute build submit` cloned the public repo, built the Dockerfile server-side, pushed the image to `eigenlayer/eigencloud-containers`, and recorded on-chain provenance with a verified signature.
2. Dependencies (two EigenCompute base container builds) were resolved and verified.

## What failed

`ecloud compute app upgrade --verifiable --image-ref <tag>` pulls the verified image locally, layers EigenCompute components (compute-source-env.sh, kms-client) into a new `-layered` tag, then tries to push that layered image back to `docker.io/eigenlayer/eigencloud-containers`. This push fails with:

```
PushPermissionError: Permission denied pushing to
docker.io/eigenlayer/eigencloud-containers:...-layered:
push access denied, repository does not exist or may require authorization:
server message: insufficient_scope: authorization failed
```

## Next steps

- Ask EigenLayer team (Matt Murray) whether cohort participants need Docker Hub collaborator access to `eigenlayer/eigencloud-containers`, or if there is an alternative upgrade path.
- The verifiable build itself is complete and on-chain. Only the upgrade (deploying it to the running app) is blocked.

## Build submit output (trimmed)

```
Submitted build: 2c8c4a42-bed8-4936-91a3-4bdceec16f6d

Build completed successfully

Image:  docker.io/eigenlayer/eigencloud-containers:0decca6311c6295052b4bb2b52828d7ed30d1c86-1778573054
Digest: sha256:057e2c8eeb69725353ccfb7921779cf126beddf9ad295552626c5894e649330b
Source: https://github.com/audehaklouk/health-agent/tree/0decca6311c6295052b4bb2b52828d7ed30d1c86

Dependencies (resolved builds):
  - sha256:164c2890c15e88c0040fba5144fc1e20cd3bee66bfbf6085eb4ba6b59490b926 eigencompute-containers
  - sha256:840a35560a9ea6a47ce016e10ef73d21684f56fd34b027468d9868f268751303 eigencompute-containers

Provenance signature verified
provenance_signature: MEYCIQCKkpg5ijtu7yp1fuWfF50Kad03sggd8V4lkHtjtXDKmQIhAMdMph0ZlYQ8v3Qcy5ETgVV3swzYWNwfU/jt+/YwBlWU

Next Steps:
  Deploy a new app:
    ecloud compute app deploy --verifiable --image-ref sha256:057e2c8eeb69725353ccfb7921779cf126beddf9ad295552626c5894e649330b
  Upgrade an existing app:
    ecloud compute app upgrade <app-id> --verifiable --image-ref sha256:057e2c8eeb69725353ccfb7921779cf126beddf9ad295552626c5894e649330b
```

## Upgrade attempt error (trimmed)

```
Resolving and verifying prebuilt verifiable image...
Build completed successfully
Provenance signature verified

Performing preflight checks...
Pulling image... Image is up to date
Adding ecloud components to create ...-layered
Building Docker image: ...-layered (cached, all steps CACHED)
Publishing updated image...
Pushing image...

push access denied, repository does not exist or may require authorization:
server message: insufficient_scope: authorization failed

PushPermissionError: Permission denied pushing to
docker.io/eigenlayer/eigencloud-containers:...-layered
```
