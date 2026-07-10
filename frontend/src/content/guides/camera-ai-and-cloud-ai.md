---
title: How Wildlife Watcher's AIs work together
description: What the Camera AI on your device and the Cloud AI on the website each do, why one photo can have two opinions, and how the Wildlife Brain groups look-alikes
category: Analysis
order: 20
updated: 2026-07-11
---

Wildlife Watcher identifies animals in two places — once on the camera itself, and again on the website after you upload — and then a third tool, the **Wildlife Brain**, groups the look-alikes to speed up your review. They are different tools with different jobs, and your photos benefit from all of them.

## Camera AI — on the device

**Camera AI** is the camera's ability to identify animals on its own, in the field, with no internet. The specific model that does this is called your project's **Species Brain** — a small, efficient model (for example, a "rat" vs "not rat" detector). You choose it in your project settings, and it is installed on the camera when you prepare an SD card (the Toolkit's **Prepare SD Card** step) or update the camera from the mobile app.

- It works in the field, instantly, on every photo the camera takes.
- It is trained for **your project's target species**, not for every animal.
- Its results are saved inside each photo, so they travel with the image to the website — where they appear as a **📟 Camera AI** label next to the website's own result (see below).

> **Tip:** a project without a Species Brain still takes photos normally — it just won't identify animals until you add one in the project settings.

## Cloud AI — on the website

When you upload photos, the website automatically runs a much larger identification system on powerful servers. Think of it as the thorough second opinion:

- It first finds the animals in each photo, then identifies the species.
- It knows thousands of species, not just your project's targets.
- It marks empty photos as **blank**, so you don't review them one by one.

Because it has far more computing power than the camera, the Cloud AI result is the more accurate of the two — it is the benchmark your team reviews against.

## Why both?

| | Camera AI | Cloud AI |
|---|---|---|
| Where it runs | On the camera, offline | On the website, after upload |
| Speed | Immediate, in the field | When photos are uploaded |
| Species it knows | Your project's targets | Thousands of species |
| Best at | Fast local detection | Accurate identification |

The two are complementary: the Camera AI reacts in the field the moment something is seen, and the Cloud AI double-checks everything once the photos reach the website.

## Two results on one photo

On the website, a photo can carry both opinions side by side, each with a small label so you always know where a result came from:

- **📟 Camera AI** — what your camera's Species Brain decided in the field.
- **☁ Cloud AI** — what the website's model decided on upload.
- **👤 Reviewed** — a person has checked it.

When they disagree, a person decides: **human review always wins**, then Cloud AI, then Camera AI. So the labels aren't a conflict to resolve — they're two independent checks that make it easy to trust the ones that agree and focus your attention on the ones that don't.

## Wildlife Brain — grouping look-alikes

After the Cloud AI has identified species, the **Wildlife Brain** does something different: it looks at how the animals *look* and groups visually similar ones together. It doesn't name species — it's a curation tool that helps you review a big dataset far faster:

- **Clusters** — confirm a whole group of look-alike animals in one go instead of one photo at a time.
- **Find similar** — from one animal, jump straight to others that look like it.
- **Map (UMAP)** — a visual scatter of your whole dataset to spot patterns and outliers.

You run it from the **Clusters** page. See [Grouping look-alikes with the Wildlife Brain](/guides/wildlife-brain) for the full walkthrough. (It's a separate tool from your camera's *Species Brain* — the Species Brain identifies on the device; the Wildlife Brain groups on the website.)

## What's next

Field alerts sent directly from the camera over long-range radio (LoRaWAN) are **in development** — the goal is that a Camera AI detection can notify your team without waiting for the SD card to be collected.

For help setting up your camera, see [Focusing the camera](/guides/focusing-the-camera). For common questions about the AI, see the [FAQ](/faq).
