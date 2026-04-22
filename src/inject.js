(function() {
    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        const url = (typeof args[0] === 'string') ? args[0] : args[0].url;
        tryInterceptResponse(url, response.clone());
        return response;
    };

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        return originalXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        this.addEventListener('load', function() {
            if (this.responseType !== '' && this.responseType !== 'text') return;
            try {
                tryInterceptRawResponse(this._url, this.responseText);
            } catch (e) {}
        });
        return originalXHRSend.apply(this, args);
    };

    async function tryInterceptResponse(url, response) {
        if (!shouldIntercept(url)) return;
        try {
            const text = await response.text();
            tryInterceptRawResponse(url, text);
        } catch (e) {}
    }

    function tryInterceptRawResponse(url, text) {
        if (!shouldIntercept(url)) return;
        try {
            const json = JSON.parse(text);
            const medias = findInstagramMedia(json);
            if (medias.length > 0) {
                const existing = JSON.parse(sessionStorage.getItem('insta-media-cache') || '{}');
                medias.forEach(m => {
                    if (!existing[m.id]) existing[m.id] = [];
                    
                    const existingIndex = existing[m.id].findIndex(ex => ex.index === m.index);
                    
                    if (existingIndex !== -1) {
                        const existingMedia = existing[m.id][existingIndex];
                        if (m.type === 'video' && existingMedia.type === 'image') {
                            existing[m.id][existingIndex] = m;
                        }
                    } else {
                        existing[m.id].push(m);
                    }
                });
                sessionStorage.setItem('insta-media-cache', JSON.stringify(existing));
                window.postMessage({ source: 'insta-media-assist', type: 'MEDIA_EXTRACTED' }, '*');
            }
        } catch (e) {}
    }

    function shouldIntercept(url) {
        return url.includes('/graphql/query') || url.includes('/api/v1/');
    }

    function findInstagramMedia(obj) {
        const results = [];
        const seen = new WeakSet();

        function _traverse(current) {
            if (!current || typeof current !== 'object' || seen.has(current)) return;
            seen.add(current);

            // Clean shortcode (remove tracking params if they leaked into the JSON)
            let shortcode = current.code || current.shortcode;
            if (shortcode && typeof shortcode === 'string') {
                shortcode = shortcode.split('?')[0].split('#')[0];
                const username = current.user?.username || current.owner?.username || 'unknown';
                
                if (current.carousel_media) {
                    current.carousel_media.forEach((item, idx) => {
                        const media = extractUrls(item, shortcode, username, idx + 1);
                        if (media) results.push(media);
                    });
                } else if (current.edge_sidecar_to_children?.edges) {
                    current.edge_sidecar_to_children.edges.forEach((edge, idx) => {
                        const media = extractUrls(edge.node, shortcode, username, idx + 1);
                        if (media) results.push(media);
                    });
                } else {
                    const media = extractUrls(current, shortcode, username);
                    if (media) results.push(media);
                }
            }

            for (const key in current) {
                _traverse(current[key]);
            }
        }

        function extractUrls(node, shortcode, username, index = null) {
            let type, url;
            // 1. Prioritize Video (Avoid capturing both pic + video)
            if (node.video_versions?.length > 0) {
                type = 'video';
                url = node.video_versions.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0].url;
            } 
            else if (node.image_versions2?.candidates?.length > 0) {
                type = 'image';
                url = node.image_versions2.candidates.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0].url;
            }
            else if (node.display_resources?.length > 0) {
                type = 'image';
                url = node.display_resources.sort((a, b) => (b.config_width * b.config_height) - (a.config_width * a.config_height))[0].src;
            }

            if (url) return { id: shortcode, username, type, url, index };
            return null;
        }

        _traverse(obj);
        return results;
    }
})();
