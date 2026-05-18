const DANBOORU_BASE_URL = "https://danbooru.donmai.us";
const RETRY_SLEEP_MS = 1400;
const REQUEST_SLEEP_MS = 700;
const MAX_RETRIES = 3;
const HISTORY_KEY = "danbooru-search-history";
const MAX_HISTORY_ITEMS = 9;
const POPULAR_TAG_LIMIT = 12;
const POPULAR_TAG_REQUEST_LIMIT = 36;

const searchForm = document.querySelector("#searchForm");
const tagInput = document.querySelector("#tagInput");
const selectedTagsBox = document.querySelector("#selectedTags");
const pagesInput = document.querySelector("#pagesInput");
const limitInput = document.querySelector("#limitInput");
const remoteTagInput = document.querySelector("#remoteTagInput");
const ratingInput = document.querySelector("#ratingInput");
const searchButton = document.querySelector("#searchButton");
const cancelButton = document.querySelector("#cancelButton");
const clearButton = document.querySelector("#clearButton");
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
const popularTags = document.querySelector("#popularTags");
const previewDialog = document.querySelector("#previewDialog");
const closeDialogButton = document.querySelector("#closeDialogButton");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogMedia = document.querySelector("#dialogMedia");
const dialogImage = document.querySelector("#dialogImage");
const prevPostButton = document.querySelector("#prevPostButton");
const nextPostButton = document.querySelector("#nextPostButton");
const metaToggleButton = document.querySelector("#metaToggleButton");
const dialogTags = document.querySelector("#dialogTags");
const dialogRating = document.querySelector("#dialogRating");
const dialogScore = document.querySelector("#dialogScore");
const dialogDimensions = document.querySelector("#dialogDimensions");
const dialogSize = document.querySelector("#dialogSize");
const dialogPostLink = document.querySelector("#dialogPostLink");
const dialogFileLink = document.querySelector("#dialogFileLink");
const mobileGalleryQuery = window.matchMedia("(max-width: 820px)");

let activeController = null;
let selectedTags = [];
let currentPosts = [];
let activePreviewIndex = -1;
let previewScrollY = 0;
let previewTouchStart = null;

const RATING_LABELS = {
  g: "GENERAL",
  s: "SAFE",
  q: "QUESTIONABLE",
  e: "EXPLICIT",
  any: "ALL",
};

const FALLBACK_POPULAR_TAGS = [
  { name: "1girl" },
  { name: "solo" },
  { name: "long_hair" },
  { name: "looking_at_viewer" },
  { name: "smile" },
  { name: "blue_archive" },
  { name: "white_hair" },
  { name: "original" },
  { name: "school_uniform" },
  { name: "landscape" },
  { name: "cat" },
  { name: "flower" },
];

const POPULAR_TAG_BLOCKLIST = new Set([
  "ass",
  "areolae",
  "breasts",
  "cleavage",
  "cum",
  "large_breasts",
  "medium_breasts",
  "naked",
  "nipples",
  "nude",
  "panties",
  "penis",
  "pussy",
  "sex",
  "small_breasts",
  "underwear",
]);

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

function formatPostCount(count) {
  const value = Number(count);

  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }

  if (value >= 1000) {
    return `${Math.round(value / 1000)}K`;
  }

  return String(value);
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

  return `${size.width}x${size.height}`;
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

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
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
        await sleep(RETRY_SLEEP_MS * attempt);
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
      await sleep(RETRY_SLEEP_MS * attempt);
    }
  }

  throw lastError || new Error("请求失败");
}

async function searchPosts(tags, options, signal) {
  const { remoteTags, localTags } = splitRemoteAndLocalTags(tags, options.maxRemoteTags);
  const remoteQuery = remoteTags.join(" ");
  const posts = [];

  for (let page = 1; page <= options.pages; page += 1) {
    const params = new URLSearchParams({
      tags: remoteQuery,
      limit: String(options.limit),
      page: String(page),
    });

    setStatus(`请求第 ${page}/${options.pages} 页：${remoteQuery}`);
    setProgress(((page - 1) / options.pages) * 100);

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

    setCount(deduplicatePosts(posts).length);
    setProgress((page / options.pages) * 100);

    if (pagePosts.length < options.limit) {
      break;
    }

    if (page < options.pages) {
      await sleep(REQUEST_SLEEP_MS);
    }
  }

  return deduplicatePosts(posts);
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
    getVariant(post, "sample") ||
    getVariant(post, "720x720") ||
    post.large_file_url ||
    post.file_url ||
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

function readHistory() {
  try {
    const rawHistory = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(rawHistory) ? rawHistory.filter(Array.isArray).map(uniqueTags) : [];
  } catch {
    return [];
  }
}

function writeHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)));
  } catch {
    // Ignore storage failures; search should keep working without history.
  }
}

function saveHistory(tags) {
  const normalizedTags = uniqueTags(tags);

  if (normalizedTags.length === 0) {
    return;
  }

  const key = normalizedTags.join(" ");
  const history = readHistory().filter((item) => item.join(" ") !== key);
  writeHistory([normalizedTags, ...history]);
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

  history.forEach((tags) => {
    const button = document.createElement("button");
    button.className = "history-item";
    button.type = "button";
    button.dataset.tags = tags.join(" ");
    button.innerHTML = `
      <span class="history-clock" aria-hidden="true"></span>
      <span class="history-label"></span>
      <span class="history-return" aria-hidden="true"></span>
    `;
    button.querySelector(".history-label").textContent = tags.join(" ");
    historyList.append(button);
  });
}

function renderPopularTags(tags, sourceLabel = "") {
  popularTags.replaceChildren();

  tags
    .filter((tag) => !POPULAR_TAG_BLOCKLIST.has(normalizeTag(tag.name)))
    .slice(0, POPULAR_TAG_LIMIT)
    .forEach((tag) => {
      const name = normalizeTag(tag.name);

      if (!name) {
        return;
      }

      const button = document.createElement("button");
      const countLabel = formatPostCount(tag.post_count);
      button.type = "button";
      button.dataset.tags = name;
      button.title = countLabel ? `${name} · ${countLabel} posts${sourceLabel}` : name;

      const label = document.createElement("span");
      label.className = "popular-name";
      label.textContent = name;
      button.append(label);

      if (countLabel) {
        const count = document.createElement("span");
        count.className = "popular-count";
        count.textContent = countLabel;
        button.append(count);
      }

      popularTags.append(button);
    });
}

async function loadPopularTags() {
  const params = new URLSearchParams({
    limit: String(POPULAR_TAG_REQUEST_LIMIT),
    "search[category]": "0",
    "search[hide_empty]": "yes",
    "search[is_deprecated]": "no",
    "search[order]": "count",
  });

  try {
    const tags = await fetchJsonWithRetry(`${DANBOORU_BASE_URL}/tags.json?${params.toString()}`);

    if (!Array.isArray(tags) || tags.length === 0) {
      throw new Error("Danbooru 没有返回 tag 数据");
    }

    renderPopularTags(tags, " · Danbooru");
  } catch {
    renderPopularTags(FALLBACK_POPULAR_TAGS, " · fallback");
  }
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

  if (currentPosts.length === 0) {
    return;
  }

  if (shouldUseMobileMasonry()) {
    renderMobileMasonry(currentPosts);
  } else {
    renderFlatGallery(currentPosts);
  }

  if (activePreviewIndex >= 0) {
    setSelectedPost(activePreviewIndex);
  }
}

function renderPosts(posts) {
  currentPosts = posts;
  activePreviewIndex = -1;
  emptyState.hidden = posts.length > 0;

  if (posts.length === 0) {
    emptyState.querySelector("p").textContent = "没有找到符合条件的图片。";
    emptyState.querySelector("span").textContent = "可以减少本地过滤 tag 或增加页数。";
    renderGallery();
    return;
  }

  renderGallery();
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

  setSelectedPost(index);
  dialogTitle.textContent = `Post #${post.id} · ${index + 1}/${currentPosts.length}`;
  dialogImage.src = largeUrl;
  dialogImage.alt = `Danbooru post ${post.id}`;
  dialogTags.textContent = getTagSummary(post) || post.tag_string || "";
  dialogRating.textContent = formatRating(post.rating);
  dialogScore.textContent = String(post.score ?? 0);
  dialogDimensions.textContent = getDimensions(post);
  dialogSize.textContent = formatBytes(post.file_size || post.media_asset?.file_size);
  dialogPostLink.href = `${DANBOORU_BASE_URL}/posts/${post.id}`;
  dialogFileLink.href = largeUrl;
  prevPostButton.hidden = currentPosts.length < 2;
  nextPostButton.hidden = currentPosts.length < 2;
}

function openPreview(index) {
  const post = currentPosts[index];

  if (!post) {
    return;
  }

  previewScrollY = window.scrollY;
  activePreviewIndex = index;
  previewDialog.classList.remove("is-meta-open");
  metaToggleButton.setAttribute("aria-expanded", "false");
  updatePreview(post, index);

  if (!previewDialog.open) {
    previewDialog.showModal();
  }
}

function navigatePreview(direction) {
  if (currentPosts.length < 2 || activePreviewIndex < 0) {
    return;
  }

  const nextIndex = (activePreviewIndex + direction + currentPosts.length) % currentPosts.length;
  const nextPost = currentPosts[nextIndex];

  if (!nextPost) {
    return;
  }

  activePreviewIndex = nextIndex;
  updatePreview(nextPost, nextIndex);
}

function handlePreviewTouchStart(event) {
  if (event.touches.length !== 1) {
    previewTouchStart = null;
    return;
  }

  const touch = event.touches[0];
  previewTouchStart = {
    x: touch.clientX,
    y: touch.clientY,
    time: Date.now(),
  };
}

function handlePreviewTouchEnd(event) {
  if (!previewTouchStart || event.changedTouches.length === 0) {
    return;
  }

  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - previewTouchStart.x;
  const deltaY = touch.clientY - previewTouchStart.y;
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  const elapsed = Date.now() - previewTouchStart.time;
  previewTouchStart = null;

  if (elapsed > 900) {
    return;
  }

  if (absX > 58 && absX > absY * 1.15) {
    navigatePreview(deltaX < 0 ? 1 : -1);
    return;
  }

  if (deltaY > 96 && absX < 84) {
    previewDialog.close();
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
  cancelButton.hidden = !isLoading;
}

function getOptions() {
  return {
    pages: Math.min(Math.max(Number(pagesInput.value) || 1, 1), 20),
    limit: Math.min(Math.max(Number(limitInput.value) || 100, 1), 100),
    maxRemoteTags: Math.min(Math.max(Number(remoteTagInput.value) || 2, 1), 2),
    rating: ratingInput.value,
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

  activeController = new AbortController();
  hideNotice();
  setLoading(true);
  setCount(0);
  setProgress(0);
  renderCurrentTags(tags, options.maxRemoteTags);
  currentPosts = [];
  activePreviewIndex = -1;
  gallery.replaceChildren();
  emptyState.hidden = false;
  emptyState.querySelector("p").textContent = "正在搜索...";
  emptyState.querySelector("span").textContent = `${remoteTags.join(" ")} · ${localTags.join(" ") || "无本地过滤"}`;
  setStatus(`远程 tag：${remoteTags.join(" ")}；本地过滤：${localTags.join(" ") || "无"}`);

  try {
    const posts = await searchPosts(tags, options, activeController.signal);
    renderPosts(posts);
    setStatus(`约 ${posts.length.toLocaleString("zh-CN")} 张图片`);
    setCount(posts.length);
    setProgress(100);
    saveHistory(tags);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("搜索已停止");
      emptyState.querySelector("p").textContent = "搜索已停止。";
      emptyState.querySelector("span").textContent = "可以调整 tag 后重新搜索。";
    } else {
      showNotice(error.message || "请求失败，请稍后重试。");
      setStatus("请求失败");
      emptyState.querySelector("p").textContent = "没有可显示的结果。";
      emptyState.querySelector("span").textContent = "请检查网络或稍后重试。";
    }
  } finally {
    setLoading(false);
    activeController = null;
  }
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

cancelButton.addEventListener("click", () => {
  if (activeController) {
    activeController.abort();
  }
});

clearButton.addEventListener("click", () => {
  if (activeController) {
    activeController.abort();
  }

  selectedTags = [];
  tagInput.value = "";
  currentPosts = [];
  activePreviewIndex = -1;
  gallery.replaceChildren();
  hideNotice();
  setCount(0);
  setProgress(0);
  renderSelectedTags();
  renderCurrentTags();
  setStatus("等待输入 tag");
  emptyState.hidden = false;
  emptyState.querySelector("p").textContent = "输入 tag 后，图片会显示在这里。";
  emptyState.querySelector("span").textContent = "默认使用 Safe 评级和本地过滤。";
  tagInput.focus();
});

clearHistoryButton.addEventListener("click", () => {
  writeHistory([]);
  renderHistory();
});

popularTags.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-tags]");

  if (!button) {
    return;
  }

  addTags(parseTags(button.dataset.tags || ""));
  tagInput.focus();
});

historyList.addEventListener("click", (event) => {
  const item = event.target.closest(".history-item");

  if (!item) {
    return;
  }

  setTags(parseTags(item.dataset.tags || ""));
  runSearch(selectedTags);
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

prevPostButton.addEventListener("click", () => {
  navigatePreview(-1);
});

nextPostButton.addEventListener("click", () => {
  navigatePreview(1);
});

metaToggleButton.addEventListener("click", () => {
  const isOpen = !previewDialog.classList.contains("is-meta-open");
  previewDialog.classList.toggle("is-meta-open", isOpen);
  metaToggleButton.setAttribute("aria-expanded", String(isOpen));
});

dialogMedia.addEventListener("touchstart", handlePreviewTouchStart, { passive: true });
dialogMedia.addEventListener("touchend", handlePreviewTouchEnd, { passive: true });

closeDialogButton.addEventListener("click", () => {
  previewDialog.close();
});

previewDialog.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    navigatePreview(-1);
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    navigatePreview(1);
  }
});

previewDialog.addEventListener("close", () => {
  dialogImage.removeAttribute("src");
  previewDialog.classList.remove("is-meta-open");
  metaToggleButton.setAttribute("aria-expanded", "false");

  window.requestAnimationFrame(() => {
    window.scrollTo({ top: previewScrollY, left: 0, behavior: "auto" });
  });
});

if (typeof mobileGalleryQuery.addEventListener === "function") {
  mobileGalleryQuery.addEventListener("change", renderGallery);
} else {
  mobileGalleryQuery.addListener(renderGallery);
}

renderHistory();
renderSelectedTags();
renderCurrentTags();
loadPopularTags();
