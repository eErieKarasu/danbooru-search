const DANBOORU_BASE_URL = "https://danbooru.donmai.us";
const RETRY_SLEEP_MS = 1400;
const REQUEST_SLEEP_MS = 700;
const MAX_RETRIES = 3;
const HISTORY_KEY = "danbooru-search-history";
const FAVORITES_KEY = "danbooru-search-favorites";
const SETTINGS_KEY = "danbooru-search-settings";
const MAX_HISTORY_ITEMS = 15;
const DEFAULT_MAX_REMOTE_TAGS = 2;
const DEFAULT_RATING = "any";
const REMOTE_FETCH_LIMIT = 100;
const DEFAULT_TARGET_POSTS = 200;
const DEFAULT_HOME_TAGS = ["order:rank"];
const DEFAULT_DENSITY = "comfortable";

const appShell = document.querySelector("#appShell");
const navButtons = document.querySelectorAll("[data-view-button]");
const viewPanels = document.querySelectorAll("[data-view-panel]");
const gallerySurface = document.querySelector("#gallerySurface");
const settingsSurface = document.querySelector("#settingsSurface");
const searchForm = document.querySelector("#searchForm");
const tagInput = document.querySelector("#tagInput");
const selectedTagsBox = document.querySelector("#selectedTags");
const countInput = document.querySelector("#countInput");
const settingsCountInput = document.querySelector("#settingsCountInput");
const settingsRatingSelect = document.querySelector("#settingsRatingSelect");
const settingsSortSelect = document.querySelector("#settingsSortSelect");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const searchButton = document.querySelector("#searchButton");
const stopSearchButton = document.querySelector("#stopSearchButton");
const clearButton = document.querySelector("#clearButton");
const showFavoritesButton = document.querySelector("#showFavoritesButton");
const favoriteSummary = document.querySelector("#favoriteSummary");
const clearHistoryButton = document.querySelector("#clearHistoryButton");
const currentTags = document.querySelector("#currentTags");
const progressBar = document.querySelector("#progressBar");
const statusText = document.querySelector("#statusText");
const resultCount = document.querySelector("#resultCount");
const noticeBox = document.querySelector("#noticeBox");
const emptyState = document.querySelector("#emptyState");
const emptyStateIcon = emptyState.querySelector(".empty-search-line .search-glyph");
const emptyStateTitle = emptyState.querySelector(".empty-copy p");
const emptyStateDescription = emptyState.querySelector(".empty-copy span");
const gallery = document.querySelector("#gallery");
const postTemplate = document.querySelector("#postTemplate");
const historyList = document.querySelector("#historyList");
const previewDialog = document.querySelector("#previewDialog");
const closeDialogButton = document.querySelector("#closeDialogButton");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogImage = document.querySelector("#dialogImage");
const dialogRatingBadge = document.querySelector("#dialogRatingBadge");
const dialogFavoriteButton = document.querySelector("#dialogFavoriteButton");
const dialogScorePill = document.querySelector("#dialogScorePill");
const dialogRatingText = document.querySelector("#dialogRatingText");
const dialogTags = document.querySelector("#dialogTags");
const dialogDimensions = document.querySelector("#dialogDimensions");
const dialogSize = document.querySelector("#dialogSize");
const dialogPostLink = document.querySelector("#dialogPostLink");
const dialogFileLink = document.querySelector("#dialogFileLink");
const dialogPosition = document.querySelector("#dialogPosition");
const dialogPrevButton = document.querySelector("#dialogPrevButton");
const dialogNextButton = document.querySelector("#dialogNextButton");
const inspectorMode = document.querySelector("#inspectorMode");
const inspectorResultCount = document.querySelector("#inspectorResultCount");
const inspectorFavoriteCount = document.querySelector("#inspectorFavoriteCount");
const inspectorTags = document.querySelector("#inspectorTags");
const mobileGalleryQuery = window.matchMedia("(max-width: 820px)");
const mobileFilterQuery = window.matchMedia("(max-width: 900px)");

let activeController = null;
let selectedTags = [];
let allPosts = [];
let homePostsCache = [];
let searchPostsCache = [];
let favoritePosts = new Map();
let currentView = "home";
let isFavoritesView = false;
let activePreviewIndex = -1;
let activePreviewPost = null;
let previewScrollY = 0;
let defaultRating = DEFAULT_RATING;
let filterState = {
  rating: "any",
  aspect: "all",
  size: "all",
  sort: "relevance",
};

const RATING_LABELS = {
  g: "G 安全",
  s: "S 敏感",
  q: "Q 边缘",
  e: "E 限制",
  any: "全部",
};

const FILTER_LABELS = {
  rating: { any: "全部", g: "G", s: "S", q: "Q", e: "E" },
  aspect: { all: "全部", landscape: "横图", portrait: "竖图", square: "方图", wide: "宽屏" },
  size: { all: "全部", large: "大图", wallpaper: "壁纸", absurdres: "超清" },
  sort: { relevance: "默认", score: "得分", favorite: "收藏", resolution: "尺寸", newest: "最新" },
};

const DENSITY_VALUES = ["compact", "comfortable", "wide"];

function setAppView(view) {
  currentView = view;
  isFavoritesView = view === "favorites";
  document.body.dataset.view = view;

  navButtons.forEach((button) => {
    const isActive = button.dataset.viewButton === view;
    button.classList.toggle("is-active", isActive);
    if (button.id === "showFavoritesButton") {
      button.setAttribute("aria-pressed", String(isActive));
    }
  });

  viewPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
  });

  if (gallerySurface) {
    gallerySurface.hidden = view === "settings";
  }

  if (settingsSurface) {
    settingsSurface.hidden = view !== "settings";
  }

  appShell?.querySelector(".main-area")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function normalizeTag(tag) {
  return String(tag).trim().replace(/\s+/g, "_");
}

function parseTags(input) {
  const value = input.trim();

  if (!value) {
    return [];
  }

  if (/[,;\n]/.test(value)) {
    return value
      .split(/[,;\n]+/)
      .map(normalizeTag)
      .filter(Boolean);
  }

  const matches = value.matchAll(/"([^"]+)"|'([^']+)'|[^\s]+/g);
  return Array.from(matches, (match) => normalizeTag(match[1] || match[2] || match[0]))
    .filter(Boolean);
}

function splitRemoteAndLocalTags(tags, maxRemoteTags) {
  return {
    remoteTags: tags.slice(0, maxRemoteTags),
    localTags: tags.slice(maxRemoteTags),
  };
}

function uniqueTags(tags) {
  const seen = new Set();

  return tags.filter((tag) => {
    const normalized = normalizeTag(tag);

    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

function formatRating(rating) {
  return RATING_LABELS[rating] || String(rating || "N/A").toUpperCase();
}

function formatBytes(bytes) {
  const value = Number(bytes);

  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatCount(count) {
  return `${count.toLocaleString("zh-CN")} 张图片`;
}

function getPostSize(post) {
  const width = Number(post.image_width || post.media_asset?.image_width);
  const height = Number(post.image_height || post.media_asset?.image_height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function getPostAspectRatio(post) {
  const size = getPostSize(post);
  return size ? size.width / size.height : 1;
}

function getPostAspectRatioValue(post) {
  const size = getPostSize(post);
  return size ? `${size.width} / ${size.height}` : "1 / 1";
}

function getDimensions(post) {
  const size = getPostSize(post);

  if (!size) {
    return "-";
  }

  return `${size.width} × ${size.height}`;
}

function collectAllTags(post) {
  const fields = [
    "tag_string_general",
    "tag_string_character",
    "tag_string_copyright",
    "tag_string_artist",
    "tag_string_meta",
    "tag_string",
  ];

  const tags = new Set();
  fields.forEach((field) => {
    String(post[field] || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((tag) => tags.add(tag));
  });

  return tags;
}

function matchesPost(post, localTags, rating) {
  if (rating !== "any" && post.rating !== rating) {
    return false;
  }

  if (localTags.length === 0) {
    return true;
  }

  const postTags = collectAllTags(post);
  return localTags.every((tag) => postTags.has(normalizeTag(tag)));
}

function getAspectBucket(post) {
  const ratio = getPostAspectRatio(post);

  if (ratio >= 1.78) {
    return "wide";
  }

  if (ratio > 1.1) {
    return "landscape";
  }

  if (ratio < 0.9) {
    return "portrait";
  }

  return "square";
}

function matchesSizeFilter(post) {
  const size = getPostSize(post);

  if (filterState.size === "all" || !size) {
    return true;
  }

  if (filterState.size === "large") {
    return Math.max(size.width, size.height) >= 2000;
  }

  if (filterState.size === "wallpaper") {
    return size.width >= 1920 && size.height >= 1080;
  }

  if (filterState.size === "absurdres") {
    return size.width * size.height >= 8000000;
  }

  return true;
}

function matchesClientFilters(post) {
  const ratingOk = filterState.rating === "any" || post.rating === filterState.rating;
  const aspectOk = filterState.aspect === "all" || getAspectBucket(post) === filterState.aspect;

  return ratingOk && aspectOk && matchesSizeFilter(post);
}

function getFavoriteCount(post) {
  return Number(post.fav_count ?? post.fav_count_total ?? post.score ?? 0);
}

function getResolution(post) {
  const size = getPostSize(post);
  return size ? size.width * size.height : 0;
}

function getFilteredPosts(posts) {
  const filtered = posts.filter(matchesClientFilters);
  const sorted = [...filtered];

  if (filterState.sort === "score") {
    sorted.sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.id || 0) - Number(a.id || 0));
  }

  if (filterState.sort === "favorite") {
    sorted.sort((a, b) => getFavoriteCount(b) - getFavoriteCount(a) || Number(b.id || 0) - Number(a.id || 0));
  }

  if (filterState.sort === "resolution") {
    sorted.sort((a, b) => getResolution(b) - getResolution(a) || Number(b.id || 0) - Number(a.id || 0));
  }

  if (filterState.sort === "newest") {
    sorted.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
  }

  return sorted;
}

function deduplicatePosts(posts) {
  const seen = new Set();
  return posts.filter((post) => {
    if (!post.id || seen.has(post.id)) {
      return false;
    }

    seen.add(post.id);
    return true;
  });
}

function createAbortError() {
  const error = new Error("搜索已停止");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    function handleAbort() {
      window.clearTimeout(timeoutId);
      reject(createAbortError());
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function fetchJsonWithRetry(url, signal) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal,
      });

      if (response.status === 429 || response.status >= 500) {
        await sleep(RETRY_SLEEP_MS * attempt, signal);
        continue;
      }

      if (!response.ok) {
        const message = await response.text();
        throw new Error(`${response.status} ${response.statusText}: ${message.slice(0, 160)}`);
      }

      return response.json();
    } catch (error) {
      if (error.name === "AbortError") {
        throw error;
      }

      lastError = error;
      await sleep(RETRY_SLEEP_MS * attempt, signal);
    }
  }

  throw lastError || new Error("请求失败");
}

async function searchPosts(tags, options, signal, onProgress = () => {}) {
  const { remoteTags, localTags } = splitRemoteAndLocalTags(tags, options.maxRemoteTags);
  const remoteQuery = remoteTags.join(" ");
  const posts = [];
  let uniquePosts = [];

  for (let page = 1; ; page += 1) {
    throwIfAborted(signal);

    const collectedCount = Math.min(uniquePosts.length, options.maxDisplayPosts);
    const previousCount = uniquePosts.length;
    const params = new URLSearchParams({
      tags: remoteQuery,
      limit: String(REMOTE_FETCH_LIMIT),
      page: String(page),
    });

    setStatus(`请求远程第 ${page} 页：${remoteQuery}；已收集 ${collectedCount}/${options.maxDisplayPosts} 张`);
    setProgress(Math.min((collectedCount / options.maxDisplayPosts) * 88, 88));

    const pagePosts = await fetchJsonWithRetry(
      `${DANBOORU_BASE_URL}/posts.json?${params.toString()}`,
      signal
    );

    if (!Array.isArray(pagePosts) || pagePosts.length === 0) {
      break;
    }

    pagePosts
      .filter((post) => matchesPost(post, localTags, options.rating))
      .forEach((post) => posts.push(post));

    uniquePosts = deduplicatePosts(posts).slice(0, options.maxDisplayPosts);
    const nextCount = uniquePosts.length;
    setCount(nextCount);
    setProgress(Math.min((nextCount / options.maxDisplayPosts) * 92, 92));
    if (nextCount > previousCount) {
      onProgress(uniquePosts, page);
    }

    if (uniquePosts.length >= options.maxDisplayPosts) {
      return uniquePosts;
    }

    if (pagePosts.length < REMOTE_FETCH_LIMIT) {
      break;
    }

    await sleep(REQUEST_SLEEP_MS, signal);
  }

  return uniquePosts;
}

function getVariant(post, preferredType) {
  return post.media_asset?.variants?.find((variant) => variant.type === preferredType)?.url || null;
}

function getPreviewUrl(post) {
  return (
    getVariant(post, "360x360") ||
    post.preview_file_url ||
    getVariant(post, "180x180") ||
    post.large_file_url ||
    post.file_url
  );
}

function getLargeUrl(post) {
  return (
    post.file_url ||
    getVariant(post, "original") ||
    post.large_file_url ||
    getVariant(post, "sample") ||
    getVariant(post, "720x720") ||
    getPreviewUrl(post)
  );
}

function getTagSummary(post) {
  const priorityTags = [
    post.tag_string_character,
    post.tag_string_copyright,
    post.tag_string_artist,
    post.tag_string_general,
  ];

  return priorityTags
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 16)
    .join(" ");
}

function getPreviewTags(post) {
  const priorityFields = [
    "tag_string_general",
    "tag_string_artist",
    "tag_string_character",
    "tag_string_copyright",
    "tag_string_meta",
    "tag_string",
  ];
  const tags = [];
  const seen = new Set();

  priorityFields.forEach((field) => {
    String(post[field] || "")
      .split(/\s+/)
      .filter(Boolean)
      .forEach((tag) => {
        if (!seen.has(tag)) {
          seen.add(tag);
          tags.push(tag);
        }
      });
  });

  return tags;
}

function renderDialogTags(post) {
  const previewTags = getPreviewTags(post);
  const fragment = document.createDocumentFragment();

  previewTags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "dialog-tag-chip";
    chip.textContent = tag;
    fragment.append(chip);
  });

  if (previewTags.length === 0) {
    const empty = document.createElement("span");
    empty.className = "dialog-tag-chip is-muted";
    empty.textContent = "无标签";
    fragment.append(empty);
  }

  dialogTags.replaceChildren(fragment);
}

function getPostKey(postOrId) {
  const id = typeof postOrId === "object" ? postOrId?.id : postOrId;
  const key = String(id ?? "").trim();

  return key && key !== "undefined" && key !== "null" ? key : "";
}

function normalizeFavoritePost(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = Number(item.id);

  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const numericField = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };

  return {
    id,
    rating: String(item.rating || ""),
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
    fav_count: Number.isFinite(Number(item.fav_count)) ? Number(item.fav_count) : 0,
    image_width: numericField(item.image_width),
    image_height: numericField(item.image_height),
    file_size: numericField(item.file_size),
    preview_file_url: String(item.preview_file_url || ""),
    large_file_url: String(item.large_file_url || item.file_url || ""),
    file_url: String(item.file_url || item.large_file_url || ""),
    tag_string_general: String(item.tag_string_general || ""),
    tag_string_character: String(item.tag_string_character || ""),
    tag_string_copyright: String(item.tag_string_copyright || ""),
    tag_string_artist: String(item.tag_string_artist || ""),
    tag_string_meta: String(item.tag_string_meta || ""),
    tag_string: String(item.tag_string || ""),
    favorited_at: String(item.favorited_at || new Date(0).toISOString()),
  };
}

function readFavorites() {
  try {
    const rawFavorites = JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    const items = Array.isArray(rawFavorites)
      ? rawFavorites
      : Object.values(rawFavorites || {});
    const favorites = new Map();

    items.forEach((item) => {
      const favorite = normalizeFavoritePost(item);

      if (favorite) {
        favorites.set(getPostKey(favorite), favorite);
      }
    });

    return favorites;
  } catch {
    return new Map();
  }
}

function writeFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favoritePosts.values())));
  } catch {
    // Ignore storage failures; the current search and preview should keep working.
  }
}

function isKnownOption(options, value) {
  return Object.prototype.hasOwnProperty.call(options, value);
}

function normalizeSettings(rawSettings = {}) {
  const targetCount = Number(rawSettings.targetCount);
  const normalizedFilters = { ...filterState };
  const rawFilters = rawSettings.filterState && typeof rawSettings.filterState === "object"
    ? rawSettings.filterState
    : {};

  Object.keys(normalizedFilters).forEach((key) => {
    if (isKnownOption(FILTER_LABELS[key] || {}, rawFilters[key])) {
      normalizedFilters[key] = rawFilters[key];
    }
  });

  return {
    targetCount: Number.isFinite(targetCount) && targetCount > 0
      ? Math.floor(targetCount)
      : DEFAULT_TARGET_POSTS,
    defaultRating: isKnownOption(RATING_LABELS, rawSettings.defaultRating)
      ? rawSettings.defaultRating
      : DEFAULT_RATING,
    filterState: normalizedFilters,
    density: DENSITY_VALUES.includes(rawSettings.density)
      ? rawSettings.density
      : DEFAULT_DENSITY,
  };
}

function readSettings() {
  try {
    const rawSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return normalizeSettings(rawSettings && typeof rawSettings === "object" ? rawSettings : {});
  } catch {
    return normalizeSettings();
  }
}

function getCurrentSettings() {
  const targetCount = Number(countInput.value);

  return normalizeSettings({
    targetCount: Number.isFinite(targetCount) && targetCount > 0
      ? Math.floor(targetCount)
      : DEFAULT_TARGET_POSTS,
    defaultRating,
    filterState,
    density: document.body.dataset.density || DEFAULT_DENSITY,
  });
}

function applySettings(settings) {
  const normalizedSettings = normalizeSettings(settings);

  defaultRating = normalizedSettings.defaultRating;
  filterState = { ...filterState, ...normalizedSettings.filterState };
  document.body.dataset.density = normalizedSettings.density;
  countInput.value = String(normalizedSettings.targetCount);

  if (settingsCountInput) {
    settingsCountInput.value = String(normalizedSettings.targetCount);
  }

  if (settingsRatingSelect) {
    settingsRatingSelect.value = defaultRating;
  }

  document.querySelectorAll(".density-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.density === normalizedSettings.density);
  });
}

function writeSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(getCurrentSettings()));
  } catch {
    // Settings are convenience defaults; the app remains usable without storage.
  }
}

function acknowledgeSettingsSaved() {
  if (!saveSettingsButton) {
    return;
  }

  saveSettingsButton.textContent = "已保存";
  window.setTimeout(() => {
    saveSettingsButton.textContent = "保存设置";
  }, 1100);
}

function createFavoriteSnapshot(post) {
  const size = getPostSize(post);
  const tags = getPreviewTags(post);

  return normalizeFavoritePost({
    id: post.id,
    rating: post.rating,
    score: post.score,
    fav_count: post.fav_count,
    image_width: size?.width,
    image_height: size?.height,
    file_size: post.file_size || post.media_asset?.file_size,
    preview_file_url: getPreviewUrl(post),
    large_file_url: post.large_file_url || getLargeUrl(post),
    file_url: getLargeUrl(post),
    tag_string_general: post.tag_string_general,
    tag_string_character: post.tag_string_character,
    tag_string_copyright: post.tag_string_copyright,
    tag_string_artist: post.tag_string_artist,
    tag_string_meta: post.tag_string_meta,
    tag_string: post.tag_string || tags.join(" "),
    favorited_at: new Date().toISOString(),
  });
}

function getFavoritePosts() {
  return Array.from(favoritePosts.values()).sort((a, b) => {
    return (Date.parse(b.favorited_at) || 0) - (Date.parse(a.favorited_at) || 0);
  });
}

function updateFavoriteButton(button, postOrId) {
  const key = getPostKey(postOrId || button.dataset.favoritePostId);

  if (!key) {
    button.disabled = true;
    return;
  }

  const isFavorite = favoritePosts.has(key);
  button.disabled = false;
  button.dataset.favoritePostId = key;
  button.classList.toggle("is-active", isFavorite);
  button.setAttribute("aria-pressed", String(isFavorite));
  button.setAttribute(
    "aria-label",
    `${isFavorite ? "取消收藏" : "收藏"} Post #${key}`
  );
}

function syncFavoriteButtons() {
  document.querySelectorAll(".favorite-button[data-favorite-post-id]").forEach((button) => {
    updateFavoriteButton(button);
    const card = button.closest(".post-card");

    if (card) {
      card.classList.toggle("is-favorite", button.classList.contains("is-active"));
    }
  });

  if (dialogFavoriteButton.dataset.favoritePostId) {
    updateFavoriteButton(dialogFavoriteButton);
  }
}

function renderFavoriteSummary() {
  const count = favoritePosts.size;
  const formattedCount = count.toLocaleString("zh-CN");

  if (favoriteSummary) {
    favoriteSummary.textContent = formattedCount;
  }

  document.querySelectorAll(".favorite-summary").forEach((node) => {
    node.textContent = formattedCount;
  });

  if (showFavoritesButton) {
    showFavoritesButton.title = currentView === "favorites" ? "当前显示收藏" : "查看收藏";
    showFavoritesButton.disabled = false;
    showFavoritesButton.classList.toggle("is-active", currentView === "favorites");
    showFavoritesButton.setAttribute("aria-pressed", String(currentView === "favorites"));
  }

  if (inspectorFavoriteCount) {
    inspectorFavoriteCount.textContent = formattedCount;
  }
}

function toggleFavorite(post) {
  const key = getPostKey(post);

  if (!key) {
    return;
  }

  if (favoritePosts.has(key)) {
    favoritePosts.delete(key);
  } else {
    const snapshot = createFavoriteSnapshot(post);

    if (snapshot) {
      favoritePosts.set(key, snapshot);
    }
  }

  writeFavorites();
  renderFavoriteSummary();

  if (isFavoritesView) {
    const wasRemoved = !favoritePosts.has(key);
    showFavoritePosts({ resetPage: false });

    if (previewDialog.open && wasRemoved) {
      if (allPosts.length === 0) {
        previewDialog.close();
        return;
      }

      activePreviewIndex = Math.max(0, Math.min(activePreviewIndex, allPosts.length - 1));
      updatePreview(allPosts[activePreviewIndex], activePreviewIndex);
    }
  } else {
    syncFavoriteButtons();
  }
}

function readHistory() {
  try {
    const rawHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");

    if (!Array.isArray(rawHistory)) {
      return [];
    }

    const tags = rawHistory.flatMap((item) => {
      if (Array.isArray(item)) {
        return item;
      }

      return typeof item === "string" ? [item] : [];
    });

    return uniqueTags(tags).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function writeHistory(history) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(uniqueTags(history).slice(0, MAX_HISTORY_ITEMS))
    );
  } catch {
    // Ignore storage failures; search should keep working without history.
  }
}

function saveHistory(tags) {
  const normalizedTags = uniqueTags(tags);

  if (normalizedTags.length === 0) {
    return;
  }

  const history = readHistory().filter((tag) => !normalizedTags.includes(tag));
  writeHistory([...normalizedTags, ...history]);
  renderHistory();
}

function renderHistory() {
  const history = readHistory();
  historyList.replaceChildren();

  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "暂无历史记录";
    historyList.append(empty);
    return;
  }

  history.forEach((tag) => {
    const button = document.createElement("button");
    button.className = "tag-chip history-tag";
    button.type = "button";
    button.dataset.tag = tag;
    button.setAttribute("aria-label", `添加历史 tag ${tag}`);
    button.textContent = tag;
    historyList.append(button);
  });
}

function renderSelectedTags() {
  selectedTagsBox.replaceChildren();

  selectedTags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "input-chip";
    chip.textContent = tag;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `移除 ${tag}`);
    removeButton.textContent = "×";
    removeButton.addEventListener("click", () => {
      selectedTags = selectedTags.filter((item) => item !== tag);
      renderSelectedTags();
      renderCurrentTags(getPendingTags(), getOptions().maxRemoteTags);
      tagInput.focus();
    });

    chip.append(removeButton);
    selectedTagsBox.append(chip);
  });
}

function addTags(tags) {
  selectedTags = uniqueTags([...selectedTags, ...tags]);
  renderSelectedTags();
  renderCurrentTags(getPendingTags(), getOptions().maxRemoteTags);
}

function commitInputTags() {
  const tags = parseTags(tagInput.value);

  if (tags.length > 0) {
    addTags(tags);
    tagInput.value = "";
  }
}

function setTags(tags) {
  selectedTags = uniqueTags(tags);
  tagInput.value = "";
  renderSelectedTags();
  renderCurrentTags(selectedTags, getOptions().maxRemoteTags);
}

function getPendingTags() {
  return uniqueTags([...selectedTags, ...parseTags(tagInput.value)]);
}

function shouldUseMobileMasonry() {
  return mobileGalleryQuery.matches && !gallery.classList.contains("is-list");
}

function createPostCard(post, index) {
  const node = postTemplate.content.firstElementChild.cloneNode(true);
  const imageButton = node.querySelector(".image-button");
  const image = node.querySelector("img");
  const ratingBadge = node.querySelector(".rating-badge");
  const scoreLabel = node.querySelector(".score-label");
  const postId = node.querySelector(".post-id");
  const postSize = node.querySelector(".post-size");
  const favoriteCountLabel = node.querySelector(".favorite-count-label");
  const tags = node.querySelector(".post-tags");
  const postLink = node.querySelector(".post-link");
  const favoriteButton = node.querySelector(".favorite-button-card");
  const previewUrl = getPreviewUrl(post);
  const size = getPostSize(post);

  node.dataset.postIndex = String(index);
  node.style.setProperty("--post-aspect-ratio", getPostAspectRatioValue(post));
  node.classList.toggle("is-favorite", favoritePosts.has(getPostKey(post)));
  image.src = previewUrl;
  image.alt = `Danbooru post ${post.id}`;
  ratingBadge.textContent = formatRating(post.rating);
  ratingBadge.classList.add(`rating-${post.rating || "unknown"}`);
  scoreLabel.textContent = `score ${post.score ?? 0}`;
  if (postSize) {
    postSize.textContent = size ? `${size.width}x${size.height}` : "-";
  }
  if (favoriteCountLabel) {
    favoriteCountLabel.textContent = `fav ${getFavoriteCount(post)}`;
  }
  postId.textContent = `#${post.id}`;
  tags.textContent = getTagSummary(post) || `post ${post.id}`;
  postLink.href = `${DANBOORU_BASE_URL}/posts/${post.id}`;
  updateFavoriteButton(favoriteButton, post);

  favoriteButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavorite(post);
  });

  imageButton.addEventListener("click", () => openPreview(index));
  return node;
}

function renderFlatGallery(posts) {
  const fragment = document.createDocumentFragment();

  posts.forEach((post, index) => {
    fragment.append(createPostCard(post, index));
  });

  gallery.append(fragment);
}

function renderMobileMasonry(posts) {
  const columns = [document.createElement("div"), document.createElement("div")];
  const columnHeights = [0, 0];

  columns.forEach((column) => {
    column.className = "gallery-column";
  });

  posts.forEach((post, index) => {
    const targetColumn = columnHeights[0] <= columnHeights[1] ? 0 : 1;
    columns[targetColumn].append(createPostCard(post, index));
    columnHeights[targetColumn] += 1 / Math.max(getPostAspectRatio(post), 0.1);
  });

  gallery.append(...columns);
}

function renderGallery() {
  gallery.replaceChildren();
  gallery.classList.toggle("is-mobile-masonry", shouldUseMobileMasonry());

  if (allPosts.length === 0) {
    return;
  }

  if (shouldUseMobileMasonry()) {
    renderMobileMasonry(allPosts);
  } else {
    renderFlatGallery(allPosts);
  }

  if (activePreviewIndex >= 0) {
    setSelectedPost(activePreviewIndex);
  }
}

function getCurrentSourcePosts() {
  if (currentView === "home") {
    return homePostsCache;
  }

  if (currentView === "favorites") {
    return getFavoritePosts();
  }

  if (currentView === "search") {
    return searchPostsCache;
  }

  return [];
}

function renderPosts(posts, { resetPage = true, showEmptyResult = true } = {}) {
  const filteredPosts = getFilteredPosts(posts);

  allPosts = filteredPosts;
  if (resetPage) {
    activePreviewIndex = -1;
  }
  const useCompactEmptyState = ["favorites", "search"].includes(currentView) && filteredPosts.length === 0;
  emptyState.classList.toggle("is-compact", useCompactEmptyState);
  emptyState.hidden = filteredPosts.length > 0;

  if (filteredPosts.length === 0) {
    if (showEmptyResult) {
      if (posts.length === 0) {
        const emptyCopy = {
          home: ["主页暂时没有可显示图片。", "稍后重试 order:rank，或切到搜索页输入 tag。"],
          search: ["暂无搜索结果", ""],
          favorites: ["暂无收藏。", ""],
        }[currentView] || ["没有可显示的图片。", "换一个入口继续查看。"];

        setEmptyStateCopy(
          emptyCopy[0],
          emptyCopy[1]
        );
      } else {
        const filteredEmptyCopy = currentView === "favorites"
          ? ["当前收藏没有匹配筛选。", ""]
          : ["暂无搜索结果", ""];

        setEmptyStateCopy(filteredEmptyCopy[0], filteredEmptyCopy[1]);
      }
    }
    renderGallery();
    setCount(0);
    return;
  }

  renderGallery();
  setCount(filteredPosts.length, posts.length);
}

function showFavoritePosts({ resetPage = true } = {}) {
  if (activeController) {
    activeController.abort();
    activeController = null;
    setLoading(false);
  }

  setAppView("favorites");
  const favorites = getFavoritePosts();
  if (resetPage) {
    activePreviewIndex = -1;
  }
  hideNotice();
  setProgress(0);
  renderCurrentTags(["本地收藏"], 1);
  renderPosts(favorites, { resetPage, showEmptyResult: true });

  if (favorites.length === 0) {
    emptyState.hidden = false;
    emptyState.classList.add("is-compact");
    setEmptyStateCopy("暂无收藏。", "");
    setStatus("暂无收藏");
  } else {
    updateViewStatus({ force: true });
  }

  setInspectorMode("收藏视图");
  renderFavoriteSummary();
  syncFavoriteButtons();
}

function restoreSearchPosts() {
  const shouldAbortActiveSearch = activeController && currentView !== "search";

  if (shouldAbortActiveSearch) {
    activeController.abort();
    activeController = null;
    setLoading(false);
  }

  setAppView("search");
  activePreviewIndex = -1;
  hideNotice();
  setProgress(searchPostsCache.length > 0 ? 100 : 0);
  renderCurrentTags(getPendingTags(), getOptions().maxRemoteTags);
  renderPosts(searchPostsCache, { resetPage: true, showEmptyResult: false });

  if (searchPostsCache.length > 0) {
    updateViewStatus({ force: true });
    setInspectorMode("结果浏览");
  } else {
    emptyState.hidden = false;
    emptyState.classList.add("is-compact");
    setEmptyStateCopy("暂无搜索结果", "");
    setStatus("等待输入 tag");
    setInspectorMode("待检索");
  }

  renderFavoriteSummary();
  syncFavoriteButtons();
}

function showHomePosts({ resetPage = true } = {}) {
  if (activeController) {
    activeController.abort();
    activeController = null;
    setLoading(false);
  }

  setAppView("home");
  activePreviewIndex = resetPage ? -1 : activePreviewIndex;
  hideNotice();
  setProgress(homePostsCache.length > 0 ? 100 : 0);
  renderCurrentTags(DEFAULT_HOME_TAGS, DEFAULT_MAX_REMOTE_TAGS);

  if (homePostsCache.length > 0) {
    renderPosts(homePostsCache, { resetPage, showEmptyResult: true });
    updateViewStatus({ force: true });
    syncFavoriteButtons();
    return;
  }

  runSearch(DEFAULT_HOME_TAGS, { saveToHistory: false, source: "home" });
}

function setSelectedPost(index) {
  gallery.querySelectorAll(".post-card.is-selected").forEach((node) => {
    node.classList.remove("is-selected");
  });

  const selectedNode = gallery.querySelector(`[data-post-index="${index}"]`);

  if (selectedNode) {
    selectedNode.classList.add("is-selected");
  }
}

function updatePreview(post, index) {
  const largeUrl = getLargeUrl(post);

  activePreviewPost = post;
  setSelectedPost(index);
  dialogTitle.textContent = `Post #${post.id}`;
  dialogImage.src = largeUrl;
  dialogImage.alt = `Danbooru post ${post.id}`;
  dialogRatingBadge.className = `dialog-rating-pill rating-${post.rating || "unknown"}`;
  dialogRatingBadge.textContent = formatRating(post.rating);
  if (dialogRatingText) {
    dialogRatingText.textContent = post.rating || "-";
  }
  if (dialogPosition) {
    dialogPosition.textContent = `${index + 1} / ${allPosts.length || 1}${isFavoritesView ? " · 收藏" : ""}`;
  }
  updateFavoriteButton(dialogFavoriteButton, post);
  dialogScorePill.textContent = `${post.score ?? 0}`;
  renderDialogTags(post);
  dialogDimensions.textContent = getDimensions(post);
  dialogSize.textContent = formatBytes(post.file_size || post.media_asset?.file_size);
  dialogPostLink.href = `${DANBOORU_BASE_URL}/posts/${post.id}`;
  dialogFileLink.href = largeUrl;
}

function openPreview(index) {
  const post = allPosts[index];

  if (!post) {
    return;
  }

  previewScrollY = window.scrollY;
  activePreviewIndex = index;
  updatePreview(post, index);
  document.body.classList.add("dialog-open");

  if (!previewDialog.open) {
    previewDialog.showModal();
    previewDialog.focus({ preventScroll: true });
  }
}

function movePreview(delta) {
  if (!previewDialog.open || allPosts.length === 0) {
    return;
  }

  activePreviewIndex = (activePreviewIndex + delta + allPosts.length) % allPosts.length;
  updatePreview(allPosts[activePreviewIndex], activePreviewIndex);
}

function setStatus(message) {
  statusText.textContent = message;
}

function setInspectorMode(message) {
  if (inspectorMode) {
    inspectorMode.textContent = message;
  }
}

function setProgress(percent) {
  const safePercent = Math.min(Math.max(Number(percent) || 0, 0), 100);
  progressBar.style.width = `${safePercent}%`;
}

function setCount(count, sourceCount = count) {
  const visible = Number(count || 0);
  const total = Number(sourceCount || 0);

  resultCount.textContent = total > 0 && visible !== total
    ? `${visible.toLocaleString("zh-CN")} / ${total.toLocaleString("zh-CN")} 张`
    : formatCount(visible);

  if (inspectorResultCount) {
    inspectorResultCount.textContent = visible.toLocaleString("zh-CN");
  }
}

function updateFilterLabels() {
  const labelMap = [
    ["ratingLabel", "rating"],
    ["aspectLabel", "aspect"],
    ["sizeLabel", "size"],
    ["sortLabel", "sort"],
  ];

  labelMap.forEach(([id, key]) => {
    const node = document.querySelector(`#${id}`);
    if (node) {
      node.textContent = FILTER_LABELS[key][filterState[key]];
    }
  });

  document.querySelectorAll(".filter-option").forEach((option) => {
    const isActive = filterState[option.dataset.filter] === option.dataset.value;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });

  if (settingsSortSelect) {
    settingsSortSelect.value = filterState.sort;
  }
}

function updateViewStatus({ force = false } = {}) {
  const sourcePosts = getCurrentSourcePosts();
  const visibleCount = allPosts.length;
  const sourceCount = sourcePosts.length;

  setCount(visibleCount, sourceCount);

  if (!force && document.body.classList.contains("is-loading")) {
    return;
  }

  if (currentView === "favorites") {
    setStatus(sourceCount > 0 ? `收藏 · ${visibleCount} / ${sourceCount} 张` : "暂无收藏");
    setInspectorMode("收藏视图");
    return;
  }

  if (currentView === "home") {
    setStatus(sourceCount > 0 ? `热门 · ${visibleCount} / ${sourceCount} 张` : "正在加载热门");
    setInspectorMode("主页热门");
    return;
  }

  if (currentView === "search" && sourceCount > 0) {
    setStatus(`筛选完成 · ${visibleCount} / ${sourceCount} 张`);
    setInspectorMode("结果浏览");
  } else {
    setStatus("等待输入 tag");
    setInspectorMode("待检索");
  }
}

function refreshCurrentView({ resetPage = false, forceStatus = false } = {}) {
  renderPosts(getCurrentSourcePosts(), { resetPage, showEmptyResult: true });
  updateViewStatus({ force: forceStatus });
  syncFavoriteButtons();
}

function renderInspectorTags(tags = []) {
  if (!inspectorTags) {
    return;
  }

  inspectorTags.replaceChildren();

  if (tags.length === 0) {
    const empty = document.createElement("span");
    empty.className = "is-muted";
    empty.textContent = "等待 tag";
    inspectorTags.append(empty);
    return;
  }

  tags.slice(0, 10).forEach((tag) => {
    const item = document.createElement("span");
    item.textContent = tag;
    inspectorTags.append(item);
  });
}

function renderCurrentTags(tags = [], maxRemoteTags = 2) {
  currentTags.replaceChildren();
  renderInspectorTags(tags);

  if (tags.length === 0) {
    const placeholder = document.createElement("span");
    placeholder.className = "tag-chip is-muted";
    placeholder.textContent = "等待输入";
    currentTags.append(placeholder);
    return;
  }

  tags.forEach((tag, index) => {
    const chip = document.createElement("span");
    chip.className = `tag-chip ${index < maxRemoteTags ? "is-remote" : "is-local"}`;
    chip.textContent = tag;
    currentTags.append(chip);
  });
}

function showNotice(message) {
  noticeBox.textContent = message;
  noticeBox.hidden = false;
}

function hideNotice() {
  noticeBox.textContent = "";
  noticeBox.hidden = true;
}

function setEmptyStateCopy(title, description) {
  if (emptyStateIcon) {
    emptyStateIcon.textContent = "";
  }

  if (emptyStateTitle) {
    emptyStateTitle.textContent = title;
  }

  if (emptyStateDescription) {
    emptyStateDescription.textContent = description;
  }
}

function setLoading(isLoading) {
  document.body.classList.toggle("is-loading", isLoading);
  searchButton.disabled = isLoading;
  stopSearchButton.hidden = !isLoading;
  stopSearchButton.disabled = !isLoading;
  stopSearchButton.textContent = "停止";
}

function getOptions() {
  const targetValue = Number(countInput.value);
  const targetCount = Number.isFinite(targetValue)
    ? Math.max(Math.floor(targetValue), 1)
    : DEFAULT_TARGET_POSTS;

  return {
    targetCount,
    maxDisplayPosts: targetCount,
    maxRemoteTags: DEFAULT_MAX_REMOTE_TAGS,
    rating: defaultRating,
  };
}

async function runSearch(tags, { saveToHistory = true, source = "search" } = {}) {
  if (tags.length === 0) {
    showNotice("至少输入 1 个 tag。");
    tagInput.focus();
    return;
  }

  if (activeController) {
    activeController.abort();
  }

  const options = getOptions();
  const { remoteTags, localTags } = splitRemoteAndLocalTags(tags, options.maxRemoteTags);

  setAppView(source);
  if (source === "home") {
    homePostsCache = [];
  } else {
    searchPostsCache = [];
  }
  renderFavoriteSummary();

  const controller = new AbortController();
  activeController = controller;
  hideNotice();
  setLoading(true);
  setInspectorMode("检索中");
  setCount(0);
  setProgress(0);
  renderCurrentTags(tags, options.maxRemoteTags);
  allPosts = [];
  activePreviewIndex = -1;
  gallery.replaceChildren();
  setCount(0);
  emptyState.hidden = false;
  setEmptyStateCopy(
    "正在搜索...",
    `${remoteTags.join(" ")} · ${localTags.join(" ") || "无本地过滤"} · 目标 ${options.targetCount} 张`
  );
  setStatus(
    `远程 tag：${remoteTags.join(" ")}；本地过滤：${localTags.join(" ") || "无"}；评级：All`
  );

  try {
    const posts = await searchPosts(tags, options, controller.signal, (partialPosts, page) => {
      if (activeController !== controller) {
        return;
      }

      if (source === "home") {
        homePostsCache = partialPosts;
      } else {
        searchPostsCache = partialPosts;
      }
      renderPosts(partialPosts, { resetPage: false, showEmptyResult: false });

      if (partialPosts.length > 0) {
        setStatus(
          `已显示 ${allPosts.length.toLocaleString("zh-CN")} / ${options.maxDisplayPosts.toLocaleString("zh-CN")} 张，继续请求远程第 ${page + 1} 页`
        );
      }
    });

    if (activeController !== controller) {
      return;
    }

    if (source === "home") {
      homePostsCache = posts;
    } else {
      searchPostsCache = posts;
    }
    renderPosts(posts, { resetPage: allPosts.length === 0 });
    updateViewStatus({ force: true });
    setProgress(100);
    if (saveToHistory && source === "search") {
      saveHistory(tags);
    }
  } catch (error) {
    if (activeController !== controller) {
      return;
    }

    if (error.name === "AbortError") {
      const retainedCount = allPosts.length;
      if (retainedCount > 0) {
        renderPosts(allPosts, { resetPage: false, showEmptyResult: false });
        setStatus(`搜索已停止，已保留 ${retainedCount.toLocaleString("zh-CN")} 张图片`);
      } else {
        setStatus("搜索已停止");
        setInspectorMode("已停止");
        emptyState.hidden = false;
        setEmptyStateCopy("搜索已停止。", "可以调整 tag 后重新搜索。");
      }
    } else {
      showNotice(error.message || "请求失败，请稍后重试。");
      setStatus("请求失败");
      setInspectorMode("请求失败");
      setEmptyStateCopy("没有可显示的结果。", "请检查网络或稍后重试。");
    }
  } finally {
    if (activeController === controller) {
      setLoading(false);
      activeController = null;
    }
  }
}

function stopActiveSearch() {
  if (!activeController) {
    return;
  }

  stopSearchButton.disabled = true;
  stopSearchButton.textContent = "停止中";
  setStatus("正在停止搜索...");
  activeController.abort();
}

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  commitInputTags();
  runSearch(selectedTags, { source: "search" });
});

tagInput.addEventListener("keydown", (event) => {
  if (event.isComposing) {
    return;
  }

  if (event.key === "Enter" && tagInput.value.trim() === "" && selectedTags.length > 0) {
    return;
  }

  if (
    event.key === "Enter" ||
    event.key === "," ||
    event.key === ";" ||
    (event.key === " " && tagInput.value.trim() !== "")
  ) {
    event.preventDefault();
    commitInputTags();
  }

  if (event.key === "Backspace" && tagInput.value === "" && selectedTags.length > 0) {
    selectedTags = selectedTags.slice(0, -1);
    renderSelectedTags();
    renderCurrentTags(getPendingTags(), getOptions().maxRemoteTags);
  }

  if (previewDialog.open && event.key === "ArrowLeft") {
    event.preventDefault();
    movePreview(-1);
  }

  if (previewDialog.open && event.key === "ArrowRight") {
    event.preventDefault();
    movePreview(1);
  }
});

tagInput.addEventListener("input", () => {
  if (/[,;\n]/.test(tagInput.value)) {
    commitInputTags();
  } else {
    renderCurrentTags(getPendingTags(), getOptions().maxRemoteTags);
  }
});

stopSearchButton.addEventListener("click", () => {
  stopActiveSearch();
});

clearButton.addEventListener("click", () => {
  if (activeController) {
    activeController.abort();
  }

  selectedTags = [];
  tagInput.value = "";
  allPosts = [];
  searchPostsCache = [];
  setAppView("search");
  activePreviewIndex = -1;
  gallery.replaceChildren();
  hideNotice();
  setCount(0);
  setProgress(0);
  renderSelectedTags();
  renderFavoriteSummary();
  renderCurrentTags();
  setStatus("等待输入 tag");
  setInspectorMode("待检索");
  emptyState.hidden = false;
  emptyState.classList.add("is-compact");
  setEmptyStateCopy("暂无搜索结果", "");
  tagInput.focus();
});

function openView(view) {
  if (view === "home") {
    showHomePosts();
    return;
  }

  if (view === "search") {
    restoreSearchPosts();
    return;
  }

  if (view === "favorites") {
    showFavoritePosts();
    return;
  }

  if (view === "settings") {
    if (activeController) {
      activeController.abort();
      activeController = null;
      setLoading(false);
    }
    setAppView("settings");
    hideNotice();
    setInspectorMode("设置");
  }
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    openView(button.dataset.viewButton);
  });
});

clearHistoryButton.addEventListener("click", () => {
  writeHistory([]);
  renderHistory();
});

function applyHistoryTag(tag) {
  if (!tag) {
    return;
  }

  addTags([tag]);
  if (isFavoritesView) {
    restoreSearchPosts();
  }
  tagInput.focus();
}

historyList.addEventListener("pointerdown", (event) => {
  const item = event.target.closest(".history-tag");

  if (!item) {
    return;
  }

  event.preventDefault();
  applyHistoryTag(item.dataset.tag || "");
});

historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".history-tag");

  if (!item || event.detail !== 0) {
    return;
  }

  applyHistoryTag(item.dataset.tag || "");
});

function clearFilterMenuPosition(control) {
  const menu = control?.querySelector(".filter-menu");

  if (!menu) {
    return;
  }

  menu.style.removeProperty("--filter-menu-left");
  menu.style.removeProperty("--filter-menu-top");
}

function closeFilterControl(control) {
  if (!control) {
    return;
  }

  control.classList.remove("open");
  control.querySelector(".filter-trigger")?.setAttribute("aria-expanded", "false");
  clearFilterMenuPosition(control);
}

function closeFilterControls(exceptControl = null) {
  document.querySelectorAll(".filter-control.open").forEach((item) => {
    if (item !== exceptControl) {
      closeFilterControl(item);
    }
  });
}

function positionFilterMenu(control) {
  const menu = control?.querySelector(".filter-menu");

  if (!menu || !mobileFilterQuery.matches || !control.classList.contains("open")) {
    clearFilterMenuPosition(control);
    return;
  }

  const trigger = control.querySelector(".filter-trigger");
  const rail = control.closest(".filter-rail");
  const triggerRect = trigger?.getBoundingClientRect();
  const railRect = rail?.getBoundingClientRect();
  const railWidth = railRect?.width ?? window.innerWidth;
  const menuWidth = Math.min(menu.offsetWidth || 168, Math.max(railWidth, 0));
  const maxLeft = Math.max(0, railWidth - menuWidth);
  const desiredLeft = (triggerRect?.left ?? railRect?.left ?? 0) - (railRect?.left ?? 0);
  const left = Math.min(Math.max(desiredLeft, 0), maxLeft);
  const top = (triggerRect?.bottom ?? railRect?.top ?? 0) - (railRect?.top ?? 0) + 7;

  menu.style.setProperty("--filter-menu-left", `${Math.round(left)}px`);
  menu.style.setProperty("--filter-menu-top", `${Math.round(top)}px`);
}

document.querySelectorAll("[data-filter-trigger]").forEach((trigger) => {
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const control = trigger.closest(".filter-control");
    const wasOpen = control.classList.contains("open");

    closeFilterControls(control);

    if (wasOpen) {
      closeFilterControl(control);
      return;
    }

    control.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    positionFilterMenu(control);
    window.requestAnimationFrame(() => {
      positionFilterMenu(control);
      if (window.scrollX !== 0) {
        window.scrollTo({ top: window.scrollY, left: 0, behavior: "auto" });
      }
    });
  });
});

document.querySelectorAll(".filter-option").forEach((option) => {
  option.addEventListener("click", () => {
    const filterName = option.dataset.filter;

    if (!filterName) {
      return;
    }

    filterState[filterName] = option.dataset.value;
    closeFilterControl(option.closest(".filter-control"));
    updateFilterLabels();
    refreshCurrentView({ resetPage: true, forceStatus: true });
  });
});

settingsCountInput?.addEventListener("input", () => {
  const nextValue = Number(settingsCountInput.value);

  if (Number.isFinite(nextValue) && nextValue > 0) {
    countInput.value = String(Math.floor(nextValue));
  }
});

countInput?.addEventListener("input", () => {
  if (settingsCountInput) {
    settingsCountInput.value = countInput.value;
  }
});

settingsRatingSelect?.addEventListener("change", () => {
  defaultRating = settingsRatingSelect.value;
});

settingsSortSelect?.addEventListener("change", () => {
  filterState.sort = settingsSortSelect.value;
  updateFilterLabels();
  refreshCurrentView({ resetPage: true, forceStatus: true });
});

document.querySelectorAll(".density-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".density-button").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    document.body.dataset.density = button.dataset.density || "comfortable";
    renderGallery();
  });
});

document.querySelectorAll(".switch").forEach((button) => {
  button.addEventListener("click", () => {
    button.classList.toggle("is-on");
  });
});

saveSettingsButton?.addEventListener("click", () => {
  writeSettings();
  setInspectorMode("设置已保存");
  acknowledgeSettingsSaved();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".filter-control")) {
    closeFilterControls();
  }
});

window.addEventListener("resize", () => {
  document.querySelectorAll(".filter-control.open").forEach(positionFilterMenu);
});

document.querySelectorAll(".view-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".view-button").forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    gallery.classList.toggle("is-list", button.getAttribute("aria-label") === "列表视图");
    renderGallery();
  });
});

dialogPrevButton?.addEventListener("click", () => {
  movePreview(-1);
});

dialogNextButton?.addEventListener("click", () => {
  movePreview(1);
});

dialogFavoriteButton.addEventListener("click", () => {
  const fallbackKey = dialogFavoriteButton.dataset.favoritePostId;
  const post = activePreviewPost || allPosts[activePreviewIndex] || favoritePosts.get(fallbackKey);

  if (post) {
    toggleFavorite(post);
  }
});

closeDialogButton.addEventListener("click", () => {
  previewDialog.close();
});

previewDialog.addEventListener("close", () => {
  document.body.classList.remove("dialog-open");
  dialogImage.removeAttribute("src");
  dialogFavoriteButton.removeAttribute("data-favorite-post-id");
  activePreviewPost = null;

  window.requestAnimationFrame(() => {
    window.scrollTo({ top: previewScrollY, left: 0, behavior: "auto" });
  });
});

window.addEventListener("keydown", (event) => {
  if (!previewDialog.open) {
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    movePreview(-1);
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    movePreview(1);
  }
});

if (typeof mobileGalleryQuery.addEventListener === "function") {
  mobileGalleryQuery.addEventListener("change", renderGallery);
} else {
  mobileGalleryQuery.addListener(renderGallery);
}

favoritePosts = readFavorites();
applySettings(readSettings());
updateFilterLabels();
renderFavoriteSummary();
renderHistory();
setTags([]);
setAppView("home");
setInspectorMode("主页热门");
setCount(0);
runSearch(DEFAULT_HOME_TAGS, { saveToHistory: false, source: "home" });
