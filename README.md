# 🎵 K-Pop Random Dance Generator

A sleek, modern web application that allows you to create the perfect K-Pop random dance practice mix. Combine your favorite song segments from YouTube with professional countdown transitions automatically.

You can check it live at (kpopgenerator.cloud)

## ✨ Features

- **YouTube Integration**: Search and import metadata directly from YouTube URLs.
- **Smart Time Formatting**: Quickly enter times like `123` and have them auto-formatted to `1:23`.
- **Advanced Validation**: Real-time checking of time ranges and YouTube URL validity.
- **Project Management**:
  - **Export/Import**: Save your song lists to JSON files and reload them later.
  - **Shuffle**: Randomized song order for a true challenge.
  - **Reordering**: Intuitive drag-and-drop to organize your playlist.
- **Compact & Expanded Views**: Toggle between a dense list view for long playlists and a detailed view with video thumbnails.
- **Detailed Reports**: Generates a `report.json` with your playlist order and **Artist Statistics** (e.g., "Somi 20%, NewJeans 40%").
- **Automatic Audio Processing**: Seamlessly mixes audio segments with 5-second countdowns between them using high-performance backend processing.

## 🛠️ Technology Stack

- **Backend**: [Bun](https://bun.sh/) + [Hono](https://hono.dev/)
- **Audio Processing**: [FFmpeg](https://ffmpeg.org/)
- **Video Extraction**: [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- **Frontend**: Vanilla HTML5, CSS3 (Glassmorphism), and Modern JavaScript

## 📋 Prerequisites

Before running the application, ensure you have the following installed:

1. [Bun](https://bun.sh/docs/installation) (v1.0.0 or later)
2. [FFmpeg](https://ffmpeg.org/download.html)
3. [yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/Installation)

## 🚀 Installation & Setup

1. **Clone the repository**:

   ```bash
   git clone https://github.com/your-username/kpop-random-dance-generator.git
   cd kpop-random-dance-generator
   ```

2. **Install dependencies**:

   ```bash
   bun install
   ```

3. **Configure Environment**:
   Create a `.env` file in the root directory (using `.env.template` as a guide):
   ```bash
   PORT=3000
   YTDLP_PATH=/usr/bin/yt-dlp  # Optional: full path to yt-dlp binary
   ```

## 🏃 Running the Application

### Development Mode (with hot-reload)

```bash
bun run dev
```

### Production Mode

```bash
bun start
```

Once started, the application will be available at `http://localhost:3000`.

## ⚙️ Configuration

The application uses environment variables for configuration. You can set these in a `.env` file:

| Variable     | Description                          | Default  |
| ------------ | ------------------------------------ | -------- |
| `PORT`       | The port the server will run on      | `3000`   |
| `YTDLP_PATH` | Full path to the `yt-dlp` executable | `yt-dlp` |

## 📁 Project Structure

```text
├── src/
│   ├── index.ts        # Entry point & Dependency checks
│   ├── routes/
│   │   └── api.ts      # API endpoints (YouTube info, Generate, Download)
│   ├── services/
│   │   ├── audio.ts    # FFmpeg processing logic
│   │   ├── youtube.ts  # yt-dlp integration
│   │   └── report.ts   # JSON report & statistics generation
│   └── types.ts        # TypeScript interfaces
├── public/
│   ├── index.html      # Main application UI
│   ├── styles.css      # Design & Theme
│   └── app.js          # Frontend logic & State management
├── assets/             # Static assets (countdown sounds, etc.)
└── temp/               # Temporary workspace for audio generation
```

## 💜 Acknowledgments

- Built for K-Pop dance lovers everywhere.
- Thanks to the developers of Bun, Hono, FFmpeg, and yt-dlp.
