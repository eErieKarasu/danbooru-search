const DANBOORU_BASE_URL = "https://danbooru.donmai.us";
const RETRY_SLEEP_MS = 1400;
const REQUEST_SLEEP_MS = 700;
const MAX_RETRIES = 3;

const searchForm = document.querySelector("#searchForm");
const tagInput = document.querySelector("#tagInput");
const pagesInput = document.querySelector("#pagesInput");
const limitInput = document.querySelector("#limitInput");
const remoteTagInput = document.querySelector("#remoteTagInput");
const ratingInput = document.querySelector("#ratingInput");
const searchButton = document.querySelector("#searchButton");
const cancelButton = document.querySelector("#cancelButton");
const clearButton = document.querySelector("#clearButton");
const statusText = document.querySelector("#statusText");
const resultCount = document.querySelector("#resultCount");
const noticeBox = document.querySelector("#noticeBox");
const emptyState = document.querySelector("#emptyState");
const gallery = document.querySelector("#gallery");
const postTemplate = document.querySelector("#postTemplate");
const previewDialog = document.querySelector("#previewDialog");
const closeDialogButton = document.querySelector("#closeDialogButton");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogImage = document.querySelector("#dialogImage");
const dialogTags = document.querySelector("#dialogTags");
const dialogPostLink = document.querySelector("#dialogPostLink");
const dialogFileLink = document.querySelector("#dialogFileLink");

let activeController = null;

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

function renderPosts(posts) {
  gallery.replaceChildren();
  emptyState.hidden = posts.length > 0;

  if (posts.length === 0) {
    emptyState.querySelector("p").textContent = "没有找到符合条件的图片。可以减少本地过滤 tag 或增加页数。";
    return;
  }

  const fragment = document.createDocumentFragment();

  posts.forEach((post) => {
    const node = postTemplate.content.firstElementChild.cloneNode(true);
    const imageButton = node.querySelector(".image-button");
    const image = node.querySelector("img");
    const ratingBadge = node.querySelector(".rating-badge");
    const scoreLabel = node.querySelector(".score-label");
    const tags = node.querySelector(".post-tags");
    const postLink = node.querySelector(".post-link");
    const previewUrl = getPreviewUrl(post);

    image.src = previewUrl;
    image.alt = `Danbooru post ${post.id}`;
    ratingBadge.textContent = post.rating || "n/a";
    scoreLabel.textContent = `score ${post.score ?? 0}`;
    tags.textContent = getTagSummary(post) || `post ${post.id}`;
    postLink.href = `${DANBOORU_BASE_URL}/posts/${post.id}`;

    imageButton.addEventListener("click", () => openPreview(post));
    fragment.append(node);
  });

  gallery.append(fragment);
}

function openPreview(post) {
  const largeUrl = getLargeUrl(post);

  dialogTitle.textContent = `Post #${post.id}`;
  dialogImage.src = largeUrl;
  dialogImage.alt = `Danbooru post ${post.id}`;
  dialogTags.textContent = getTagSummary(post) || post.tag_string || "";
  dialogPostLink.href = `${DANBOORU_BASE_URL}/posts/${post.id}`;
  dialogFileLink.href = largeUrl;
  previewDialog.showModal();
}

function setStatus(message) {
  statusText.textContent = message;
}

function setCount(count) {
  resultCount.textContent = `${count} ${count === 1 ? "post" : "posts"}`;
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

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const tags = parseTags(tagInput.value);

  if (tags.length === 0) {
    showNotice("至少输入 1 个 tag。");
    return;
  }

  if (activeController) {
    activeController.abort();
  }

  activeController = new AbortController();
  hideNotice();
  setLoading(true);
  setCount(0);
  gallery.replaceChildren();
  emptyState.hidden = false;
  emptyState.querySelector("p").textContent = "正在搜索...";

  const options = getOptions();
  const { remoteTags, localTags } = splitRemoteAndLocalTags(tags, options.maxRemoteTags);
  setStatus(`远程 tag：${remoteTags.join(" ")}；本地过滤：${localTags.join(" ") || "无"}`);

  try {
    const posts = await searchPosts(tags, options, activeController.signal);
    renderPosts(posts);
    setStatus(`完成：${tags.join(" ")}，匹配 ${posts.length} 个 post`);
    setCount(posts.length);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("搜索已停止");
      emptyState.querySelector("p").textContent = "搜索已停止。";
    } else {
      showNotice(error.message || "请求失败，请稍后重试。");
      setStatus("请求失败");
      emptyState.querySelector("p").textContent = "没有可显示的结果。";
    }
  } finally {
    setLoading(false);
    activeController = null;
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

  tagInput.value = "";
  gallery.replaceChildren();
  hideNotice();
  setCount(0);
  setStatus("等待输入 tag");
  emptyState.hidden = false;
  emptyState.querySelector("p").textContent = "输入 tag 后，图片会显示在这里。";
  tagInput.focus();
});

document.querySelectorAll(".quick-tags button").forEach((button) => {
  button.addEventListener("click", () => {
    tagInput.value = button.dataset.tags || "";
    tagInput.focus();
  });
});

closeDialogButton.addEventListener("click", () => {
  previewDialog.close();
});

previewDialog.addEventListener("close", () => {
  dialogImage.removeAttribute("src");
});
