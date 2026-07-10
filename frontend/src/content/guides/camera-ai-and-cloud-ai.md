---
title: How Wildlife Watcher's two AIs work together
description: What the Camera AI on your device and the Cloud AI on the website each do, and why one photo can have two opinions
category: Analysis
order: 20
updated: 2026-07-08
---

Wildlife Watcher identifies animals in two places: once on the camera itself, and again on the website after you upload your photos. They are different tools with different jobs, and your photos benefit from both.

## Camera AI — on the device

Your project can have a **Species Brain**: a small, efficient animal-identification model that runs on the camera itself, with no internet needed. It is chosen in your project settings and installed on the camera when you prepare an SD card (see the Toolkit's **Prepare SD Card** step) or update the camera from the mobile app.

- It works in the field, instantly, on every photo the camera takes.
- It is trained for **your project's target species** (for example "rat" vs "not rat"), not for every animal.
- Its results are saved inside each photo, so they travel with the image to the website.

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

The two are complementary: the Camera AI reacts in the field the moment something is seen, and the Cloud AI double-checks everything once the photos reach the website. Human review always has the final say over both.

## What's next

Field alerts sent directly from the camera over long-range radio (LoRaWAN) are **in development** — the goal is that a Camera AI detection can notify your team without waiting for the SD card to be collected.

For help setting up your camera, see [Focusing the camera](/guides/focusing-the-camera). For common questions about the AI, see the [FAQ](/faq).
