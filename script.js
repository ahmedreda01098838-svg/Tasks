// تهيئة Firebase
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

db.enablePersistence().catch((err) => {
  if (err.code == "failed-precondition")
    console.warn("حسابات متعددة مفتوحة، تم إلغاء التخزين المحلي مؤقتاً.");
});

let currentUser = null;
let activeListeners = {};
let globalStats = {};
let midnightTimer = null;

// تشغيل الـ init عند تحميل الكود مباشرة
init();

function init() {
  auth.onAuthStateChanged((user) => {
    const profileDiv = document.getElementById("user-profile");
    const addDayBtn = document.getElementById("add-day-btn");
    const dashboard = document.getElementById("dashboard-panel");
    const searchBar = document.getElementById("search-container");
    const container = document.getElementById("tasks-container");

    if (user) {
      currentUser = user;
      if (addDayBtn) addDayBtn.style.display = "flex";
      if (dashboard) dashboard.style.display = "flex";
      if (searchBar) searchBar.style.display = "block";

      if (profileDiv) {
        profileDiv.innerHTML = `
          <div class="user-info">
              <img src="${user.photoURL}" class="user-avatar" alt="avatar">
              <button onclick="logout()" class="logout-btn" title="تسجيل الخروج">🚪</button>
          </div>
        `;
      }

      // إضافة اليوم الحالي تلقائياً عند الدخول
      autoAddTodayIfMissing();
      scheduleMidnightAutoAdd();

      loadTasks();
    } else {
      currentUser = null;
      if (addDayBtn) addDayBtn.style.display = "none";
      if (dashboard) dashboard.style.display = "none";
      if (searchBar) searchBar.style.display = "none";
      
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

  window.addEventListener("focus", () => {
    if (currentUser) {
      autoAddTodayIfMissing();
    }
  });
}

function getFormattedDate(dateObj = new Date()) {
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  return dateObj.toLocaleDateString("ar-EG", options);
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
          createdAt: new Date().getTime(),
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
  auth
    .signInWithPopup(provider)
    .catch((err) => Swal.fire("خطأ", err.message, "error"));
}

function logout() {
  auth.signOut();
}

function addNewDay() {
  if (!currentUser) {
    Swal.fire("تنبيه", "يجب تسجيل الدخول أولاً لإضافة يوم جديد!", "warning");
    return;
  }

  const date = getFormattedDate();

  db.collection("task_days")
    .add({
      date: date,
      userId: currentUser.uid,
      createdAt: new Date().getTime(),
    })
    .catch((err) => {
      console.error("خطأ أثناء إضافة اليوم:", err);
      Swal.fire("خطأ في قاعدة البيانات", err.message, "error");
    });
}

function loadTasks() {
  const container = document.getElementById("tasks-container");
  if (!container || !currentUser) return;

  db.collection("task_days")
    .where("userId", "==", currentUser.uid)
    .orderBy("createdAt", "desc")
    .onSnapshot((snap) => {
      if (snap.empty) {
        container.innerHTML =
          '<p style="text-align:center; color: var(--text-muted); margin-top: 40px;">لا توجد أيام مضافة بعد.</p>';
        updateGlobalDashboard();
        return;
      }

      snap.docChanges().forEach((change) => {
        const dayId = change.doc.id;
        if (change.type === "added") {
          if (
            container.firstElementChild &&
            container.firstElementChild.tagName === "P"
          )
            container.innerHTML = "";
          renderDay(change.doc);
        } else if (change.type === "modified") {
          const titleElement = document.querySelector(
            `#card-${dayId} .day-header h3`
          );
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

function renderDay(doc) {
  const dayId = doc.id;
  const data = doc.data();
  const container = document.getElementById("tasks-container");

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
  
  container.appendChild(dayCard);
  loadItems(dayId);
}

function handleKeyPress(event, dayId) {
  if (event.key === "Enter") {
    addTask(dayId);
  }
}

function addTask(dayId) {
  const input = document.getElementById(`input-${dayId}`);
  const taskText = input.value.trim();

  if (taskText && currentUser) {
    db.collection("task_days").doc(dayId).collection("items").add({
      text: taskText,
      done: false,
      createdAt: new Date().getTime(),
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

      list.innerHTML = "";
      let doneCount = 0;

      snap.forEach((itemDoc) => {
        const item = itemDoc.data();
        if (item.done) doneCount++;

        list.innerHTML += `
                <div class="task-item ${item.done ? "done" : ""}" data-text="${item.text.toLowerCase()}">
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        <input type="checkbox" ${item.done ? "checked" : ""} 
                            onclick="toggleTask('${dayId}', '${itemDoc.id}', ${item.done})">
                        <span class="task-text" onclick="editTask('${dayId}', '${itemDoc.id}', '${item.text}')">${item.text}</span>
                    </div>
                    <button class="edit-task-btn" onclick="editTask('${dayId}', '${itemDoc.id}', '${item.text}')">✏️</button>
                    <button class="delete-task-btn" onclick="deleteSingleTask('${dayId}', '${itemDoc.id}')">✖</button>
                </div>`;
      });

      const progress = snap.size > 0 ? (doneCount / snap.size) * 100 : 0;
      bar.style.width = progress + "%";

      if (
        progress === 100 &&
        snap.size > 0 &&
        globalStats[dayId]?.completed !== doneCount
      ) {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      }

      globalStats[dayId] = { total: snap.size, completed: doneCount };
      updateGlobalDashboard();
    });
  activeListeners[dayId] = unsubscribe;
}

function updateGlobalDashboard() {
  let total = 0,
    completed = 0;
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
  db.collection("task_days")
    .doc(dayId)
    .collection("items")
    .doc(taskId)
    .update({ done: !currentStatus });
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
    db.collection("task_days")
      .doc(dayId)
      .collection("items")
      .doc(taskId)
      .update({ text: newText.trim() });
  }
}

function deleteSingleTask(dayId, taskId) {
  db.collection("task_days")
    .doc(dayId)
    .collection("items")
    .doc(taskId)
    .delete();
}

function filterTasks() {
  const query = document.getElementById("search-input").value.toLowerCase();
  const cards = document.querySelectorAll(".day-card");

  cards.forEach((card) => {
    const tasks = card.querySelectorAll(".task-item");
    const dateText = card
      .querySelector(".day-header h3")
      .textContent.toLowerCase();
    let matches = false;

    if (dateText.includes(query)) {
      matches = true;
    }

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
    const items = await db
      .collection("task_days")
      .doc(dayId)
      .collection("items")
      .get();
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
