chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOWNLOAD_MEDIA') {
        chrome.downloads.download({
            url: message.url,
            filename: message.filename,
            conflictAction: 'uniquify',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('[InstaMediaAssist] Download failed:', chrome.runtime.lastError);
            } else {
                console.log('[InstaMediaAssist] Started download:', downloadId);
            }
        });
    }
});
