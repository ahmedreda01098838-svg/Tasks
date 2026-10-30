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
const PAGE_SIZE = 5; 

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
            if (loadMoreBtn) loadMoreBtn.style.display = "block";

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

// --- Fetch User Settings & Recurring Tasks ---
async function fetchUserDataSettings() {
    if (!currentUser) return;
    try {
        const doc = await db.collection("user_settings").doc(currentUser.uid).get();
        if (doc.exists) {
            const data = doc.data();
            if (data.recurringTasks && Array.isArray(data.recurringTasks)) {
                recurringTasksList = data.recurringTasks;
            }
            renderRecurringChips();
        }
    } catch (e) {
        console.error("خطأ في جلب الإعدادات:", e);
    }
}

async function saveUserSettings() {
    if (!currentUser) return;
    try {
        await db.collection("user_settings").doc(currentUser.uid).set({
            recurringTasks: recurringTasksList
        }, { merge: true });
    } catch (e) {
        console.error("خطأ في حفظ الإعدادات:", e);
    }
}

async function addRecurringTask() {
    const input = document.getElementById("recurring-input");
    if (!input) return;
    const val = input.value.trim();
    
    if (val && currentUser) {
        if (!recurringTasksList.includes(val)) {
            recurringTasksList.push(val);
            input.value = "";
            await saveUserSettings();
            renderRecurringChips();
        } else {
            input.value = "";
            Swal.fire({ title: "ملاحظة", text: "هذه المهمة موجودة مسبقاً في القائمة المتكررة.", icon: "info", timer: 1500, showConfirmButton: false });
        }
    }
}

function renderRecurringChips() {
    const container = document.getElementById("recurring-chips");
    if (!container) return;
    container.innerHTML = "";
    
    recurringTasksList.forEach((task, idx) => {
        const chip = document.createElement("div");
        chip.className = "tracker-chip";
        chip.innerHTML = `<span>🔄 ${task}</span> <button onclick="removeRecurringTask(${idx})" style="background:transparent; color:var(--danger); font-size:0.8rem; cursor:pointer;">✖</button>`;
        container.appendChild(chip);
    });
}

async function removeRecurringTask(idx) {
    if (idx > -1 && idx < recurringTasksList.length) {
        recurringTasksList.splice(idx, 1);
        await saveUserSettings();
        renderRecurringChips();
    }
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

// --- Smart Intelligent Task Grouping (مجموعات دمج ذكية بالمعنى) ---
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

        let categoryCounts = {
            "📚 المذاكرة الجامعية": 0,
            "📖 القرآن والورد": 0,
            "🤲 الأذكار والأدعية": 0,
            "💻 لينكس والبرمجة": 0,
            "🏋️ الرياضة والجيم": 0
        };

        const promises = daysSnap.docs.map(doc => ({
