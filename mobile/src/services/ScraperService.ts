export const ScraperService = {
  /**
   * Generates the JS string to inject into the LDAP login form page
   */
  getLoginInjectionScript(username: string, password: string): string {
    const escapedUser = JSON.stringify(username);
    const escapedPass = JSON.stringify(password);

    return `
      (function() {
        try {
          if (!window.location.href.includes('/login')) {
            return; // Exit if not on login page
          }
          
          var retries = 50; // Try for up to 5 seconds
          var checkExist = setInterval(function() {
            if (!window.location.href.includes('/login')) {
              clearInterval(checkExist);
              return;
            }
            
            var ldapInput = document.getElementById('ldap');
            var secretInput = document.getElementById('secret');
            var submitButton = document.querySelector('button[type="submit"]');

            if (ldapInput && secretInput && submitButton) {
              clearInterval(checkExist);
              
              ldapInput.value = ${escapedUser};
              secretInput.value = ${escapedPass};

              // Trigger AngularJS binding updates
              ldapInput.dispatchEvent(new Event('input', { bubbles: true }));
              ldapInput.dispatchEvent(new Event('change', { bubbles: true }));
              secretInput.dispatchEvent(new Event('input', { bubbles: true }));
              secretInput.dispatchEvent(new Event('change', { bubbles: true }));

              submitButton.click();
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'LOGIN_SUBMITTED' }));
            } else {
              retries--;
              if (retries <= 0) {
                clearInterval(checkExist);
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Timed out waiting for login elements' }));
              }
            }
          }, 100);
        } catch (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: e.message }));
        }
      })();
      true;
    `;
  },

  /**
   * Runs BEFORE page scripts via injectedJavaScriptBeforeContentLoaded.
   * Sets up XHR/fetch hooks so we capture the profile API response
   * the moment Angular's $http service fires, not after.
   */
  getEarlyInterceptScript(): string {
    return `
      (function() {
        window.__profileCaptured = null;

        function looksLikeProfile(obj) {
          return obj && (obj.roll || obj.name) && obj.acadIISER;
        }

        function tryCapture(text) {
          if (window.__profileCaptured) return;
          try {
            if (!text || text.indexOf('"roll"') === -1) return;
            var p = JSON.parse(text);
            if (looksLikeProfile(p)) { window.__profileCaptured = p; return; }
            if (p && p.data && looksLikeProfile(p.data)) { window.__profileCaptured = p.data; }
          } catch(e) {}
        }

        // Intercept XHR
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(m, u) {
          this._xhrUrl = u;
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          var xhr = this;
          xhr.addEventListener('load', function() { tryCapture(xhr.responseText); });
          return origSend.apply(this, arguments);
        };

        // Intercept fetch
        var origFetch = window.fetch;
        window.fetch = function() {
          var p = origFetch.apply(this, arguments);
          p.then(function(resp) {
            resp.clone().text().then(tryCapture);
          }).catch(function(){});
          return p;
        };
      })();
      true;
    `;
  },

  /**
   * JS script to inject on the student profile page (/secure/studenthome)
   */
  getProfileScraperScript(): string {
    return `
      (function() {
        var done = false;

        function postProfile(d) {
          if (done) return;
          done = true;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'PROFILE_SCRAPED',
            status: 'success',
            name: d.name || '',
            roll: d.roll ? d.roll.toString() : '',
            dept: (d.acadIISER && d.acadIISER.major) ? d.acadIISER.major.toUpperCase() : '',
            passedCourses: (d.current && d.current.passedCourses) ? d.current.passedCourses : [],
            failedCourses: (d.current && d.current.failedCourses) ? d.current.failedCourses : [],
            performance: d.performance || []
          }));
        }

        function looksLikeProfile(obj) {
          return obj && (obj.roll || obj.name) && obj.acadIISER;
        }

        // --- Strategy 1: Intercept XHR at network level ---
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(m, u) {
          this._xhrUrl = u;
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          var xhr = this;
          xhr.addEventListener('load', function() {
            if (done) return;
            try {
              var text = xhr.responseText;
              if (!text || text.length < 20) return;
              if (text.indexOf('"roll"') === -1 && text.indexOf('"name"') === -1) return;
              var parsed = JSON.parse(text);
              if (looksLikeProfile(parsed)) {
                postProfile(parsed);
              } else if (parsed && parsed.data && looksLikeProfile(parsed.data)) {
                postProfile(parsed.data);
              }
            } catch(e) {}
          });
          return origSend.apply(this, arguments);
        };

        // Also intercept fetch()
        var origFetch = window.fetch;
        window.fetch = function() {
          var p = origFetch.apply(this, arguments);
          p.then(function(resp) {
            if (done) return resp;
            resp.clone().text().then(function(text) {
              if (!text || text.indexOf('"roll"') === -1) return;
              try {
                var parsed = JSON.parse(text);
                if (looksLikeProfile(parsed)) postProfile(parsed);
                else if (parsed && parsed.data && looksLikeProfile(parsed.data)) postProfile(parsed.data);
              } catch(e) {}
            });
          }).catch(function(){});
          return p;
        };

        // --- Strategy 2: Poll Angular scope ---
        var attempts = 0;
        var maxAttempts = 200; // 20 seconds

        var poll = setInterval(function() {
          if (done) { clearInterval(poll); return; }
          attempts++;
          try {
            // Strategy 0: Check early-intercepted data from injectedJavaScriptBeforeContentLoaded
            if (window.__profileCaptured && looksLikeProfile(window.__profileCaptured)) {
              clearInterval(poll);
              postProfile(window.__profileCaptured);
              return;
            }

            var el = document.querySelector('[ng-controller]') || document.body;
            var scope = (typeof angular !== 'undefined') ? angular.element(el).scope() : null;
            if (scope && scope.studentData && looksLikeProfile(scope.studentData)) {
              clearInterval(poll);
              postProfile(scope.studentData);
              return;
            }

            if (attempts >= maxAttempts) {
              clearInterval(poll);
              if (!done) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'ERROR',
                  message: 'Timed out: XHR and scope both failed to yield student data'
                }));
              }
            }
          } catch(e) {
            clearInterval(poll);
            if (!done) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Poll error: ' + e.message }));
            }
          }
        }, 100);
      })();
      true;
    `;
  },







  /**
   * JS script to inject on the courses page (/secure/studentMyCourses)
   * It scrapes course rows and uses fetch() requests in parallel to get attendance statistics.
   */
  getAttendanceScraperScript(): string {
    return `
      (async function() {
        try {
          var bodyScope = angular.element(document.body).scope();
          if (!bodyScope || !bodyScope.userInfo) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Angular body scope not initialized' }));
            return;
          }
          var roll = bodyScope.userInfo.roll;

          // Parse course rows from dataTable
          var rows = Array.from(document.querySelectorAll('#dataTable tbody tr'));
          if (rows.length === 0) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ATTENDANCE_SCRAPED', status: 'success', items: [] }));
            return;
          }

          var courses = rows.map(function(row) {
            var cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
              var courseCode = cells[0].innerText.trim();
              var courseTitle = cells[1].innerText.trim();
              
              var instructorText = cells[2].innerText.trim();
              // Clean instructor name from whitespace/newlines
              var instructor = instructorText.replace(/\\s+/g, ' ');

              var attendanceBtn = cells[3].querySelector('a[ng-click^="getAttendanceData"]');
              var ngClickAttr = attendanceBtn ? attendanceBtn.getAttribute('ng-click') : '';
              var argMatch = ngClickAttr.match(/getAttendanceData\\('(.*)'\\)/);
              var attendanceArg = argMatch ? argMatch[1] : (courseCode + ',');

              return {
                courseCode: courseCode,
                courseTitle: courseTitle,
                instructor: instructor,
                attendanceArg: attendanceArg
              };
            }
            return null;
          }).filter(Boolean);

          function parseRecords(raw) {
            if (!raw) return [];
            var list = [];
            
            if (Array.isArray(raw)) {
              for (var i = 0; i < raw.length; i++) {
                var item = raw[i];
                if (!item) continue;
                
                if (typeof item === 'string') {
                  var parts = item.split(/[:,-]/);
                  list.push({ date: parts[0] ? parts[0].trim() : item, status: parts[1] ? parts[1].trim() : 'Present' });
                } else if (Array.isArray(item)) {
                  list.push({ date: (item[0] || '').toString(), status: (item[1] || 'Present').toString() });
                } else if (typeof item === 'object') {
                  var keys = Object.keys(item);
                  var dateVal = '';
                  var statusVal = '';
                  
                  // Find date field
                  for (var k = 0; k < keys.length; k++) {
                    var lk = keys[k].toLowerCase();
                    if (lk.includes('date') || lk.includes('day') || lk.includes('time') || lk.includes('session')) {
                      dateVal = item[keys[k]];
                      break;
                    }
                  }
                  
                  // Find status field
                  for (var k = 0; k < keys.length; k++) {
                    var lk = keys[k].toLowerCase();
                    if (lk.includes('status') || lk.includes('attend') || lk.includes('present') || lk.includes('mark') || lk.includes('state')) {
                      statusVal = item[keys[k]];
                      break;
                    }
                  }
                  
                  // Fallbacks if not found by name
                  if (!dateVal && keys.length > 0) dateVal = item[keys[0]];
                  if (!statusVal && keys.length > 1) statusVal = item[keys[1]];
                  if (!statusVal && keys.length === 1 && typeof dateVal === 'string' && (dateVal === 'P' || dateVal === 'A' || dateVal.toLowerCase().includes('present'))) {
                    statusVal = dateVal;
                    dateVal = keys[0];
                  }
                  
                  function normalizeDate(ds) {
                    if (!ds) return '';
                    var str = ds.toString().trim();
                    var ymd = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
                    if (ymd) return ymd[3].padStart(2, '0') + '-' + ymd[2].padStart(2, '0') + '-' + ymd[1];
                    var y8 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
                    if (y8) return y8[3] + '-' + y8[2] + '-' + y8[1];
                    var dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
                    if (dmy) return dmy[1].padStart(2, '0') + '-' + dmy[2].padStart(2, '0') + '-' + dmy[3];
                    return str;
                  }

                  if (dateVal || statusVal) {
                    list.push({ date: normalizeDate(dateVal), status: (statusVal || 'Present').toString() });
                  }
                }
              }
            } else if (typeof raw === 'object') {
              var objKeys = Object.keys(raw);
              for (var i = 0; i < objKeys.length; i++) {
                var k = objKeys[i];
                var v = raw[k];
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                  var inner = parseRecords([v]);
                  if (inner.length > 0) list.push(inner[0]);
                } else if (v) {
                  list.push({ date: normalizeDate(k), status: v.toString() });
                }
              }
            }
            return list;
          }


          // Helper to clean HTML strings in webview context
          function cleanHtmlText(html) {
            if (!html) return '';
            var temp = html
              .replace(/<br\\s*[\\/]?>/gi, '\\n')
              .replace(/<\\/p>/gi, '\\n\\n')
              .replace(/<[^>]+>/g, '')
              .replace(/&nbsp;/g, ' ')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/[ \\t]+/g, ' ')
              .replace(/\\n\\s*\\n/g, '\\n\\n')
              .trim();
            return temp;
          }

          function parseHtmlList(html) {
            if (!html) return [];
            var liMatches = html.match(/<li[^>]*>(.*?)<\\/li>/gis);
            if (liMatches && liMatches.length > 0) {
              return liMatches.map(function(item) {
                return cleanHtmlText(item);
              }).filter(function(i) { return i.length > 0; });
            }
            var text = cleanHtmlText(html);
            if (!text) return [];
            var lines = text.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
            if (lines.length > 1) {
              return lines.map(function(l) { return l.replace(/^\\d+[\\.\\)]\\s*/, '').trim(); }).filter(Boolean);
            }
            return [text];
          }

          // Fetch attendance data (summary + date-wise records) in parallel
          var fetchPromises = courses.map(async function(course) {
            try {
              var response = await fetch('/secure/studentMyCourseAttendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseId: course.attendanceArg, roll: roll })
              });
              
              var resJson = await response.json();
              if (resJson && resJson.status === 'ok') {
                var total = resJson.totalClasses || 0;
                var present = resJson.presentClasses || 0;

                // Extract date-wise records from all potential locations
                var records = parseRecords(resJson.data || resJson.records || resJson.userAttendanceInfo || resJson.relPresentdays);

                // Fallback: If 0 records, try previous attendance endpoint
                if (records.length === 0) {
                  try {
                    var prevRes = await fetch('/secure/myCoursePreviousAttendance', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ cnum: course.courseCode })
                    });
                    var prevJson = await prevRes.json();
                    if (prevJson && prevJson.status === 'ok') {
                      records = parseRecords(prevJson.attendanceRecord || prevJson.data || prevJson.records);
                    }
                  } catch (e2) {}
                }

                var total = (typeof resJson.totalClasses === 'number' && resJson.totalClasses > 0) ? resJson.totalClasses : 0;
                var present = (typeof resJson.presentClasses === 'number' && resJson.presentClasses > 0) ? resJson.presentClasses : 0;

                if (records.length > 0) {
                  var recPresent = records.filter(function(r) {
                    var st = (r.status || '').toLowerCase();
                    return st.includes('present') || st === 'p';
                  }).length;
                  
                  if (total === 0 || total < records.length) {
                    total = records.length;
                  }
                  if (present === 0 || present < recPresent) {
                    present = recPresent;
                  }
                }

                var absent = Math.max(0, total - present);
                var percentage = total > 0 
                  ? (present / total) * 100 
                  : (resJson.relPresentPercentage ? parseFloat(resJson.relPresentPercentage) : 100);

                return {
                  courseCode: course.courseCode,
                  courseTitle: course.courseTitle,
                  instructor: course.instructor,
                  present: present,
                  absent: absent,
                  totalClasses: total,
                  percentage: percentage,
                  records: records
                };
              }
            } catch (err) {}
            return {
              courseCode: course.courseCode,
              courseTitle: course.courseTitle,
              instructor: course.instructor,
              present: 0, absent: 0, totalClasses: 0, percentage: 0, records: []
            };
          });

          // Extract Course Details from Angular scope and modal controller
          var detailsMap = {};
          try {
            var el = document.querySelector('[ng-controller="studentMyCourse"]') || document.body;
            var ctrlScope = (typeof angular !== 'undefined' && angular.element) ? angular.element(el).scope() : null;

            courses.forEach(function(course) {
              var cCode = course.courseCode;
              var d = null;

              if (ctrlScope && typeof ctrlScope.currentCoursesDetail === 'function') {
                try {
                  ctrlScope.currentCoursesDetail(cCode);
                  if (ctrlScope.currentCourseDetail) {
                    d = ctrlScope.currentCourseDetail;
                  }
                } catch(e) {}
              }

              if (!d && ctrlScope) {
                var possibleLists = [ctrlScope.myCourses, ctrlScope.courses, ctrlScope.allCourses, ctrlScope.currentCourses];
                for (var li = 0; li < possibleLists.length; li++) {
                  var list = possibleLists[li];
                  if (Array.isArray(list)) {
                    for (var cidx = 0; cidx < list.length; cidx++) {
                      var item = list[cidx];
                      if (item && (item["Course Number"] === cCode || item.courseCode === cCode || item.cnum === cCode)) {
                        d = item;
                        break;
                      }
                    }
                  }
                  if (d) break;
                }
              }

              if (d) {
                detailsMap[cCode] = {
                  courseCode: cCode,
                  courseTitle: cleanHtmlText(d["Course Title"] || d.courseTitle || course.courseTitle),
                  credits: (d["Credits"] || d.credits || '4').toString(),
                  slot: (d["Slot"] || d.slot || 'N/A').toString(),
                  instructors: cleanHtmlText(d["Instructors"] || d.instructors || course.instructor),
                  tutors: cleanHtmlText(d["Tutors"] || d.tutors || ''),
                  teachingAssistants: cleanHtmlText(d["Teaching Assistants"] || d.teachingAssistants || ''),
                  prerequisites: cleanHtmlText(d["Prerequisites"] || d.prerequisites || ''),
                  otherPrerequisites: cleanHtmlText(d["Other Prerequisites"] || d.otherPrerequisites || ''),
                  learningObjectives: parseHtmlList(d["Learning Objectives"] || d.learningObjectives || ''),
                  textBooks: parseHtmlList(d["Text Books"] || d.textBooks || ''),
                  referenceBooks: parseHtmlList(d["Reference Books"] || d.referenceBooks || ''),
                  content: cleanHtmlText(d["Content"] || d.content || ''),
                  remark: cleanHtmlText(d["Remark"] || d.remark || '')
                };
              }
            });
          } catch (e) {}

          var results = await Promise.all(fetchPromises);

          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'ATTENDANCE_SCRAPED',
            status: 'success',
            items: results,
            courseDetails: detailsMap
          }));
        } catch (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Attendance scrape failed: ' + e.message }));
        }
      })();
      true;
    `;
  },


  /**
   * Runs BEFORE page scripts via injectedJavaScriptBeforeContentLoaded.
   * Sets up XHR/fetch hooks and injects early viewport meta tag and styling to prevent layout flash.
   */
  getEarlyMobileResponsiveScript(): string {
    return `
      (function() {
        try {
          // 1. Enforce mobile viewport
          var meta = document.querySelector('meta[name="viewport"]');
          if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            document.head.appendChild(meta);
          }
          meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=3.0, minimum-scale=0.8, user-scalable=yes';

          // 2. Early CSS injection to avoid desktop sidebar/header flash
          var earlyStyle = document.createElement('style');
          earlyStyle.id = 'shiksha-early-mobile-style';
          earlyStyle.textContent = 'html, body { width: 100% !important; max-width: 100vw !important; overflow-x: hidden !important; } #header, #left-sidebar-nav, .leftside-navigation, footer.page-footer, .footer-fixed { display: none !important; } #main { padding-left: 0 !important; margin: 0 !important; }';
          if (document.head) {
            document.head.appendChild(earlyStyle);
          } else {
            document.addEventListener('DOMContentLoaded', function() {
              document.head.appendChild(earlyStyle);
            });
          }
        } catch (e) {}

        // 3. Early XHR/Fetch profile data interception
        window.__profileCaptured = null;

        function looksLikeProfile(obj) {
          return obj && (obj.roll || obj.name) && obj.acadIISER;
        }

        function tryCapture(text) {
          if (window.__profileCaptured) return;
          try {
            if (!text || text.indexOf('"roll"') === -1) return;
            var p = JSON.parse(text);
            if (looksLikeProfile(p)) { window.__profileCaptured = p; return; }
            if (p && p.data && looksLikeProfile(p.data)) { window.__profileCaptured = p.data; }
          } catch(e) {}
        }

        // Intercept XHR
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(m, u) {
          this._xhrUrl = u;
          return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
          var xhr = this;
          xhr.addEventListener('load', function() { tryCapture(xhr.responseText); });
          return origSend.apply(this, arguments);
        };

        // Intercept fetch
        var origFetch = window.fetch;
        window.fetch = function() {
          var p = origFetch.apply(this, arguments);
          p.then(function(resp) {
            resp.clone().text().then(tryCapture);
          }).catch(function(){});
          return p;
        };
      })();
      true;
    `;
  },

  /**
   * Injects CSS styles and responsive DOM enhancements to make the webview look and feel native on mobile screens.
   */
  getCssInjectionScript(): string {
    const css = `
      /* Global Box Sizing & Mobile Viewport Constraints */
      *, *::before, *::after {
        box-sizing: border-box !important;
      }
      html, body {
        width: 100% !important;
        max-width: 100vw !important;
        overflow-x: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
        -webkit-text-size-adjust: 100% !important;
        -webkit-tap-highlight-color: transparent !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        background-color: #f8fafc !important;
      }

      /* Hide Desktop Headers, Sidebars, Footers & Crumbs */
      #header, 
      #left-sidebar-nav, 
      .leftside-navigation, 
      footer.page-footer, 
      .footer-fixed,
      .sidebar-collapse,
      .breadcrumbs-nav,
      #breadcrumbs-wrapper,
      .page-topbar {
        display: none !important;
      }

      /* Adjust Main Wrapper & Content Container */
      #main {
        padding-left: 0 !important;
        padding-right: 0 !important;
        padding-top: 0 !important;
        margin-top: 0 !important;
        width: 100% !important;
        max-width: 100vw !important;
        min-height: auto !important;
      }
      #content {
        padding: 10px 12px !important;
        margin: 0 !important;
        width: 100% !important;
        max-width: 100vw !important;
        min-height: calc(100vh - 80px) !important;
      }
      .wrapper {
        width: 100% !important;
        max-width: 100vw !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .container {
        width: 100% !important;
        max-width: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      /* Responsive Flex Grid for Materialize Columns */
      .row {
        margin-left: 0 !important;
        margin-right: 0 !important;
        margin-bottom: 12px !important;
        display: flex !important;
        flex-wrap: wrap !important;
        width: 100% !important;
      }
      .row .col {
        padding: 4px !important;
        float: none !important;
        flex: 1 1 100% !important;
        max-width: 100% !important;
      }

      /* Overhaul Broken Materialize Responsive Table Styles */
      .responsiveTable, 
      .dataTables_wrapper,
      .table-responsive,
      .table-wrapper {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        margin: 10px 0 !important;
        border-radius: 10px !important;
        border: 1px solid #e2e8f0 !important;
        background: #ffffff !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
      }

      table,
      table.mdl-data-table,
      table.responsiveTable {
        width: 100% !important;
        min-width: 520px !important;
        border-collapse: collapse !important;
        display: table !important;
        margin: 0 !important;
      }
      table thead,
      .responsiveTable thead {
        display: table-header-group !important;
        float: none !important;
        width: auto !important;
        background-color: #f1f5f9 !important;
      }
      table thead tr,
      .responsiveTable thead tr {
        display: table-row !important;
        border-bottom: 2px solid #cbd5e1 !important;
      }
      table tbody,
      .responsiveTable tbody {
        display: table-row-group !important;
        width: auto !important;
        white-space: normal !important;
      }
      table tbody tr,
      .responsiveTable tbody tr {
        display: table-row !important;
        border-bottom: 1px solid #e2e8f0 !important;
        height: auto !important;
      }
      table th, 
      table td,
      .responsiveTable th, 
      .responsiveTable td {
        display: table-cell !important;
        padding: 10px 12px !important;
        font-size: 13px !important;
        line-height: 1.45 !important;
        text-align: left !important;
        white-space: normal !important;
        vertical-align: middle !important;
      }
      table th,
      .responsiveTable th {
        font-weight: 600 !important;
        color: #334155 !important;
      }

      /* Card and Panel Elements */
      .card, .card-panel {
        border-radius: 14px !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05) !important;
        margin: 10px 0 !important;
        background: #ffffff !important;
        border: 1px solid #e2e8f0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
      }
      .card .card-content {
        padding: 16px !important;
      }
      .card-title {
        font-size: 17px !important;
        font-weight: 600 !important;
        line-height: 1.3 !important;
      }

      /* Form Inputs & Controls */
      .input-field {
        margin-top: 12px !important;
        margin-bottom: 16px !important;
        width: 100% !important;
      }
      input[type=text], 
      input[type=password], 
      input[type=email], 
      input[type=date], 
      select, 
      textarea {
        font-size: 16px !important; /* Prevents auto-zoom in iOS Safari */
        box-sizing: border-box !important;
        height: 46px !important;
        border-radius: 8px !important;
        padding: 0 12px !important;
        border: 1px solid #cbd5e1 !important;
        background-color: #ffffff !important;
        width: 100% !important;
      }
      textarea {
        height: 90px !important;
        padding: 10px 12px !important;
      }

      /* Modals & Dialogs */
      .modal {
        width: 92% !important;
        max-width: 480px !important;
        max-height: 85vh !important;
        top: 6% !important;
        border-radius: 16px !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25) !important;
        overflow-y: auto !important;
      }
      .modal .modal-content {
        padding: 18px !important;
      }
      .modal-overlay {
        opacity: 0.5 !important;
      }

      /* Buttons & Floating Actions */
      .btn, .btn-large, .btn-flat {
        border-radius: 8px !important;
        height: 42px !important;
        line-height: 42px !important;
        font-size: 14px !important;
        font-weight: 600 !important;
        text-transform: none !important;
      }
      .fixed-action-btn {
        bottom: 96px !important;
        right: 18px !important;
      }
    `;

    return `
      (function() {
        try {
          // Enforce/Update mobile viewport
          var meta = document.querySelector('meta[name="viewport"]');
          if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            document.head.appendChild(meta);
          }
          meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=3.0, minimum-scale=0.8, user-scalable=yes';

          // Inject or update responsive stylesheet
          var existingStyle = document.getElementById('shiksha-mobile-responsive-style');
          if (existingStyle) {
            existingStyle.innerHTML = ${JSON.stringify(css)};
          } else {
            var style = document.createElement('style');
            style.id = 'shiksha-mobile-responsive-style';
            style.type = 'text/css';
            style.innerHTML = ${JSON.stringify(css)};
            document.head.appendChild(style);
          }

          // Wrap any uncontained tables into a scrollable container
          var tables = document.querySelectorAll('table');
          tables.forEach(function(table) {
            var parent = table.parentElement;
            if (!parent.classList.contains('responsiveTable') && 
                !parent.classList.contains('dataTables_wrapper') && 
                !parent.classList.contains('table-responsive')) {
              var wrapper = document.createElement('div');
              wrapper.className = 'table-responsive';
              parent.insertBefore(wrapper, table);
              wrapper.appendChild(table);
            }
          });
        } catch (e) {}
      })();
      true;
    `;
  }
};
