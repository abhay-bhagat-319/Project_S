# Specification: Course Details, 5-Tab Navigation, and Portal WebView

## Problem Statement

Students using the mobile wrapper application need quick, offline-first access to complete course information (such as credits, course slot, instructors, learning objectives, syllabus content, and prescribed textbooks) without navigating cumbersome desktop tables. Additionally, students require seamless access to other portal services (such as semester registration, admit cards, and grade reports) without being repeatedly logged out or forced to use unoptimized desktop web views on mobile devices.

## Solution

1. **5-Tab Floating Bottom Navigation Bar**:
   - Reorganize bottom navigation into five distinct tabs:
     1. **Profile**: Student information, passed/failed course badges, and academic CPI/SPI charts.
     2. **Attendance**: Course-wise attendance records, bunk/recovery calculators, and historical logs.
     3. **My Courses**: Enrolled courses list with quick action triggers for **Course Info**, **Marks**, and **SRS Redirect**.
     4. **Portal (WebView)**: Full-screen authenticated browser embedding IISERB Shiksha portal with mobile-optimized CSS styling, browser toolbar controls (Back, Forward, Refresh, Home), and automatic background session recovery/login.
     5. **Settings**: Biometric security, stored credentials management, cache controls, and logout.

2. **Course Details Native Sheet / Modal**:
   - Tapping **Course Info** on any course card opens a rich, dark-themed native modal presenting:
     - **Header**: Course Code, Course Title, Credits badge, Slot badge, Instructor(s).
     - **Instructors & Support Staff**: Instructors, Tutors, and Teaching Assistants.
     - **Prerequisites**: Minimum grade and prerequisite course requirements.
     - **Learning Objectives**: Clean formatted native bullet points.
     - **Syllabus / Course Content**: Clear, readable content breakdown.
     - **Prescribed Literature**: Textbooks and reference books.
     - **Remarks**: Additional course remarks.

3. **Pending Feature Placeholders**:
   - **Marks**: Modal placeholder with clean UI prepared for the upcoming marks spreadsheet integration.
   - **SRS Redirect**: Directly opens the survey in the authenticated WebView tab (or displays a notice if the survey window is closed).

4. **Offline Caching & Scraping Pipeline**:
   - Enhanced background sync to extract and cache course detail structures directly from `/secure/studentMyCourses` and the underlying course detail modal hooks.

---

## User Stories

1. As a student, I want to see a 5-item navigation bar at the bottom of my screen, so that I can easily switch between Profile, Attendance, My Courses, Portal Webview, and Settings.
2. As a student, I want to open the "My Courses" tab and see all my enrolled courses for the current semester in clean cards.
3. As a student, I want each course card to have clear action buttons for "Course Info", "Marks", and "SRS", so that I can quickly perform course-specific actions.
4. As a student, I want to tap "Course Info" on a course card and view its credits, slot, instructor, learning objectives, syllabus, and textbooks in a native dark-themed modal.
5. As a student, I want the course syllabus, objectives, and textbook list to be formatted with clean native typography and bullet points rather than raw HTML tags.
6. As a student, I want course details to be cached locally on my device so that I can look up my syllabus and textbook requirements even when offline.
7. As a student, I want to tap "Marks" on a course card and see a styled placeholder view informing me that performance spreadsheet integration is coming soon.
8. As a student, I want to tap "SRS" on a course card and be routed to the authenticated Student Reaction Survey on the portal.
9. As a student, I want a dedicated "Portal" WebView tab that keeps me logged into Shiksha, so that I can access semester registration, admit cards, and other portal services directly inside the app.
10. As a student, I want the in-app portal WebView to have a top toolbar with Back, Forward, Reload, and Home navigation buttons.
11. As a student, I want the in-app portal WebView to hide unnecessary desktop headers and sidebars on mobile so that portal forms and pages fit comfortably on my screen.
12. As a student, I want the WebView to automatically re-authenticate if my session expires, so that I never have to manually type my credentials repeatedly.
13. As a student, I want to pull down to refresh on the Attendance screen or trigger a sync to update my profile, attendance, and course details simultaneously.

---

## Implementation Decisions

### 1. Navigation Architecture
- The active tab state in `App.tsx` expands from `TabName = 'Dashboard' | 'Courses' | 'Attendance' | 'Settings'` to:
  `TabName = 'Profile' | 'Attendance' | 'Courses' | 'Portal' | 'Settings'`.
- Bottom navigation bar updated to render 5 items with icons:
  - Profile: `person-outline` / `person`
  - Attendance: `calendar-outline` / `calendar`
  - My Courses: `book-outline` / `book`
  - Portal Webview: `globe-outline` / `globe`
  - Settings: `settings-outline` / `settings`

### 2. Data Models & Schemas
- Define `CourseDetail` interface:
  ```typescript
  export interface CourseDetail {
    courseCode: string;
    courseTitle: string;
    credits: string;
    slot: string;
    instructors: string;
    tutors?: string;
    teachingAssistants?: string;
    prerequisites?: string;
    otherPrerequisites?: string;
    learningObjectives: string[];
    textBooks: string[];
    referenceBooks: string[];
    content: string;
    remark?: string;
  }
  ```
- Extend `Course` in `CoursesScreen.tsx` to include `details?: CourseDetail`.
- Extend `CacheService` to cache and retrieve `CourseDetail[]` or a `Record<string, CourseDetail>`.

### 3. Portal WebView Component (`PortalWebviewScreen.tsx`)
- Encapsulates `react-native-webview` with:
  - Injected CSS via `ScraperService.getCssInjectionScript()` to hide `#header`, `#left-sidebar-nav`, `footer.page-footer`.
  - Injected credentials auto-login script when navigating to `/login`.
  - Top header toolbar with:
    - Back button (`canGoBack` check)
    - Forward button (`canGoForward` check)
    - Reload button
    - Home button (resets to `https://shiksha.iiserb.ac.in/secure/studenthome`)
    - URL domain/title indicator

### 4. Course Details Modal UI & HTML Parsing
- Create `CourseDetailModal.tsx` displaying:
  - Header with Course Code, Title, Credits chip, Slot chip.
  - Tabbed or structured accordion sections for:
    - **Overview**: Instructor, Tutors, TAs, Prerequisites.
    - **Objectives**: Rendered bullet list parsed from `<ol><li>` / `<ul><li>`.
    - **Syllabus**: Rendered paragraph block parsed from `<p>`.
    - **Textbooks**: Rendered item list parsed from `<ul><li>`.
- HTML sanitizer utility to transform portal HTML strings into clean arrays and paragraphs.

### 5. Scraping Integration
- Update `ScraperService.getAttendanceScraperScript()` to extract the course information or trigger `currentCoursesDetail(courseCode)` to parse the detail table (`#moreDetail #tblCourseDetail`) into structured `CourseDetail` JSON payloads.

---

## Testing Decisions

### What Makes a Good Test
- Tests should verify external contracts and behaviors rather than implementation details:
  1. HTML scraper parser correctly transforms raw portal tables into `CourseDetail` objects (handling missing fields, empty strings, and nested HTML tags).
  2. Cache serialization correctly persists and restores course details offline.
  3. UI components render course cards, open the modal upon tapping "Course Info", display formatted sections, and handle empty states gracefully.
  4. WebView auto-login injection script produces valid executable JavaScript for Angular inputs.

### Modules to Test
- `ScraperService`: HTML parsing and extraction of `CourseDetail` attributes.
- `CacheService`: Storage and retrieval of course details.
- `CourseDetailModal`: Renders structured fields and handles missing optional attributes.
- `CoursesScreen`: Card rendering, action callbacks, and search/filter behavior.
- `PortalWebviewScreen`: Navigation state and URL loading.

---

## Out of Scope

- Live parsing and calculation of student marks/grades from the course performance spreadsheet (placeholder UI provided).
- Full in-app interactive submission of the Student Reaction Survey form (redirects to authenticated WebView).
- Offline editing or manual addition of custom unregistered courses.

---

## Further Notes

- The authenticated WebView leverages the shared HTTP cookie storage between WebView instances on both Android and iOS, allowing seamless continuity between background synchronization and interactive browsing.
