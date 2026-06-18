/**
 * [웅동중학교 스마트 데스크 - 서버 스크립트 v9.0 최적화]
 * - 백그라운드 동기화(트리거) 방식 적용으로 로딩 속도 비약적 향상
 * - 캐시 우선 로딩 구조로 변경
 */

const CONFIG = {
  FOLDER_ID: '1mNsW-AwUMT2xpUo7hpOMT8plcGCWeOqo',
  EVENT_SHEET_ID: '1WXHAbzLAhJKJj8P3cToqifGMo82EjC9iWALYd41vWu4',
  WEEKLY_PLAN_SHEET_ID: '1J9RlY0D-c7ofX2BliHkeEnw2GpL4QkyMQVGdd4nUNaQ',
  GOOGLE_CALENDAR_ID: "742096256b0a004fcc79cc7b3189c6294e8d3e8eb4b0eafd5b7ded0a0d84a6d9@group.calendar.google.com",
  HOLIDAY_CALENDAR_ID: "ko.south_korea#holiday@group.v.calendar.google.com",
  PERIOD_TIMES: [
    { p: 1, start: "09:00", end: "09:45", label: "09:00~09:45" },
    { p: 2, start: "09:55", end: "10:40", label: "09:55~10:40" },
    { p: 3, start: "10:50", end: "11:35", label: "10:50~11:35" },
    { p: 4, start: "11:45", end: "12:30", label: "11:45~12:30" },
    { p: 5, start: "13:30", end: "14:15", label: "13:30~14:15" },
    { p: 6, start: "14:20", end: "15:05", label: "14:20~15:05" },
    { p: 7, start: "15:10", end: "15:55", label: "15:10~15:55" }
  ],
  SCHOOL_EVENTS: {}
};

const PIN_AUTH = {
  SECRET: 'dndehd0025',
  CACHE_PREFIX: 'smart_desk_pin_session_',
  TTL_SECONDS: 21600
};

function verifyPin(pin) {
  if (String(pin || '').trim() !== PIN_AUTH.SECRET) {
    return { success: false, message: "PIN 번호가 맞지 않습니다." };
  }

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(PIN_AUTH.CACHE_PREFIX + token, "1", PIN_AUTH.TTL_SECONDS);
  return { success: true, token: token };
}

function verifyPinSession(token) {
  return { success: isPinSessionValid_(token) };
}

function isPinSessionValid_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get(PIN_AUTH.CACHE_PREFIX + String(token)) === "1";
}

function createPinAuthError_() {
  return {
    success: false,
    error: "PIN 인증이 필요합니다.",
    message: "PIN 인증이 필요합니다.",
    menu: "PIN 인증이 필요합니다."
  };
}

function doGet(e) {
  // 1. 접속 꼬리표(?v=lite) 확인
  var params = (e && e.parameter) ? e.parameter : {};
  var page = params.v === 'lite' ? 'lite' : 'index';

  // 2. 템플릿 생성
  var template = HtmlService.createTemplateFromFile(page);

  // [핵심 수정] 앱의 절대 주소를 HTML로 넘겨줍니다. (링크 오류 방지)
  template.appUrl = ScriptApp.getService().getUrl();

  // 3. 제목 설정
  var title = page === 'lite' ? '웅동중학교 시간표' : '웅동중학교 스마트 데스크';

  return template.evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// 1. 핵심 로직: 시간표 데이터 로드 및 동기화
// ==========================================

// [수정] 클라이언트는 이제 무거운 작업을 직접 시키지 않고 캐시된 데이터만 가져갑니다.
function getTimetableData(requestedSheetName, token) {
  if (!isPinSessionValid_(token)) return createPinAuthError_();

  // 특정 시트 이름을 요청한 경우(드롭다운 변경 등)에는 실시간으로 가져와야 함
  if (requestedSheetName) {
    return getTimetableDataFromExcelFolder_(requestedSheetName);
  }

  // 일반 접속(초기 로딩): 미리 만들어진 캐시 시트에서 데이터 로드 (0.5초 소요)
  const cachedData = loadDataFromCacheSheet_();

  if (cachedData) {
    return cachedData;
  } else {
    // 만약 캐시가 텅 비어있다면(최초 실행 등), 그때만 강제로 동기화 실행 후 리턴
    syncTimetableBackground();
    return loadDataFromCacheSheet_() || { error: "데이터를 불러올 수 없습니다." };
  }
}

// [신규] 트리거에 의해 10~30분마다 실행될 백그라운드 동기화 함수
function syncTimetableBackground() {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const lastProcessedId = scriptProps.getProperty("LAST_TT_FILE_ID");

    // 1. 폴더 파일 탐색
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    const files = folder.getFiles();
    let allXlsx = [];

    while (files.hasNext()) {
      const file = files.next();
      if (file.getName().includes("temp_data_sync")) continue;
      if (file.getMimeType().includes('spreadsheetml.sheet') || file.getMimeType().includes('excel')) {
        allXlsx.push({
          file: file,
          id: file.getId(),
          name: file.getName(),
          lastUpdatedTime: file.getLastUpdated(),
          score: getFileDateScore_(file.getName())
        });
      }
    }

    if (allXlsx.length === 0) return;

    // 날짜 점수 정렬
    allXlsx.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.lastUpdatedTime.getTime() - a.lastUpdatedTime.getTime();
    });

    // 오늘 날짜 포함 파일 찾기
    let targetFileObj = null;
    for (let f of allXlsx) {
      if (isFileCoveringToday_(f.name)) {
        targetFileObj = f;
        break;
      }
    }
    if (!targetFileObj) targetFileObj = allXlsx[0];

    // 2. 변경사항 체크: 마지막으로 처리한 파일 ID와 같으면 패스 (리소스 절약)
    // 단, 캐시 시트가 비어있다면 강제 진행
    const cachedData = loadDataFromCacheSheet_();
    if (lastProcessedId === targetFileObj.id && cachedData) {
      console.log("변경사항 없음, 동기화 건너뜀");
      return;
    }

    // 3. 변환 및 파싱 시작
    console.log("새로운 시간표 파일 변환 시작: " + targetFileObj.name);
    const config = getConfigFromSheet();
    const currDataObj = getSheetDataFromFile(targetFileObj.file, null);

    if (!currDataObj.error) {
      const currResult = processTimetableData(currDataObj.data, currDataObj.sheetName, config.excludedTeachers);
      currResult.sheetList = currDataObj.sheetList;
      currResult.lastUpdated = Utilities.formatDate(new Date(), "Asia/Seoul", "M월 d일 H시 m분 업데이트");
      currResult.currentSheetName = currDataObj.sheetName;
      currResult.thisWeekSheetName = currDataObj.thisWeekSheetName || currDataObj.sheetName;

      // 임시 파일 정리
      if (currDataObj.tempId) DriveApp.getFileById(currDataObj.tempId).setTrashed(true);

      // 4. 결과 저장 (시트 캐시에 저장)
      saveDataToCacheSheet_(currResult);

      // 처리한 파일 ID 기록
      scriptProps.setProperty("LAST_TT_FILE_ID", targetFileObj.id);
      console.log("동기화 완료");
    }
  } catch (e) {
    console.error("동기화 실패: " + e.toString());
  }
}

// (Legacy) 특정 시트 요청 시 사용되는 실시간 변환 함수
function getTimetableDataFromExcelFolder_(requestedSheetName) {
  try {
    const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    const files = folder.getFiles();
    let allXlsx = [];
    while (files.hasNext()) {
      const file = files.next();
      if (file.getName().includes("temp_data_sync")) continue;
      if (file.getMimeType().includes('spreadsheetml.sheet') || file.getMimeType().includes('excel')) {
        let score = getFileDateScore_(file.getName());
        allXlsx.push({ file: file, id: file.getId(), name: file.getName(), lastUpdatedTime: file.getLastUpdated(), score: score });
      }
    }
    if (allXlsx.length === 0) return { error: "엑셀 파일이 없어요 😢" };

    allXlsx.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.lastUpdatedTime.getTime() - a.lastUpdatedTime.getTime();
    });

    let targetFileObj = null;
    for (let f of allXlsx) {
      if (isFileCoveringToday_(f.name)) { targetFileObj = f; break; }
    }
    if (!targetFileObj) targetFileObj = allXlsx[0];

    const config = getConfigFromSheet();
    const currDataObj = getSheetDataFromFile(targetFileObj.file, requestedSheetName);

    if (!currDataObj.error) {
      const currResult = processTimetableData(currDataObj.data, currDataObj.sheetName, config.excludedTeachers);
      currResult.sheetList = currDataObj.sheetList;
      currResult.lastUpdated = Utilities.formatDate(targetFileObj.lastUpdatedTime, "Asia/Seoul", "M월 d일 H시 m분 수정");
      currResult.currentSheetName = currDataObj.sheetName;
      currResult.thisWeekSheetName = currDataObj.thisWeekSheetName || currDataObj.sheetName;
      if (currDataObj.tempId) DriveApp.getFileById(currDataObj.tempId).setTrashed(true);
      return currResult;
    }
    if (currDataObj.tempId) DriveApp.getFileById(currDataObj.tempId).setTrashed(true);
    return currDataObj;
  } catch (e) { return { error: "서버 오류: " + e.toString() }; }
}

// ==========================================
// 2. 유틸리티 및 헬퍼 함수들
// ==========================================

// Code.gs의 기존 함수를 이걸로 교체하세요

// Code.gs의 기존 getConfigFromSheet 함수를 지우고 이 코드로 교체하세요.

function getConfigFromSheet() {
  const cache = CacheService.getScriptCache();
  // [중요] 캐시 키를 바꿔서 강제로 새로고침 시킵니다.
  const cachedConfig = cache.get("app_config_student_v1");

  if (cachedConfig) return JSON.parse(cachedConfig);

  try {
    const ss = SpreadsheetApp.openById(CONFIG.EVENT_SHEET_ID);
    let sheet = ss.getSheetByName("Config") || ss.getSheetByName("설정") || ss.getSheets()[0];
    const data = sheet.getDataRange().getValues();

    // noticeStudent 초기값 설정
    let res = { excludedTeachers: [], notice: "공지사항 없음", noticeStudent: "" };

    if (data && data.length > 0) {
      for (let i = 0; i < data.length; i++) {
        let row = data[i];
        if (row.length < 2) continue;
        let key = String(row[0]).trim();
        let val = String(row[1]).trim();

        if (key === "NOTICE_MESSAGE") res.notice = val;
        // [핵심] 여기서 학생용 공지를 읽어옵니다.
        else if (key === "NOTICE_MESSAGE_STUDENT") res.noticeStudent = val;
        else if (key === "EXCLUDED_TEACHERS") res.excludedTeachers = val.split(",").map(s => s.trim()).filter(Boolean);
      }
    }

    // 만약 시트에 학생용 공지가 비어있으면, 교사용 공지를 대신 보여줍니다.
    if (!res.noticeStudent) res.noticeStudent = res.notice;

    // 캐시 저장 (새로운 키 이름 사용)
    cache.put("app_config_student_v1", JSON.stringify(res), 1200);
    return res;
  } catch (e) { return { notice: "설정 로드 오류", noticeStudent: "로딩 오류", excludedTeachers: [] }; }
}

function getStaticData(forceRefresh, token) {
  if (!isPinSessionValid_(token)) return createPinAuthError_();

  if (forceRefresh) {
    const cache = CacheService.getScriptCache();
    cache.remove("app_config_student_v1");
    cache.remove("sheet_events_v1");
    cache.remove("holiday_events_v1");
  }

  const config = getConfigFromSheet();
  const baseEvents = CONFIG.SCHOOL_EVENTS;
  const sheetEvents = getEventsFromSheet();
  const eventStart = new Date();
  eventStart.setDate(eventStart.getDate() - 30);
  const eventEnd = new Date();
  eventEnd.setDate(eventEnd.getDate() + 365);
  const userCalEvents = getEventsBetweenDates_(CONFIG.GOOGLE_CALENDAR_ID, eventStart, eventEnd);
  const holidayEvents = getHolidayEvents();

  let merged = mergeEventData(sheetEvents, userCalEvents);
  merged = mergeEventData(merged, holidayEvents);

  const finalEvents = { ...baseEvents, ...merged };

  return {
    events: finalEvents,
    notice: config.notice,
    noticeStudent: config.noticeStudent, // [신규] 학생용 공지 데이터 전달
    periodTimes: CONFIG.PERIOD_TIMES,
    excludedTeachers: config.excludedTeachers
  };
}

function getEventsFromSheet() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("sheet_events_v1");
  if (cached) return JSON.parse(cached);

  try {
    const ss = SpreadsheetApp.openById(CONFIG.EVENT_SHEET_ID);
    let sheet = ss.getSheetByName("학사일정") || ss.getSheets()[0];
    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return {};
    const data = sheet.getRange(1, 1, lastRow, 2).getValues();
    const events = {};
    for (let i = 0; i < data.length; i++) {
      let dateVal = data[i][0];
      let eventName = data[i][1];
      if (dateVal && eventName) {
        let dateStr = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, "Asia/Seoul", "yyyy-MM-dd") : String(dateVal).trim();
        if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          events[dateStr] = events[dateStr] ? events[dateStr] += " / " + eventName : eventName;
        }
      }
    }
    cache.put("sheet_events_v1", JSON.stringify(events), 3600);
    return events;
  } catch (e) { return {}; }
}

function getSpecificRangeEvents(calId, sy, sm, sd, ey, em, ed) {
  return getEventsBetweenDates_(calId, new Date(sy, sm, sd), new Date(ey, em, ed));
}

function getEventsBetweenDates_(calId, start, end) {
  const eventMap = {};
  try {
    const cal = CalendarApp.getCalendarById(calId);
    if (cal) {
      cal.getEvents(start, end).forEach(evt => processEvent(evt, eventMap));
    }
  } catch (e) { }
  return eventMap;
}

function getHolidayEvents() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("holiday_events_v1");
  if (cached) return JSON.parse(cached);
  const eventMap = {};
  try {
    const cal = CalendarApp.getCalendarById(CONFIG.HOLIDAY_CALENDAR_ID);
    if (!cal) return {};
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate() - 30);
    const end = new Date(now); end.setDate(now.getDate() + 365);
    cal.getEvents(start, end).forEach(evt => processEvent(evt, eventMap));
    cache.put("holiday_events_v1", JSON.stringify(eventMap), 21600);
  } catch (e) { }
  return eventMap;
}

function processEvent(evt, eventMap) {
  let title = evt.getTitle();
  let startDate = evt.isAllDayEvent() ? evt.getAllDayStartDate() : evt.getStartTime();
  let endDate = evt.isAllDayEvent() ? evt.getAllDayEndDate() : evt.getEndTime();
  let current = new Date(startDate); current.setHours(0, 0, 0, 0);
  let endLimit = new Date(endDate);
  if (!evt.isAllDayEvent() && endLimit.getHours() > 0) { endLimit.setHours(0, 0, 0, 0); endLimit.setDate(endLimit.getDate() + 1); }
  else { endLimit.setHours(0, 0, 0, 0); }
  let safety = 0;
  while (current < endLimit && safety < 365) {
    let dateStr = Utilities.formatDate(current, "Asia/Seoul", "yyyy-MM-dd");
    if (eventMap[dateStr]) { if (!eventMap[dateStr].includes(title)) eventMap[dateStr] += " / " + title; }
    else { eventMap[dateStr] = title; }
    current.setDate(current.getDate() + 1);
    safety++;
  }
}

function mergeEventData(sourceA, sourceB) {
  const merged = { ...sourceA };
  for (let dateKey in sourceB) {
    if (merged[dateKey]) { if (!merged[dateKey].includes(sourceB[dateKey])) merged[dateKey] += " / " + sourceB[dateKey]; }
    else { merged[dateKey] = sourceB[dateKey]; }
  }
  return merged;
}

function getVirtualDateVal_() {
  const now = new Date();
  const parts = Utilities.formatDate(now, "Asia/Seoul", "u,H,m,M,d").split(",");
  const day = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  const min = parseInt(parts[2], 10);
  const month = parseInt(parts[3], 10);
  const date = parseInt(parts[4], 10);

  let addDays = 0;
  if (day === 5 && (hour > 15 || (hour === 15 && min >= 55))) addDays = 3;
  else if (day === 6) addDays = 2;
  else if (day === 7) addDays = 1;

  let virtualDate = new Date(now.getFullYear(), month - 1, date + addDays);
  let vMonth = virtualDate.getMonth() + 1;
  let vDate = virtualDate.getDate();

  if (vMonth === 1 || vMonth === 2) {
    return (vMonth + 12) * 100 + vDate;
  }
  return vMonth * 100 + vDate;
}

function pickCurrentSheetByName_(sheets) {
  const todayVal = getVirtualDateVal_();
  for (var s = 0; s < sheets.length; s++) {
    var name = sheets[s].getName();
    var match = name.match(/(\d{1,2})[\.\/-](\d{1,2})\s*[~\-]\s*(\d{1,2})[\.\/-](\d{1,2})/);
    if (match) {
      let sm = parseInt(match[1], 10), sd = parseInt(match[2], 10), em = parseInt(match[3], 10), ed = parseInt(match[4], 10);
      let startVal = sm * 100 + sd;
      let endVal = em * 100 + ed;
      if (sm === 1 || sm === 2) startVal = (sm + 12) * 100 + sd;
      if (em === 1 || em === 2) endVal = (em + 12) * 100 + ed;
      if (sm === 12 && em === 1) endVal = 1300 + ed;
      if (todayVal >= startVal && todayVal <= endVal) return sheets[s];
    }
  }
  return null;
}

function logStat(selectedVal, userAgent, token) {
  if (!isPinSessionValid_(token)) return createPinAuthError_();

  try {
    const cache = CacheService.getScriptCache();
    const k = "stat_" + hashKey_(String(selectedVal) + "|" + String(userAgent));
    if (cache.get(k)) return;
    cache.put(k, "1", 60);
  } catch (e) { }
  var lock = LockService.getScriptLock();
  try {
    if (lock.tryLock(2000)) {
      const ss = SpreadsheetApp.openById(CONFIG.EVENT_SHEET_ID);
      let sheet = ss.getSheetByName("Stats");
      if (!sheet) { sheet = ss.insertSheet("Stats"); sheet.appendRow(["일시", "요일", "구분", "조회대상", "접속기기(UA)"]); }
      const now = new Date();
      const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
      sheet.appendRow([Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"), dayNames[now.getDay()], selectedVal.indexOf("-") > -1 ? "학급" : "교사", selectedVal, userAgent]);
      lock.releaseLock();
    }
  } catch (e) { }
}

function hashKey_(str) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8)).substring(0, 16);
}

function getWeeklyPlanUrl(token) {
  if (!isPinSessionValid_(token)) return "";

  const now = new Date();
  const parts = Utilities.formatDate(now, "Asia/Seoul", "u,H,m").split(",");
  const day = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  const min = parseInt(parts[2], 10);
  let targetDate = new Date(now);
  if (day === 5 && (hour > 15 || (hour === 15 && min >= 55))) targetDate.setDate(now.getDate() + 3);
  else if (day === 6) targetDate.setDate(now.getDate() + 2);
  else if (day === 7) targetDate.setDate(now.getDate() + 1);
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1;
  const targetDay = targetDate.getDate();
  const firstDayOfMonth = new Date(targetYear, targetMonth - 1, 1).getDay();
  const weekNo = Math.ceil((targetDay + firstDayOfMonth) / 7);
  const targetName = targetMonth + "월 " + weekNo + "주";
  const cache = CacheService.getScriptCache();
  const cacheKey = "weekly_plan_url_" + targetName;
  const cachedUrl = cache.get(cacheKey);
  if (cachedUrl) return cachedUrl;
  try {
    const ss = SpreadsheetApp.openById(CONFIG.WEEKLY_PLAN_SHEET_ID);
    const sheets = ss.getSheets();
    let gid = "0";
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().includes(targetName)) {
        gid = sheets[i].getSheetId();
        break;
      }
    }
    const url = "https://docs.google.com/spreadsheets/d/" + CONFIG.WEEKLY_PLAN_SHEET_ID + "/edit#gid=" + gid;
    cache.put(cacheKey, url, 1800);
    return url;
  } catch (e) { return "https://docs.google.com/spreadsheets/d/" + CONFIG.WEEKLY_PLAN_SHEET_ID + "/edit"; }
}

function getLunchData(dateStr, token) {
  if (!isPinSessionValid_(token)) return createPinAuthError_();

  const cache = CacheService.getScriptCache();
  const cacheKey = "meal_v1_" + String(dateStr || "");
  try {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { }
  const url = `https://open.neis.go.kr/hub/mealServiceDietInfo?Type=json&ATPT_OFCDC_SC_CODE=S10&SD_SCHUL_CODE=9022157&MLSV_YMD=${dateStr}`;
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const json = JSON.parse(response.getContentText());
    let result;
    if (json.mealServiceDietInfo) {
      const rows = json.mealServiceDietInfo[1].row;
      let lunchRow = rows.find(r => r.MMEAL_SC_NM === '중식') || rows[0];
      result = { menu: lunchRow.DDISH_NM, success: true };
    } else {
      result = { menu: json.RESULT && json.RESULT.CODE === "INFO-200" ? "오늘은 급식이 없어요! 🙅‍♂️" : "급식 정보를 찾을 수 없어요.", success: false };
    }
    try { cache.put(cacheKey, JSON.stringify(result), 21600); } catch (e) { }
    return result;
  } catch (e) { return { menu: "불러오기 실패", success: false }; }
}

function getCoffeeOrderUrl(token) {
  if (!isPinSessionValid_(token)) return "";

  return "https://docs.google.com/spreadsheets/d/1uYqgGlLk1vJ1FieeYJKfQK4t4DbrAdoAav6M8zgD1Qw/edit";
}

function getFileDateScore_(fileName) {
  let match = fileName.match(/(\d{1,2})[\.\/-](\d{1,2})\s*[~\-]\s*(\d{1,2})[\.\/-](\d{1,2})/);
  if (!match) return 0;
  let sm = parseInt(match[1], 10);
  let sd = parseInt(match[2], 10);
  if (sm === 1 || sm === 2) { return (sm + 12) * 100 + sd; }
  return sm * 100 + sd;
}

function isFileCoveringToday_(fileName) {
  let match = fileName.match(/(\d{1,2})[\.\/-](\d{1,2})\s*[~\-]\s*(\d{1,2})[\.\/-](\d{1,2})/);
  if (!match) return false;

  let sm = parseInt(match[1], 10), sd = parseInt(match[2], 10);
  let em = parseInt(match[3], 10), ed = parseInt(match[4], 10);

  let startScore = (sm === 1 || sm === 2) ? (sm + 12) * 100 + sd : sm * 100 + sd;
  let endScore = (em === 1 || em === 2) ? (em + 12) * 100 + ed : em * 100 + ed;
  if (sm === 12 && em === 1) endScore = 1300 + ed;

  let todayScore = getVirtualDateVal_();

  return (todayScore >= startScore && todayScore <= endScore);
}

function getSheetDataFromFile(file, reqName) {
  let spreadsheet;
  try {
    const resource = { name: "temp_" + new Date().getTime(), mimeType: "application/vnd.google-apps.spreadsheet" };
    const created = Drive.Files.create(resource, file.getBlob());
    spreadsheet = SpreadsheetApp.openById(created.id);
  } catch (e) { return { error: "파일 변환 실패" }; }

  const sheets = spreadsheet.getSheets();
  const sheetList = sheets.map(s => s.getName());

  const thisWeekSheet = pickCurrentSheetByName_(sheets) || sheets[sheets.length - 1];
  const thisWeekSheetName = thisWeekSheet ? thisWeekSheet.getName() : "";

  let targetSheet = reqName ? spreadsheet.getSheetByName(reqName) : null;
  if (!targetSheet) targetSheet = thisWeekSheet;
  if (!targetSheet) targetSheet = sheets[sheets.length - 1];

  const data = targetSheet.getDataRange().getDisplayValues();
  return {
    data: data,
    sheetName: targetSheet.getName(),
    sheetList: sheetList,
    tempId: spreadsheet.getId(),
    thisWeekSheetName: thisWeekSheetName
  };
}

function processTimetableData(rows, sheetName, excludedTeachers) {
  const teacherMap = {}; const classMap = {}; let headerRowIdx = -1; let firstClassColIdx = -1;
  for (let r = 0; r < Math.min(rows.length, 50); r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c].toString().replace(/\s/g, "") === "1-1") { headerRowIdx = r; firstClassColIdx = c; break; }
    }
    if (headerRowIdx !== -1) break;
  }
  if (headerRowIdx === -1) return { error: "양식 오류" };

  const classCols = {};
  rows[headerRowIdx].forEach((cell, idx) => {
    let name = cell.trim().replace(/\s/g, "");
    if (name.indexOf("-") > -1 && idx >= firstClassColIdx) { classCols[idx] = name; classMap[name] = {}; }
  });

  const dayList = ["월", "화", "수", "목", "금"];
  let currentDayIdx = -1;
  let prevP = 99;
  let lastValueCache = {};

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.join("").indexOf("식사") > -1 || row.join("").indexOf("점심") > -1) { lastValueCache = {}; continue; }
    let p = NaN;
    for (let j = firstClassColIdx - 1; j >= 0; j--) {
      let rawVal = row[j].toString().trim();
      if (rawVal.match(/^[1-7]$/) || rawVal.match(/^[1-7]교시$/)) { p = parseInt(rawVal.replace("교시", ""), 10); break; }
    }
    if (isNaN(p)) continue;

    if (p <= prevP && p === 1) { currentDayIdx++; if (currentDayIdx >= dayList.length) currentDayIdx = 4; lastValueCache = {}; }
    let currentDay = dayList[currentDayIdx]; prevP = p;
    if (currentDayIdx < 0) continue;

    for (let colIdx in classCols) {
      const className = classCols[colIdx]; let val = row[colIdx] ? row[colIdx].trim() : "";
      if (val === "" && lastValueCache[colIdx]) val = lastValueCache[colIdx]; else lastValueCache[colIdx] = val;

      if (val.length > 1) {
        let subject = ""; let teachers = [];
        const lines = val.split('\n').filter(l => l.trim());
        const splitRegex = /=>|->|→|[,/\s]+/;

        if (lines.length >= 2) {
          subject = lines[0].trim();
          teachers = lines[lines.length - 1].split(splitRegex).map(t => t.trim()).filter(t => t.length >= 2);
        } else {
          if (val.match(/=>|->|→/)) {
            teachers = val.split(splitRegex).map(t => t.trim()).filter(t => t.match(/[가-힣]{2,4}/));
            subject = val;
          } else {
            const nameMatch = val.match(/[가-힣]{2,4}$/);
            if (nameMatch) { teachers = [nameMatch[0]]; subject = val.replace(nameMatch[0], "").trim(); }
            else { subject = val; }
          }
        }
        let isChanged = false;
        if (val.match(/변경|교체|보강|자습|TR|출장|조퇴|병가|연수|대강|교환|이동|=>|->|→/)) { isChanged = true; }

        teachers = teachers.filter(t => {
          let clean = t.replace(/\s/g, "");
          if (clean.includes("체험활동") || clean.includes("창체") || clean.includes("창의적") || clean.includes("학급자치") || clean.includes("계광누리")) return false;
          if (clean.match(/변경|교체|보강|자습|TR|출장|조퇴|병가|연수|대강|교환|이동|교시|과목/)) return false;
          if (excludedTeachers && excludedTeachers.length > 0) return !excludedTeachers.some(ex => clean.includes(ex));
          return clean !== "손정아";
        });

        if (teachers.length > 0 || subject) {
          if (!(currentDay === "수" && p >= 6)) {
            const entry = { day: currentDay, period: p, subject: subject, className: className, teachers: teachers, isChanged: isChanged };
            if (!classMap[className][currentDay]) classMap[className][currentDay] = [];
            classMap[className][currentDay].push(entry);

            teachers.forEach(t => {
              let ct = t.replace(/\s/g, "");
              if (!teacherMap[ct]) teacherMap[ct] = {};
              if (!teacherMap[ct][currentDay]) teacherMap[ct][currentDay] = [];
              teacherMap[ct][currentDay].push(entry);
            });
          }
        }
      }
    }
  }
  return { teachers: teacherMap, classes: classMap, teacherList: Object.keys(teacherMap).sort(), classList: Object.keys(classMap).sort(), periodTimes: CONFIG.PERIOD_TIMES };
}

function handleTodoDB(action, uid, todoData, token) {
  if (!isPinSessionValid_(token)) return createPinAuthError_();

  var lock = LockService.getScriptLock();
  try { lock.waitLock(3000); } catch (e) { return { success: false, message: "서버가 바빠요." }; }
  try {
    const ss = SpreadsheetApp.openById(CONFIG.EVENT_SHEET_ID);
    let sheet = ss.getSheetByName("DB_Todos");
    if (!sheet) { sheet = ss.insertSheet("DB_Todos"); sheet.appendRow(["User_Key", "Data", "Last_Updated"]); sheet.setFrozenRows(1); }
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) { if (String(data[i][0]) === String(uid)) { rowIndex = i + 1; break; } }

    if (action === "load") {
      if (rowIndex !== -1) { return { success: true, data: JSON.parse(data[rowIndex - 1][1]) }; }
      else { return { success: true, data: {} }; }
    } else if (action === "save") {
      const timestamp = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
      const jsonStr = JSON.stringify(todoData);
      if (rowIndex !== -1) { sheet.getRange(rowIndex, 2).setValue(jsonStr); sheet.getRange(rowIndex, 3).setValue(timestamp); }
      else { sheet.appendRow([uid, jsonStr, timestamp]); }
      return { success: true };
    }
  } catch (e) { return { success: false, message: e.toString() }; } finally { lock.releaseLock(); }
}

function saveDataToCacheSheet_(dataObj) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.EVENT_SHEET_ID);
    let sheet = ss.getSheetByName("DB_Timetable_Cache");
    if (!sheet) { sheet = ss.insertSheet("DB_Timetable_Cache"); }
    sheet.clear();
    const jsonStr = JSON.stringify(dataObj);
    const chunkSize = 40000;
    const chunks = [];
    for (let i = 0; i < jsonStr.length; i += chunkSize) { chunks.push([jsonStr.substring(i, i + chunkSize)]); }
    sheet.getRange(1, 1, chunks.length, 1).setValues(chunks);
  } catch (e) { }
}

function loadDataFromCacheSheet_() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.EVENT_SHEET_ID);
    const sheet = ss.getSheetByName("DB_Timetable_Cache");
    if (!sheet) return null;
    const lastRow = sheet.getLastRow();
    if (lastRow < 1) return null;
    const data = sheet.getRange(1, 1, lastRow, 1).getValues();
    let fullJson = "";
    for (let i = 0; i < data.length; i++) { fullJson += data[i][0]; }
    return JSON.parse(fullJson);
  } catch (e) { return null; }
}

function getContactsData(token) {
  if (!isPinSessionValid_(token)) return [];

  const cache = CacheService.getScriptCache();
  const cached = cache.get("unified_search_data_v6");
  if (cached) return JSON.parse(cached);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.EVENT_SHEET_ID);
    const result = [];
    let sheetPerson = ss.getSheetByName("업무분장");
    if (sheetPerson) {
      const lastRow = sheetPerson.getLastRow();
      if (lastRow > 1) {
        const data = sheetPerson.getRange(2, 1, lastRow - 1, 5).getValues();
        for (let i = 0; i < data.length; i++) {
          if (data[i][0]) {
            result.push({ type: 'person', name: String(data[i][0]).trim(), dept: String(data[i][1]).trim(), tel: String(data[i][2]).trim(), duty: String(data[i][3]).trim(), committee: String(data[i][4]).trim() });
          }
        }
      }
    }
    let sheetManual = ss.getSheetByName("매뉴얼");
    if (sheetManual) {
      const lastRow = sheetManual.getLastRow();
      if (lastRow > 1) {
        const data = sheetManual.getRange(2, 1, lastRow - 1, 3).getValues();
        for (let i = 0; i < data.length; i++) {
          if (data[i][0]) {
            result.push({ type: 'manual', keyword: String(data[i][0]).trim(), content: String(data[i][1]).trim(), approval: String(data[i][2]).trim() });
          }
        }
      }
    }
    cache.put("unified_search_data_v6", JSON.stringify(result), 3600);
    return result;
  } catch (e) { return []; }
}
