// ─── AUTH ───────────────────────────

function getCurrentUser() {
  const u = localStorage.getItem("fractureai_user");
  return u ? JSON.parse(u) : null;
}

function setCurrentUser(user) {
  localStorage.setItem("fractureai_user", JSON.stringify(user));
}

function logout() {
  localStorage.removeItem("fractureai_user");
  window.location.href = "index.html";
}

function getUsers() {
  const u = localStorage.getItem("fractureai_users");
  return u ? JSON.parse(u) : {};
}

function saveUsers(users) {
  localStorage.setItem("fractureai_users", JSON.stringify(users));
}

function signup(name, email, password) {
  const users = getUsers();
  if (users[email]) return { ok: false, error: "An account already exists." };

  users[email] = { name, email, password: btoa(password) };
  saveUsers(users);

  return { ok: true };
}

function login(email, password) {
  const users = getUsers();
  const user = users[email];

  if (!user) return { ok: false, error: "No account found." };
  if (user.password !== btoa(password)) return { ok: false, error: "Wrong password." };

  setCurrentUser({ name: user.name, email });
  return { ok: true };
}

// ─── INDEXEDDB HISTORY (NEW) ───────────────────────────────────────

const DB_NAME = "fractureai_db";
const DB_VERSION = 1;
const STORE_NAME = "history";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true
        });

        store.createIndex("email", "email", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── ADD ENTRY ─────────────────────────────────────────────────────
async function addHistoryEntry(email, entry) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  store.add({ email, ...entry });
}

// ─── GET HISTORY ───────────────────────────────────────────────────
async function getHistory(email) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const index = store.index("email");

  const req = index.getAll(email);

  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror = () => reject(req.error);
  });
}

// ─── DELETE ONE ────────────────────────────────────────────────────
async function deleteHistoryEntry(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  store.delete(id);
}

// ─── CLEAR ALL ─────────────────────────────────────────────────────
async function clearAllHistory(email) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const index = store.index("email");

  const req = index.getAll(email);

  req.onsuccess = () => {
    req.result.forEach(item => {
      store.delete(item.id);
    });
  };
}

// ─── NAVBAR (KEEP YOUR ORIGINAL) ───────────────────────────────────
function updateNavbar() {
  const user = getCurrentUser();
  const navLinks = document.querySelector(".nav-links");
  const navRight = document.querySelector(".nav-right");
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  if (!navLinks) return;

  document.querySelectorAll(".nav-auth").forEach(el => el.remove());

  if (user) {
    const historyItem = document.createElement("li");
    historyItem.className = "nav-auth";

    const historyLink = document.createElement("a");
    historyLink.href = "history.html";
    historyLink.textContent = "History";
    if (currentPage === "history.html") {
      historyLink.classList.add("active");
    }

    historyItem.appendChild(historyLink);
    navLinks.appendChild(historyItem);

    if (navRight) {
      const userLabel = document.createElement("span");
      userLabel.className = "nav-auth nav-user";
      userLabel.textContent = user.name;

      const logoutBtn = document.createElement("button");
      logoutBtn.className = "nav-auth btn-logout";
      logoutBtn.type = "button";
      logoutBtn.textContent = "Logout";
      logoutBtn.onclick = logout;

      navRight.prepend(logoutBtn);
      navRight.prepend(userLabel);
    }
  } else if (navRight) {
    const loginLink = document.createElement("a");
    loginLink.className = "nav-auth nav-login";
    loginLink.href = "login.html";
    loginLink.textContent = "Login";

    const signupLink = document.createElement("a");
    signupLink.className = "nav-auth btn-signup";
    signupLink.href = "signup.html";
    signupLink.textContent = "Sign Up";

    navRight.prepend(signupLink);
    navRight.prepend(loginLink);
  }
}

document.addEventListener("DOMContentLoaded", updateNavbar);
