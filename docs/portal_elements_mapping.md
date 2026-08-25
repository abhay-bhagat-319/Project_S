# IISER Bhopal Shiksha Student Portal: DOM & Feature Mapping

This document maps the structural elements, selectors, links, and forms of the IISER Bhopal Shiksha Portal (`https://shiksha.iiserb.ac.in/`) based on the saved page HTML files. It provides the exact CSS/JS injection targets needed to render a clean, native-feeling mobile app.

---

## 1. Global Structure & Technical Stack

*   **Framework**: AngularJS (1.x)
*   **CSS Framework**: Materialize CSS (v0.100.x or similar)
*   **Global Layout Elements**:
    *   **Header Nav Bar**: `<header id="header" class="page-topbar">`
    *   **Sidebar Navigation**: `<aside id="left-sidebar-nav">` containing `<ul id="slide-out" class="side-nav fixed leftside-navigation">`
    *   **Main Wrapper**: `<div id="main">`
    *   **Content Wrapper**: `<section id="content">` inside `<div class="wrapper">`
    *   **Footer**: `<footer class="page-footer footer-fixed gradient-45deg-light-blue-cyan footerZindex">`

---

## 2. Global Mobile App CSS Injection

To make the site feel like a native app, we inject CSS into every page load to hide headers, sidebars, and footers, and expand the main content wrapper to fill the viewport.

```css
/* Hide all desktop navigation and footer elements */
#header, 
#left-sidebar-nav, 
.leftside-navigation, 
footer.page-footer, 
.footer-fixed,
.sidebar-collapse {
  display: none !important;
}

/* Adjust main content positioning */
#main {
  padding-left: 0 !important;
  padding-right: 0 !important;
  margin-top: 0 !important;
}

#content {
  padding: 0 !important;
  margin: 0 !important;
  min-height: 100vh !important;
}

/* Make tables scrollable and touch-friendly */
.responsiveTable, 
.dataTables_wrapper {
  overflow-x: auto !important;
  -webkit-overflow-scrolling: touch !important;
}

/* Remove desktop margins on inner containers */
.container {
  width: 100% !important;
  max-width: 100% !important;
  padding: 8px !important;
}
```

---

## 3. Native App Navigation Mapping

Rather than relying on the website's sidebar navigation, the mobile app should use a **Native Bottom Navigation Bar** or **Native Drawer**. Page transitions are performed by executing the website's built-in AngularJS redirect function `gootoo(path)` via JavaScript injection.

| Native App Tab | Target Redirect Path | JavaScript Evaluation Trigger |
| :--- | :--- | :--- |
| **Profile** | `/secure/studenthome` | `gootoo('/secure/studenthome');` |
| **Courses** | `/secure/studentMyCourses` | `gootoo('/secure/studentMyCourses');` |
| **Reports** | `/secure/studentReports` | `gootoo('/secure/studentReports');` |
| **Requisitions** | `/secure/requisitionForm` | `gootoo('/secure/requisitionForm');` |
| **Admit Card** | `/secure/getAdmitCard` | `gootoo('/secure/getAdmitCard');` |
| **Log Out** | `/secure/logout` | `gootoo('/secure/logout');` |

---

## 4. Page-Specific Element Mappings

### A. Profile Page (`/secure/studenthome`)
*   **File Source**: `Shiksha _ Profile.html`
*   **Features**:
    *   Shows student details (Roll Number, Department, Program).
    *   **Password Change Form**:
        *   Contains password change header (`Password Change`).
        *   Save button: `<a class="right btn-floating waves-effect waves-dark green tooltipped" data-tooltip="Save Password">` with a `save` icon.
        *   Edit button: `<a class="btn-floating btn-large red">` with an `edit` icon.
        *   Settings button: `<a class="btn-floating green tooltipped modal-trigger waves-effect waves-light btn" data-activates="settings">`.

### B. My Courses Page (`/secure/studentMyCourses`)
*   **File Source**: `Shiksha _ Mycourses.html`
*   **Features**:
    *   Lists all current semester courses.
    *   **Courses Table**: ID: `dataTable` (`table.mdl-data-table`)
        *   Columns: `Course No.`, `Course Title`, `Instructor(s)`, `Actions`.
    *   **Row Actions**:
        *   **View course performance**: Click triggers `ng-click="getSpreadSheetData('COURSE_CODE')"` (icon: `show_chart`). Opens a performance chart modal.
        *   **View Attendance**: Click triggers `ng-click="getAttendanceData('COURSE_CODE')"` (icon: `people`).
        *   **View Course Info**: Click triggers `ng-click="currentCoursesDetail('COURSE_CODE')"` (icon: `info_outline`).
        *   **Course Timeline**: Link points to `/secure/facultyTimeline/COURSE_CODE&YEAR-SEM` (icon: `linear_scale`).
        *   **SRS Feedback Form**: Link points to `/secure/studentSRS/COURSE_CODE` (icon: `thumb_up`).
    *   **Mobile Optimizations**: Hide the sidebar and float action button wrappers. Keep table headers visible, but hide action icons behind a native bottom sheet.

### C. Document Requisitions Page (`/secure/requisitionForm`)
*   **File Source**: `Shiksha _ Document_requisitions.html`
*   **Features**:
    *   Displays pending and approved document request lists.
    *   **Pending Requests Table**: ID: `dataTable`
    *   **Approved Requests Table**: ID: `dataTable2` (under container with `id="approved"`)
    *   **Add New Request Button**: Fixed floating action button:
        ```html
        <a class="btn-floating btn-large pink" ng-click="openNewReq()">
          <i class="material-icons">add</i>
        </a>
        ```
    *   **New Requisition Form Modal**: ID: `newRequisition`
        *   Inputs to populate:
            *   `reason` (Text area - reason for document request)
            *   `radioG1` (Radio inputs - select document type)
            *   `tranAmount` (Text input - transaction fee paid)
            *   `tranNumber` (Text input - transaction reference number)
            *   `tranDate` (Date input - transaction date)

### D. Reports Page (`/secure/studentReports`)
*   **File Source**: `Shiksha _ Reports.html`
*   **Features**:
    *   Lists Grade Cards and Transcripts.
    *   **Reports Table**: ID: `dataTable`
        *   Columns: `S.No.`, `Semester`, `Type`, `Annotation`, `Show Report`.
    *   **Report View Action**:
        *   Click triggers `ng-click="fetchFile(studentRoll, reports.sem, reports.annotation)"` (icon: `receipt`).
        *   Triggers file generation/download. The mobile app must capture the downloaded PDF stream and prompt the native share sheet or save option.

### E. Admit Card Page (`/secure/getAdmitCard`)
*   **File Source**: `Shiksha _ Admit_card.html`
*   **Features**:
    *   Dynamically loads the admit card.
    *   Uses Angular state checks: `ng-show="waitMessage"` shows a loading skeleton while it fetches, and displays the card once ready.
    *   **UserInfo metadata block**: A hidden DIV containing student details:
        ```html
        <div id="userInfo" style="display: none;">{"name":"...","dept":"...","role":"student","roll":...}</div>
        ```
        The mobile app can read the text content of `#userInfo` using JS evaluation (`document.getElementById('userInfo').innerText`) to retrieve and display student details locally on the native home dashboard.
