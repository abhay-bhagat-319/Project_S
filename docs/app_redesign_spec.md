# Project_S: Master App Redesign Specification (Screen-by-Screen)

## 1. Design Vision & Architectural Paradigm

This document specifies the complete visual, architectural, and interaction redesign for **Project_S (IISERB Shiksha Mobile Companion)**. The redesign elevates the app from a basic wrapper into a high-agency, daily-driver academic cockpit with instant access to tools, schedules, reports, and attendance metrics.

### 1.1 Aesthetic & Visual Foundations (Anti-Slop Guidelines)
*   **Palette**: Pure Dark Canvas (`#121318` background, `#1A1C24` card surface, `#252836` elevated container/borders). High-contrast accent system (Electric Indigo `#6C5CE7` / Vibrant Cyan `#00CEC9` / Warm Amber `#FDCB6E` / Mint Green `#00B894` / Coral `#FF7675`).
*   **Geometry**: Large radius cards (`24px`–`28px`), circular micro-action pills (`9999px`), 1px subtle inner refraction borders (`border-white/10`).
*   **Typography**: Clean sans-serif hierarchy (`Satoshi` / `Cabinet Grotesk` / system font stack). High contrast white `#FFFFFF` for primary titles, `#94A3B8` for secondary metadata, and tabular monospace numbers for CGPA/Attendance percentages.
*   **Motion**: Spring-driven transitions (`type: "spring", stiffness: 120, damping: 18`), zero layout jumping, tactile press states (`scale: 0.96`), and sequential waterfall reveals.

---

## 2. Screen Inventory & Navigation Architecture

```
                                  [ Global App Shell ]
                                           │
  ┌──────────────────┬─────────────────────┼─────────────────────┬──────────────────┐
  ▼                  ▼                     ▼                     ▼                  ▼
[1. Dashboard/     [2. Attendance]       [3. Courses &         [4. Portal         [5. Settings &
 Profile Hub]       (Live Tracker &       Curriculum]           Webview]           Storage]
 (PhonePe Quick-     Bunk Calculator)     (Syllabus, Slots &    (Injected Clean    (Cache Stats &
  Action Grid &                           SRS Surveys)          Portal Engine)     Security)
  CPI Trends)
```

---

## 3. Screen 1: Dashboard / Profile Hub (The Academic Cockpit)

### 3.1 Problem with Current Implementation
- Current profile page is static and underutilized: only shows student name, roll number, passed/failed badges, and a CPI chart.
- Extra features (DOAA schedules, report cards, SRS feedback, exam timetables, admit cards) lack a unified, immediate entry point.

### 3.2 Redesign Solution: PhonePe-Style "Quick Access" Bento Grid
Transform the profile home screen into a modular academic launchpad. Similar to PhonePe's modular service grid, the top fold displays student identity and key academic metrics, followed by a high-density, categorized **Quick Access Grid** for all daily student utilities.

```
+-------------------------------------------------------------+
| [IISERB Logo]  Dashboard              [🔔 Notice] [⚡ Sync] |
+-------------------------------------------------------------+
|  +-------------------------------------------------------+  |
|  | [Avatar]  BHAGAT ABHAY RAMESH                         |  |
|  |           Roll: 24401  •  BS-MS (Physics)             |  |
|  |           Semester: 2025-2026-II  •  🟢 Synced 2h ago |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  +---------------------------+ +-------------------------+  |
|  | 🎯 Cumulative CPI         | | 📚 Course Status        |  |
|  |    8.42                   | |    18 Passed • 0 Failed |  |
|  |    SPI Trend: ↗ +0.35     | |    [View Transcript]    |  |
|  +---------------------------+ +-------------------------+  |
|                                                             |
|  ACADEMIC SERVICES & QUICK ACCESS                           |
|  +-------------------------------------------------------+  |
|  |  [📊]        [🕒]         [📅]          [📝]          |  |
|  | Reports   My Timetable  DOAA Sched    SRS Feedback    |  |
|  |                                                       |  |
|  |  [🎫]        [📄]         [🏛️]          [🌐]          |  |
|  | Admit Card Requisitions  Exam Routine  Portal Direct  |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  PERFORMANCE TRAJECTORY (CPI / SPI)                         |
|  +-------------------------------------------------------+  |
|  |  10.0 ┤                                    ● CPI 8.42 |  |
|  |   8.0 ┤  ●-------●-------●-------●-------●            |  |
|  |   6.0 ┤                                    ○ SPI 8.65 |  |
|  |       └─────┬───────┬───────┬───────┬───────┬         |  |
|  |            Sem 1   Sem 2   Sem 3   Sem 4   Sem 5      |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  RECENT CAMPUS NOTICES & TIMELINE                           |
|  +-------------------------------------------------------+  |
|  | 📢 Mid-Sem Schedule Released by DOAA • Yesterday      |  |
|  | 📢 Fee Requisition Window Open • 3 days ago           |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

### 3.3 Detailed Component Breakdown

#### A. Student Identity & Sync Banner
*   **Elements**: Circular student avatar (with fallbacks and base64 caching), Full Name in uppercase bold, Roll Number, Degree Program & Major, and live Background Sync Health Badge (`🟢 Synced 2h ago` / `🟡 Syncing...` / `🔴 Offline`).
*   **Interactions**: Tapping the sync badge forces an immediate differential re-sync. Tapping the avatar opens the Full Profile & ID Card modal.

#### B. Academic KPI Chips
*   **Card 1 (CPI / Performance)**: Displays current CPI (e.g. `8.42`) in large tabular typography, latest SPI, and delta indicator (`↗ +0.35`).
*   **Card 2 (Academic Standing)**: Count of passed courses (`18`) in emerald green and failed courses (`0`) in muted gray. Tapping opens the Course Clearance Modal.

#### C. PhonePe-Style Quick Access Grid (The Core Additions)
A 4-column, 2-row icon grid with high-contrast tactile action tiles:
1.  **📊 Grade Reports (`ReportCardsScreen`)**: Direct link to Semester Grade Reports (SGR), Cumulative Grade Reports (CGR), and offline PDF vault.
2.  **🕒 My Timetable (`TimetableModal`)**: Student's individual registered weekly class slot schedule.
3.  **📅 DOAA Schedules (`AcademicSchedulesModal`)**: Institute Academic Calendar, Holidays list, and official DOAA notifications.
4.  **📝 SRS Feedback (`CourseSrsModal`)**: Direct shortcut to active Mid-Sem/End-Sem student feedback forms.
5.  **🎫 Admit Card (`AdmitCardModal`)**: One-tap exam hall ticket viewer & PDF export.
6.  **📄 Requisitions (`RequisitionModal`)**: Document requisition status tracker & new certificate request form.
7.  **🏛️ Exam Routine (`ExamScheduleModal`)**: Mid-sem and End-sem master examination seating and slot chart.
8.  **🌐 Portal Direct (`PortalWebviewScreen`)**: Direct authenticated gateway to Shiksha web portal with mobile styling.

#### D. Interactive CPI/SPI Curve Chart
*   Custom SVG Chart with dual polyline tracks (CPI in Solid Electric Purple `#6C5CE7`, SPI in Accent Cyan `#00CEC9`).
*   Interactive tooltip: Tapping any point reveals exact semester grades, credits earned, and GPA.

#### E. Institute Timeline & Notice Feed
*   Live carousel or mini-feed pulling notices directly from Shiksha's timeline endpoint.

---

## 4. Screen 2: Courses & Curriculum Hub (`CoursesScreen.tsx`)

### 4.1 Problem with Current Implementation
- Current course list is a flat list of cards with limited syllabus visibility and basic action buttons.
- SRS feedback buttons and course details require nested modal jumps.

### 4.2 Redesign Solution: Interactive Course Catalog & Syllabus Hub

```
+-------------------------------------------------------------+
|  My Registered Courses (5)                     [Filter ▾]   |
+-------------------------------------------------------------+
|  [Active Semester: 2025-2026-II]                            |
|                                                             |
|  +-------------------------------------------------------+  |
|  | PHY301 • Quantum Mechanics II                [4 Credits] |  |
|  | Slot 4 (Mon, Wed, Fri 10:00 AM)                          |  |
|  | 👨‍🏫 Prof. S. Sharma  •  Room: L-4                        |  |
|  |                                                       |  |
|  | Attendance: 88.2% (15/17)            [🟢 Above 75%]   |  |
|  |                                                       |  |
|  | [ 📖 Syllabus ]  [ 📊 Performance ]  [ 📝 SRS Survey ] |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  +-------------------------------------------------------+  |
|  | MTH302 • Complex Analysis                    [4 Credits] |  |
|  | Slot 7 (Tue, Thu 02:00 PM)                               |  |
|  | 👨‍🏫 Dr. R. Verma  •  Room: L-2                           |  |
|  |                                                       |  |
|  | Attendance: 72.0% (18/25)            [🔴 Needs +3]    |  |
|  |                                                       |  |
|  | [ 📖 Syllabus ]  [ 📊 Performance ]  [ 📝 SRS Done ]   |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

### 4.3 Key Improvements
1.  **Direct Course Metadata**: Slot timing, lecture hall, credits, and instructor at a glance.
2.  **Integrated Attendance Micro-Bar**: Shows real-time attendance percentage directly inside each course card so students don't need to switch tabs.
3.  **Contextual Action Buttons**:
    *   **Syllabus & Books**: Opens full course detail modal with structured learning objectives, textbooks, and reference material.
    *   **Performance Chart**: Opens grade distribution and spreadsheet performance.
    *   **SRS Survey Status**: Glowing badge if survey is open; checks off automatically when submitted.

---

## 5. Screen 3: Standalone Attendance Tracker (`AttendanceScreen.tsx`)

### 5.1 Problem with Current Implementation
- Attendance calculations work well, but the screen layout can be crowded and lacks date-wise drill-down visualization.

### 5.2 Redesign Solution: Bunk Calculator & Date-Wise Timeline

```
+-------------------------------------------------------------+
|  Attendance Tracker                         [🔄 Refresh]    |
+-------------------------------------------------------------+
|  INSTITUTE HEALTH OVERVIEW                                  |
|  +-------------------------------------------------------+  |
|  |  Average Attendance: 84.5%          [ Safe Zone 🟢 ]   |  |
|  |  Total Classes: 112  •  Present: 95  •  Absent: 17     |  |
|  |  Status: 4 Courses Safe  •  1 Course at Risk           |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  COURSE-WISE BREAKDOWN                                      |
|  +-------------------------------------------------------+  |
|  | PHY301 • Quantum Mechanics II                            |  |
|  | Present: 22  |  Absent: 3  |  Total: 25   (88.0%)         |  |
|  | 🛡️ Safe to miss up to 4 more classes                     |  |
|  | [ Expand Date Logs ▾ ]                                    |  |
|  |  • 12 Sep: Present (Lecture)                             |  |
|  |  • 10 Sep: Absent (Tutorial)                             |  |
|  |  • 08 Sep: Present (Lecture)                             |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  +-------------------------------------------------------+  |
|  | CHM301 • Organic Synthesis                               |  |
|  | Present: 14  |  Absent: 6  |  Total: 20   (70.0%)         |  |
|  | ⚠️ Attend next 2 classes consecutively to recover 75%    |  |
|  | [ Expand Date Logs ▾ ]                                    |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

### 5.3 Key Improvements
1.  **Global Health Card**: Immediate macro summary of total attendance across all registered courses.
2.  **Color-Coded Status Cards**:
    *   **Green Theme**: For $\ge 75\%$ attendance with exact "Bunk allowance" calculation ($x = \lfloor P/0.75 - T \rfloor$).
    *   **Amber/Red Theme**: For $< 75\%$ attendance with exact "Consecutive classes needed" recovery calculation ($y = \max(0, \lceil 3T - 4P \rceil)$).
3.  **Accordion Date-Wise Logs**: Tap any card to reveal individual class dates, session types (Lecture/Lab/Tutorial), and attendance marks.

---

## 6. Screen 4: Report Cards & Transcripts Hub (`ReportCardsScreen.tsx`)

### 6.1 Purpose & Design
A dedicated, offline-first vault for academic transcripts, Semester Grade Reports (SGR), and Cumulative Grade Reports (CGR) parsed from `/secure/studentReports`.

```
+-------------------------------------------------------------+
|  Academic Report Cards                       [⚡ Sync All]  |
+-------------------------------------------------------------+
|  [ All (6) ]    [ Semester Reports (5) ]    [ Cumulative (1) ] |
|                                                             |
|  +-------------------------------------------------------+  |
|  | [📄 SGR]  Semester Grade Report for 2025-2026-II       |  |
|  | Session: 2025-2026 Spring  •  Issued by DOAA             |  |
|  | Status: 🟢 Offline Ready (1.2 MB)                         |  |
|  |                                                       |  |
|  | [ 👁️ View PDF ]       [ ↗️ Share / Export ]   [ 🔄 Recheck ] |  |
|  +-------------------------------------------------------+  |
|                                                             |
|  +-------------------------------------------------------+  |
|  | [📜 CGR]  Cumulative Grade Report (Upto 2025-2026-I)   |  |
|  | Cumulative Transcript  •  Official Record                |  |
|  | Status: 🟢 Offline Ready (2.1 MB)                         |  |
|  |                                                       |  |
|  | [ 👁️ View PDF ]       [ ↗️ Share / Export ]   [ 🔄 Recheck ] |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

### 6.2 Key Features
1.  **Instant Offline Open**: Zero-wait PDF opening via sandboxed `${documentDirectory}reports/`.
2.  **Differential Revalidation**: Periodic HTTP `HEAD` / conditional requests to detect in-place grade revisions with 0-byte payload overhead.
3.  **Native Sharing & Export**: Share directly to WhatsApp, email, or Google Drive via `expo-sharing`.

---

## 7. Screen 5: DOAA Academic Schedules & Timetables

### 7.1 Purpose & Design
Centralized viewer for institute-wide academic calendars, examination seating plans, and official holiday lists parsed from DOAA.

```
+-------------------------------------------------------------+
|  DOAA Academic Schedules                     [🔄 Refresh]    |
+-------------------------------------------------------------+
|  [ Calendars ]   [ Class Timetables ]   [ Exam Schedules ]  |
|                                                             |
|  +-------------------------------------------------------+  |
|  | 📅 Academic Calendar 2026 (All Batches)                 |  |
|  | Source: DOAA Portal  •  Updated: 15 Aug 2026             |  |
|  | Status: 🟢 Cached Locally (850 KB)                       |  |
|  | [ View Calendar ]                     [ Open in PDF App ]|  |
|  +-------------------------------------------------------+  |
|                                                             |
|  +-------------------------------------------------------+  |
|  | 📝 End Semester Exam Schedule 2026-II                   |  |
|  | Source: DOAA Portal  •  Latest Revision                 |  |
|  | Status: 🟢 Cached Locally (1.4 MB)                       |  |
|  | [ View Exam Slots ]                   [ Open in PDF App ]|  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

---

## 8. Screen 6: Settings & Storage Management (`SettingsScreen.tsx`)

### 8.1 Key Features
1.  **Storage Inspector**: Granular breakdown of cache footprint across AsyncStorage metadata, Scraped PDF reports, Academic schedules, and downloaded APK updates.
2.  **Selective Purge**: Option to clear only temporary files while preserving offline report cards.
3.  **Security & App Lock**: Toggle biometric fingerprint/FaceID or PIN on app launch.
4.  **Auto-Update Manager**: Version checker, differential patch installer, and background download progress monitor.

---

## 9. Redesign Implementation Roadmap

```
Phase 1: Profile & Dashboard Overhaul
├── 1. Create Quick Access Grid Component on DashboardScreen
├── 2. Wire navigation hooks for DOAA Schedules, Report Cards, Timetable, SRS
└── 3. Implement CPI/SPI interactive trajectory graph

Phase 2: Report Cards & DOAA Schedule Hub
├── 1. Build ReportCardsScreen + PdfViewerModal with offline caching
├── 2. Implement DOAA Academic Schedules viewer & zero-byte HEAD revalidation
└── 3. Connect differential sync with BackgroundSyncTask

Phase 3: Courses & Attendance Visual Upgrade
├── 1. Upgrade CoursesScreen with integrated slot times & attendance micro-bars
└── 2. Enhance AttendanceScreen with accordion date logs & bunk calculator

Phase 4: Shell, Settings & Motion Polish
├── 1. Refine Floating Pill Bottom Bar & tactile micro-animations
└── 2. Update Storage Inspector with granular reports cache controls
```
