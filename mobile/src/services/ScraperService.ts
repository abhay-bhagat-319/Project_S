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

          // Fetch Course Details in parallel
          var courseDetailPromises = courses.map(async function(course) {
            try {
              // Try fetching from standard course detail API endpoints
              var detailRes = await fetch('/secure/studentCourseDetail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseCode: course.courseCode, cnum: course.courseCode })
              });
              var detailJson = await detailRes.json();
              var d = (detailJson && (detailJson.data || detailJson.courseDetail || detailJson)) || {};

              return {
                courseCode: course.courseCode,
                courseTitle: cleanHtmlText(d.courseTitle || d.title || course.courseTitle),
                credits: (d.credits || d.credit || '4').toString(),
                slot: (d.slot || 'N/A').toString(),
                instructors: cleanHtmlText(d.instructors || d.instructor || course.instructor),
                tutors: cleanHtmlText(d.tutors || d.tutor || ''),
                teachingAssistants: cleanHtmlText(d.teachingAssistants || d.ta || ''),
                prerequisites: cleanHtmlText(d.prerequisites || ''),
                otherPrerequisites: cleanHtmlText(d.otherPrerequisites || ''),
                learningObjectives: parseHtmlList(d.learningObjectives || d.objectives || ''),
                textBooks: parseHtmlList(d.textBooks || d.textbooks || ''),
                referenceBooks: parseHtmlList(d.referenceBooks || d.references || ''),
                content: cleanHtmlText(d.content || d.syllabus || ''),
                remark: cleanHtmlText(d.remark || '')
              };
            } catch (e) {
              return {
                courseCode: course.courseCode,
                courseTitle: course.courseTitle,
                credits: '4',
                slot: 'N/A',
                instructors: course.instructor,
                tutors: '',
                teachingAssistants: '',
                prerequisites: '',
                otherPrerequisites: '',
                learningObjectives: [],
                textBooks: [],
                referenceBooks: [],
                content: '',
                remark: ''
              };
            }
          });

          var results = await Promise.all(fetchPromises);
          var detailResults = await Promise.all(courseDetailPromises);

          var detailsMap = {};
          detailResults.forEach(function(dt) {
            if (dt && dt.courseCode) {
              detailsMap[dt.courseCode] = dt;
            }
          });

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
   * Injects CSS styles to make the target webview responsive and native-feeling
   */
  getCssInjectionScript(): string {
    const css = `
      #header, 
      #left-sidebar-nav, 
      .leftside-navigation, 
      footer.page-footer, 
      .footer-fixed,
      .sidebar-collapse {
        display: none !important;
      }
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
      .responsiveTable, 
      .dataTables_wrapper {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
      }
      .container {
        width: 100% !important;
        max-width: 100% !important;
        padding: 8px !important;
      }
    `;

    return `
      (function() {
        try {
          var style = document.createElement('style');
          style.type = 'text/css';
          style.innerHTML = ${JSON.stringify(css)};
          document.head.appendChild(style);
        } catch (e) {}
      })();
      true;
    `;
  }
};
