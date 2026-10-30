// --- Firebase Config & Initialization ---
const firebaseConfig = {
    apiKey: "AIzaSyAyw4tZH8I85CsBKmdxK7ZYMDCBxDvCgPc",
    authDomain: "task-planner-app-f6e0e.firebaseapp.com",
    projectId: "task-planner-app-f6e0e",
    storageBucket: "task-planner-app-f6e0e.firebasestorage.app",
    messagingSenderId: "189812947761",
    appId: "1:189812947761:web:c8dd4c8cc3534e84a90e10",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === "failed-precondition") {
        console.warn("التخزين المحلي يعمل في تبويب آخر.");
    }
});

let currentUser = null;
let activeListeners = {};
let midnightTimer = null;
let lastVisibleDoc = null; 
const PAGE_SIZE = 10; 
let trackedKeywords = ["قران", "قرآن", "ذاكرت", "مذاكرة", "تمارين", "جيم"];

document.addEventListener("DOMContentLoaded", () => {
    initApp();
    initPrayerTimes();
});

function initApp() {
    auth.onAuthStateChanged((user) => {
        const profileDiv = document.getElementById("user-profile");
        const dashboard = document.getElementById("dashboard-panel");
        const trackerSec = document.getElementById("tracker-section");
        const searchBar = document.getElementById("search-container");
        const container = document.getElementById("tasks-container");
        const loadMoreBtn = document.getElementById("load-more-btn");

        if (user) {
            currentUser = user;
            if (dashboard) dashboard.style.display = "grid";
            if (trackerSec) trackerSec.style.display = "block";
            if (searchBar) searchBar.style.display = "block";

            if (profileDiv) {
                profileDiv.innerHTML = `
                    <div class="user-info">
                        <img src="${user.photoURL}" class="user-avatar" alt="avatar" loading="lazy">
                        <button onclick="logout()" class="logout-btn" title="تسجيل الخروج">🚪</button>
                    </div>
                `;
            }

            autoAddTodayIfMissing();
            scheduleMidnightAutoAdd();
            loadInitialTasks();
            calculateAdvancedStats();
        } else {
            currentUser = null;
            if (dashboard) dashboard.style.display = "none";
            if (trackerSec) trackerSec.style.display = "none";
            if (searchBar) searchBar.style.display = "none";
            if (loadMoreBtn) loadMoreBtn.style.display = "none";
            
            if (container) {
                container.innerHTML =
                    '<p class="loading-text">يرجى تسجيل الدخول أولاً لحفظ مهامك سحابياً.</p>';
            }

            if (profileDiv) {
                profileDiv.innerHTML = `<button onclick="login()" class="btn btn-primary">🔐 دخول بجوجل</button>`;
            }

            if (midnightTimer) clearTimeout(midnightTimer);
            Object.keys(activeListeners).forEach((id) => activeListeners[id]());
            activeListeners = {};
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && currentUser) {
            autoAddTodayIfMissing();
            scheduleMidnightAutoAdd();
        }
    });
}

// --- Date Formatting ---
function getFormattedDate(dateObj = new Date()) {
    return dateObj.toLocaleDateString("ar-EG", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function autoAddTodayIfMissing() {
    if (!currentUser) return;
    const todayFormatted = getFormattedDate();

    db.collection("task_days")
        .where("userId", "==", currentUser.uid)
        .where("date", "==", todayFormatted)
        .get()
        .then((snapshot) => {
            if (snapshot.empty) {
                db.collection("task_days").add({
                    date: todayFormatted,
                    userId: currentUser.uid,
                    createdAt: Date.now(),
                }).then(() => calculateAdvancedStats());
            }
        })
        .catch((err) => console.error("خطأ التثبت من اليوم الحالي:", err));
}

function scheduleMidnightAutoAdd() {
    if (midnightTimer) clearTimeout(midnightTimer);

    const now = new Date();
    const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0, 0, 1
    );
    const timeUntilMidnight = midnight.getTime() - now.getTime();

    midnightTimer = setTimeout(() => {
        autoAddTodayIfMissing();
        scheduleMidnightAutoAdd();
    }, timeUntilMidnight);
}

function login() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch((err) => Swal.fire("خطأ", err.message, "error"));
}

function logout() {
    auth.signOut();
}

// --- Stats & Keyword Analytics ---
async function calculateAdvancedStats() {
    if (!currentUser) return;

    try {
        const daysSnap = await db.collection("task_days")
            .where("userId", "==", currentUser.uid)
            .get();

        let totalTasks = 0;
        let completedTasks = 0;
        let weekCompleted = 0;
        let monthCompleted = 0;

        const now = Date.now();
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

        let keywordCounts = {};
        trackedKeywords.forEach(k => keywordCounts[k] = 0);

        const promises = daysSnap.docs.map(doc => {
            return {
                createdAt: doc.data().createdAt || 0,
                promise: db.collection("task_days").doc(doc.id).collection("items").get()
            };
        });

        const itemsSnapshots = await Promise.all(promises.map(p => p.promise));

        itemsSnapshots.forEach((snap, idx) => {
            const dayCreatedAt = promises[idx].createdAt;
            const isWithinWeek = (now - dayCreatedAt) <= SEVEN_DAYS_MS;
            const isWithinMonth = (now - dayCreatedAt) <= THIRTY_DAYS_MS;

            snap.forEach(itemDoc => {
                const itemData = itemDoc.data();
                totalTasks++;

                if (itemData.done) {
                    completedTasks++;
                    if (isWithinWeek) weekCompleted++;
                    if (isWithinMonth) monthCompleted++;

                    const textLower = (itemData.text || "").toLowerCase();
                    trackedKeywords.forEach(kw => {
                        if (textLower.includes(kw.toLowerCase())) {
                            keywordCounts[kw]++;
                        }
                    });
                }
            });
        });

        const totalEl = document.getElementById("stat-total");
        const weekEl = document.getElementById("stat-week");
        const monthEl = document.getElementById("stat-month");
        const ratioEl = document.getElementById("stat-ratio");

        if (totalEl) totalEl.textContent = completedTasks;
        if (weekEl) weekEl.textContent = weekCompleted;
        if (monthEl) monthEl.textContent = monthCompleted;
        if (ratioEl) ratioEl.textContent = totalTasks === 0 ? "0%" : Math.round((completedTasks / totalTasks) * 100) + "%";

        renderTrackerChips(keywordCounts);

    } catch (err) {
        console.error("خطأ في حساب الإحصائيات الشاملة:", err);
    }
}

function renderTrackerChips(counts) {
    const container = document.getElementById("tracker-chips");
    if (!container) return;
    container.innerHTML = "";

    Object.keys(counts).forEach(kw => {
        const chip = document.createElement("div");
        chip.className = "tracker-chip";
        chip.innerHTML = `
            <span>${kw}</span>
            <span class="count">${counts[kw]} مرة</span>
        `;
        container.appendChild(chip);
    });
}

function addKeywordTracker() {
    const input = document.getElementById("tracker-input");
    const val = input.value.trim();
    if (val && !trackedKeywords.includes(val)) {
        trackedKeywords.push(val);
        input.value = "";
        calculateAdvancedStats();
    }
}

// --- Task List Functions ---
function loadInitialTasks() {
    const container = document.getElementById("tasks-container");
    const loadMoreBtn = document.getElementById("load-more-btn");
    if (!container || !currentUser) return;

    db.collection("task_days")
        .where("userId", "==", currentUser.uid)
        .orderBy("createdAt", "desc")
        .limit(PAGE_SIZE)
        .onSnapshot((snap) => {
            const loadingSpinner = document.getElementById("loading-spinner");
            if (loadingSpinner) loadingSpinner.remove();

            if (snap.empty) {
                container.innerHTML =
                    '<p class="loading-text">لا توجد أيام مضافة بعد.</p>';
                if (loadMoreBtn) loadMoreBtn.style.display = "none";
                return;
            }

            lastVisibleDoc = snap.docs[snap.docs.length - 1];

            if (loadMoreBtn) {
                loadMoreBtn.style.display = snap.docs.length >= PAGE_SIZE ? "block" : "none";
            }

            snap.docChanges().forEach((change) => {
                const dayId = change.doc.id;
                
                if (change.type === "added") {
                    renderDay(change.doc, change.newIndex);
                } else if (change.type === "modified") {
                    const titleElement = document.querySelector(`#card-${dayId} .day-header h3`);
                    if (titleElement) titleElement.textContent = `📅 ${change.doc.data().date}`;
                } else if (change.type === "removed") {
                    const card = document.getElementById(`card-${dayId}`);
                    if (card) card.remove();
                    if (activeListeners[dayId]) {
                        activeListeners[dayId]();
                        delete activeListeners[dayId];
                    }
                    calculateAdvancedStats();
                }
            });
        });
}

function loadMoreTasks() {
    if (!lastVisibleDoc || !currentUser) return;

    const loadMoreBtn = document.getElementById("load-more-btn");
    if (loadMoreBtn) loadMoreBtn.textContent = "جاري التحميل...";

    db.collection("task_days")
        .where("userId", "==", currentUser.uid)
        .orderBy("createdAt", "desc")
        .startAfter(lastVisibleDoc)
        .limit(PAGE_SIZE)
        .get()
        .then((snap) => {
            if (snap.empty) {
                if (loadMoreBtn) loadMoreBtn.style.display = "none";
                return;
            }

            lastVisibleDoc = snap.docs[snap.docs.length - 1];

            snap.docs.forEach((doc) => {
                renderDay(doc, -1);
            });

            if (loadMoreBtn) {
                loadMoreBtn.textContent = "📥 عرض الأيام السابقة";
                loadMoreBtn.style.display = snap.docs.length >= PAGE_SIZE ? "block" : "none";
            }
        })
        .catch((err) => {
            console.error("خطأ في تحميل الأيام القديمة:", err);
            if (loadMoreBtn) loadMoreBtn.textContent = "📥 عرض الأيام السابقة";
        });
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
        <div class="progress-container">
            <div class="progress-bar" id="bar-${dayId}"></div>
        </div>
        <div id="list-${dayId}"></div>
        <div class="input-group">
            <input type="text" id="input-${dayId}" placeholder="اكتب مهمة جديدة..." onkeypress="handleKeyPress(event, '${dayId}')">
            <button class="btn btn-primary" onclick="addTask('${dayId}')">➕ إدراج</button>
        </div>
    `;

    const existingChildren = container.children;
    if (targetIndex === -1 || targetIndex >= existingChildren.length) {
        container.appendChild(dayCard);
    } else {
        container.insertBefore(dayCard, existingChildren[targetIndex]);
    }

    loadItems(dayId);
}

function handleKeyPress(event, dayId) {
    if (event.key === "Enter") addTask(dayId);
}

function addTask(dayId) {
    const input = document.getElementById(`input-${dayId}`);
    const taskText = input.value.trim();

    if (taskText && currentUser) {
        db.collection("task_days").doc(dayId).collection("items").add({
            text: taskText,
            done: false,
            createdAt: Date.now(),
        }).then(() => {
            calculateAdvancedStats();
        });
        input.value = "";
    }
}

function loadItems(dayId) {
    if (activeListeners[dayId]) activeListeners[dayId]();

    const unsubscribe = db
        .collection("task_days")
        .doc(dayId)
        .collection("items")
        .orderBy("createdAt", "asc")
        .onSnapshot((snap) => {
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
                itemDiv.setAttribute("data-text", item.text.toLowerCase());
                itemDiv.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        <input type="checkbox" ${item.done ? "checked" : ""} 
                            onclick="toggleTask('${dayId}', '${itemDoc.id}', ${item.done})">
                        <span class="task-text" onclick="editTask('${dayId}', '${itemDoc.id}', '${item.text.replace(/'/g, "\\'")}')">${item.text}</span>
                    </div>
                    <button class="edit-task-btn" onclick="editTask('${dayId}', '${itemDoc.id}', '${item.text.replace(/'/g, "\\'")}')">✏️</button>
                    <button class="delete-task-btn" onclick="deleteSingleTask('${dayId}', '${itemDoc.id}')">✖</button>
                `;
                fragment.appendChild(itemDiv);
            });

            list.innerHTML = "";
            list.appendChild(fragment);

            const progress = snap.size > 0 ? (doneCount / snap.size) * 100 : 0;
            bar.style.width = progress + "%";

            if (progress === 100 && snap.size > 0) {
                if (typeof confetti === "function") {
                    confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
                }
            }
        });

    activeListeners[dayId] = unsubscribe;
}

function toggleTask(dayId, taskId, currentStatus) {
    db.collection("task_days").doc(dayId).collection("items").doc(taskId).update({ 
        done: !currentStatus 
    }).then(() => {
        calculateAdvancedStats();
    });
}

async function editTask(dayId, taskId, currentText) {
    const { value: newText } = await Swal.fire({
        title: "تعديل المهمة",
        input: "text",
        inputValue: currentText,
        showCancelButton: true,
        confirmButtonText: "حفظ التعديل",
        cancelButtonText: "إلغاء",
    });

    if (newText && newText.trim() !== currentText) {
        db.collection("task_days").doc(dayId).collection("items").doc(taskId).update({ text: newText.trim() });
    }
}

function deleteSingleTask(dayId, taskId) {
    db.collection("task_days").doc(dayId).collection("items").doc(taskId).delete().then(() => {
        calculateAdvancedStats();
    });
}

function filterTasks() {
    const query = document.getElementById("search-input").value.toLowerCase();
    const cards = document.querySelectorAll(".day-card");

    cards.forEach((card) => {
        const tasks = card.querySelectorAll(".task-item");
        const dateText = card.querySelector(".day-header h3").textContent.toLowerCase();
        let matches = dateText.includes(query);

        tasks.forEach((task) => {
            const text = task.getAttribute("data-text");
            if (text.includes(query)) {
                task.style.display = "flex";
                matches = true;
            } else {
                task.style.display = "none";
            }
        });

        card.style.display = matches ? "block" : "none";
        if (query === "") tasks.forEach((t) => (t.style.display = "flex"));
    });
}

async function deleteDay(dayId) {
    const result = await Swal.fire({
        title: "حذف اليوم؟",
        text: "سيتم مسح جميع المهام المسجلة في هذا اليوم!",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#ef4444",
        confirmButtonText: "نعم، حذف",
        cancelButtonText: "إلغاء",
    });

    if (result.isConfirmed) {
        const items = await db.collection("task_days").doc(dayId).collection("items").get();
        const batch = db.batch();
        items.forEach((i) => batch.delete(i.ref));
        await batch.commit();
        await db.collection("task_days").doc(dayId).delete();
        calculateAdvancedStats();
        Swal.fire("تم!", "تم حذف اليوم بنجاح.", "success");
    }
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// --- Prayer Times Engine ---
function initPrayerTimes() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => fetchPrayerTimes(pos.coords.latitude, pos.coords.longitude),
            () => fetchPrayerTimesByIP()
        );
    } else {
        fetchPrayerTimesByIP();
    }
}

function fetchPrayerTimesByIP() {
    document.getElementById("prayer-city").textContent = "القاهرة";
    fetchPrayerTimes(30.0444, 31.2357);
}

async function fetchPrayerTimes(lat, lng) {
    try {
        const res = await fetch(`https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=5`);
        const data = await res.json();
        if (data && data.data) {
            const timings = data.data.timings;
            const dateInfo = data.data.date;

            document.getElementById("t-Fajr").textContent = formatTime12(timings.Fajr);
            document.getElementById("t-Dhuhr").textContent = formatTime12(timings.Dhuhr);
            document.getElementById("t-Asr").textContent = formatTime12(timings.Asr);
            document.getElementById("t-Maghrib").textContent = formatTime12(timings.Maghrib);
            document.getElementById("t-Isha").textContent = formatTime12(timings.Isha);

            document.getElementById("prayer-date").textContent = `${dateInfo.hijri.day} ${dateInfo.hijri.month.ar} ${dateInfo.hijri.year} هـ`;
            if (data.data.meta && data.data.meta.timezone) {
                document.getElementById("prayer-city").textContent = data.data.meta.timezone.split('/')[1] || "موقعك الحالي";
            }

            highlightNextPrayer(timings);
        }
    } catch (e) {
        console.error("خطأ في جلب مواقيت الصلاة:", e);
    }
}

function formatTime12(time24) {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'م' : 'ص';
    const h12 = h % 12 || 12;
    return `${h12}:${m < 10 ? '0' : ''}${m} ${period}`;
}

function highlightNextPrayer(timings) {
    const prayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    let nextPrayer = 'Fajr';
    for (let p of prayers) {
        const [h, m] = timings[p].split(':').map(Number);
        if (h * 60 + m > currentMins) {
            nextPrayer = p;
            break;
        }
    }

    prayers.forEach(p => {
        const card = document.getElementById(`p-${p}`);
        if (card) card.classList.remove('active');
    });

    const activeCard = document.getElementById(`p-${nextPrayer}`);
    if (activeCard) activeCard.classList.add('active');
}
