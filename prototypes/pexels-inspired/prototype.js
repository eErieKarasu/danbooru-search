"use strict";

// This prototype uses original local artwork, independent of the production API.
const works = [
  { id: 1, title: "云与山之间", width: 640, height: 880, tags: ["scenery", "landscape", "mountain", "sky", "river"], score: 98 },
  { id: 2, title: "沿着海岸线", width: 800, height: 580, tags: ["scenery", "landscape", "ocean", "coast", "sky", "light"], score: 96 },
  { id: 3, title: "山眠于月色", width: 640, height: 790, tags: ["scenery", "landscape", "mountain", "night", "moon", "sky"], score: 94 },
  { id: 4, title: "风穿过麦田", width: 640, height: 920, tags: ["scenery", "landscape", "field", "light", "sky"], score: 92 },
  { id: 5, title: "一片云的旅行", width: 640, height: 720, tags: ["scenery", "cloud", "sky", "light"], score: 90 },
  { id: 6, title: "沙丘的呼吸", width: 800, height: 600, tags: ["scenery", "landscape", "desert", "light", "sky"], score: 88 },
  { id: 7, title: "慢慢靠近海", width: 640, height: 880, tags: ["scenery", "landscape", "ocean", "coast", "sky", "light"], score: 86 },
  { id: 8, title: "远处有青山", width: 640, height: 680, tags: ["scenery", "landscape", "mountain", "forest", "sky"], score: 84 },
  { id: 9, title: "今夜，山河无声", width: 640, height: 900, tags: ["scenery", "landscape", "mountain", "night", "moon", "sky"], score: 82 },
  { id: 10, title: "晴日里的来信", width: 800, height: 600, tags: ["scenery", "landscape", "field", "light", "sky"], score: 80 },
  { id: 11, title: "天空留了白", width: 640, height: 840, tags: ["scenery", "cloud", "sky", "light"], score: 78 },
  { id: 12, title: "日落以前", width: 640, height: 760, tags: ["scenery", "landscape", "desert", "light", "sky"], score: 76 },
];
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const favoritesKey = "danbooru-pexels-prototype-favorites-v1";
const preferencesKey = "danbooru-pexels-prototype-preferences-v1";
function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
const storedFavorites = readStorage(favoritesKey, []);
const favorites = new Set(Array.isArray(storedFavorites) ? storedFavorites.filter((id) => works.some((work) => work.id === id)) : []);
const savedPreferences = readStorage(preferencesKey, {});
const preferences = {
  compact: savedPreferences?.compact === true,
  captions: savedPreferences?.captions !== false,
};
const state = { view: "discover", query: [], rating: "all", aspect: "all", sort: "popular" };
const aliases = { 风景: "scenery", 天空: "sky", 海边: "ocean", 夜色: "night", 山: "mountain", 森林: "forest", 云: "cloud", 麦田: "field", 沙漠: "desert" };
let visibleWorks = [];
let previewId = null;
let toastTimer;
let layoutFrame;

function artworkPath(work) { return `assets/scene-${String(work.id).padStart(2, "0")}.svg`; }
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}
function notify(message) {
  clearTimeout(toastTimer);
  $("#toast span").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 2400);
}
function saveStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
function syncFavorites() {
  $$(".favorite-count").forEach((node) => { node.textContent = favorites.size; });
  $$(".save-button").forEach((button) => {
    const saved = favorites.has(Number(button.dataset.id));
    button.setAttribute("aria-pressed", String(saved));
    button.setAttribute("aria-label", `${saved ? "取消收藏" : "收藏"}：${works.find((work) => work.id === Number(button.dataset.id)).title}`);
  });
  if (previewId !== null) {
    const saved = favorites.has(previewId);
    $("#previewFavorite").setAttribute("aria-pressed", String(saved));
    $("#previewFavorite span").textContent = saved ? "已收藏 · 点击取消" : "收藏作品";
  }
}
function toggleFavorite(id) {
  const wasSaved = favorites.has(id);
  if (wasSaved) favorites.delete(id); else favorites.add(id);
  const persisted = saveStorage(favoritesKey, [...favorites]);
  syncFavorites();
  if (state.view === "favorites") {
    const index = visibleWorks.findIndex((work) => work.id === id);
    render();
    if ($("#preview").open && !visibleWorks.some((work) => work.id === previewId)) {
      if (visibleWorks.length) openPreview(visibleWorks[Math.min(index, visibleWorks.length - 1)].id);
      else $("#preview").close();
    }
  }
  notify(`${wasSaved ? "已移出收藏" : "已加入我的收藏"}${persisted ? "" : "（仅本次有效）"}`);
}
function columnCount() {
  const base = matchMedia("(max-width: 700px)").matches ? 2 : matchMedia("(max-width: 1050px)").matches ? 3 : 4;
  return base + (preferences.compact ? 1 : 0);
}
function createCard(work) {
  const card = document.createElement("article");
  card.className = "post-card";
  const frame = document.createElement("div");
  frame.className = "art-frame";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "art-button";
  button.setAttribute("aria-label", `预览：${work.title}`);
  button.addEventListener("click", () => openPreview(work.id));
  const image = document.createElement("img");
  Object.assign(image, { src: artworkPath(work), alt: work.title, width: work.width, height: work.height, loading: "lazy", decoding: "async" });
  image.addEventListener("error", () => {
    frame.classList.add("image-failed");
    image.hidden = true;
    const errorCopy = document.createElement("span");
    errorCopy.className = "image-error-copy";
    errorCopy.textContent = "图片未能加载 · 点击查看详情";
    button.append(errorCopy);
  }, { once: true });
  const overlay = document.createElement("span");
  overlay.className = "art-overlay";
  overlay.textContent = `${work.tags.slice(0, 2).join(" / ")}  ↗`;
  button.append(image, overlay);
  const save = document.createElement("button");
  save.type = "button";
  save.className = "save-button";
  save.dataset.id = work.id;
  save.append(icon("heart"));
  save.addEventListener("click", () => toggleFavorite(work.id));
  frame.append(button, save);
  const caption = document.createElement("div");
  caption.className = "post-caption";
  const title = document.createElement("h3");
  title.textContent = work.title;
  const label = document.createElement("span");
  label.textContent = `G / ${String(work.id).padStart(3, "0")}`;
  caption.append(title, label);
  card.append(frame, caption);
  return card;
}
function renderChips() {
  $("#queryChips").replaceChildren();
  $("#queryChips").hidden = !state.query.length;
  state.query.forEach((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "query-chip";
    chip.textContent = tag;
    chip.setAttribute("aria-label", `移除标签 ${tag}`);
    chip.append(icon("close"));
    chip.addEventListener("click", () => {
      state.query = state.query.filter((item) => item !== tag);
      $("#query").value = state.query.join(" ");
      render();
    });
    $("#queryChips").append(chip);
  });
}
function render() {
  visibleWorks = works.filter((work) =>
    (state.view !== "favorites" || favorites.has(work.id)) &&
    (state.rating === "all" || state.rating === "g") &&
    (state.aspect === "all" || (state.aspect === "portrait" ? work.height > work.width : work.width > work.height)) &&
    state.query.every((query) => {
      const negative = query.startsWith("-");
      const raw = negative ? query.slice(1) : query;
      const tag = aliases[raw] || raw;
      const matches = work.tags.some((item) => item.includes(tag)) || work.title.includes(tag);
      return negative ? !matches : matches;
    })
  ).sort((a, b) => state.sort === "latest" ? b.id - a.id : state.sort === "oldest" ? a.id - b.id : b.score - a.score);

  $("#gallery").replaceChildren();
  const count = columnCount();
  $("#gallery").style.gridTemplateColumns = `repeat(${count}, minmax(0, 1fr))`;
  const heights = Array(count).fill(0);
  const columns = Array.from({ length: count }, () => {
    const column = document.createElement("div");
    column.className = "gallery-column";
    $("#gallery").append(column);
    return column;
  });
  visibleWorks.forEach((work) => {
    const index = heights.indexOf(Math.min(...heights));
    columns[index].append(createCard(work));
    heights[index] += work.height / work.width + (preferences.captions ? .18 : .07);
  });
  $("#gallery").setAttribute("aria-busy", "false");
  $("#resultCount").textContent = `${visibleWorks.length} 幅作品`;
  $("#galleryTitle").textContent = state.view === "favorites" ? "我的收藏" : state.query.length ? "搜索结果" : state.view === "latest" ? "新鲜灵感" : "发现好作品";
  $("#emptyState").hidden = visibleWorks.length > 0;
  const favoritesEmpty = state.view === "favorites" && favorites.size === 0;
  $("#emptyTitle").textContent = favoritesEmpty ? "喜欢的画面，留在这里" : "暂时没有找到作品";
  $("#emptyCopy").textContent = favoritesEmpty ? "点击图片上的爱心，建立自己的灵感收藏。" : state.rating !== "all" && state.rating !== "g" ? "示例图库均为 G 安全评级，试试其他筛选条件。" : "试试 scenery、sky、ocean，或调整筛选条件。";
  $(".gallery-end").hidden = visibleWorks.length === 0;
  $("#resetFilters").hidden = state.rating === "all" && state.aspect === "all" && !state.query.length;
  $$("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#sort").value = state.sort;
  renderChips();
  syncFavorites();
}
function search(query) {
  state.query = [...new Set(query.trim().toLowerCase().split(/[\s,，]+/).filter(Boolean))];
  state.view = "discover";
  $("#query").value = state.query.join(" ");
  render();
}
function goToGallery() { $(".browse").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); }
function setView(view) {
  state.view = view;
  state.query = [];
  state.rating = "all";
  state.aspect = "all";
  state.sort = view === "latest" ? "latest" : "popular";
  $("#query").value = "";
  $("#rating").value = "all";
  $("#aspect").value = "all";
  render();
}
function openPreview(id) {
  const work = works.find((item) => item.id === id);
  if (!work) return;
  previewId = id;
  $("#previewImage").src = artworkPath(work);
  $("#previewImage").alt = work.title;
  $("#previewTitle").textContent = work.title;
  $("#previewAspect").textContent = `${work.width} × ${work.height} · ${work.width > work.height ? "横图" : "竖图"}`;
  $("#previewId").textContent = `DEMO-${String(id).padStart(3, "0")}`;
  const position = visibleWorks.findIndex((item) => item.id === id);
  $("#previewPosition").textContent = `${position + 1} / ${visibleWorks.length} · 使用 ← → 切换作品`;
  $("#prevImage").disabled = position <= 0;
  $("#nextImage").disabled = position >= visibleWorks.length - 1;
  $("#previewTags").replaceChildren();
  work.tags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    button.setAttribute("aria-label", `搜索标签 ${tag}`);
    button.addEventListener("click", () => { $("#preview").close(); search(tag); goToGallery(); });
    $("#previewTags").append(button);
  });
  syncFavorites();
  if (!$("#preview").open) $("#preview").showModal();
}
function movePreview(direction) {
  const index = visibleWorks.findIndex((work) => work.id === previewId);
  if (index >= 0 && visibleWorks[index + direction]) openPreview(visibleWorks[index + direction].id);
}
function applyPreferences() {
  document.body.classList.toggle("hide-captions", !preferences.captions);
  $("#density").value = preferences.compact ? "compact" : "comfortable";
  $("#showCaptions").checked = preferences.captions;
  $("#densityButton").setAttribute("aria-pressed", String(preferences.compact));
  $("#densityButton").setAttribute("aria-label", `切换为${preferences.compact ? "舒适" : "紧凑"}布局`);
  if (!saveStorage(preferencesKey, preferences)) notify("偏好仅在本次浏览生效");
  render();
}

$("#searchForm").addEventListener("submit", (event) => { event.preventDefault(); search($("#query").value); goToGallery(); });
// Native search clear button also resets applied search tags.
$("#query").addEventListener("input", () => { if (!$("#query").value && state.query.length) search(""); });
$$("[data-query]").forEach((button) => button.addEventListener("click", () => { search(button.dataset.query); goToGallery(); }));
$$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$$("[data-nav]").forEach((button) => button.addEventListener("click", () => { setView(button.dataset.nav); goToGallery(); }));
$("#focusSearch").addEventListener("click", () => {
  $("#query").focus({ preventScroll: true });
  $(".intro").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
});
["rating", "aspect", "sort"].forEach((key) => $("#" + key).addEventListener("change", (event) => { state[key] = event.target.value; render(); }));
$("#resetFilters").addEventListener("click", () => { const view = state.view; setView(view); });
$("#emptyReset").addEventListener("click", () => setView("discover"));
$("#closePreview").addEventListener("click", () => $("#preview").close());
$("#preview").addEventListener("close", () => { previewId = null; });
$("#previewFavorite").addEventListener("click", () => { if (previewId !== null) toggleFavorite(previewId); });
$("#prevImage").addEventListener("click", () => movePreview(-1));
$("#nextImage").addEventListener("click", () => movePreview(1));
$("#preview").addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); movePreview(event.key === "ArrowRight" ? 1 : -1); }
});
$("#settingsButton").addEventListener("click", () => $("#settings").showModal());
$("#closeSettings").addEventListener("click", () => $("#settings").close());
$("#doneSettings").addEventListener("click", () => $("#settings").close());
$("#density").addEventListener("change", (event) => { preferences.compact = event.target.value === "compact"; applyPreferences(); });
$("#showCaptions").addEventListener("change", (event) => { preferences.captions = event.target.checked; applyPreferences(); });
$("#densityButton").addEventListener("click", () => { preferences.compact = !preferences.compact; applyPreferences(); });
window.addEventListener("resize", () => { cancelAnimationFrame(layoutFrame); layoutFrame = requestAnimationFrame(render); });
// Render a local skeleton for the initial frame; there is no simulated network wait.
$("#gallery").setAttribute("aria-busy", "true");
for (let index = 0; index < columnCount(); index++) {
  const skeleton = document.createElement("div");
  skeleton.className = "skeleton";
  skeleton.style.aspectRatio = index % 2 ? ".9" : ".72";
  $("#gallery").append(skeleton);
}
requestAnimationFrame(applyPreferences);
