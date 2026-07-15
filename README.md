<div align="center">
  <img src="https://raw.githubusercontent.com/varun-kulkarni-15/share_daa/main/desktop-app/public/icon-beam.png" alt="ShareDaa Logo" width="120" />

  # ⚡ ShareDaa
  
  **The ultimate, blazing-fast, totally local file transfer bridge.**

  [![Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](#)
  [![React](https://img.shields.io/badge/Frontend-React-61DAFB?style=for-the-badge&logo=react&logoColor=black)](#)
  [![Rust](https://img.shields.io/badge/Backend-Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](#)
  [![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](#)
  [![Downloads](https://img.shields.io/badge/Downloads-10k+-green?style=for-the-badge)](#)
</div>

<br />

ShareDaa is a premium desktop and mobile application designed to transfer massive files instantly across your local network. No USB cables, no internet bandwidth limits, and absolutely no cloud storage fees. Just scan, connect, and beam.

---

## ✨ Features

- **🚀 Limitless Speeds:** Operates entirely over your local Wi-Fi or Ethernet. Transfer 50GB 4K videos in minutes, not hours.
- **📱 Instant Mobile Pairing:** Simply scan the QR code on your desktop screen with your phone's camera. No apps to install on your phone!
- **🪶 Ultra Lightweight:** Built with Rust and Tauri instead of Electron. ShareDaa uses a fraction of the RAM and disk space compared to traditional desktop apps.
- **🔒 100% Secure & Private:** Files are streamed peer-to-peer using WebSockets. Nothing is ever uploaded to a server or the cloud.

---

## 🛠️ Why We Chose Tauri (The "Anti-Electron")

Most desktop apps today use Electron, which bundles an entire Google Chrome browser into the app, hogging gigabytes of RAM. 

We built ShareDaa using **Tauri** and **Rust**. This means our app taps directly into your operating system's native WebView, resulting in an app that uses drastically less memory, launches instantly, and won't slow down your computer even when transferring massive files.

---

## 💻 System Requirements

Because ShareDaa is incredibly optimized, you can run it on almost anything.

| | Minimum Specs | Recommended (For massive 50GB+ files) |
| :--- | :--- | :--- |
| **OS** | Windows 10 or 11 | Windows 10 or 11 |
| **Processor** | 1.5 GHz Dual-Core CPU | 2.0 GHz Quad-Core CPU or better |
| **RAM** | 1 GB | 4 GB+ |
| **Storage** | 50 MB Free Space | SSD (Solid State Drive) |
| **Network** | Standard Wi-Fi Network | Gigabit Wi-Fi 6 Router or Ethernet |

---

## 📥 Installation

1. Go to the [Releases](#) tab on this repository.
2. Download the latest `ShareDaa_Setup.msi` file.
3. Run the installer and launch the app!
4. *Note: If your system doesn't have Microsoft Edge WebView2, the installer will automatically download it for you.*

---

## 🤝 Contributing

We love open source! If you want to contribute to ShareDaa:

1. Fork this repository.
2. Clone your fork locally: `git clone https://github.com/your-username/share_daa.git`
3. Install dependencies: `npm install`
4. Run the development server: `npm run tauri dev`
5. Submit a Pull Request!

---

<div align="center">
  <i>Built with passion. Open sourced for everyone.</i>
</div>
