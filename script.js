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
let globalStats = {};
let midnightTimer = null;

let lastVisibleDoc = null; // يحفظ آخر يوم تم تحميله للبدء منه في التحميل القادم
const PAGE_SIZE = 10;      // عدد الأيام في كل دفعة

document.addEventListener("DOMContentLoaded", init);

function init() {
  auth.onAuthStateChanged((user) => {
    const profileDiv = document.getElementById("user-profile");
    const dashboard = document.getElementById("dashboard-panel");
    const searchBar = document.getElementById("search-container");
    const container = document.getElementById("tasks-container");
    const loadMoreBtn = document.getElementById("load-more-btn");

    if (user) {
      currentUser = user;
      if (dashboard) dashboard.style.display = "flex";
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
    } else {
      currentUser = null;
      if (dashboard) dashboard.style.display = "none";
      if (searchBar) searchBar.style.display = "none";
      if (loadMoreBtn) loadMoreBtn.style.display = "none";
      
      if (container) {
        container.innerHTML =
          '<p style="text-align:center; color: var(--text-muted); margin-top: 40px;">يرجى تسجيل الدخول أولاً لحفظ مهامك سحابياً.</p>';
      }

      if (profileDiv) {
        profileDiv.innerHTML = `<button onclick="login()" class="login-btn">🔐 دخول بجوجل</button>`;
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
        });
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

// تحميل أول دفعة من الأيام (الأحدث)
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
          '<p style="text-align:center; color: var(--text-muted); margin-top: 40px;">لا توجد أيام مضافة بعد.</p>';
        updateGlobalDashboard();
        if (loadMoreBtn) loadMoreBtn.style.display = "none";
        return;
      }

      lastVisibleDoc = snap.docs[snap.docs.length - 1];

      // إظهار زر تحميل المزيد لو عدد الأيام بيساوي الحد الأقصى للدفعة
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
          delete globalStats[dayId];
          updateGlobalDashboard();
        }
      });
    });
}

// تحميل الدفعة التالية (الأيام الأقدم) عند الضغط على الزر
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
        renderDay(doc, -1); // -1 تعني إضافته في القاع (تحت خالص)
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
            <button class="add-task-btn" onclick="addTask('${dayId}')">➕ إدراج</button>
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

      if (progress === 100 && snap.size > 0 && globalStats[dayId]?.completed !== doneCount) {
        if (typeof confetti === "function") {
          confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        }
      }

      globalStats[dayId] = { total: snap.size, completed: doneCount };
      updateGlobalDashboard();
    });

  activeListeners[dayId] = unsubscribe;
}

function updateGlobalDashboard() {
  let total = 0, completed = 0;
  Object.values(globalStats).forEach((stat) => {
    total += stat.total || 0;
    completed += stat.completed || 0;
  });

  const totalEl = document.getElementById("stat-total");
  const compEl = document.getElementById("stat-completed");
  const ratioEl = document.getElementById("stat-ratio");

  if (totalEl) totalEl.textContent = total;
  if (compEl) compEl.textContent = completed;
  if (ratioEl) ratioEl.textContent = total === 0 ? "0%" : Math.round((completed / total) * 100) + "%";
}

function toggleTask(dayId, taskId, currentStatus) {
  db.collection("task_days").doc(dayId).collection("items").doc(taskId).update({ done: !currentStatus });
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
  db.collection("task_days").doc(dayId).collection("items").doc(taskId).delete();
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
    Swal.fire("تم!", "تم حذف اليوم بنجاح.", "success");
  }
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}
