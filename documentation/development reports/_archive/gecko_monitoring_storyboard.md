# 🦎 UI Storyboard: Monitoring Wellington Geckos

> **Status:** 🕰️ Historical snapshot — point-in-time design/roadmap; **not** kept current with the code.

**User Persona:** Dr. Sarah, a conservation ecologist monitoring a translocated population of Wellington green geckos.
**Goal:** Process SD card footage from 5 trail cameras placed around a sanctuary for a month, identify all geckos, and generate a geographical heatmap of their activity.

---

### Step 1: Login
- **What she sees:** The `wildlifewatcher.ai` login screen.
- **What she does:** Enters her credentials and clicks "Log In".
- **Result:** She is directed to the **Home Page**.

### Step 2: Uploading SD Card Footage
- **What she sees:** The Home Page displaying her active projects and a prominent **"Upload Data"** button.
- **What she does:** 
  1. Plugs the SD card from Camera 1 into her laptop.
  2. Clicks the **"Upload Data"** button.
  3. A drag-and-drop zone appears on the screen.
  4. She selects the media files from her SD card directory and drags them into the zone.
- **Result:** A progress bar appears showing the upload status. The system automatically reads the deployment ID from the files to link them to the correct location and user, so she sees no manual entry forms.
- *She repeats the drag-and-drop action for the remaining 4 SD cards.*

### Step 3: Automatic AI Processing
- **What she sees:** As the upload progresses, the images start appearing immediately in the **Review Section** with AI-generated species classifications automatically applied (e.g., "Wellington Green Gecko - 92% confidence").
- **What she does:** Because the system is set to run the AI pipeline and clustering automatically upon upload, she doesn't have to trigger anything manually. She simply watches the AI process the incoming footage in real-time.

### Step 4: Rapid Review & iNaturalist Integration
- **What she sees:** The screen displays large "Contact Sheets" where the system has automatically grouped visually similar images into clusters.
- **What she does and sees:** 
  - The first few grouped sheets display arrays of identical geckos. Since the AI's "Wellington Green Gecko" classification is correct, she clicks **"Confirm Cluster"** to bulk-approve them.
  - She spots a couple of gecko photos in a cluster that look slightly different, making her suspect it might be a rare variant or a different species altogether.
  - She selects those specific photos and clicks the **"Publish to iNaturalist"** button. Since she had previously linked her iNaturalist account to Wildlife Watcher, the images and their metadata are instantly pushed to her iNaturalist profile for community expert review.
  - She then scrolls down to another cluster containing rodents. The AI grouped them together as "Rat". She uses the bulk-edit tool to refine the identification to the species level, marking them all as "Ship Rat" with one click.

### Step 5: Interactive Reporting & Export
- **What she sees:** A navigation menu with an option for the **Reports Section**.
- **What she does:** Clicks on the section to open the interactive graphing tool.
  1. She configures the Y-axis to display `"Number of Gecko Photos per Day"`.
  2. She configures the X-axis to display external weather data: `"Max Daily Temperature"`.
- **Result:** A dynamic scatter plot/line graph is generated, clearly visualizing the correlation between temperature spikes and gecko activity.
- **Exporting:** She clicks the **"Download"** button and saves the graph as both a `.pdf` and a `.png` for an upcoming presentation. Finally, she clicks **"Export Data"** to download the raw dataset as a `.csv` so she can run advanced statistical modeling in R.
