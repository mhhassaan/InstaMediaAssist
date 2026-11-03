// InstaMediaAssist - Content Script

function getCache() {
    try {
        const raw = sessionStorage.getItem('insta-media-cache');
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function startObserver() {
    if (!document.body) {
        setTimeout(startObserver, 100);
        return;
    }
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) injectDownloadButtons(node);
            });
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    injectDownloadButtons(document.body);
}

startObserver();

function makeDownloadButton(onClick) {
    const btn = document.createElement('button');
    btn.className = 'insta-download-btn';
    btn.type = 'button';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 16l-5-5h3V3h4v8h3l-5 5zm9 2v2H3v-2h18z" fill="currentColor"/></svg>';
    btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(btn);
    };
    return btn;
}

function injectDownloadButtons(root) {
    injectViaShareIcon(root);
    injectFallbackOverlay(root);
}

// Primary path: feed posts / reels page that expose a Share/Direct action icon.
function injectViaShareIcon(root) {
    const shareIcons = root.querySelectorAll('svg[aria-label="Share"], svg[aria-label="Direct"], svg[aria-label="Share Post"]');
    shareIcons.forEach(icon => {
        const iconContainer = icon.closest('div[role="button"]');
        if (!iconContainer || iconContainer.parentElement.querySelector('.insta-download-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'insta-download-wrapper';
        const btn = makeDownloadButton((b) => {
            const container = icon.closest('article') || icon.closest('div[role="presentation"]') || document.body;
            handleDownload(container, b);
        });

        wrapper.appendChild(btn);
        iconContainer.after(wrapper);
    });
}

// Fallback path: media opened in a modal/dialog that has no Share icon at all,
// e.g. a post or reel opened from a DM attachment. Overlay a button directly on the media.
function injectFallbackOverlay(root) {
    // Anchor on the media itself rather than the dialog shell: the dialog can
    // render empty first and have its video/image attached in a later mutation,
    // so we must catch that mutation too, not just the dialog's own creation.
    const mediaEls = [];
    if (root.matches && root.matches('video, img[srcset]')) mediaEls.push(root);
    root.querySelectorAll && root.querySelectorAll('video, img[srcset]').forEach(m => mediaEls.push(m));

    mediaEls.forEach(media => {
        const container = media.closest('div[role="dialog"]') || media.closest('article');
        if (!container) return;
        if (container.querySelector('.insta-download-wrapper')) return;
        if (container.querySelector('svg[aria-label="Share"], svg[aria-label="Direct"], svg[aria-label="Share Post"]')) return;

        const mediaParent = media.parentElement || container;
        if (getComputedStyle(mediaParent).position === 'static') {
            mediaParent.style.position = 'relative';
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'insta-download-wrapper insta-download-overlay';
        const btn = makeDownloadButton((b) => handleDownload(container, b));
        wrapper.appendChild(btn);
        mediaParent.appendChild(wrapper);
    });
}

// Polls the cache for a short window so we don't give up (or grab only the
// thumbnail) while the real video_versions response is still in flight.
function waitForMedia(shortcode, expectVideo, attemptsLeft = 10, delayMs = 300) {
    return new Promise(resolve => {
        function check(remaining) {
            const list = getCache()[shortcode];
            const hasVideo = !!(list && list.some(item => item.type === 'video'));
            if ((list && list.length && (!expectVideo || hasVideo)) || remaining <= 0) {
                resolve(list || null);
                return;
            }
            setTimeout(() => check(remaining - 1), delayMs);
        }
        check(attemptsLeft);
    });
}

// Collapses multiple cache entries for the same slot into one, preferring
// video over image, so a single post never downloads both a thumbnail and a video.
function dedupeBySlot(mediaList) {
    const bySlot = new Map();
    mediaList.forEach(item => {
        const key = item.index ?? 'single';
        const current = bySlot.get(key);
        if (!current || (item.type === 'video' && current.type === 'image')) {
            bySlot.set(key, item);
        }
    });
    return Array.from(bySlot.values());
}

async function handleDownload(container, btn) {
    let shortcode = null;

    // Helper to clean shortcodes from tracking params
    const cleanId = (id) => id ? id.split('?')[0].split('#')[0] : null;

    // 1. Try finding ID in links
    const links = container.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
    for (const link of links) {
        const match = link.href.match(/\/(p|reel|reels)\/([^/]+)/);
        if (match) {
            const rawId = match[2];
            if (rawId !== 'audio' && rawId !== 'activity' && rawId !== 'reels_tab') {
                shortcode = cleanId(rawId);
                break;
            }
        }
    }

    // 2. Fallback: Check current URL
    if (!shortcode) {
        const match = window.location.href.match(/\/(p|reel|reels)\/([^/]+)/);
        if (match) shortcode = cleanId(match[2]);
    }

    // 3. Fallback: Check timestamp
    if (!shortcode) {
        const timeLink = container.querySelector('time')?.closest('a');
        if (timeLink) {
            const match = timeLink.href.match(/\/(p|reel|reels)\/([^/]+)/);
            if (match) shortcode = cleanId(match[2]);
        }
    }

    if (shortcode && shortcode !== 'audio') {
        const expectVideo = !!container.querySelector('video');
        if (btn) btn.classList.add('insta-download-pending');
        const rawList = await waitForMedia(shortcode, expectVideo);
        if (btn) btn.classList.remove('insta-download-pending');

        if (rawList && rawList.length > 0) {
            const mediaList = dedupeBySlot(rawList);
            mediaList.forEach((item, idx) => {
                const suffix = mediaList.length > 1 ? `-${idx + 1}` : '';
                const ext = item.type === 'video' ? 'mp4' : 'jpg';
                const filename = `${item.username}-${shortcode}${suffix}.${ext}`;

                chrome.runtime.sendMessage({
                    type: 'DOWNLOAD_MEDIA',
                    url: item.url,
                    filename: filename
                });
            });
        } else {
            alert('High-quality media for "' + shortcode + '" not yet captured. Try scrolling slightly.');
        }
    } else {
        alert('Could not identify the post ID.');
    }
}
