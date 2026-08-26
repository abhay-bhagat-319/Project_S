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
   * JS script to inject on the student profile page (/secure/studenthome)
   */
  getProfileScraperScript(): string {
    return `
      (function() {
        try {
          // Look for the div with ng-init="initProfileInfo(...)"
          var div = Array.from(document.querySelectorAll('[ng-init]')).find(function(el) {
            return el.getAttribute('ng-init').includes('initProfileInfo');
          });

          if (div) {
            var ngInit = div.getAttribute('ng-init');
            var match = ngInit.match(/initProfileInfo\\('(.*)'\\)/);
            if (match && match[1]) {
              var decoded = match[1]
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&');
              
              var data = JSON.parse(decoded);
              
              var payload = {
                type: 'PROFILE_SCRAPED',
                status: 'success',
                name: data.name,
                roll: data.roll ? data.roll.toString() : '',
                dept: (data.acadIISER && data.acadIISER.major) ? data.acadIISER.major.toUpperCase() : '',
                passedCourses: (data.current && data.current.passedCourses) ? data.current.passedCourses : [],
                failedCourses: (data.current && data.current.failedCourses) ? data.current.failedCourses : [],
                performance: data.performance || []
              };

              window.ReactNativeWebView.postMessage(JSON.stringify(payload));
              return;
            }
          }
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Profile data init block not found' }));
        } catch (e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Scrape failed: ' + e.message }));
        }
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

          // Fetch attendance data in parallel
          var fetchPromises = courses.map(async function(course) {
            try {
              var response = await fetch('/secure/studentMyCourseAttendance', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  courseId: course.attendanceArg,
                  roll: roll
                })
              });
              
              var resJson = await response.json();
              if (resJson && resJson.status === 'ok') {
                var total = resJson.totalClasses || 0;
                var present = resJson.presentClasses || 0;
                return {
                  courseCode: course.courseCode,
                  courseTitle: course.courseTitle,
                  instructor: course.instructor,
                  present: present,
                  absent: total - present,
                  totalClasses: total,
                  percentage: resJson.relPresentPercentage ? parseFloat(resJson.relPresentPercentage) : 0
                };
              }
            } catch (err) {
              // Ignore and fallback
            }
            return {
              courseCode: course.courseCode,
              courseTitle: course.courseTitle,
              instructor: course.instructor,
              present: 0,
              absent: 0,
              totalClasses: 0,
              percentage: 0
            };
          });

          var results = await Promise.all(fetchPromises);
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'ATTENDANCE_SCRAPED',
            status: 'success',
            items: results
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
