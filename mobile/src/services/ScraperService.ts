export const ScraperService = {
  /**
   * Generates the JS string to wipe all cookies, sessionStorage, and localStorage in the WebView
   */
  getSessionPurgeScript(): string {
    return `
      (function() {
        function safePost(obj) {
          try {
            if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
              window.ReactNativeWebView.postMessage(JSON.stringify(obj));
            }
          } catch (e) {}
        }

        try {
          // Clear Web Storage
          try { localStorage.clear(); } catch (e) {}
          try { sessionStorage.clear(); } catch (e) {}

          // Expire all cookies across path variations
          try {
            var cookies = document.cookie.split(";");
            for (var i = 0; i < cookies.length; i++) {
              var cookie = cookies[i];
              var eqPos = cookie.indexOf("=");
              var name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
              if (name) {
                document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
                document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/secure";
                document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/login";
                document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;domain=" + window.location.hostname + ";path=/";
              }
            }
          } catch (e) {}

          safePost({ type: 'SESSION_PURGED' });
        } catch (err) {
          safePost({ type: 'SESSION_PURGED' });
        }
      })();
      true;
    `;
  },

  /**
   * Generates the JS string to inject into the LDAP login form page
   */
  getLoginInjectionScript(username: string, password: string): string {
    const escapedUser = JSON.stringify(username);
    const escapedPass = JSON.stringify(password);

    return `
      (function() {
        function safePost(obj) {
          try {
            if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
              window.ReactNativeWebView.postMessage(JSON.stringify(obj));
            }
          } catch (e) {}
        }

        try {
          // If already on secure landing page, authentication is already valid
          if (window.location.href.includes('/secure/') || window.location.href.includes('/secure')) {
            safePost({ type: 'AUTH_SUCCESS' });
            return;
          }

          // If on LDAP progress page, do not inject form scraper or throw error
          if (window.location.href.includes('ldap_login_progress') || window.location.href.includes('login_progress')) {
            return;
          }

          if (!window.location.href.includes('/login')) {
            return;
          }

          var retries = 150; // Try for up to 15 seconds
          var checkExist = setInterval(function() {
            if (window.location.href.includes('/secure/') || window.location.href.includes('/secure')) {
              clearInterval(checkExist);
              safePost({ type: 'AUTH_SUCCESS' });
              return;
            }

            if (window.location.href.includes('ldap_login_progress') || window.location.href.includes('login_progress')) {
              clearInterval(checkExist);
              return;
            }

            if (!window.location.href.includes('/login')) {
              clearInterval(checkExist);
              return;
            }

            // Multi-selector query for username input
            var ldapInput = document.getElementById('ldap') ||
                            document.querySelector('input[name="ldap"]') ||
                            document.querySelector('input[name="username"]') ||
                            document.getElementById('username') ||
                            document.querySelector('input[type="text"]');

            // Multi-selector query for password input
            var secretInput = document.getElementById('secret') ||
                              document.querySelector('input[name="secret"]') ||
                              document.querySelector('input[name="password"]') ||
                              document.getElementById('password') ||
                              document.querySelector('input[type="password"]');

            // Multi-selector query for submit action
            var submitButton = document.querySelector('button[type="submit"]') ||
                               document.querySelector('input[type="submit"]') ||
                               document.querySelector('button.btn') ||
                               document.querySelector('button') ||
                               document.querySelector('form');

            // Check if page already shows an invalid credentials toast/alert
            var errorElement = document.querySelector('.toast, .alert, .card-panel.red, #error-message');
            if (errorElement && errorElement.innerText && errorElement.innerText.trim().length > 0) {
              var errMsg = errorElement.innerText.trim();
              if (/invalid|incorrect|failed|wrong/i.test(errMsg)) {
                clearInterval(checkExist);
                safePost({ type: 'AUTH_FAILED', message: errMsg });
                return;
              }
            }

            if (ldapInput && secretInput && submitButton) {
              clearInterval(checkExist);

              ldapInput.value = ${escapedUser};
              secretInput.value = ${escapedPass};

              // Native event dispatches
              ldapInput.dispatchEvent(new Event('input', { bubbles: true }));
              ldapInput.dispatchEvent(new Event('change', { bubbles: true }));
              secretInput.dispatchEvent(new Event('input', { bubbles: true }));
              secretInput.dispatchEvent(new Event('change', { bubbles: true }));

              // AngularJS 1.x binding updates
              if (window.angular) {
                try {
                  var ngLdap = angular.element(ldapInput);
                  var ngSecret = angular.element(secretInput);
                  ngLdap.val(${escapedUser}).triggerHandler('input');
                  ngLdap.triggerHandler('change');
                  ngSecret.val(${escapedPass}).triggerHandler('input');
                  ngSecret.triggerHandler('change');
                  var scope = ngLdap.scope() || ngSecret.scope();
                  if (scope && scope.$apply) {
                    scope.$apply();
                  }
                } catch (e) {}
              }

              // Submit form
              if (typeof submitButton.click === 'function') {
                submitButton.click();
              } else if (typeof submitButton.submit === 'function') {
                submitButton.submit();
              }

              safePost({ type: 'LOGIN_SUBMITTED' });
            } else {
              retries--;
              if (retries <= 0) {
                clearInterval(checkExist);
                safePost({ type: 'AUTH_FAILED', message: 'Timed out waiting for portal login form elements.' });
              }
            }
          }, 100);
        } catch (e) {
          safePost({ type: 'AUTH_FAILED', message: e.message });
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

        async function extractPhoto(d) {
          var photoUrl = '';
          var photoBase64 = '';

          // 1. Check DOM image elements
          var photoEl = document.getElementById('profile_photo') || 
                        document.querySelector('img.profile-image') || 
                        document.querySelector('img[alt="avatar"]') ||
                        document.querySelector('img[alt="profile image"]');
          if (photoEl && photoEl.src && photoEl.src.indexOf('http') === 0) {
            photoUrl = photoEl.src;
          }

          // 2. Check CouchDB document attachments if photoUrl not found
          if (!photoUrl && d && d._id && d._attachments) {
            var attachKeys = Object.keys(d._attachments);
            var picKey = attachKeys.find(function(k) {
              var lk = k.toLowerCase();
              return lk.includes('profilepic') || lk.includes('.jpg') || lk.includes('.png') || lk.includes('.jpeg');
            });
            if (picKey) {
              photoUrl = 'https://shiksha.iiserb.ac.in/students/profilepic/' + d._id + '/' + picKey;
            }
          }

          // 3. Check Angular scope for profilePicture
          if (!photoUrl && d && d.profilePicture) {
            photoUrl = d.profilePicture;
          }

          // 4. Try to convert to Base64 via Canvas
          if (photoEl && photoEl.complete && photoEl.naturalWidth > 0) {
            try {
              var canvas = document.createElement('canvas');
              canvas.width = photoEl.naturalWidth;
              canvas.height = photoEl.naturalHeight;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(photoEl, 0, 0);
              photoBase64 = canvas.toDataURL('image/jpeg', 0.85);
            } catch(e) {}
          }

          // 5. If Canvas failed or not loaded, fetch inside WebView session
          if (!photoBase64 && photoUrl) {
            try {
              var res = await fetch(photoUrl);
              var blob = await res.blob();
              photoBase64 = await new Promise(function(resolve) {
                var reader = new FileReader();
                reader.onloadend = function() { resolve(reader.result || ''); };
                reader.onerror = function() { resolve(''); };
                reader.readAsDataURL(blob);
              });
            } catch(e2) {}
          }

          return { photoUrl: photoUrl, photoBase64: photoBase64 };
        }

        async function postProfile(d) {
          if (done) return;
          done = true;
          var photoInfo = { photoUrl: '', photoBase64: '' };
          try {
            photoInfo = await extractPhoto(d);
          } catch(e) {}

          var rawReports = [];
          if (d && Array.isArray(d.reports) && d.reports.length > 0) {
            rawReports = d.reports;
          }

          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'PROFILE_SCRAPED',
            status: 'success',
            name: d.name || '',
            roll: d.roll ? d.roll.toString() : '',
            dept: (d.acadIISER && d.acadIISER.major) ? d.acadIISER.major.toUpperCase() : (d.dept || ''),
            passedCourses: (d.current && d.current.passedCourses) ? d.current.passedCourses : (d.passedCourses || []),
            failedCourses: (d.current && d.current.failedCourses) ? d.current.failedCourses : (d.failedCourses || []),
            performance: d.performance || [],
            reports: rawReports,
            photoUrl: photoInfo.photoUrl || '',
            photoBase64: photoInfo.photoBase64 || ''
          }));
        }

        function looksLikeProfile(obj) {
          if (!obj || typeof obj !== 'object') return false;
          var hasId = !!(obj.roll || obj.name || obj.email || obj._id);
          var hasData = !!(obj.acadIISER || obj.performance || obj.current || obj.passedCourses || obj.dept || obj.personal || obj.programme);
          return hasId || hasData;
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
        var maxAttempts = 375; // 15 seconds (every 40ms)

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

            // Strategy 1: Check ng-init="initProfileInfo(...)" directly from DOM
            try {
              var initEls = Array.from(document.querySelectorAll('[ng-init]'));
              for (var k = 0; k < initEls.length; k++) {
                var initAttr = initEls[k].getAttribute('ng-init') || '';
                if (initAttr.indexOf('initProfileInfo') !== -1) {
                  var m = initAttr.match(/initProfileInfo\s*\(\s*['"]?(\{[\s\S]*?\})['"]?\s*\)/);
                  if (!m) m = initAttr.match(/initProfileInfo\s*\(\s*['"]([\s\S]*?)['"]\s*\)/);
                  if (m && m[1]) {
                    var rawStr = m[1].replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&');
                    var parsedInit = JSON.parse(rawStr);
                    if (looksLikeProfile(parsedInit)) {
                      // Also enrich performance if initPrformanceRep exists
                      var perfEl = document.querySelector('[ng-init*="initPrformanceRep"]');
                      if (perfEl && (!parsedInit.performance || parsedInit.performance.length === 0)) {
                        try {
                          var perfAttr = perfEl.getAttribute('ng-init') || '';
                          var mPerf = perfAttr.match(/initPrformanceRep\s*\(\s*['"]?(\{[\s\S]*?\})['"]?\s*\)/);
                          if (mPerf && mPerf[1]) {
                            var rawPerf = mPerf[1].replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&');
                            var pData = JSON.parse(rawPerf);
                            if (pData && Array.isArray(pData.x)) {
                              parsedInit.performance = pData.x.map(function(semName, sIdx) {
                                return {
                                  sem: semName,
                                  spi: (pData.ySPI && pData.ySPI[sIdx] !== undefined) ? pData.ySPI[sIdx] : 0,
                                  cpi: (pData.yCPI && pData.yCPI[sIdx] !== undefined) ? pData.yCPI[sIdx] : 0
                                };
                              });
                            }
                          }
                        } catch(ePerf) {}
                      }

                      clearInterval(poll);
                      postProfile(parsedInit);
                      return;
                    }
                  }
                }
              }
            } catch(eInit) {}

            // Strategy 2: Check Angular scope
            var el = document.querySelector('[ng-controller]') || document.body;
            var scope = (typeof angular !== 'undefined' && angular.element) ? angular.element(el).scope() : null;
            if (scope) {
              var candidate = scope.studentData || scope.student || scope.profile || scope.userInfo || scope.user;
              if (candidate && looksLikeProfile(candidate)) {
                clearInterval(poll);
                postProfile(candidate);
                return;
              }
            }

            // Strategy 3: Check #userInfo hidden DOM element
            try {
              var infoEl = document.getElementById('userInfo');
              if (infoEl && infoEl.innerText && infoEl.innerText.trim().startsWith('{')) {
                var pData = JSON.parse(infoEl.innerText.trim());
                if (looksLikeProfile(pData)) {
                  clearInterval(poll);
                  postProfile(pData);
                  return;
                }
              }
            } catch(eJson) {}

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
        }, 40);
      })();
      true;
    `;
  },







  /**
   * Lean attendance scraper script (/secure/studentMyCourses)
   * Fetches only attendance statistics with a strict 4s per-endpoint timeout guard.
   */
  getAttendanceScraperScript(knownRoll: string = ''): string {
    const escapedKnownRoll = JSON.stringify(knownRoll || '');
    return `
      (function() {
        var attempts = 0;
        var maxAttempts = 200; // 10 seconds (every 50ms)
        var done = false;
        var fallbackRoll = ${escapedKnownRoll};

        function fetchWithTimeout(url, options, timeoutMs) {
          timeoutMs = timeoutMs || 4000;
          return new Promise(function(resolve) {
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            if (controller && options) {
              options.signal = controller.signal;
            }
            var timer = setTimeout(function() {
              if (controller) {
                try { controller.abort(); } catch(e) {}
              }
              resolve(null);
            }, timeoutMs);

            fetch(url, options).then(function(res) {
              clearTimeout(timer);
              if (!res || !res.ok) { resolve(null); return; }
              return res.json().then(function(json) {
                resolve(json);
              }).catch(function() { resolve(null); });
            }).catch(function() {
              clearTimeout(timer);
              resolve(null);
            });
          });
        }

        function getStudentRoll(bodyScope, ctrlScope) {
          if (fallbackRoll && fallbackRoll.trim().length > 0) return fallbackRoll.trim();
          if (bodyScope && bodyScope.userInfo && bodyScope.userInfo.roll) return bodyScope.userInfo.roll.toString();
          if (ctrlScope && ctrlScope.userInfo && ctrlScope.userInfo.roll) return ctrlScope.userInfo.roll.toString();
          if (ctrlScope && ctrlScope.roll) return ctrlScope.roll.toString();
          try {
            var infoEl = document.getElementById('userInfo');
            if (infoEl && infoEl.innerText) {
              var parsed = JSON.parse(infoEl.innerText);
              if (parsed && parsed.roll) return parsed.roll.toString();
            }
          } catch(e) {}
          return '';
        }

        var poll = setInterval(async function() {
          if (done) { clearInterval(poll); return; }
          attempts++;

          try {
            var el = document.querySelector('[ng-controller="studentMyCourse"]') || 
                     document.querySelector('[ng-controller]') || 
                     document.body;
            var ctrlScope = (typeof angular !== 'undefined' && angular.element) ? angular.element(el).scope() : null;
            var bodyScope = (typeof angular !== 'undefined' && angular.element) ? angular.element(document.body).scope() : ctrlScope;
            
            var rows = Array.from(document.querySelectorAll('#dataTable tbody tr, table tbody tr'));
            var hasRows = rows.length > 0 && rows[0].querySelectorAll('td').length >= 3;
            var isEmptyTable = rows.length === 1 && rows[0].innerText.toLowerCase().includes('no data');
            var currentRoll = getStudentRoll(bodyScope, ctrlScope);

            if ((hasRows || isEmptyTable) && (currentRoll || attempts >= 20)) {
              clearInterval(poll);
              done = true;
              await runScraper(bodyScope, ctrlScope, rows, currentRoll);
            } else if (attempts >= maxAttempts) {
              clearInterval(poll);
              done = true;
              if (hasRows || isEmptyTable) {
                await runScraper(bodyScope, ctrlScope, rows, currentRoll);
              } else {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'ERROR',
                  message: 'Timed out waiting for courses table to render.'
                }));
              }
            }
          } catch (e) {
            clearInterval(poll);
            done = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Attendance poll error: ' + e.message }));
          }
        }, 50);

        async function runScraper(bodyScope, ctrlScope, rows, roll) {
          try {
            if (!roll) {
              roll = getStudentRoll(bodyScope, ctrlScope);
            }

            if (rows.length === 0 || (rows.length === 1 && rows[0].innerText.toLowerCase().includes('no data'))) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ATTENDANCE_SCRAPED', status: 'success', items: [] }));
              return;
            }

            var courses = rows.map(function(row) {
              var cells = row.querySelectorAll('td');
              if (cells.length >= 4) {
                var courseCode = cells[0].innerText.trim();
                var courseTitle = cells[1].innerText.trim();
                var instructor = cells[2].innerText.trim().replace(/\\s+/g, ' ');

                var attendanceBtn = cells[3].querySelector('a[ng-click^="getAttendanceData"]');
                var ngClickAttr = attendanceBtn ? attendanceBtn.getAttribute('ng-click') : '';
                var argMatch = ngClickAttr.match(/getAttendanceData\\('(.*)'\\)/);
                var attendanceArg = argMatch ? argMatch[1] : (courseCode + ',');

                var midSemBtn = cells[3].querySelector('a[href*="studentMidSemSRS"]');
                var midSemHref = midSemBtn ? midSemBtn.getAttribute('href') : '';
                var midSemAvailable = !!midSemHref && midSemHref.indexOf('studentMidSemSRS') !== -1;

                var endSemBtn = cells[3].querySelector('a[href*="studentSRS"]:not([href*="studentMidSemSRS"])');
                var endSemHref = endSemBtn ? endSemBtn.getAttribute('href') : '';
                var endSemAvailable = !!endSemHref && endSemHref.indexOf('studentSRS') !== -1;

                return {
                  courseCode: courseCode,
                  courseTitle: courseTitle,
                  instructor: instructor,
                  attendanceArg: attendanceArg,
                  srsStatus: {
                    midSemAvailable: midSemAvailable,
                    midSemUrl: midSemAvailable ? midSemHref : undefined,
                    endSemAvailable: endSemAvailable,
                    endSemUrl: endSemAvailable ? endSemHref : undefined
                  }
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
                    for (var k = 0; k < keys.length; k++) {
                      var lk = keys[k].toLowerCase();
                      if (lk.includes('date') || lk.includes('day') || lk.includes('time') || lk.includes('session')) {
                        dateVal = item[keys[k]];
                        break;
                      }
                    }
                    for (var k = 0; k < keys.length; k++) {
                      var lk = keys[k].toLowerCase();
                      if (lk.includes('status') || lk.includes('attend') || lk.includes('present') || lk.includes('mark') || lk.includes('state')) {
                        statusVal = item[keys[k]];
                        break;
                      }
                    }
                    if (!dateVal && keys.length > 0) dateVal = item[keys[0]];
                    if (!statusVal && keys.length > 1) statusVal = item[keys[1]];

                    function normalizeDate(ds) {
                      if (!ds) return '';
                      var str = ds.toString().trim();
                      var ymd = str.match(/^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})/);
                      if (ymd) return ymd[3].padStart(2, '0') + '-' + ymd[2].padStart(2, '0') + '-' + ymd[1];
                      var y8 = str.match(/^(\\d{4})(\\d{2})(\\d{2})$/);
                      if (y8) return y8[3] + '-' + y8[2] + '-' + y8[1];
                      var dmy = str.match(/^(\\d{1,2})[-/.](\\d{1,2})[-/.](\\d{4})/);
                      if (dmy) return dmy[1].padStart(2, '0') + '-' + dmy[2].padStart(2, '0') + '-' + dmy[3];
                      return str;
                    }

                    if (dateVal || statusVal) {
                      list.push({ date: normalizeDate(dateVal), status: (statusVal || 'Present').toString() });
                    }
                  }
                }
              }
              return list;
            }

            // Bounded parallel fetch for all attendance endpoints
            var fetchPromises = courses.map(async function(course) {
              try {
                var resJson = await fetchWithTimeout('/secure/studentMyCourseAttendance', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ courseId: course.attendanceArg, roll: roll })
                }, 4000);

                if (resJson && resJson.status === 'ok') {
                  var total = (typeof resJson.totalClasses === 'number' && resJson.totalClasses > 0) ? resJson.totalClasses : 0;
                  var present = (typeof resJson.presentClasses === 'number' && resJson.presentClasses > 0) ? resJson.presentClasses : 0;
                  var records = parseRecords(resJson.data || resJson.records || resJson.userAttendanceInfo || resJson.relPresentdays);

                  if (records.length === 0) {
                    var prevJson = await fetchWithTimeout('/secure/myCoursePreviousAttendance', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ cnum: course.courseCode })
                    }, 3000);
                    if (prevJson && prevJson.status === 'ok') {
                      records = parseRecords(prevJson.attendanceRecord || prevJson.data || prevJson.records);
                    }
                  }

                  if (records.length > 0) {
                    var recPresent = records.filter(function(r) {
                      var st = (r.status || '').toLowerCase();
                      return st.includes('present') || st === 'p';
                    }).length;
                    if (total === 0 || total < records.length) total = records.length;
                    if (present === 0 || present < recPresent) present = recPresent;
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
                    records: records,
                    srsStatus: course.srsStatus
                  };
                }
              } catch (err) {}

              return {
                courseCode: course.courseCode,
                courseTitle: course.courseTitle,
                instructor: course.instructor,
                present: 0, absent: 0, totalClasses: 0, percentage: 0, records: [],
                srsStatus: course.srsStatus
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
        }
      })();
      true;
    `;
  },

  /**
   * Scraper script specifically for Courses catalog metadata and SRS status (/secure/studentMyCourses)
   */
  getCoursesScraperScript(): string {
    return `
      (function() {
        var attempts = 0;
        var maxAttempts = 200;
        var done = false;

        function cleanHtmlText(html) {
          if (!html) return '';
          return html
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

        var poll = setInterval(function() {
          if (done) { clearInterval(poll); return; }
          attempts++;

          try {
            var rows = Array.from(document.querySelectorAll('#dataTable tbody tr, table tbody tr'));
            var hasRows = rows.length > 0 && rows[0].querySelectorAll('td').length >= 3;
            var isEmptyTable = rows.length === 1 && rows[0].innerText.toLowerCase().includes('no data');

            if (hasRows || isEmptyTable || attempts >= maxAttempts) {
              clearInterval(poll);
              done = true;

              if (rows.length === 0 || (rows.length === 1 && rows[0].innerText.toLowerCase().includes('no data'))) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'COURSES_SCRAPED',
                  status: 'success',
                  items: [],
                  courseDetails: {}
                }));
                return;
              }

              var el = document.querySelector('[ng-controller="studentMyCourse"]') || document.body;
              var ctrlScope = (typeof angular !== 'undefined' && angular.element) ? angular.element(el).scope() : null;

              var courses = rows.map(function(row) {
                var cells = row.querySelectorAll('td');
                if (cells.length >= 4) {
                  var courseCode = cells[0].innerText.trim();
                  var courseTitle = cells[1].innerText.trim();
                  var instructor = cells[2].innerText.trim().replace(/\\s+/g, ' ');

                  var midSemBtn = cells[3].querySelector('a[href*="studentMidSemSRS"]');
                  var midSemHref = midSemBtn ? midSemBtn.getAttribute('href') : '';
                  var midSemAvailable = !!midSemHref && midSemHref.indexOf('studentMidSemSRS') !== -1;

                  var endSemBtn = cells[3].querySelector('a[href*="studentSRS"]:not([href*="studentMidSemSRS"])');
                  var endSemHref = endSemBtn ? endSemBtn.getAttribute('href') : '';
                  var endSemAvailable = !!endSemHref && endSemHref.indexOf('studentSRS') !== -1;

                  return {
                    courseCode: courseCode,
                    courseTitle: courseTitle,
                    instructor: instructor,
                    srsStatus: {
                      midSemAvailable: midSemAvailable,
                      midSemUrl: midSemAvailable ? midSemHref : undefined,
                      endSemAvailable: endSemAvailable,
                      endSemUrl: endSemAvailable ? endSemHref : undefined
                    }
                  };
                }
                return null;
              }).filter(Boolean);

              var detailsMap = {};
              if (ctrlScope) {
                var possibleLists = [ctrlScope.myCourses, ctrlScope.courses, ctrlScope.allCourses, ctrlScope.currentCourses];
                courses.forEach(function(course) {
                  var cCode = course.courseCode;
                  var d = null;
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
              }

              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'COURSES_SCRAPED',
                status: 'success',
                items: courses,
                courseDetails: detailsMap
              }));
            }
          } catch (e) {
            clearInterval(poll);
            done = true;
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: 'Courses scrape error: ' + e.message }));
          }
        }, 50);
      })();
      true;
    `;
  },

  /**
   * Priority Marks Streamer script:
   * Immediately scrapes marks for priorityCourseCode with a 4s timeout and sends COURSE_MARKS_STREAMED,
   * then fetches the remaining courses in the background.
   */
  getCourseMarksScraperScript(priorityCourseCode: string = '', allCourseCodes: string[] = [], knownRoll: string = ''): string {
    const escapedPriority = JSON.stringify(priorityCourseCode || '');
    const escapedCodes = JSON.stringify(allCourseCodes || []);
    const escapedRoll = JSON.stringify(knownRoll || '');

    return `
      (function() {
        var priorityCode = ${escapedPriority};
        var courseCodes = ${escapedCodes};
        var knownRoll = ${escapedRoll};

        function fetchWithTimeout(url, options, timeoutMs) {
          timeoutMs = timeoutMs || 4000;
          return new Promise(function(resolve) {
            var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            if (controller && options) {
              options.signal = controller.signal;
            }
            var timer = setTimeout(function() {
              if (controller) {
                try { controller.abort(); } catch(e) {}
              }
              resolve(null);
            }, timeoutMs);

            fetch(url, options).then(function(res) {
              clearTimeout(timer);
              if (!res || !res.ok) { resolve(null); return; }
              return res.json().then(function(json) {
                resolve(json);
              }).catch(function() { resolve(null); });
            }).catch(function() {
              clearTimeout(timer);
              resolve(null);
            });
          });
        }

        function extractAssessments(resJson) {
          var items = [];
          if (!resJson) return items;
          var data = resJson.data || resJson.records || resJson.marks || resJson;
          if (Array.isArray(data)) {
            for (var i = 0; i < data.length; i++) {
              var m = data[i];
              if (!m) continue;
              items.push({
                name: (m.name || m.title || m.assessment || m.examType || m.component || ('Assessment ' + (i + 1))).toString(),
                scored: parseFloat(m.scored || m.marks || m.score || m.obtained || '0') || 0,
                max: parseFloat(m.max || m.total || m.outOf || '100') || 100,
                weightage: m.weightage ? (m.weightage.toString() + '%') : undefined,
                classAverage: m.classAverage !== undefined ? parseFloat(m.classAverage) : undefined
              });
            }
          } else if (typeof data === 'object') {
            var keys = Object.keys(data);
            for (var i = 0; i < keys.length; i++) {
              var k = keys[i];
              var v = data[k];
              if (typeof v === 'number' || typeof v === 'string') {
                items.push({
                  name: k,
                  scored: parseFloat(v) || 0,
                  max: 100
                });
              } else if (v && typeof v === 'object') {
                items.push({
                  name: (v.name || v.title || k).toString(),
                  scored: parseFloat(v.scored || v.marks || v.score || '0') || 0,
                  max: parseFloat(v.max || v.total || '100') || 100
                });
              }
            }
          }
          return items;
        }

        async function fetchMarksForCourse(cCode) {
          try {
            var resJson = await fetchWithTimeout('/secure/studentCourseMarks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cnum: cCode, courseCode: cCode, roll: knownRoll })
            }, 4000);

            var items = extractAssessments(resJson);
            return {
              courseCode: cCode,
              items: items,
              timestamp: new Date().toISOString()
            };
          } catch (e) {
            return {
              courseCode: cCode,
              items: [],
              timestamp: new Date().toISOString()
            };
          }
        }

        async function runMarksStreamer() {
          var allMarksMap = {};

          // Phase 1: Immediately fetch priority course first
          if (priorityCode && priorityCode.trim().length > 0) {
            var priorityMarks = await fetchMarksForCourse(priorityCode.trim());
            allMarksMap[priorityCode.trim()] = priorityMarks;

            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'COURSE_MARKS_STREAMED',
              courseCode: priorityCode.trim(),
              marksData: priorityMarks
            }));
          }

          // Phase 2: Asynchronously fetch the remaining courses
          var remainingCodes = courseCodes.filter(function(c) {
            return c && c !== priorityCode;
          });

          for (var i = 0; i < remainingCodes.length; i++) {
            var code = remainingCodes[i];
            var mData = await fetchMarksForCourse(code);
            allMarksMap[code] = mData;

            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'COURSE_MARKS_STREAMED',
              courseCode: code,
              marksData: mData
            }));
          }

          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'ALL_COURSE_MARKS_SCRAPED',
            status: 'success',
            allMarks: allMarksMap
          }));
        }

        runMarksStreamer();
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
   * Injects Desktop Viewport meta tags and high-DPI desktop styling
   */
  getDesktopViewportScript(): string {
    return `
      (function() {
        try {
          // 1. Enforce Desktop Viewport with smooth zoom capabilities
          var meta = document.querySelector('meta[name="viewport"]');
          if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'viewport';
            document.head.appendChild(meta);
          }
          meta.content = 'width=1280, initial-scale=0.32, minimum-scale=0.2, maximum-scale=4.0, user-scalable=yes';

          // 2. Inject subtle desktop readability styles without breaking tables or hiding navigation
          var style = document.getElementById('__project_s_desktop_css');
          if (!style) {
            style = document.createElement('style');
            style.id = '__project_s_desktop_css';
            document.head.appendChild(style);
          }
          style.innerHTML = \`
            html, body {
              width: 1280px !important;
              min-width: 1280px !important;
              overflow-x: auto !important;
              -webkit-text-size-adjust: 100% !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
              background-color: #f8fafc !important;
              -webkit-font-smoothing: antialiased !important;
            }
            #main, .wrapper, #content, .container {
              width: 1280px !important;
              max-width: 1280px !important;
              box-sizing: border-box !important;
            }
            /* Smooth touch scrolling for nested tables */
            table, .responsiveTable, .dataTables_wrapper {
              -webkit-overflow-scrolling: touch !important;
            }
            /* Clean rounded cards and subtle shadow */
            .card, .card-panel {
              border-radius: 8px !important;
              box-shadow: 0 1px 4px rgba(0,0,0,0.06) !important;
            }
          \`;
        } catch (e) {}
      })();
      true;
    `;
  },


  /**
   * Injected script to submit SRS questionnaire directly within the authenticated portal context
   */
  getSrsSubmissionScript(payload: any, isMidSem: boolean = true): string {
    return `
      (async function() {
        try {
          var payload = ${JSON.stringify(payload)};
          var isMid = ${isMidSem ? 'true' : 'false'};
          
          // Attempt AngularJS scope submission if active in DOM
          var submitted = false;
          try {
            var el = document.querySelector('[ng-controller="studentMidSemSRSCtrl"]') || 
                     document.querySelector('[ng-controller="studentSRSCtrl"]') || 
                     document.body;
            var scope = (typeof angular !== 'undefined' && angular.element) ? angular.element(el).scope() : null;
            if (scope) {
              scope.studentReviewJson = payload;
              if (typeof scope.submit === 'function') {
                scope.submit();
                submitted = true;
              }
            }
          } catch (eScope) {}

          // Fallback to direct POST fetch to the SRS endpoint
          if (!submitted) {
            var url = isMid ? '/secure/studentMidSemSRS/submit' : '/secure/studentSRS/submit';
            try {
              await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
            } catch (fErr) {}
          }

          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'SRS_SUBMITTED',
            status: 'success',
            courseCode: payload.courseNumber || payload.courseCode,
            message: 'Survey submitted successfully'
          }));
        } catch (err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'SRS_SUBMITTED',
            status: 'error',
            courseCode: payload.courseNumber || payload.courseCode,
            message: err.message || 'Submission failed'
          }));
        }
      })();
      true;
    `;
  },

  /**
   * JS script to inject on the reports page (/secure/studentReports)
   * Extracts student grade reports and transcripts
   */
  getReportsScraperScript(): string {
    return `
      (function() {
        var done = false;
        var attempts = 0;
        var maxAttempts = 100; // 5 seconds maximum

        var poll = setInterval(function() {
          if (done) { clearInterval(poll); return; }
          attempts++;

          try {
            var reports = [];

            // Strategy 1: Check Angular Scope
            try {
              if (window.angular && window.angular.element) {
                var el = document.querySelector('[ng-controller="studentReportController"]') || 
                         document.querySelector('[ng-controller]') || 
                         document.body;
                if (el) {
                  var scope = window.angular.element(el).scope();
                  if (scope) {
                    if (Array.isArray(scope.studentReports) && scope.studentReports.length > 0) {
                      reports = scope.studentReports;
                    } else if (Array.isArray(scope.reports) && scope.reports.length > 0) {
                      reports = scope.reports;
                    }
                  }
                }
              }
            } catch (e1) {}

            // Strategy 2: Extract JSON from ng-init attribute (robust substring parsing)
            if (!reports || reports.length === 0) {
              try {
                var initEls = document.querySelectorAll('[ng-init]');
                for (var i = 0; i < initEls.length; i++) {
                  var initAttr = initEls[i].getAttribute('ng-init') || '';
                  var startMarker = initAttr.indexOf('initReports(');
                  if (startMarker !== -1) {
                    var arrStart = initAttr.indexOf('[', startMarker);
                    var arrEnd = initAttr.indexOf('])', arrStart);
                    if (arrEnd === -1) {
                      arrEnd = initAttr.lastIndexOf(']');
                    }
                    if (arrStart !== -1 && arrEnd > arrStart) {
                      var rawJson = initAttr.substring(arrStart, arrEnd + 1)
                        .replace(/&quot;|&#34;/g, '"')
                        .replace(/&amp;/g, '&')
                        .replace(/&#39;/g, "'");
                      try {
                        var parsed = JSON.parse(rawJson);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                          reports = parsed;
                          break;
                        }
                      } catch (parseErr) {}
                    }
                  }
                }
              } catch (e2) {}
            }

            // Strategy 3: Parse DOM Table Rows if Angular / ng-init didn't yield
            if (!reports || reports.length === 0) {
              try {
                var rows = document.querySelectorAll('table#dataTable tbody tr, table tbody tr');
                for (var rIdx = 0; rIdx < rows.length; rIdx++) {
                  var row = rows[rIdx];
                  var cells = row.querySelectorAll('td');
                  if (cells.length >= 4) {
                    var sem = cells[1].innerText ? cells[1].innerText.trim() : '';
                    var type = cells[2].innerText ? cells[2].innerText.trim() : '';
                    var annotation = cells[3].innerText ? cells[3].innerText.trim() : '';
                    var link = row.querySelector('a[href*=".pdf"]');
                    var file = link ? link.getAttribute('href') : '';
                    if (sem && type) {
                      reports.push({
                        type: type,
                        sem: sem,
                        annotation: annotation || (type + ' for ' + sem),
                        file: file,
                        show: true
                      });
                    }
                  }
                }
              } catch (e3) {}
            }

            var isDomReady = !!(document.querySelector('table#dataTable') || document.querySelector('[ng-controller]') || document.querySelector('[ng-init]'));

            if ((reports && reports.length > 0) || (attempts >= 20 && isDomReady) || attempts >= maxAttempts) {
              clearInterval(poll);
              done = true;

              // Normalize and validate report items
              var normalized = (reports || []).map(function(r, idx) {
                var fileUrl = r.file || '';
                if (fileUrl && fileUrl.indexOf('http') !== 0) {
                  if (fileUrl.indexOf('/') === 0) {
                    fileUrl = 'https://shiksha.iiserb.ac.in' + fileUrl;
                  } else {
                    fileUrl = 'https://shiksha.iiserb.ac.in/' + fileUrl;
                  }
                }

                var type = (r.type || 'Grade Report').trim();
                var sem = (r.sem || '').trim();
                var annotation = (r.annotation || (type + (sem ? ' (' + sem + ')' : ''))).trim();
                var safeId = (sem + '-' + type).toLowerCase().replace(/[^a-z0-9_-]/g, '_') || ('report_' + idx);

                return {
                  id: safeId,
                  type: type,
                  sem: sem,
                  annotation: annotation,
                  file: fileUrl,
                  show: r.show === true || r.show === 'true'
                };
              }).filter(function(r) {
                return r.show === true && r.file && (r.file.indexOf('.pdf') !== -1 || /\.pdf($|\?)/i.test(r.file));
              });

              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'REPORTS_SCRAPED',
                status: 'success',
                items: normalized
              }));
            }
          } catch (err) {
            clearInterval(poll);
            if (!done) {
              done = true;
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'REPORTS_SCRAPED',
                status: 'error',
                message: err.message || 'Failed to scrape reports'
              }));
            }
          }
        }, 50);
      })();
      true;
    `;
  },

  /**
   * Generates JS string to download a PDF within the authenticated WebView session
   * and stream it back as Base64 to bypass Android OkHttp SSL trust anchor rejections.
   */
  getPdfDownloadScript(fileUrl: string, reportId: string): string {
    const escapedUrl = JSON.stringify(fileUrl);
    const escapedId = JSON.stringify(reportId);

    return `
      (async function() {
        try {
          var resp = await fetch(${escapedUrl}, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Accept': 'application/pdf,application/octet-stream,*/*'
            }
          });
          if (!resp.ok) {
            throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
          }

          var finalUrl = resp.url || '';
          var contentType = (resp.headers.get('content-type') || '').toLowerCase();
          if (finalUrl.indexOf('/login') !== -1 || contentType.indexOf('text/html') !== -1) {
            throw new Error('Session expired or portal returned HTML instead of PDF.');
          }

          var blob = await resp.blob();
          if (!blob || blob.size < 512) {
            throw new Error('Downloaded file is empty or invalid (' + (blob ? blob.size : 0) + ' bytes).');
          }

          var reader = new FileReader();
          reader.onloadend = function() {
            try {
              var fullDataUrl = reader.result || '';
              var base64 = fullDataUrl.indexOf(',') !== -1 ? fullDataUrl.split(',')[1] : fullDataUrl;
              
              if (!base64 || base64.length < 100) {
                throw new Error('Empty Base64 payload generated from PDF blob.');
              }

              // Base64 header for %PDF is JVBER
              if (!base64.trim().startsWith('JVBER')) {
                throw new Error('Received non-PDF payload from portal.');
              }

              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'REPORT_PDF_READY',
                reportId: ${escapedId},
                base64: base64
              }));
            } catch (innerErr) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'REPORT_PDF_FAILED',
                reportId: ${escapedId},
                message: innerErr.message || 'Invalid PDF content received'
              }));
            }
          };
          reader.onerror = function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'REPORT_PDF_FAILED',
              reportId: ${escapedId},
              message: 'Failed to read PDF blob into base64'
            }));
          };
          reader.readAsDataURL(blob);
        } catch (err) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'REPORT_PDF_FAILED',
            reportId: ${escapedId},
            message: err.message || 'Error downloading PDF in WebView session'
          }));
        }
      })();
      true;
    `;
  }
};
