document.addEventListener('DOMContentLoaded', async () => {
	// Connect to the background script
	browser.runtime.connect({ name: 'sidebar-port' });

	// --- Element Selectors ---
	const setupView = document.getElementById('setup-view');
    const setupFailedView = document.getElementById('setup-failed-view');
	const loginView = document.getElementById('login-view');
	const playerView = document.getElementById('player-view');
	const statusView = document.getElementById('status-view');
	const bottomControls = document.getElementById('bottom-controls');
	const logoutButton = document.getElementById('logout-button');
	const optionsButton = document.getElementById('options-button');
	const openSetupButton = document.getElementById('open-setup-button');
    const retrySetupButton = document.getElementById('retry-setup-button');
	const loginButton = document.getElementById('login-button');
    const goToSetupLink = document.getElementById('go-to-setup-link');
    const loginHelpLink = document.getElementById('login-help-link');
	const albumArt = document.getElementById('album-art');
	const albumArtWrapper = document.querySelector('.album-art-wrapper');
	const songTitleEl = document.getElementById('song-title');
	const songArtistEl = document.getElementById('song-artist');
	const contextContainer = document.getElementById('context-container');
	const songContextEl = document.getElementById('song-context');
	const currentTimeEl = document.getElementById('current-time');
	const durationEl = document.getElementById('duration');
	const progressBarFill = document.getElementById('progress-bar-fill');
	const statusMessage = document.getElementById('status-message');
	const statusSubMessage = document.getElementById('status-sub-message');
	const colorThief = new ColorThief();

	// --- State Management & Observers ---
	let currentSongId = null;
	let dominantColor = null;
	let activeBgLayer = 1;
	let progressInterval = null;
	let currentProgressMs = 0;
	let lastKnownData = null;
    let marqueeObserver;

	// --- Helper Functions ---
	function formatTime(ms) {
		if (!ms || ms < 0) return '0:00';
		const t = Math.floor(ms / 1000);
		return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
	}
	function updateProgressBarColor(color) {
		const newColor = color ? `rgb(${color.join(',')})` : '#ffffff';
		progressBarFill.style.backgroundColor = newColor;
	}
	function isAcceptableColor(rgb) {
		const [r, g, b] = rgb;
		const lightness = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const saturation = max === 0 ? 0 : (max - min) / max;
		const minLightness = 0.15;
		const maxLightness = 0.85;
		const minSaturation = 0.25;
		return (
			lightness > minLightness &&
			lightness < maxLightness &&
			saturation > minSaturation
		);
	}
	function findBestColor(palette) {
		if (!palette || palette.length === 0) return null;
		for (const color of palette) {
			if (isAcceptableColor(color)) {
				return color;
			}
		}
		return palette[0];
	}
	function isColorLight(rgb) {
		if (!rgb) return false;
		const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
		return luminance > 160;
	}

	const applyMarqueeIfNeeded = (containerEl) => {
		const textSpan = containerEl.querySelector('span');
		if (!textSpan) return;

		const containerWidth = containerEl.clientWidth;
		const textWidth = textSpan.scrollWidth;
		const isOverflowing = textWidth > containerWidth;

		if (isOverflowing) {
			const overflowDistance = textWidth - containerWidth;
			const PIXELS_PER_SECOND = 10;
			const scrollDuration = overflowDistance / PIXELS_PER_SECOND;
			containerEl.style.setProperty(
				'--marquee-scroll-amount',
				`-${overflowDistance}px`
			);
			containerEl.style.setProperty('--marquee-duration', `${scrollDuration}s`);
			containerEl.classList.add('is-scrolling');
		} else {
			containerEl.classList.remove('is-scrolling');
		}
	};

    const handleMarqueeResize = (entries) => {
        for (const entry of entries) {
            applyMarqueeIfNeeded(entry.target);
        }
    };
    marqueeObserver = new ResizeObserver(handleMarqueeResize);


	// --- Main Rendering Logic ---
	function hideAllViews() {
		if (progressInterval) clearInterval(progressInterval);
		if (marqueeObserver) marqueeObserver.disconnect();

		setupView.style.display = 'none';
        setupFailedView.style.display = 'none';
		loginView.style.display = 'none';
		playerView.style.display = 'none';
		statusView.style.display = 'none';
		bottomControls.style.display = 'none';

        const embeddedStatus = document.querySelector('.embedded-status-instance');
        if (embeddedStatus) {
            document.getElementById('container').appendChild(embeddedStatus);
            embeddedStatus.style.display = 'none';
        }
	}

	function render(request) {
		if (request.data) {
			lastKnownData = request.data;
		}

		hideAllViews();
		playerView.classList.remove('is-paused');

		if (request.state && !['setup_required', 'setup_failed', 'login', 're-login'].includes(request.state)) {
			bottomControls.style.display = 'flex';
		}

		switch (request.state) {
			case 'setup_required':
				setupView.style.display = 'flex';
				break;
            case 'setup_failed':
                setupFailedView.style.display = 'flex';
                break;
			case 'login':
				loginView.style.display = 'flex';
				break;
			case 're-login':
				loginView.style.display = 'flex';
                statusMessage.textContent = 'Session Expired';
				statusSubMessage.textContent = 'Please log in again to continue.';
                loginView.insertAdjacentElement('afterbegin', statusView);
                statusView.style.display = 'block';
				break;
			case 'playing':
				playerView.style.display = 'flex';
				renderPlayer(request.data);
				break;
			case 'paused':
				playerView.style.display = 'flex';
				playerView.classList.add('is-paused');
				renderPlayer(request.data);
				break;
			case 'idle':
				statusView.style.display = 'block';
				statusMessage.textContent = 'No Active Device';
				statusSubMessage.textContent = 'Play music on any Spotify app to start.';
				break;
			case 'network_error':
				statusView.style.display = 'block';
				statusMessage.textContent = 'Network Error';
				statusSubMessage.textContent = 'Please check your internet connection.';
				break;
			case 'api_error':
				statusView.style.display = 'block';
				statusMessage.textContent = 'Spotify Unavailable';
				statusSubMessage.textContent = "Could not connect to Spotify's servers.";
				break;
			default:
				statusView.style.display = 'block';
				statusMessage.textContent = 'Loading...';
				statusSubMessage.textContent = '';
				break;
		}
	}

	async function renderPlayer(data) {
		if (!data || !data.item) {
			render({ state: 'idle' });
			return;
		}

		const newSongId = data.item.id;
		const isNewSong = newSongId !== currentSongId;
		const progressMs = data.progress_ms;
		const durationMs = data.item.duration_ms;

		const progressPercent = durationMs > 0 ? (progressMs / durationMs) * 100 : 0;
		progressBarFill.style.width = `${progressPercent}%`;
		durationEl.textContent = formatTime(durationMs);
		if (progressInterval) clearInterval(progressInterval);
		currentTimeEl.textContent = formatTime(progressMs);
		currentProgressMs = progressMs;

		if (data.is_playing) {
			progressInterval = setInterval(() => {
				if (currentProgressMs < durationMs) {
					currentProgressMs += 1000;
					currentTimeEl.textContent = formatTime(currentProgressMs);
				} else {
					clearInterval(progressInterval);
				}
			}, 1000);
		}

		if (isNewSong) {
			currentSongId = newSongId;
			playerView.classList.add('is-fading');

			const settings = await browser.storage.local.get({
				albumDisplay: 'smart_show',
			});

			setTimeout(() => {
				songTitleEl.innerHTML = `<span>${data.item.name}</span>`;
                songTitleEl.href = data.item.uri;

				songArtistEl.innerHTML = '';
				const marqueeSpan = document.createElement('span');
				data.item.artists.forEach((artist, index) => {
					const artistLink = document.createElement('a');
					artistLink.href = artist.uri;
					artistLink.innerText = artist.name;
					marqueeSpan.appendChild(artistLink);
					if (index < data.item.artists.length - 1) {
						marqueeSpan.appendChild(document.createTextNode(', '));
					}
				});
				songArtistEl.appendChild(marqueeSpan);

				const songName = data.item.name;
				const albumName = data.item.album.name;
				let showAlbum = false;
				if (settings.albumDisplay === 'always_show') {
					showAlbum = true;
				} else if (settings.albumDisplay === 'smart_show') {
					if (songName.trim().toLowerCase() !== albumName.trim().toLowerCase()) {
						showAlbum = true;
					}
				}

				if (showAlbum) {
					contextContainer.style.display = 'block';
					songContextEl.innerHTML = '';
					const contextLink = document.createElement('a');
					contextLink.href = data.item.album.uri;
					contextLink.innerText = albumName;
					const marqueeContextSpan = document.createElement('span');
					marqueeContextSpan.appendChild(contextLink);
					songContextEl.appendChild(marqueeContextSpan);
				} else {
					contextContainer.style.display = 'none';
				}

				const preloadImage = new Image();
				preloadImage.crossOrigin = 'Anonymous';
				preloadImage.src = data.item.album.images[0].url;

				preloadImage.onload = () => {
					albumArt.src = preloadImage.src;
					const newImageUrl = `url(${preloadImage.src})`;
					if (activeBgLayer === 1) {
						document.documentElement.style.setProperty(
							'--ambient-bg-2',
							newImageUrl
						);
						albumArtWrapper.classList.remove('active-bg-1');
						albumArtWrapper.classList.add('active-bg-2');
						activeBgLayer = 2;
					} else {
						document.documentElement.style.setProperty(
							'--ambient-bg-1',
							newImageUrl
						);
						albumArtWrapper.classList.remove('active-bg-2');
						albumArtWrapper.classList.add('active-bg-1');
						activeBgLayer = 1;
					}
					try {
						const palette = colorThief.getPalette(preloadImage, 8);
						dominantColor = findBestColor(palette);
						if (dominantColor && !isColorLight(dominantColor)) {
							albumArtWrapper.classList.add('dark-album-art');
						} else {
							albumArtWrapper.classList.remove('dark-album-art');
						}
						updateProgressBarColor(dominantColor);
					} catch (e) {
						console.error('ColorThief Error:', e);
						dominantColor = null;
						updateProgressBarColor(null);
						albumArtWrapper.classList.remove('dark-album-art');
					}
					playerView.classList.remove('is-fading');
				};
			}, 600);
		}

        // Connect all visible text elements to the observer
        [songTitleEl, songArtistEl, songContextEl].forEach(el => {
            if (el.offsetParent !== null) {
                marqueeObserver.observe(el);
            }
        });
	}

	// --- Event Listeners & Initial State ---
	const setupAction = () => browser.runtime.sendMessage({ action: 'open-setup-page' });
    openSetupButton.addEventListener('click', setupAction);
    retrySetupButton.addEventListener('click', setupAction);
    goToSetupLink.addEventListener('click', (e) => {
        e.preventDefault();
        setupAction();
    });

    loginHelpLink.addEventListener('click', (e) => {
        e.preventDefault();
        const helpUrl = browser.runtime.getURL('options.html#help-section');
        browser.tabs.create({ url: helpUrl });
    });

	loginButton.addEventListener('click', () => {
		const embeddedStatus = loginView.querySelector('.embedded-status-instance');
		if (embeddedStatus) {
			embeddedStatus.remove();
		}
		browser.runtime.sendMessage({ action: 'get-auth-token' });
	});
	
	logoutButton.addEventListener('click', () => {
		browser.storage.local.remove('spotify_access_token').then(() => {
			currentSongId = null;
			render({ state: 'login' });
		});
	});

	optionsButton.addEventListener('click', () => {
		browser.runtime.openOptionsPage();
	});
	
	browser.runtime.onMessage.addListener((request) => {
		if (request.action === 'update-ui') {
			render(request);
		}
	});

	document.addEventListener('click', (e) => {
		const link = e.target.closest('a');
		if (link && link.href.startsWith('spotify:')) {
			e.preventDefault();
			const iframe = document.createElement('iframe');
			iframe.style.display = 'none';
			iframe.src = link.href;
			document.body.appendChild(iframe);
			setTimeout(() => {
				document.body.removeChild(iframe);
			}, 100);
		}
	});

	browser.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && (changes.albumDisplay || changes.clientId)) {
			if (changes.clientId) {
				browser.runtime.getBackgroundPage().then(bg => bg.startPolling());
			}
			if (changes.albumDisplay) {
				currentSongId = null;
				if (lastKnownData) {
					renderPlayer(lastKnownData);
				}
				browser.runtime.sendMessage({ action: 'force-poll' });
			}
		}
	});

	// --- MODIFIED: Reliably prevent zoom via Ctrl/Cmd + Mouse Wheel ---
	window.addEventListener('wheel', (event) => {
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
		}
	}, { passive: false });
});