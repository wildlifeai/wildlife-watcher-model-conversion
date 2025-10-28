<p align="center">
  <a href="https://wildlife.ai/">
    <img src="https://wildlife.ai/wp-content/uploads/2025/10/wildlife_ai_logo_dark_lightbackg_1772x591.png" alt="Wildlife.ai Logo" width="400">
  </a>
</p>

<h1 align="center">
Wildlife Watcher Model Conversion Tool
</h1>

<p align="center">
  <strong>A web tool to convert Edge Impulse models for use with Wildlife Watcher devices.</strong>
  <br />
  <a href="https://wildlife-watcher-model-conversion-4umtawwfwbj3webexi4fnn.streamlit.app/" target="_blank">
    <img src="https://static.streamlit.io/badges/streamlit_badge_black_white.svg" alt="Streamlit App" />
  </a>
</p>

## 🚀 Project

This Streamlit application provides a simple web interface for converting Edge Impulse models into the format required by Wildlife Watcher hardware.

The tool automates the process described in the original `WildlifeWatcher_model_preparation.ipynb` notebook. It accepts a standard Edge Impulse `.zip` file and performs the following steps:

1. Unzips the model file.
2. Runs the `vela` compiler (for the `ethos-u55-64` accelerator) on the `trained.tflite` file.
3. Extracts class labels from the `model_variables.h` header file.
4. Packages the newly compiled `_vela.tflite` model and the `labels.txt` file into a downloadable `Manifest.zip`.

## 💻 Development

To run this application locally, ensure you have Python 3 and pip installed.

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```
    *(Note: Replace the URL with your actual repository link.)*
2.  **Install dependencies:**
    This will install `streamlit` and `ethos-u-vela`.
    ```bash
    pip install -r requirements.txt
    ```
3.  **Run the app:**
    ```bash
    streamlit run app.py
    ```

The application will open in your default web browser.

## 👥 Contributors

This tool was developed by members of the Wildlife.ai team:
- Will McEwan
- Tobyn Packer
- Victor Anton

## 📜 License

This project is licensed under the **GPL-3.0 License** - see the `LICENSE` file for details.