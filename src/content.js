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

function injectDownloadButtons(root) {
    const shareIcons = root.querySelectorAll('svg[aria-label="Share"], svg[aria-label="Direct"], svg[aria-label="Share Post"]');
    shareIcons.forEach(icon => {
        const iconContainer = icon.closest('div[role="button"]');
        if (!iconContainer || iconContainer.parentElement.querySelector('.insta-download-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'insta-download-wrapper';
        const btn = document.createElement('button');
        btn.className = 'insta-download-btn';
        btn.type = 'button';
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M12 16l-5-5h3V3h4v8h3l-5 5zm9 2v2H3v-2h18z" fill="currentColor"/></svg>';
        
        btn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const container = icon.closest('article') || icon.closest('div[role="presentation"]') || document.body;
            handleDownload(container);
        };

        wrapper.appendChild(btn);
        iconContainer.after(wrapper);
    });
}

function handleDownload(container) {
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
        const cache = getCache();
        const mediaList = cache[shortcode];

        if (mediaList && mediaList.length > 0) {
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
