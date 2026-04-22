# Feature Implementations

<cite>
**Referenced Files in This Document**
- [README.md](file://README.md)
- [index.html](file://public/index.html)
- [admin.html](file://public/admin.html)
- [app.js](file://public/app/app.js)
- [admin.js](file://public/app/admin.js)
- [styles.css](file://public/css/styles.css)
- [api.ts](file://src/routes/api.ts)
- [youtube.ts](file://src/services/youtube.ts)
- [audio.ts](file://src/services/audio.ts)
- [report.ts](file://src/services/report.ts)
- [types.ts](file://src/types.ts)
- [cache.ts](file://src/services/cache.ts)
- [analytics.ts](file://src/services/analytics.ts)
</cite>

## Update Summary
**Changes Made**
- Updated search results display behavior documentation to reflect removal of automatic scrolling
- Clarified current search results display characteristics and interaction model
- Enhanced documentation for YouTube search functionality with improved visual presentation details

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document explains the major feature implementations in the frontend application for the K-Pop Random Dance Generator. It focuses on:
- YouTube search and metadata integration with enhanced visual presentation
- Song segment management (drag-and-drop, manual URL entry, bulk operations)
- Real-time validation (time inputs, URL verification)
- Project management (import/export, shuffle, view modes)
- Statistics visualization (duration, song count, band variety)
- Progress tracking during audio generation, error handling, and user feedback
- **Enhanced Top Songs feature with social discovery mechanism for trending K-pop songs**
- Performance optimization techniques for large datasets and smooth interactions

## Project Structure
The application follows a clear separation of concerns:
- Frontend (Vanilla JS): UI templates, state management, event handling, and user interactions
- Backend (Bun + Hono): API endpoints for YouTube metadata, search, generation, downloads, and analytics
- Services: yt-dlp integration, FFmpeg audio processing, caching, report generation, analytics logging

```mermaid
graph TB
subgraph "Frontend"
UI["index.html<br/>Templates & Layout"]
FE["app.js<br/>State, Events, UI Updates"]
ADM["admin.html<br/>Admin Dashboard"]
ADMA["admin.js<br/>Admin Controls"]
CSS["styles.css<br/>UI Styling"]
end
subgraph "Backend API"
API["api.ts<br/>Routes & Jobs"]
YT["youtube.ts<br/>yt-dlp Wrapper"]
AUD["audio.ts<br/>FFmpeg Processing"]
REP["report.ts<br/>Report Generation"]
ANA["analytics.ts<br/>SQLite Logging"]
CAC["cache.ts<br/>In-memory Cache"]
end
UI --> FE
ADM --> ADMA
FE --> API
ADMA --> API
API --> YT
API --> AUD
API --> REP
API --> ANA
YT --> CAC
CSS --> UI
CSS --> ADM
```

**Diagram sources**
- [index.html:1-374](file://public/index.html#L1-L374)
- [admin.html:1-216](file://public/admin.html#L1-L216)
- [app.js:1-1791](file://public/app/app.js#L1-L1791)
- [admin.js:1-105](file://public/app/admin.js#L1-L105)
- [styles.css:1-1808](file://public/css/styles.css#L1-L1808)
- [api.ts:1-306](file://src/routes/api.ts#L1-L306)
- [youtube.ts:1-232](file://src/services/youtube.ts#L1-L232)
- [audio.ts:1-206](file://src/services/audio.ts#L1-L206)
- [report.ts:1-172](file://src/services/report.ts#L1-L172)
- [cache.ts:1-42](file://src/services/cache.ts#L1-L42)
- [analytics.ts:1-92](file://src/services/analytics.ts#L1-L92)

**Section sources**
- [README.md:82-100](file://README.md#L82-L100)
- [index.html:1-374](file://public/index.html#L1-L374)
- [app.js:1-128](file://public/app/app.js#L1-L128)

## Core Components
- State management: central state object stores song segments, generation flags, toggles, and drag state
- Templates: reusable song card and search result templates for dynamic rendering
- Event-driven UI: input debouncing, drag-and-drop reordering, real-time validation, and progress polling
- Backend integration: YouTube search/info, generation job lifecycle, and download/report endpoints
- **Enhanced Top Songs Discovery: Social discovery mechanism for trending K-pop songs with real-time popularity tracking**

**Section sources**
- [app.js:5-46](file://public/app/app.js#L5-L46)
- [index.html:257-356](file://public/index.html#L257-L356)
- [app.js:108-128](file://public/app/app.js#L108-L128)

## Architecture Overview
The frontend communicates with backend endpoints to manage YouTube metadata, generate audio, and download results. The backend orchestrates yt-dlp and FFmpeg, manages job state, and persists analytics. The enhanced Top Songs feature integrates with the analytics system to provide social discovery capabilities with improved visual presentation.

```mermaid
sequenceDiagram
participant User as "User"
participant FE as "Frontend (app.js)"
participant API as "Backend API (api.ts)"
participant YT as "YouTube Service (youtube.ts)"
participant AUD as "Audio Service (audio.ts)"
participant ANA as "Analytics Service (analytics.ts)"
User->>FE : Enter YouTube URL
FE->>API : GET /api/youtube/info?url=...
API->>YT : getVideoInfo(url)
YT-->>API : VideoInfo
API-->>FE : VideoInfo
FE->>FE : Populate song card, initialize timeline
FE->>ANA : Log generation (for analytics)
User->>FE : Click "Generate"
FE->>API : POST /api/generate {segments}
API-->>FE : {jobId}
FE->>FE : Load Top Songs
FE->>API : GET /api/top-songs
API->>ANA : getStats()
ANA-->>API : topSongs data
API-->>FE : Top Songs list
loop Polling
FE->>API : GET /api/status/ : jobId
API-->>FE : {status, progress}
end
FE->>API : GET /api/download/ : jobId
API-->>FE : MP3 file
FE->>FE : Show download link
```

**Diagram sources**
- [app.js:356-541](file://public/app/app.js#L356-L541)
- [app.js:1164-1233](file://public/app/app.js#L1164-L1233)
- [api.ts:141-176](file://src/routes/api.ts#L141-L176)
- [api.ts:76-83](file://src/routes/api.ts#L76-L83)
- [youtube.ts:12-81](file://src/services/youtube.ts#L12-L81)
- [audio.ts:9-117](file://src/services/audio.ts#L9-L117)
- [analytics.ts:75-91](file://src/services/analytics.ts#L75-L91)

## Detailed Component Analysis

### YouTube Search and Metadata Integration
**Updated** The search functionality maintains its core functionality while enhancing the visual presentation and interaction model. The search results display behavior has been modified to remove automatic scrolling behavior, providing a more controlled user experience.

- **Search Implementation**: Debounced input triggers search endpoint; results are rendered in the sidebar with thumbnails and durations
- **Enhanced Visual Presentation**: Results display with improved styling, hover effects, and custom scrollbar
- **Info Retrieval**: On URL input/paste or manual fetch, the frontend requests video info; on success, it populates the song card and initializes the timeline
- **URL Cleaning**: Normalizes short URLs and extracts canonical YouTube watch URLs
- **Validation**: Real-time URL validation prevents invalid requests

```mermaid
sequenceDiagram
participant FE as "Frontend"
participant API as "API"
participant YT as "YouTube Service"
FE->>FE : User types in search box
FE->>API : GET /api/youtube/search?q=query
API->>YT : searchVideos(query)
YT-->>API : VideoInfo[]
API-->>FE : VideoInfo[]
FE->>FE : Render search results (no automatic scroll)
FE->>API : GET /api/youtube/info?url=...
API->>YT : getVideoInfo(url)
YT-->>API : VideoInfo
API-->>FE : VideoInfo
FE->>FE : Update song card, show timeline
```

**Diagram sources**
- [app.js:1108-1126](file://public/app/app.js#L1108-L1126)
- [app.js:356-433](file://public/app/app.js#L356-L433)
- [app.js:605-634](file://public/app/app.js#L605-L634)
- [api.ts:117-135](file://src/routes/api.ts#L117-L135)
- [api.ts:80-95](file://src/routes/api.ts#L80-L95)
- [youtube.ts:83-161](file://src/services/youtube.ts#L83-L161)
- [youtube.ts:12-81](file://src/services/youtube.ts#L12-L81)

**Section sources**
- [app.js:1108-1157](file://public/app/app.js#L1108-L1157)
- [app.js:356-433](file://public/app/app.js#L356-L433)
- [app.js:605-634](file://public/app/app.js#L605-L634)
- [api.ts:80-95](file://src/routes/api.ts#L80-L95)
- [youtube.ts:12-81](file://src/services/youtube.ts#L12-L81)
- [youtube.ts:83-161](file://src/services/youtube.ts#L83-L161)

### Enhanced Search Results Display Behavior
**Updated** The search results display behavior has been refined to provide a more controlled and predictable user experience by removing automatic scrolling behavior.

- **Manual Scrolling Control**: Users can manually scroll through search results without automatic viewport adjustments
- **Improved Visual Feedback**: Enhanced hover states and custom scrollbar styling for better interaction
- **Responsive Design**: Maintains optimal display across different screen sizes and device orientations
- **Accessibility**: Preserves keyboard navigation and screen reader compatibility
- **Performance Optimization**: Reduces DOM manipulation overhead by avoiding automatic scroll positioning

```mermaid
flowchart TD
Start(["User performs search"]) --> Results["Display results in sidebar"]
Results --> ManualScroll["User can manually scroll results"]
ManualScroll --> NoAutoScroll["No automatic scrolling behavior"]
NoAutoScroll --> HoverEffects["Hover effects remain active"]
HoverEffects --> AddSong["Click add button to add song"]
AddSong --> PopulateCard["Populate song card with video info"]
PopulateCard --> InitTimeline["Initialize timeline controls"]
```

**Diagram sources**
- [app.js:1136-1162](file://public/app/app.js#L1136-L1162)
- [styles.css:225-244](file://public/css/styles.css#L225-L244)
- [styles.css:254-270](file://public/css/styles.css#L254-L270)

**Section sources**
- [app.js:1136-1162](file://public/app/app.js#L1136-L1162)
- [styles.css:225-244](file://public/css/styles.css#L225-L244)
- [styles.css:254-270](file://public/css/styles.css#L254-L270)

### Top Songs Discovery System
**New Feature** - Enhanced social discovery mechanism for trending K-pop songs with improved visual presentation

- **Real-time Popularity Tracking**: The system tracks which songs are most frequently used in generated dances through analytics logging
- **Automatic Trending Display**: Top 10 most popular songs are automatically displayed in the sidebar with rank indicators
- **Enhanced Visual Popularity Indicators**: Songs are ranked with special styling for top 3 positions (gold/red gradient)
- **Direct Integration**: Users can add popular songs directly to their project with a single click
- **YouTube Thumbnail Integration**: Popular songs display YouTube thumbnails for better recognition
- **Admin Dashboard**: Administrators can view detailed popularity statistics and song usage patterns

```mermaid
flowchart TD
Start(["User loads page"]) --> LoadStats["Load analytics stats"]
LoadStats --> CheckTop{"Has top songs?"}
CheckTop --> |Yes| DisplayTop["Display top songs list"]
CheckTop --> |No| EmptyState["Show empty state"]
DisplayTop --> Hover["Hover effect shows add button"]
Hover --> Click["Click to add song"]
Click --> AddToProject["Add to project"]
AddToProject --> FetchInfo["Fetch video info"]
FetchInfo --> Populate["Populate song card"]
Populate --> InitTimeline["Initialize timeline"]
```

**Diagram sources**
- [app.js:1164-1233](file://public/app/app.js#L1164-L1233)
- [app.js:1255-1272](file://public/app/app.js#L1255-L1272)
- [api.ts:76-83](file://src/routes/api.ts#L76-L83)
- [analytics.ts:75-91](file://src/services/analytics.ts#L75-L91)

**Section sources**
- [app.js:1164-1233](file://public/app/app.js#L1164-L1233)
- [app.js:1255-1272](file://public/app/app.js#L1255-L1272)
- [api.ts:76-83](file://src/routes/api.ts#L76-L83)
- [analytics.ts:75-91](file://src/services/analytics.ts#L75-L91)
- [admin.js:83-96](file://public/app/admin.js#L83-L96)

### Song Segment Management
- Manual URL entry: URL input with paste/enter triggers auto-fetch; debounced to reduce network calls
- Drag-and-drop reordering: Uses native HTML5 drag-and-drop on card headers; updates state and rebuilds UI
- Bulk operations: Add/remove songs; import/export project JSON; toggle compact/expanding views
- Timeline editing: Visual timeline with draggable handles and keyboard navigation; auto-updates time inputs and validates ranges

```mermaid
flowchart TD
Start(["User adds URL"]) --> Clean["Clean URL"]
Clean --> Valid{"Valid YouTube URL?"}
Valid --> |No| Hint["Show invalid state"]
Valid --> |Yes| Debounce["Debounce fetch"]
Debounce --> Fetch["Fetch video info"]
Fetch --> Populate["Populate card & timeline"]
Populate --> Drag["Drag to reorder"]
Drag --> Rebuild["Rebuild list UI"]
Rebuild --> Export["Export project JSON"]
Rebuild --> Import["Import project JSON"]
Rebuild --> Compact["Toggle compact view"]
```

**Diagram sources**
- [app.js:162-323](file://public/app/app.js#L162-L323)
- [app.js:262-307](file://public/app/app.js#L262-L307)
- [app.js:844-902](file://public/app/app.js#L844-L902)
- [app.js:605-634](file://public/app/app.js#L605-L634)

**Section sources**
- [app.js:162-323](file://public/app/app.js#L162-L323)
- [app.js:262-307](file://public/app/app.js#L262-L307)
- [app.js:844-902](file://public/app/app.js#L844-L902)
- [app.js:1315-1427](file://public/app/app.js#L1315-L1427)

### Real-time Validation System
- Time inputs: Auto-format numeric input (e.g., 123 → 1:23); strict validation ensures logical ranges (start < end)
- URL validation: Regex-based checks for YouTube domains and formats; cleans URLs to canonical form
- Timeline validation: Visual feedback when start ≥ end; ARIA attributes for accessibility
- Button enable/disable: Generate button is enabled only when at least one song has a valid URL and all times are valid

```mermaid
flowchart TD
Input["User edits time"] --> AutoFormat["Auto-format 3-digit input"]
AutoFormat --> Validate["Validate format & range"]
Validate --> Valid{"Valid?"}
Valid --> |No| MarkInvalid["Mark inputs invalid"]
Valid --> |Yes| UpdateUI["Update timeline & stats"]
MarkInvalid --> UpdateUI
UpdateUI --> EnableGen["Enable/disable generate button"]
```

**Diagram sources**
- [app.js:988-1013](file://public/app/app.js#L988-L1013)
- [app.js:907-950](file://public/app/app.js#L907-L950)
- [app.js:955-983](file://public/app/app.js#L955-L983)
- [app.js:557-572](file://public/app/app.js#L557-L572)

**Section sources**
- [app.js:988-1013](file://public/app/app.js#L988-L1013)
- [app.js:907-950](file://public/app/app.js#L907-L950)
- [app.js:955-983](file://public/app/app.js#L955-L983)
- [app.js:557-572](file://public/app/app.js#L557-L572)

### Project Management Features
- Import/Export: JSON serialization of current state; preserves shuffle setting and song list
- Shuffle: Toggle to randomize order before generation
- View modes: Compact/expanding view toggles; global preference applied to existing cards
- Visit tracking: POST to log visits for analytics

```mermaid
sequenceDiagram
participant FE as "Frontend"
participant API as "API"
FE->>FE : Toggle shuffle
FE->>FE : Toggle compact view
FE->>FE : Click "Save Project"
FE->>FE : Export JSON blob
FE->>FE : Click "Load Project"
FE->>FE : Import JSON file
FE->>API : POST /api/visit
API-->>FE : OK
```

**Diagram sources**
- [app.js:56-69](file://public/app/app.js#L56-L69)
- [app.js:844-902](file://public/app/app.js#L844-L902)
- [api.ts:56-62](file://src/routes/api.ts#L56-L62)

**Section sources**
- [app.js:56-69](file://public/app/app.js#L56-L69)
- [app.js:844-902](file://public/app/app.js#L844-L902)
- [api.ts:56-62](file://src/routes/api.ts#L56-L62)

### Statistics Visualization
- Total duration: Sum of (end - start) per segment plus 5s countdown per segment
- Song count: Simple count of segments
- Band variety: Identifies bands from titles/channels using band list; renders percentage breakdown and a color-coded variety bar

```mermaid
flowchart TD
Init["Compute totals"] --> Loop["For each segment"]
Loop --> Dur["Add (end-start) + 5s countdown"]
Loop --> Band["Identify band"]
Band --> Count["Increment band count"]
Dur --> Done["Render stats"]
Count --> Done
```

**Diagram sources**
- [app.js:1018-1057](file://public/app/app.js#L1018-L1057)
- [app.js:1062-1103](file://public/app/app.js#L1062-L1103)
- [app.js:1274-1310](file://public/app/app.js#L1274-L1310)

**Section sources**
- [app.js:1018-1103](file://public/app/app.js#L1018-L1103)
- [app.js:1274-1310](file://public/app/app.js#L1274-L1310)

### Progress Tracking During Audio Generation
- Job lifecycle: Start generation, poll status every 2 seconds, update progress bar and text, show download/report links upon completion
- Error handling: Graceful failure states with user feedback; resets button state

```mermaid
sequenceDiagram
participant FE as "Frontend"
participant API as "API"
FE->>API : POST /api/generate {segments}
API-->>FE : {jobId}
loop Every 2s
FE->>API : GET /api/status/ : jobId
API-->>FE : {status, progress}
FE->>FE : Update progress bar
end
FE->>API : GET /api/download/ : jobId
API-->>FE : MP3
FE->>FE : Show download link
```

**Diagram sources**
- [app.js:438-541](file://public/app/app.js#L438-L541)
- [api.ts:141-176](file://src/routes/api.ts#L141-L176)
- [api.ts:182-205](file://src/routes/api.ts#L182-L205)

**Section sources**
- [app.js:438-541](file://public/app/app.js#L438-L541)
- [api.ts:141-176](file://src/routes/api.ts#L141-L176)
- [api.ts:182-205](file://src/routes/api.ts#L182-L205)

### Backend Integration Details
- YouTube info/search: Uses yt-dlp with JSON dump; caches search results; parses thumbnails and metadata
- Audio generation: Downloads segments with yt-dlp, concatenates with FFmpeg, applies loudness normalization, generates countdown audio
- Reports: Builds band statistics and saves JSON report alongside audio
- Analytics: Logs visits and generation events to SQLite with popularity tracking for social discovery

```mermaid
classDiagram
class API {
+GET /youtube/info
+GET /youtube/search
+POST /generate
+GET /status/ : jobId
+GET /download/ : jobId
+GET /download-report/ : jobId
+GET /bands
+POST /visit
+GET /top-songs
+GET /stats
}
class YouTubeService {
+getVideoInfo(url)
+searchVideos(query)
+downloadSegment(url, start, end, out)
+parseTimeToSeconds()
+formatSecondsToTime()
}
class AudioService {
+concatenateWithCountdown(segments, countdown, output)
+generateCountdownAudio(output)
+cleanupTempFiles(paths)
}
class ReportService {
+generateReport(segments)
+saveReport(report, jobId, dir)
}
class AnalyticsService {
+logVisit(userAgent, ip)
+logGeneration(jobId, segments)
+getStats()
}
class CacheService {
+getCache(key)
+setCache(key, value, ttl)
}
API --> YouTubeService : "uses"
API --> AudioService : "uses"
API --> ReportService : "uses"
API --> AnalyticsService : "uses"
YouTubeService --> CacheService : "uses"
AnalyticsService --> Database : "SQLite"
```

**Diagram sources**
- [api.ts:1-306](file://src/routes/api.ts#L1-L306)
- [youtube.ts:1-232](file://src/services/youtube.ts#L1-L232)
- [audio.ts:1-206](file://src/services/audio.ts#L1-L206)
- [report.ts:1-172](file://src/services/report.ts#L1-L172)
- [cache.ts:1-42](file://src/services/cache.ts#L1-L42)
- [analytics.ts:1-92](file://src/services/analytics.ts#L1-L92)

**Section sources**
- [api.ts:76-135](file://src/routes/api.ts#L76-L135)
- [youtube.ts:12-81](file://src/services/youtube.ts#L12-L81)
- [youtube.ts:83-161](file://src/services/youtube.ts#L83-L161)
- [audio.ts:9-117](file://src/services/audio.ts#L9-L117)
- [report.ts:136-171](file://src/services/report.ts#L136-L171)
- [cache.ts:16-35](file://src/services/cache.ts#L16-L35)
- [analytics.ts:60-91](file://src/services/analytics.ts#L60-L91)

## Dependency Analysis
- Frontend depends on backend endpoints for YouTube metadata, generation, downloads, and analytics
- Backend depends on yt-dlp and FFmpeg binaries; SQLite for analytics
- Services share common types and utilities for time parsing/formatting
- **Enhanced Top Songs feature depends on analytics service for popularity tracking and admin dashboard for management**

```mermaid
graph LR
FE["app.js"] --> API["api.ts"]
ADM["admin.js"] --> API
API --> YT["youtube.ts"]
API --> AUD["audio.ts"]
API --> REP["report.ts"]
API --> ANA["analytics.ts"]
YT --> CAC["cache.ts"]
FE --> TYPES["types.ts"]
ADM --> TYPES
API --> TYPES
YT --> TYPES
AUD --> TYPES
REP --> TYPES
```

**Diagram sources**
- [app.js:1-1791](file://public/app/app.js#L1-L1791)
- [admin.js:1-105](file://public/app/admin.js#L1-L105)
- [api.ts:1-306](file://src/routes/api.ts#L1-L306)
- [youtube.ts:1-232](file://src/services/youtube.ts#L1-L232)
- [audio.ts:1-206](file://src/services/audio.ts#L1-L206)
- [report.ts:1-172](file://src/services/report.ts#L1-L172)
- [cache.ts:1-42](file://src/services/cache.ts#L1-L42)
- [types.ts:1-45](file://src/types.ts#L1-L45)

**Section sources**
- [types.ts:1-45](file://src/types.ts#L1-L45)

## Performance Considerations
- Debouncing: Input fields debounce network calls to reduce redundant requests
- Caching: Search results cached with TTL to minimize repeated yt-dlp calls
- Efficient UI updates: Rebuilding the song list avoids full DOM recreation when reordering
- Minimal DOM manipulation: Timeline updates compute positions and apply CSS classes efficiently
- Background processing: Generation runs asynchronously; UI remains responsive with polling
- Large dataset handling: Timeline markers scale by duration; keyboard navigation supports fine-grained adjustments
- **Enhanced Search Performance**: Improved search results display with manual scrolling control reduces layout thrashing and improves responsiveness
- **Top Songs caching**: Analytics data is cached and refreshed periodically to minimize database queries

## Troubleshooting Guide
- YouTube URL issues: Ensure URLs are valid YouTube links; the frontend cleans short URLs and validates formats
- Generation failures: Check backend logs for yt-dlp/FFmpeg errors; verify external tools installation
- Empty search results: Confirm network connectivity and that yt-dlp is available at configured path
- Progress stuck: Verify job ID exists and polling continues; inspect status endpoint responses
- Analytics not updating: Confirm SQLite database initialization and write permissions
- **Search results not displaying properly**: Check that search results container has proper height constraints and custom scrollbar styling
- **Top Songs not loading**: Check /api/top-songs endpoint returns data; verify analytics logging is working; ensure database has generation records

**Section sources**
- [app.js:605-634](file://public/app/app.js#L605-L634)
- [api.ts:237-294](file://src/routes/api.ts#L237-L294)
- [youtube.ts:12-81](file://src/services/youtube.ts#L12-L81)
- [audio.ts:188-204](file://src/services/audio.ts#L188-L204)
- [analytics.ts:75-91](file://src/services/analytics.ts#L75-L91)

## Conclusion
The frontend integrates seamlessly with backend services to deliver a robust, user-friendly experience for creating K-Pop random dance mixes. Its features—YouTube search, precise time editing, real-time validation, project management, statistics visualization, and progress tracking—are implemented with performance and usability in mind.

**The enhanced Top Songs feature significantly improves the user experience by providing social discovery capabilities for trending K-pop songs. The recent enhancement to search results display behavior removes automatic scrolling, providing users with more control over their search experience while maintaining the visual appeal and functionality of the search interface. Through real-time popularity tracking and analytics integration, users can easily discover and incorporate the most popular songs in generated dances, creating a more engaging and community-driven experience. The feature includes comprehensive admin dashboard support for monitoring and managing popularity metrics, making it a valuable addition to the platform's social features.**

The modular backend architecture scales well for future enhancements while maintaining reliability, with the enhanced Top Songs feature demonstrating the platform's commitment to community engagement and social discovery.