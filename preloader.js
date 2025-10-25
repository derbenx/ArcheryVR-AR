(function() {
    const progressBar = document.getElementById('progress-bar');
    const statusText = document.getElementById('status');
    const retryButton = document.getElementById('retry-button');

    if ('serviceWorker' in navigator) {
        // Listen for messages from the Service Worker
        navigator.serviceWorker.addEventListener('message', event => {
            const data = event.data;
            if (data.type === 'progress') {
                const percent = Math.round((data.loaded / data.total) * 100);
                progressBar.style.width = percent + '%';
                statusText.textContent = `Downloading: ${data.file} (${data.loaded}/${data.total})`;
            } else if (data.type === 'complete') {
                progressBar.style.width = '100%';
                statusText.textContent = 'All assets loaded! Starting game...';
                setTimeout(() => {
                    window.location.href = '/game.html';
                }, 500);
            } else if (data.type === 'error') {
                progressBar.style.backgroundColor = '#ff0000'; // Change bar to red
                progressBar.style.width = '100%';
                statusText.textContent = `Error: ${data.message}. Please try again.`;
                retryButton.style.display = 'block'; // Show the retry button
            }
        });

        // Add click listener for the retry button
        retryButton.addEventListener('click', () => {
            retryButton.disabled = true;
            statusText.textContent = 'Retrying...';
            // Simply reload the page to trigger a new installation attempt.
            // The intelligent SW will only download missing files.
            location.reload();
        });

        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('Service Worker registered with scope:', registration.scope);
                if (registration.active && navigator.serviceWorker.controller) {
                    statusText.textContent = 'Assets already cached. Starting game...';
                    progressBar.style.width = '100%';
                    setTimeout(() => {
                        window.location.href = '/game.html';
                    }, 250);
                } else if (registration.installing) {
                    statusText.textContent = 'Found new version. Downloading assets...';
                } else {
                    statusText.textContent = 'Waiting for service worker...';
                }
            })
            .catch(error => {
                console.error('Service Worker registration failed:', error);
                statusText.textContent = 'Error: Could not load game assets. Please try refreshing.';
                retryButton.style.display = 'block';
            });

    } else {
        statusText.textContent = 'Service Workers are not supported. Game cannot be pre-cached.';
    }
})();
