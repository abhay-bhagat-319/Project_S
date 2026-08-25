# UI/UX Specification & Wireframe Mapping

This document provides the mobile-first design wireframe, UI components, typography tokens, color guidelines, and UX states for the wrapped student portal application. Use this specification to map out the visual screens (Figma/mockups) before we begin the implementation.

---

## 1. Visual Style & Theme Guidelines

To elevate the legacy Materialize look, the mobile app should use a premium, clean visual style.

*   **Theme Mode**: Sleek dark mode by default (vibrant primary accents on neutral dark grays) or a clean light/dark toggle.
*   **Color Palette Suggestions**:
    *   *Primary Accents*: Deep Cyan (`#00b4d8`) or Cobalt Blue (`#0077b6`).
    *   *Secondary Accents*: Coral Orange (`#f77f00`) matching the portal's orange alert icons.
    *   *Backgrounds*: Dark Gray (`#121212`) or clean Off-White (`#f8f9fa`).
*   **Typography**: Clean sans-serif fonts (e.g., *Inter* or *Outfit*).
*   **Layout Elements**:
    *   **Cards**: Rounded corners (`border-radius: 16px`), light border/outline (`1px solid rgba(255,255,255,0.08)`), and subtle box-shadows.
    *   **Buttons**: Filled button for primary actions (min height `48dp` for touch target), outlined/text button for secondary options.

---

## 2. Screen-by-Screen Layout & Button Wireframe

### Screen 1: Welcome & Authentication
*   **Goal**: Initial setup for fresh install or logging in a user.
*   **Visual Layout**:
    *   Central logo placeholder.
    *   **Text Input 1**: "LDAP Username" (Icon: `person`) -> Maps to `input#ldap`.
    *   **Text Input 2**: "LDAP Password" (Icon: `lock`, secure entry toggle) -> Maps to `input#secret`.
    *   **Button 1 (Primary)**: "Log In" -> Triggers LDAP validation script.
    *   **Biometric Switch**: "Enable Biometric Login" toggle -> Triggers Keystore/Keychain registration.
    *   **Separator**: "Or" divider.
    *   **Button 2 (Secondary)**: "Sign in with IISERB Email Account" (Google Logo icon) -> Triggers Google OAuth redirection.
    *   **Footer Link**: "Forgot Password?" (Opens `https://changepass.iiserb.ac.in/` in system browser).

### Screen 2: Dashboard (Home Screen)
*   **Goal**: The main landing hub showing user metadata and quick actions.
*   **Visual Layout**:
    *   **Header Card**: User profile header containing:
        *   Student profile image circular placeholder -> Parsed from `profilePicture` in `#userInfo`.
        *   Text label: Student Name -> Parsed from `name` in `#userInfo`.
        *   Text label: Roll No & Department -> Parsed from `roll` and `dept` in `#userInfo`.
    *   **Grid Quick Links (4 Actions)**:
        1.  `My Courses` (Redirection to `/secure/studentMyCourses`)
        2.  `Grade Cards` (Redirection to `/secure/studentReports`)
        3.  `Document Requests` (Redirection to `/secure/requisitionForm`)
        4.  `Admit Card` (Redirection to `/secure/getAdmitCard`)
    *   **Notification Area**: Scrollable list of latest system notifications -> Extracted from `#noticeModel` in portal HTML.

### Screen 3: My Courses Screen
*   **Goal**: Lists current registered courses and displays detail sheets.
*   **Visual Layout**:
    *   **Scrollable Course Cards List**: For each item in `dataTable`:
        *   Top row: Course Code (e.g. `DSE312`) in bold, alongside Course Title (e.g. `Computer Vision`).
        *   Bottom row: Instructor Name.
        *   **Action Bar (Touch-friendly buttons at card bottom)**:
            1.  **View Performance** (Icon: `show_chart`) -> Executes `getSpreadSheetData('CODE')`.
            2.  **View Attendance** (Icon: `people`) -> Executes `getAttendanceData('CODE')`.
            3.  **Course Info** (Icon: `info_outline`) -> Executes `currentCoursesDetail('CODE')`.
            4.  **Feedback (SRS)** (Icon: `thumb_up`) -> Triggers redirect to `/secure/studentSRS/CODE`.
    *   *Interaction Note*: Clicking these actions should open a native bottom sheet/modal displaying the loaded web content rather than forcing web redirects.

### Screen 4: Grade Reports & Transcripts Screen
*   **Goal**: Lists generated academic reports for viewing/downloading.
*   **Visual Layout**:
    *   **Segmented Control / Tab Filter**: `Semester Reports` \| `Cumulative Reports`.
    *   **Grade Report Card**: For each row in `dataTable`:
        *   Bold Label: Semester Code (e.g., `2025-2026-1`).
        *   Description: "Semester Grade Report".
        *   **Action Button**: "View Report" (Icon: `receipt`, primary action) -> Executes `fetchFile(...)` to pull the document stream.
    *   *UX Directive*: Integrate a native PDF viewer or trigger the OS share sheet once the PDF stream is captured from the WebView.

### Screen 5: Document Requisitions Screen
*   **Goal**: View past requisitions and file new document requests.
*   **Visual Layout**:
    *   **Tabs**: `Pending Requests` \| `Approved Requisitions`.
    *   **Requisition Request Cards**: Shows Application Id, Document Type, Fees Paid, Submission Date, and Status (Pending, Rejected, Approved).
    *   **Floating Action Button (FAB)**: Large pink circular `+` button in bottom right -> Executes `openNewReq()` to open the request form.
    *   **New Requisition Form Modal**: Input screen with:
        *   *Information Fields* (Read-only user profile data).
        *   **Text Field**: "Reason for Request" -> maps to `reason` text area.
        *   **Dropdown/Radio Grid**: "Document Type" -> maps to `radioG1`.
        *   **Numeric Field**: "Transaction Amount" -> maps to `tranAmount`.
        *   **Text Field**: "Transaction/UTR Number" -> maps to `tranNumber`.
        *   **Date Field**: "Transaction Date" -> maps to `tranDate` picker.
        *   **Submit Button**: "Submit Application" -> Submits form.

### Screen 6: App Settings
*   **Goal**: Configuration of security options and cache management.
*   **Visual Layout**:
    *   **Section 1: Security**:
        *   Toggle Switch: "Biometric Protection" (requires FaceID/TouchID).
        *   Button: "Update Saved Credentials" (prompts form containing new Username/Password).
    *   **Section 2: System**:
        *   Button: "Clear Cache & Cookies" (removes stored WebView sessions).
        *   Button: "Log Out" (deletes keys and logs out).

---

## 3. Screen Transitions & UX States

1.  **Loading Skeleton (FOUC Prevention)**: Whenever a WebView load is triggered (like fetching report data or updating courses), show a native skeleton overlay matching the card structures to hide page parsing/flicker.
2.  **Disconnected State**: Catch WebView HTTP errors (no internet) and present a native "Offline" layout with a retry button.
3.  **Authentication Error State**: If a background validation script returns a credentials error, return the user to Screen 1 (Welcome) and display an alert text.
