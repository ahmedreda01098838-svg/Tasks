// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyAyw4tZH8I85CsBKmdxK7ZYMDCBxDvCgPc",
    authDomain: "task-planner-app-f6e0e.firebaseapp.com",
    projectId: "task-planner-app-f6e0e",
    storageBucket: "task-planner-app-f6e0e.firebasestorage.app",
    messagingSenderId: "189812947761",
    appId: "1:189812947761:web:c8dd4c8cc3534e84a90e10",
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    console.warn("التخزين المحلي يعمل في تبويب آخر أو غير مدعوم.");
});

let currentUser = null;
let activeListeners = {};
let midnightTimer = null;
let lastVisibleDoc = null; 
const PAGE_SIZE = 10; 

let trackedKeywords = [];
let recurringTasksList = [];

// Timer / Pomodoro States
let timerSeconds = 0;
let timerInterval = null;
let isTimerRunning = false;
let timerMode = 'stopwatch';

document.addEventListener("DOMContentLoaded", () => {
    initApp();
    initPrayerTimes();
    loadThemePreference();
});

function initApp() {
    auth.onAuthStateChanged((user) => {
        const profileDiv = document.getElementById("user-profile");
        const dashboard = document.getElementById("dashboard-panel");
        const trackerSec = document.getElementById("tracker-section");
        const recurringSec = document.getElementById("recurring-section");
        const timerSec = document.getElementById("timer-section");
        const bannerSec = document.getElementById("today-banner");
        const searchBar = document.getElementById("search-container");
        const container = document.getElementById("tasks-container");
        const loadMoreBtn = document.getElementById("load-more-btn");

        if (user) {
            currentUser = user;
            if (dashboard) dashboard.style.display = "grid";
            if (trackerSec) trackerSec.style.display = "block";
            if (recurringSec) recurringSec.style.display = "block";
            if (timerSec) timerSec.style.display = "block";
            if (bannerSec) bannerSec.style.display = "block";
            if (searchBar) searchBar.style.display = "block";

            if (profileDiv) {
                profileDiv.innerHTML = `
                    <div class="user-info" style="display: flex; align-items: center; gap: 8px;">
                        <img src="${user.photoURL || ''}" class="user-avatar" alt="avatar" loading="lazy" style="width:35px; height:35px; border-radius:50%;">
                        <button onclick="logout()" class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.8rem;">خروج 🚪</button>
                    </div>
                `;
            }

            fetchUserDataSettings();
            fetchStudyStats();
            autoAddTodayIfMissing();
            scheduleMidnightAutoAdd();
            loadInitialTasks();
            calculateAdvancedStats();
        } else {
            currentUser = null;
            if (dashboard) dashboard.style.display = "none";
            if (trackerSec) trackerSec.style.display = "none";
            if (recurringSec) recurringSec.style.display = "none";
            if (timerSec) timerSec.style.display = "none";
            if (bannerSec) bannerSec.style.display = "none";
            if (searchBar) searchBar.style.display = "none";
            if (loadMoreBtn) loadMoreBtn.style.display = "none";
            
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 30px; background: var(--card-bg); border-radius: 16px; border: 1px solid var(--border-color);">
                        <p class="loading-text" style="margin-bottom: 15px;">يرجى تسجيل الدخول لحفظ وعرض مهامك سحابياً.</p>
                        <button onclick="login()" class="btn btn-primary" style="padding: 12px 24px; font-size: 1rem;">🔐 تسجيل الدخول بجوجل</button>
                    </div>
                `;
            }
            if (profileDiv) {
                profileDiv.innerHTML = `<button onclick="login()" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.85rem;">دخول 🔐</button>`;
            }

            if (midnightTimer) clearTimeout(midnightTimer);
            Object.keys(activeListeners).forEach((id) => activeListeners[id]());
            activeListeners = {};
        }
    });
}

// --- Theme Toggle ---
function toggleTheme() {
    document.body.classList.toggle("light-theme");
    const isLight = document.body.classList.contains("light-theme");
    document.getElementById("theme-btn").textContent = isLight ? "☀️" : "🌙";
    localStorage.setItem("theme_pref", isLight ? "light" : "dark");
}

function loadThemePreference() {
    const pref = localStorage.getItem("theme_pref");
    if (pref === "light") {
        document.body.classList.add("light-theme");
        document.getElementById("theme-btn").textContent = "☀️";
    }
}

// --- Timer & Pomodoro Core ---
function switchTimerMode(mode) {
    pauseTimer();
    timerMode = mode;
    document.getElementById("mode-stopwatch").classList.toggle("active", mode === 'stopwatch');
    document.getElementById("mode-pomodoro").classList.toggle("active", mode === 'pomodoro');
    timerSeconds = mode === 'pomodoro' ? 25 * 60 : 0;
    updateTimerDisplay();
}

function startTimer() {
    if (!isTimerRunning) {
        isTimerRunning = true;
        document.getElementById("timer-start-btn").style.display = "none";
        document.getElementById("timer-pause-btn").style.display = "inline-flex";

        timerInterval = setInterval(() => {
            if (timerMode === 'stopwatch') {
                timerSeconds++;
            } else {
                if (timerSeconds > 0) {
                    timerSeconds--;
                } else {
                    pauseTimer();
                    playNotificationAudio();
                    Swal.fire("انتهت الجلسة!", "حان وقت الاستراحة (5 دقائق) ☕", "success");
                    return;
                }
            }
            updateTimerDisplay();
        }, 1000);
    }
}

function pauseTimer() {
    if (isTimerRunning) {
        isTimerRunning = false;
        clearInterval(timerInterval);
        document.getElementById("timer-start-btn").style.display = "inline-flex";
        document.getElementById("timer-pause-btn").style.display = "none";
    }
}

function resetTimer() {
    pauseTimer();
    timerSeconds = timerMode === 'pomodoro' ? 25 * 60 : 0;
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const hrs = String(Math.floor(timerSeconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((timerSeconds % 3600) / 60)).padStart(2, '0');
    const secs = String(timerSeconds % 60).padStart(2, '0');
    document.getElementById("timer-display").textContent = `${hrs}:${mins}:${secs}`;
}

async function saveStudySession() {
    if (!currentUser || timerSeconds === 0) return;
    const minutesStudied = Math.round(timerSeconds / 60);

    try {
        await db.collection("study_sessions").add({
            userId: currentUser.uid,
            durationMins: minutesStudied,
            createdAt: Date.now()
        });
        Swal.fire("تم التسجيل!", `تم حفظ جلسة مذاكرة بـ ${minutesStudied} دقيقة.`, "success");
        resetTimer();
        fetchStudyStats();
    } catch (e) {
        console.error(e);
    }
}

async function fetchStudyStats() {
    if (!currentUser) return;
    try {
        const snap = await db.collection("study_sessions").where("userId", "==", currentUser.uid).get();
        let totalMins = 0;
        snap.forEach(doc => totalMins += (doc.data().durationMins || 0));
        const hours = (totalMins / 60).toFixed(1);
        const summaryEl = document.getElementById("study-stats-summary");
        if (summaryEl) summaryEl.textContent = `إجمالي المذاكرة المسجلة: ${hours} ساعة (${totalMins} دقيقة)`;
    } catch (e) {
        console.error(e);
    }
}

// --- Audio Feedback ---
function playNotificationAudio() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
        console.warn("Audio Context blocked");
    }
}

// --- Fetch User Settings & Trackers ---
async function fetchUserDataSettings() {
    if (!currentUser) return;
    try {
        const doc = await db.collection("user_settings").doc(currentUser.uid).get();
        if (doc.exists) {
            const data = doc.data();
            if (data.recurringTasks) recurringTasksList = data.recurringTasks;
            if (data.trackedKeywords) trackedKeywords = data.trackedKeywords;
            renderRecurringChips();
        }
    } catch (e) {
        console.error(e);
    }
}

async function saveUserSettings() {
    if (!currentUser) return;
    try {
        await db.collection("user_settings").doc(currentUser.uid).set({
            recurringTasks: recurringTasksList,
            trackedKeywords: trackedKeywords
        }, { merge: true });
    } catch (e) {
        console.error(e);
    }
}

async function addRecurringTask() {
    const input = document.getElementById("recurring-input");
    const val = input.value.trim();
    if (val && !recurringTasksList.includes(val) && currentUser) {
        recurringTasksList.push(val);
        input.value = "";
        await saveUserSettings();
        renderRecurringChips();
    }
}

function renderRecurringChips() {
    const container = document.getElementById("recurring-chips");
    if (!container) return;
    container.innerHTML = "";
    recurringTasksList.forEach((task, idx) => {
        const chip = document.createElement("div");
        chip.className = "tracker-chip";
        chip.innerHTML = `<span>🔄 ${task}</span> <button onclick="removeRecurringTask(${idx})" style="background:transparent; color:var(--danger); font-size:0.8rem;">✖</button>`;
        container.appendChild(chip);
    });
}

async function removeRecurringTask(idx) {
    recurringTasksList.splice(idx, 1);
    await saveUserSettings();
    renderRecurringChips();
}

async function addKeywordTracker() {
    const input = document.getElementById("tracker-input");
    const val = input.value.trim().toLowerCase();
    if (val && !trackedKeywords.includes(val) && currentUser) {
        trackedKeywords.push(val);
        input.value = "";
        await saveUserSettings();
        calculateAdvancedStats();
    }
}

async function removeKeywordTracker(idx) {
    trackedKeywords.splice(idx, 1);
    await saveUserSettings();
    calculateAdvancedStats();
}

// --- Date Formatting (Gregorian) ---
function getFormattedDate(dateObj = new Date()) {
    return dateObj.toLocaleDateString("ar-EG", { 
        calendar: "gregory", 
        weekday: "long", 
        year: "numeric", 
        month: "long", 
        day: "numeric" 
    });
}

function autoAddTodayIfMissing() {
    if (!currentUser) return;
    const todayFormatted = getFormattedDate();

    db.collection("task_days").where("userId", "==", currentUser.uid).where("date", "==", todayFormatted).get().then(async (snapshot) => {
        if (snapshot.empty) {
            const dayRef = await db.collection("task_days").add({
                date: todayFormatted,
                userId: currentUser.uid,
                createdAt: Date.now(),
            });

            if (recurringTasksList.length > 0) {
                const batch = db.batch();
                recurringTasksList.forEach(taskText => {
                    const itemRef = db.collection("task_days").doc(dayRef.id).collection("items").doc();
                    batch.set(itemRef, { text: taskText, done: false, createdAt: Date.now() });
                });
                await batch.commit();
            }
            calculateAdvancedStats();
        }
    }).catch(e => console.error(e));
}

function scheduleMidnightAutoAdd() {
    if (midnightTimer) clearTimeout(midnightTimer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    midnightTimer = setTimeout(() => {
        autoAddTodayIfMissing();
        scheduleMidnightAutoAdd();
    }, midnight.getTime() - now.getTime());
}

function login() { 
    auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch((error) => {
        console.error("Login Error:", error);
        Swal.fire("خطأ في تسجيل الدخول", error.message, "error");
    }); 
}

function logout() { auth.signOut(); }

// --- Advanced Calculation (All Stats Included) ---
async function calculateAdvancedStats() {
    if (!currentUser) return;

    try {
        const daysSnap = await db.collection("task_days").where("userId", "==", currentUser.uid).get();

        let totalRegistered = 0;
        let pendingTasks = 0;
        let completedTasks = 0;
        let weekCompleted = 0;
        let monthCompleted = 0;
        const now = Date.now();
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const todayFormatted = getFormattedDate();

        let todayTotal = 0, todayDone = 0;
        let keywordCounts = {};
        trackedKeywords.forEach(k => keywordCounts[k] = 0);

        const promises = daysSnap.docs.map(doc => ({
            date: doc.data().date,
            createdAt: doc.data().createdAt || 0,
            promise: db.collection("task_days").doc(doc.id).collection("items").get()
        }));

        const itemsSnapshots = await Promise.all(promises.map(p => p.promise));

        itemsSnapshots.forEach((snap, idx) => {
            const dayCreatedAt = promises[idx].createdAt;
            const isToday = promises[idx].date === todayFormatted;
            const isWithinWeek = (now - dayCreatedAt) <= SEVEN_DAYS_MS;
            const isWithinMonth = (now - dayCreatedAt) <= THIRTY_DAYS_MS;

            snap.forEach(itemDoc => {
                const itemData = itemDoc.data();
                totalRegistered++;
                if (isToday) todayTotal++;

                if (itemData.done) {
                    completedTasks++;
                    if (isToday) todayDone++;
                    if (isWithinWeek) weekCompleted++;
                    if (isWithinMonth) monthCompleted++;
                } else {
                    pendingTasks++;
                }

                const textLower = (itemData.text || "").toLowerCase();
                trackedKeywords.forEach(kw => {
                    if (textLower.includes(kw.toLowerCase()) && itemData.done) {
                        keywordCounts[kw]++;
                    }
                });
            });
        });

        const elReg = document.getElementById("stat-total-registered");
        const elPend = document.getElementById("stat-pending");
        const elComp = document.getElementById("stat-completed");
        const elWeek = document.getElementById("stat-week");
        const elMonth = document.getElementById("stat-month");
        const elRatio = document.getElementById("stat-ratio");
        const elTodayStatus = document.getElementById("today-status-text");
        const elTodayFill = document.getElementById("today-progress-fill");

        if (elReg) elReg.textContent = totalRegistered;
        if (elPend) elPend.textContent = pendingTasks;
        if (elComp) elComp.textContent = completedTasks;
        if (elWeek) elWeek.textContent = weekCompleted;
        if (elMonth) elMonth.textContent = monthCompleted;
        if (elRatio) elRatio.textContent = totalRegistered === 0 ? "0%" : Math.round((completedTasks / totalRegistered) * 100) + "%";

        if (elTodayStatus) elTodayStatus.textContent = `${todayDone} من ${todayTotal} مهام مكتملة`;
        const todayPct = todayTotal > 0 ? (todayDone / todayTotal) * 100 : 0;
        if (elTodayFill) elTodayFill.style.width = `${todayPct}%`;

        renderTrackerChips(keywordCounts);
    } catch (err) {
        console.error("خطأ الإحصائيات:", err);
    }
}

function renderTrackerChips(counts) {
    const container = document.getElementById("tracker-chips");
    if (!container) return;
    container.innerHTML = "";
    trackedKeywords.forEach((kw, idx) => {
        const count = counts[kw] || 0;
        const chip = document.createElement("div");
        chip.className = "tracker-chip";
        chip.innerHTML = `<span>${kw}</span><span class="count">${count} مرة</span> <button onclick="removeKeywordTracker(${idx})" style="background:transparent; color:var(--danger); font-size:0.8rem;">✖</button>`;
        container.appendChild(chip);
    });
}

// --- Load & Render Tasks ---
function loadInitialTasks() {
    const container = document.getElementById("tasks-container");
    if (!container || !currentUser) return;

    db.collection("task_days").where("userId", "==", currentUser.uid).orderBy("createdAt", "desc").limit(PAGE_SIZE).onSnapshot((snap) => {
        const spinner = document.getElementById("loading-spinner");
        if (spinner) spinner.remove();

        if (snap.empty) {
            container.innerHTML = '<p class="loading-text" style="text-align:center; padding:20px;">لا توجد أيام مضافة بعد. ابدأ بإضافة مهامك اليومية!</p>';
            return;
        }

        lastVisibleDoc = snap.docs[snap.docs.length - 1];

        snap.docChanges().forEach((change) => {
            const dayId = change.doc.id;
            if (change.type === "added") renderDay(change.doc, change.newIndex);
            else if (change.type === "removed") {
                const card = document.getElementById(`card-${dayId}`);
                if (card) card.remove();
                calculateAdvancedStats();
            }
        });
    }, (error) => {
        console.error("Firestore Error:", error);
        if (container) container.innerHTML = `<p class="loading-text" style="color: var(--danger);">حدث خطأ أثناء تحميل المهام: ${error.message}</p>`;
    });
}

function loadMoreTasks() {
    if (!lastVisibleDoc || !currentUser) return;
    db.collection("task_days").where("userId", "==", currentUser.uid).orderBy("createdAt", "desc").startAfter(lastVisibleDoc).limit(PAGE_SIZE).get().then((snap) => {
        if (snap.empty) return;
        lastVisibleDoc = snap.docs[snap.docs.length - 1];
        snap.docs.forEach((doc) => renderDay(doc, -1));
    }).catch(e => console.error(e));
}

function renderDay(doc, targetIndex) {
    const dayId = doc.id;
    const data = doc.data();
    const container = document.getElementById("tasks-container");
    if (document.getElementById(`card-${dayId}`)) return;

    const dayCard = document.createElement("div");
    dayCard.className = "day-card";
    dayCard.id = `card-${dayId}`;
    dayCard.innerHTML = `
        <div class="day-header">
            <h3>📅 ${data.date}</h3>
            <button class="delete-btn" onclick="deleteDay('${dayId}')">🗑️</button>
        </div>
        <div class="progress-container"><div class="progress-bar" id="bar-${dayId}"></div></div>
        <div id="list-${dayId}"></div>
        <div class="input-group">
            <input type="text" id="input-${dayId}" placeholder="اكتب مهمة جديدة..." onkeypress="if(event.key==='Enter') addTask('${dayId}')">
            <button class="btn btn-primary" onclick="addTask('${dayId}')">➕ إدراج</button>
        </div>
    `;

    if (targetIndex === -1 || targetIndex >= container.children.length) container.appendChild(dayCard);
    else container.insertBefore(dayCard, container.children[targetIndex]);

    loadItems(dayId);
}

function addTask(dayId) {
    const input = document.getElementById(`input-${dayId}`);
    const text = input.value.trim();
    if (text && currentUser) {
        db.collection("task_days").doc(dayId).collection("items").add({ text, done: false, createdAt: Date.now() }).then(() => calculateAdvancedStats()).catch(e => console.error(e));
        input.value = "";
    }
}

function loadItems(dayId) {
    if (activeListeners[dayId]) activeListeners[dayId]();

    const unsubscribe = db.collection("task_days").doc(dayId).collection("items").orderBy("createdAt", "asc").onSnapshot((snap) => {
        const list = document.getElementById(`list-${dayId}`);
        const bar = document.getElementById(`bar-${dayId}`);
        if (!list || !bar) return;

        const fragment = document.createDocumentFragment();
        let doneCount = 0;

        snap.forEach((itemDoc) => {
            const item = itemDoc.data();
            if (item.done) doneCount++;

            const itemDiv = document.createElement("div");
            itemDiv.className = `task-item ${item.done ? "done" : ""}`;
            itemDiv.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px; flex:1;">
                    <input type="checkbox" ${item.done ? "checked" : ""} onclick="toggleTask('${dayId}', '${itemDoc.id}', ${item.done})">
                    <span class="task-text">${item.text}</span>
                </div>
                <button class="edit-task-btn" onclick="editTask('${dayId}', '${itemDoc.id}', '${item.text.replace(/'/g, "\\'")}')">✏️</button>
                <button class="delete-task-btn" onclick="deleteSingleTask('${dayId}', '${itemDoc.id}')">✖</button>
            `;
            fragment.appendChild(itemDiv);
        });

        list.innerHTML = "";
        list.appendChild(fragment);

        if (typeof Sortable !== "undefined") {
            new Sortable(list, { animation: 150 });
        }

        const progress = snap.size > 0 ? (doneCount / snap.size) * 100 : 0;
        bar.style.width = progress + "%";

        if (progress === 100 && snap.size > 0 && typeof confetti === "function") {
            confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
        }
    });

    activeListeners[dayId] = unsubscribe;
}

function toggleTask(dayId, taskId, currentStatus) {
    db.collection("task_days").doc(dayId).collection("items").doc(taskId).update({ done: !currentStatus }).then(() => {
        if (!currentStatus) playNotificationAudio();
        calculateAdvancedStats();
    }).catch(e => console.error(e));
}

async function editTask(dayId, taskId, currentText) {
    const { value: newText } = await Swal.fire({ title: "تعديل المهمة", input: "text", inputValue: currentText, showCancelButton: true });
    if (newText && newText.trim() !== currentText) {
        db.collection("task_days").doc(dayId).collection("items").doc(taskId).update({ text: newText.trim() }).catch(e => console.error(e));
    }
}

function deleteSingleTask(dayId, taskId) {
    db.collection("task_days").doc(dayId).collection("items").doc(taskId).delete().then(() => calculateAdvancedStats()).catch(e => console.error(e));
}

async function deleteDay(dayId) {
    const result = await Swal.fire({ title: "حذف اليوم؟", icon: "warning", showCancelButton: true });
    if (result.isConfirmed) {
        const items = await db.collection("task_days").doc(dayId).collection("items").get();
        const batch = db.batch();
        items.forEach((i) => batch.delete(i.ref));
        await batch.commit();
        await db.collection("task_days").doc(dayId).delete();
        calculateAdvancedStats();
    }
}

function filterTasks() {
    const query = document.getElementById("search-input").value.toLowerCase();
    document.querySelectorAll(".day-card").forEach((card) => {
        const matches = card.textContent.toLowerCase().includes(query);
        card.style.display = matches ? "block" : "none";
    });
}

function scrollToTop() { window.scrollTo({ top: 0, behavior: "smooth" }); }

// --- Fixed Prayer Times ---
function initPrayerTimes() {
    let savedCity = localStorage.getItem("user_prayer_city") || "Cairo";
    let savedCountry = localStorage.getItem("user_prayer_country") || "Egypt";
    fetchPrayerTimesByCity(savedCity, savedCountry);
}

async function changeCityPrompt() {
    const { value: cityName } = await Swal.fire({
        title: "أدخل اسم مدينتك (بالإنجليزية أو العربية)",
        input: "text",
        inputPlaceholder: "مثال: Cairo, Alexandria, Riyadh...",
        showCancelButton: true,
        confirmButtonText: "حفظ",
        cancelButtonText: "إلغاء"
    });

    if (cityName && cityName.trim() !== "") {
        localStorage.setItem("user_prayer_city", cityName.trim());
        localStorage.setItem("user_prayer_country", "Global");
        fetchPrayerTimesByCity(cityName.trim(), "Global");
    }
}

async function fetchPrayerTimesByCity(city, country) {
    try {
        const todayStr = new Date().toISOString().split('T')[0].split('-').reverse().join('-');
        const res = await fetch(`https://api.aladhan.com/v1/timingsByCity/${todayStr}?city=${city}&country=${country}&method=5`);
        const data = await res.json();
        
        if (data && data.data) {
            const timings = data.data.timings;
            const gregorian = data.data.date.gregorian;

            const fEl = document.getElementById("t-Fajr");
            const dEl = document.getElementById("t-Dhuhr");
            const aEl = document.getElementById("t-Asr");
            const mEl = document.getElementById("t-Maghrib");
            const iEl = document.getElementById("t-Isha");

            if (fEl) fEl.textContent = formatTime12(timings.Fajr);
            if (dEl) dEl.textContent = formatTime12(timings.Dhuhr);
            if (aEl) aEl.textContent = formatTime12(timings.Asr);
            if (mEl) mEl.textContent = formatTime12(timings.Maghrib);
            if (iEl) iEl.textContent = formatTime12(timings.Isha);

            const dateEl = document.getElementById("prayer-date");
            const cityEl = document.getElementById("prayer-city");

            if (dateEl) dateEl.textContent = `${gregorian.day} ${gregorian.month.en} ${gregorian.year}`;
            if (cityEl) cityEl.textContent = city;
        }
    } catch (e) {
        console.error("خطأ في جلب مواقيت الصلاة:", e);
    }
}

function formatTime12(time24) {
    const clean = time24.split(' ')[0];
    const [h, m] = clean.split(':').map(Number);
    return `${h % 12 || 12}:${m < 10 ? '0' : ''}${m} ${h >= 12 ? 'م' : 'ص'}`;
}
