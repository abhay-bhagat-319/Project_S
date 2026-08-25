# App UX & State Behavior Specification

This document defines the behavior, page states, caching policies, and data sync mechanics for the student portal mobile wrapper application. It captures the finalized decisions from our design review sessions.

---

## 1. Homepage & Dashboard Layout

The homepage serves as the primary navigation hub and academic summary screen.

### 1.1 UI Widgets
*   **Profile Header Card**:
    *   Displays student's profile picture, name, roll number, and department.
    *   *Source*: Fetched via JS evaluation of the hidden `#userInfo` div on the portal home page, or parsed from the `studentData` JSON in the `ng-init` attribute on `/secure/studenthome`.
*   **Academic Progress Badges**:
    *   **Passed Courses**: Elevated green badge showing the total count of passed courses (`studentData.current.passedCourses.length`). Clicking the badge opens a native modal listing all completed course codes.
    *   **Failed Courses**: Elevated red/grey badge showing the total count of failed courses (`studentData.current.failedCourses.length`). Clicking opens a native modal listing the failed course codes.
    *   *Source*: Parsed from the stringified JSON loaded inside the `<div ng-init="initProfileInfo('...')">` element on the portal home page.
*   **CPI Performance Chart**:
    *   A native line chart (plotted using `fl_chart` / `react-native-chart-kit`) placed at the bottom of the screen.
    *   *Data Source*: Scraped from the `performance` array in the home page JSON containing semester codes (`sem`), semester performance index (`spi`), and cumulative performance index (`cpi`).
    *   *Chart Constraints*: The Y-axis is strictly bounded between `1.0` and `10.0`. The X-axis auto-fits interval points dynamically as new semesters are added.

### 1.2 Primary App Navigation
*   **Navigation Type**: A floating, pill-shaped Bottom Navigation Bar styled according to `design_ui.md`.
*   **Tabs**:
    1.  **Home**: Profile header card, Academic Progress badges, and the CPI Performance Chart.
    2.  **Courses**: Current registered courses list with action sheet modal hooks (`getSpreadSheetData`, `getAttendanceData`, etc.).
    3.  **Attendance**: Standalone attendance screen (see Section 2).

---

## 2. Standalone Attendance Tracker

The attendance section is isolated from the main courses list into a dedicated native view to support offline calculations and status alerts.

### 2.1 Scraping & Data Extraction
*   **Background WebView**: When triggered, a hidden WebView loads the registered courses page (`/secure/studentMyCourses`).
*   **Scraping Loop**: For each course code:
    1.  Call the portal's built-in AngularJS function `getAttendanceData('COURSE_CODE')`.
    2.  Wait for the modal containing the status table to render.
    3.  Count the number of rows with text `"Present"` ($P$) and `"Absent"` ($A$).
    4.  Save the parsed values locally.
    5.  Close the modal.

### 2.2 Calculations & Display States
*   Let $P$ be the number of present classes, and $T = P + A$ be the total classes conducted.
*   **Current Attendance Percentage**: $(P / T) \times 100$.
*   **Above 75% State**:
    *   *Card Style*: Default theme background.
    *   *Alert message*: *"You can miss up to $x$ more classes before dropping below 75%."*
    *   *Formula*: $x = \lfloor (P / 0.75) - T \rfloor$.
*   **Below 75% State**:
    *   *Card Style*: Red alert outline / warning highlight.
    *   *Alert message*: *"You must attend the next $y$ classes consecutively to recover to 75% attendance."*
    *   *Formula*: $y = \max(0, \lceil 3T - 4P \rceil)$.

---

## 3. Data Sync & Caching Policies

### 3.1 Caching
*   All compiled profile details and attendance values (total present, total absent, percentage, and calculated recovery metrics) must be cached locally on the device (SQLite database or encrypted Shared Preferences).
*   On launch, the app instantly displays the cached stats, allowing full offline usage.

### 3.2 Background Sync Rules
*   **Sync Trigger**: Runs automatically when the app launches.
*   **Sync Cooldown**: **24 Hours**. If the app is launched within 24 hours of the last successful sync, the background sync is skipped to conserve battery/data.
*   **Manual Trigger**: A "Sync Now" / pull-to-refresh action is available on the Attendance screen to force an immediate background scrap.

---

## 4. Error Handling & Failovers

*   **Session Expiration**: If the background scraper attempts to sync and detects that the user session has expired (e.g. redirected to the `/login` route):
    1.  Keep displaying the cached offline data.
    2.  Show a warning banner: *"Sync failed. Viewing cached data from [Timestamp]"*.
    3.  Provide a **"Re-authenticate"** button which opens a login webview overlay. Once logged in, the app resumes and completes the sync.
*   **Network Loss**: If there is no internet, display a standard warning banner at the top of the screen: *"No internet connection. Viewing offline cache."*
