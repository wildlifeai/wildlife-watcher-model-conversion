# Bench run from the mobile app: steps 2 and 3 done, step 4 is yours

#### File: 2026-09-05_bench-run-from-the-mobile-app.md
#### Author: Claude (Opus 5), with Victor Anton, from the ww-mobile-app side
#### 5 September 2026

**Status:** Steps 2 and 3 of the runbook in [README.md](README.md) are done on real hardware.
Step 4 has not been run. There are 11 images waiting with per-class person scores in their
EXIF. Read §5 first if you only read one section: the model that ran is **not** the one the
runbook names, and that changes the pass condition.

## 1. What you are getting

```
C:\Users\ww\person-test-images\
└── MEDIA\
    ├── 00000000\IMAGES.000\   1 image, captured with no deployment id set
    └── E10F7C43\IMAGES.000\  11 images, the monitoring run
```

The card's own folder structure is preserved on purpose. An earlier attempt copied the
images into a flat folder and the upload dialog could not match them to a deployment,
because the folder name is the deployment id. Uploading this tree should let the matching
work; if it still cannot, that is a finding worth having.

Every one of the 11 carries the device's own scores in `UserComment`, both classes named:

| File | no person | person |
|---|---|---|
| A9B7AF10.JPG | 46% | **54%** |
| A9B7B560.JPG | 46% | **54%** |
| A9B7B5A0.JPG | 36% | **64%** |
| A9B7B5D0.JPG | 30% | **70%** |
| A9B7B610.JPG | 38% | **62%** |
| A9B7B650.JPG | 54% | 46% |
| A9B7BA00.JPG | 52% | 48% |
| A9B7BB20.JPG | 53% | 47% |
| A9B7BF50.JPG | 37% | **63%** |
| A9B7BF90.JPG | 36% | **64%** |
| A9B7BFC0.JPG | 53% | 47% |

Six of the eleven are above 50 percent, up to 70. Those six should each produce one
`ai_origin='edge'` observation at the 50 percent threshold in the label map. The other five
should produce none, which is as good a test of the threshold as the positives are of the
mapping.

The one image under `00000000` was taken before the deployment id was set. It is included
deliberately: it is what an unassigned capture looks like.

## 2. The device side is verified, so failures below this line are yours

The firmware confirmed the labels at model load:

```
Magic: 0x4c41424c Model '1V1.TFL' has 2 labels of 20 bytes:
There are 2 classes (2)
```

No `WARNING: Number of classes and labels unmatched`. That is the exact line
[#134](https://github.com/wildlifeai/ww-website/issues/134) was raised on, and the retransfer
trap in step 2.4 of the runbook did not bite: this was a freshly formatted card.

The website's own parser reads all 11 back correctly. Checked with
`app.domain.exif.parse_exif_from_bytes` inside the running api container, which returned
`{"no person": "46%", "person": "54%"}` and so on. So EXIF writing, the string contract and
your parser agree.

## 3. What I changed in the dev environment, which you may not expect

**`FF_EDGE_REFLECT_ENABLED` was never reaching the container.** It is declared in
`backend/app/config.py` and gates `domain/edge_reflection.py`, but `docker-compose.yml` did
not pass it through, so no containerised deployment could ever have had the edge half on. I
added it next to the other flags and set it true in `.env`. The api container now reports
`FF_EDGE_REFLECT_ENABLED=true`. **This is committed in the compose file and is the one change
here that outlives the session.**

**The person model had an empty `label_map`.** `build_edge_observations` returns `[]` when
the map is empty, so the edge half would have produced nothing regardless of the flag. I set
it on the model that ran: `person` as a target mapped to Homo sapiens with `threshold: 50`,
`no person` as background. If the dev database is reseeded, this goes away again; Victor was
reseeding roughly every few hours today.

**A deployment row was created** called "Person detection bench, 5 September 2026",
`53440c50-575f-4f0c-bed5-387342459e57`, on Sinbad Skink Survey. It is not the deployment
these 11 images belong to. See §5.

## 4. The images are badly overexposed, and that is a firmware fault

Every frame is washed out with a green cast. The camera's own metering says why, identically
on every capture of an earlier run:

```
AE: p75=252 (target 110) exposure 2368->934 gain code 0->0
```

The bright quartile is saturated at 252 of 255 against a target of 110. Auto exposure
computes the right correction and it never takes, because each wake re-runs the sensor init
that writes `IMX708 EXPOSURE(0x0940)`, which is 2368, and a deployed camera sleeps between
every capture. Fifteen inits, fourteen identical corrections, no convergence.

This matters to you in one way only: do not read a weak SpeciesNet result as a pipeline
problem. A person is clearly visible in the strong frames (A9B7B5D0 scored 70 percent and
shows a face), but the images are poor input for any cloud model. The firmware fault is being
written up separately on the Seeed side.

## 5. Read this before you run step 4

**The model that ran is `1V1`, not `20V1`.** The runbook names
`a3c7c373-30a2-4692-9ba2-2e69064144eb`, "Person Detection (96x96)", whose files are
`20V1.TFL` / `20V1.TXT`. What actually ran on the device is
`5f84ec96-26a8-422c-be4a-31834c25a02e`, "Person Detection", files `1V1.TFL` / `1V1.txt`. So
**your pass condition of `source_model_version = 20V1` will not match. Expect `1V1`.**

Both are `validated`, both have two-line labels, both have a label map, and both point at the
same 251568-byte binary, sha256 `4ff0ffb6…`. They are duplicates of each other under
different family ids.

**Sinbad Skink Survey was repointed at the person model, against your instruction.** The
runbook says not to reuse it because it is the Rat Detection demo. Victor asked for that
project specifically, so `projects.model_id` now points at `5f84ec96`. If you want the demo
back, set it to `d0000000-0000-4000-8000-0000000000a1`.

**The deployment id on the images is not in the cloud database.** The card folder is
`E10F7C43`, so the app created that deployment locally when monitoring started, and at the
time of writing no deployments row begins `e10f7c43`. Either it had not synced yet, or the
push dropped it. If you cannot resolve it, assign the images to a deployment under a project
whose `model_id` is the person model, or `edge_reflection` will resolve no model and reflect
nothing.

**Rat Detection is still serving the person labels.** `7V1.txt` contains `no person\nperson`
while its label map claims `rat` / `not rat`, and its binary is the same person detector. Any
project on that model reports classes its own map cannot match. That is
[ww-backend #175](https://github.com/wildlifeai/ww-backend/issues/175) and it is unchanged.

## 6. How to run it

Both work. The api container and the vite frontend were running locally against the cloud dev
database when this was written, on ports 8000 and 5173, though Docker Desktop has since
stopped on this machine.

- **Locally**, bring the stack up with both compose files, which is what picks up the new
  flag: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`. Confirm with
  `docker exec ww-website-api-1 printenv FF_EDGE_REFLECT_ENABLED`.
- **On the published dev site**, check that the same flag is set there. It was missing from
  compose entirely, so it is worth assuming it is unset wherever else the api runs.

Then upload the tree, run the pipeline, and use your own
`scripts/step3_verify_deployment.py <deployment_id>`.

## 7. What we would like back

Whether the edge half works end to end, with the caveat that the version string is `1V1`. If
it does, this closes steps 3 and 4 and the runbook is proven on hardware for the first time.

And anything you need from the mobile app. Two things we already know are ours, neither
blocking you:

- The app syncs only models with `status = 'validated'`, so a `deployed` model is invisible to
  it and a project pointing at one deploys with no model at all. The enum comment in
  ww-backend says validated **or** deployed should reach devices. Rat Detection is `deployed`,
  which is why it cannot currently be tested from the app.
- The upload dialog could not match a flat folder of images to a deployment. Expected, but if
  you would rather the app stamped something more robust than the card path, say so.

Three smaller things seen from this side, in case they are yours: the four session preview
thumbnails in the upload dialog render as broken images with alt text; `crc_checksum` is null
on the nRF firmware rows though present on the Himax ones; and `uploaded_by` being NULL is
already in your open items.
