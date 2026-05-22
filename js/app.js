const DANBOORU_BASE_URL = "https://danbooru.donmai.us";
const RETRY_SLEEP_MS = 1400;
const REQUEST_SLEEP_MS = 700;
const MAX_RETRIES = 3;
const HISTORY_KEY = "danbooru-search-history";
const FAVORITES_KEY = "danbooru-search-favorites";
const MAX_HISTORY_ITEMS = 15;
const DEFAULT_MAX_REMOTE_TAGS = 2;
const DEFAULT_RATING = "any";
const REMOTE_FETCH_LIMIT = 100;
const DEFAULT_TARGET_POSTS = 150;
const DIALOG_TAG_PREVIEW_LIMIT = 14;

const searchForm = document.querySelector("#searchForm");
const tagInput = document.querySelector("#tagInput");
const selectedTagsBox = document.querySelector("#selectedTags");
const countInput = document.querySelector("#countInput");
const searchButton = document.querySelector("#searchButton");
const stopSearchButton = document.querySelector("#stopSearchButton");
const clearButton = document.querySelector("#clearButton");
const showFavoritesButton = document.querySelector("#showFavoritesButton");
const clearFavoritesButton = document.querySelector("#clearFavoritesButton");
const favoriteSummary = document.querySelector("#favoriteSummary");
const clearHistoryButton = document.querySelector("#clearHistoryButton");
const currentTags = document.querySelector("#currentTags");
const progressBar = document.querySelector("#progressBar");
const statusText = document.querySelector("#statusText");
const resultCount = document.querySelector("#resultCount");
const noticeBox = document.querySelector("#noticeBox");
const emptyState = document.querySelector("#emptyState");
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
const dialogTags = document.querySelector("#dialogTags");
const dialogDimensions = document.querySelector("#dialogDimensions");
const dialogSize = document.querySelector("#dialogSize");
const dialogPostLink = document.querySelector("#dialogPostLink");
const dialogFileLink = document.querySelector("#dialogFileLink");
const mobileGalleryQuery = window.matchMedia("(max-width: 820px)");

let activeController = null;
let selectedTags = [];
let allPosts = [];
let searchPostsCache = [];
let favoritePosts = new Map();
let isFavoritesView = false;
let activePreviewIndex = -1;
let activePreviewPost = null;
let previewScrollY = 0;

const RATING_LABELS = {
  g: "GENERAL",
  s: "SAFE",
  q: "QUESTIONABLE",
  e: "EXPLICIT",
  any: "ALL",
};

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

function renderDialogTags(post, { expanded = false } = {}) {
  const previewTags = getPreviewTags(post);
  const visibleTags = expanded
    ? previewTags
    : previewTags.slice(0, DIALOG_TAG_PREVIEW_LIMIT);
  const hiddenCount = Math.max(previewTags.length - visibleTags.length, 0);
  const fragment = document.createDocumentFragment();

  visibleTags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "dialog-tag-chip";
    chip.textContent = tag;
    fragment.append(chip);
  });

  if (!expanded && hiddenCount > 0) {
    const moreChip = document.createElement("button");
    moreChip.type = "button";
    moreChip.className = "dialog-tag-chip dialog-tag-more";
    moreChip.textContent = `+ ${hiddenCount} 更多`;
    moreChip.setAttribute("aria-label", `展开全部 ${previewTags.length} 个标签`);
    moreChip.addEventListener("click", () => {
      renderDialogTags(post, { expanded: true });
    });
    fragment.append(moreChip);
  }

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

function createFavoriteSnapshot(post) {
  const size = getPostSize(post);
  const tags = getPreviewTags(post);

  return normalizeFavoritePost({
    id: post.id,
    rating: post.rating,
    score: post.score,
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
  });

  if (dialogFavoriteButton.dataset.favoritePostId) {
    updateFavoriteButton(dialogFavoriteButton);
  }
}

function renderFavoriteSummary() {
  const count = favoritePosts.size;
  const title = showFavoritesButton.querySelector("strong");

  favoriteSummary.textContent =
    count > 0 ? `${count.toLocaleString("zh-CN")} 张已收藏` : "暂无收藏";
  title.textContent = isFavoritesView ? "返回搜索" : "查看收藏";
  showFavoritesButton.disabled = count === 0 && !isFavoritesView;
  showFavoritesButton.classList.toggle("is-active", isFavoritesView);
  showFavoritesButton.setAttribute("aria-pressed", String(isFavoritesView));
  clearFavoritesButton.disabled = count === 0;
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
    showFavoritePosts();
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
  const tags = node.querySelector(".post-tags");
  const postLink = node.querySelector(".post-link");
  const favoriteButton = node.querySelector(".favorite-button-card");
  const previewUrl = getPreviewUrl(post);

  node.dataset.postIndex = String(index);
  node.style.setProperty("--post-aspect-ratio", getPostAspectRatioValue(post));
  image.src = previewUrl;
  image.alt = `Danbooru post ${post.id}`;
  ratingBadge.textContent = formatRating(post.rating);
  ratingBadge.classList.add(`rating-${post.rating || "unknown"}`);
  scoreLabel.textContent = `score ${post.score ?? 0}`;
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

function renderPosts(posts, { resetPage = true, showEmptyResult = true } = {}) {
  allPosts = posts;
  if (resetPage) {
    activePreviewIndex = -1;
  }
  emptyState.hidden = posts.length > 0;

  if (posts.length === 0) {
    if (showEmptyResult) {
      emptyState.querySelector("p").textContent = "没有找到符合条件的图片。";
      emptyState.querySelector("span").textContent = "可以减少本地过滤 tag 或增加图片数量。";
    }
    renderGallery();
    setCount(0);
    return;
  }

  renderGallery();
  setCount(posts.length);
}

function showFavoritePosts() {
  if (activeController) {
    activeController.abort();
    activeController = null;
    setLoading(false);
  }

  const favorites = getFavoritePosts();
  isFavoritesView = true;
  activePreviewIndex = -1;
  hideNotice();
  setProgress(0);
  renderCurrentTags(["本地收藏"], 1);
  renderPosts(favorites, { resetPage: true, showEmptyResult: false });

  if (favorites.length === 0) {
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent = "暂无收藏。";
    emptyState.querySelector("span").textContent = "点击图片上的爱心后，会在这里汇总。";
    setStatus("暂无收藏");
  } else {
    setStatus(`${favorites.length.toLocaleString("zh-CN")} 张收藏已显示`);
  }

  renderFavoriteSummary();
  syncFavoriteButtons();
}

function restoreSearchPosts() {
  isFavoritesView = false;
  activePreviewIndex = -1;
  hideNotice();
  setProgress(searchPostsCache.length > 0 ? 100 : 0);
  renderCurrentTags(getPendingTags(), getOptions().maxRemoteTags);
  renderPosts(searchPostsCache, { resetPage: true, showEmptyResult: false });

  if (searchPostsCache.length > 0) {
    setStatus(`${searchPostsCache.length.toLocaleString("zh-CN")} 张图片已显示`);
  } else {
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent = "输入 tag 后，图片会显示在这里。";
    emptyState.querySelector("span").textContent = "默认使用 All 评级和本地过滤。";
    setStatus("等待输入 tag");
  }

  renderFavoriteSummary();
  syncFavoriteButtons();
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
  updateFavoriteButton(dialogFavoriteButton, post);
  dialogScorePill.textContent = `${post.score ?? 0} 分`;
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

  if (!previewDialog.open) {
    previewDialog.showModal();
    previewDialog.focus({ preventScroll: true });
  }
}

function setStatus(message) {
  statusText.textContent = message;
}

function setProgress(percent) {
  const safePercent = Math.min(Math.max(Number(percent) || 0, 0), 100);
  progressBar.style.width = `${safePercent}%`;
}

function setCount(count) {
  resultCount.textContent = formatCount(count);
}

function renderCurrentTags(tags = [], maxRemoteTags = 2) {
  currentTags.replaceChildren();

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
    rating: DEFAULT_RATING,
  };
}

async function runSearch(tags) {
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

  isFavoritesView = false;
  searchPostsCache = [];
  renderFavoriteSummary();

  const controller = new AbortController();
  activeController = controller;
  hideNotice();
  setLoading(true);
  setCount(0);
  setProgress(0);
  renderCurrentTags(tags, options.maxRemoteTags);
  allPosts = [];
  activePreviewIndex = -1;
  gallery.replaceChildren();
  setCount(0);
  emptyState.hidden = false;
  emptyState.querySelector("p").textContent = "正在搜索...";
  emptyState.querySelector("span").textContent =
    `${remoteTags.join(" ")} · ${localTags.join(" ") || "无本地过滤"} · 目标 ${options.targetCount} 张`;
  setStatus(
    `远程 tag：${remoteTags.join(" ")}；本地过滤：${localTags.join(" ") || "无"}；评级：All`
  );

  try {
    const posts = await searchPosts(tags, options, controller.signal, (partialPosts, page) => {
      if (activeController !== controller) {
        return;
      }

      searchPostsCache = partialPosts;
      renderPosts(partialPosts, { resetPage: false, showEmptyResult: false });

      if (partialPosts.length > 0) {
        setStatus(
          `已显示 ${partialPosts.length.toLocaleString("zh-CN")} 张，继续请求远程第 ${page + 1} 页`
        );
      }
    });

    if (activeController !== controller) {
      return;
    }

    searchPostsCache = posts;
    renderPosts(posts, { resetPage: allPosts.length === 0 });
    setStatus(`${posts.length.toLocaleString("zh-CN")} 张图片已显示`);
    setProgress(100);
    saveHistory(tags);
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
        emptyState.hidden = false;
        emptyState.querySelector("p").textContent = "搜索已停止。";
        emptyState.querySelector("span").textContent = "可以调整 tag 后重新搜索。";
      }
    } else {
      showNotice(error.message || "请求失败，请稍后重试。");
      setStatus("请求失败");
      emptyState.querySelector("p").textContent = "没有可显示的结果。";
      emptyState.querySelector("span").textContent = "请检查网络或稍后重试。";
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
  runSearch(selectedTags);
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
  isFavoritesView = false;
  activePreviewIndex = -1;
  gallery.replaceChildren();
  hideNotice();
  setCount(0);
  setProgress(0);
  renderSelectedTags();
  renderFavoriteSummary();
  renderCurrentTags();
  setStatus("等待输入 tag");
  emptyState.hidden = false;
  emptyState.querySelector("p").textContent = "输入 tag 后，图片会显示在这里。";
  emptyState.querySelector("span").textContent = "默认使用 All 评级和本地过滤。";
  tagInput.focus();
});

showFavoritesButton.addEventListener("click", () => {
  if (isFavoritesView) {
    restoreSearchPosts();
  } else {
    showFavoritePosts();
  }
});

clearFavoritesButton.addEventListener("click", () => {
  if (favoritePosts.size === 0) {
    return;
  }

  if (!window.confirm("清空所有收藏？")) {
    return;
  }

  favoritePosts.clear();
  writeFavorites();
  renderFavoriteSummary();
  syncFavoriteButtons();

  if (isFavoritesView) {
    showFavoritePosts();
  }
});

clearHistoryButton.addEventListener("click", () => {
  writeHistory([]);
  renderHistory();
});

historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".history-tag");

  if (!item) {
    return;
  }

  addTags([item.dataset.tag || ""]);
  tagInput.focus();
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

dialogImage.addEventListener("click", () => {
  previewDialog.close();
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
  dialogImage.removeAttribute("src");
  dialogFavoriteButton.removeAttribute("data-favorite-post-id");
  activePreviewPost = null;

  window.requestAnimationFrame(() => {
    window.scrollTo({ top: previewScrollY, left: 0, behavior: "auto" });
  });
});

if (typeof mobileGalleryQuery.addEventListener === "function") {
  mobileGalleryQuery.addEventListener("change", renderGallery);
} else {
  mobileGalleryQuery.addListener(renderGallery);
}

favoritePosts = readFavorites();
renderFavoriteSummary();
renderHistory();
renderSelectedTags();
renderCurrentTags();
