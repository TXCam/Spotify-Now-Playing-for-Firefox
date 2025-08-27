// --- Constants and Defaults ---
const SCOPES = 'user-read-currently-playing';
const REDIRECT_URI = browser.identity.getRedirectURL();

const DEFAULTS = {
	playingInterval: 2,
	idleInterval: 5,
	gracePeriod: 10,
	albumDisplay: 'smart_show',
	clientId: null,
};

// --- State Management ---
let isSidebarOpen = false;
let pauseGracePeriodUntil = null;

// --- ON INSTALL: Open setup page if needed ---
browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        browser.storage.local.get('clientId', (settings) => {
            if (!settings.clientId) {
                browser.tabs.create({ url: 'setup.html' });
            }
        });
    }
});


// --- PKCE Helper Functions ---
function generateRandomString(length) {
	let text = '';
	const possible =
		'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < length; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
async function generateCodeChallenge(verifier) {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const digest = await window.crypto.subtle.digest('SHA-256', data);
	return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

// --- Main Authentication Flow ---
async function getAccessToken(interactive) {
	const settings = await browser.storage.local.get({ clientId: null });
	if (!settings.clientId) {
		console.error('Client ID not set. Aborting authentication.');
		sendMessageToSidebar({ state: 'setup_required' });
		return null;
	}
	const CLIENT_ID = settings.clientId;

	const codeVerifier = generateRandomString(128);
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	let authUrl = 'https://accounts.spotify.com/authorize';
	authUrl += '?client_id=' + CLIENT_ID;
	authUrl += '&response_type=code';
	authUrl += '&redirect_uri=' + encodeURIComponent(REDIRECT_URI);
	authUrl += '&scope=' + encodeURIComponent(SCOPES);
	authUrl += '&code_challenge_method=S256';
	authUrl += '&code_challenge=' + codeChallenge;
	try {
		const redirectUrl = await browser.identity.launchWebAuthFlow({
			interactive: interactive,
			url: authUrl,
		});
		const authCode = new URL(redirectUrl).searchParams.get('code');
		if (!authCode) return null;
		const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				grant_type: 'authorization_code',
				code: authCode,
				redirect_uri: REDIRECT_URI,
				code_verifier: codeVerifier,
			}),
		});
		const tokenData = await tokenResponse.json();
		if (tokenData.access_token) {
			await browser.storage.local.set({
				spotify_access_token: tokenData.access_token,
			});
			if (isSidebarOpen) {
				startPolling();
			}
			return tokenData.access_token;
		}
	} catch (error) {
		console.log('Authentication flow was cancelled or failed.', error);
		if (error && error.message.toLowerCase().includes('invalid client')) {
            await browser.storage.local.remove('clientId');
			sendMessageToSidebar({ state: 'setup_failed' });
		}
	}
	return null;
}

// --- Polling Logic ---
const POLLING_ALARM_NAME = 'poll-spotify-alarm';

function scheduleNextPoll(delayInSeconds) {
	if (isSidebarOpen) {
		const delayInMinutes = delayInSeconds / 60;
		browser.alarms.create(POLLING_ALARM_NAME, { delayInMinutes });
	}
}

function startPolling() {
	if (!isSidebarOpen) return;
	browser.storage.local.get('clientId').then((settings) => {
		if (!settings.clientId) {
			sendMessageToSidebar({ state: 'setup_required' });
			return;
		}

		browser.storage.local.get('spotify_access_token').then((result) => {
			if (result.spotify_access_token) {
				browser.alarms.create(POLLING_ALARM_NAME, { when: Date.now() });
			} else {
				sendMessageToSidebar({ state: 'login' });
			}
		});
	});
}

function stopPolling() {
	browser.alarms.clear(POLLING_ALARM_NAME);
	pauseGracePeriodUntil = null;
	console.log('Sidebar closed. Polling stopped.');
}

async function fetchCurrentlyPlaying(token) {
	if (!isSidebarOpen) return;

	const settings = await browser.storage.local.get(DEFAULTS);

	try {
		const response = await fetch(
			'https://api.spotify.com/v1/me/player/currently-playing',
			{
				headers: { Authorization: `Bearer ${token}` },
			}
		);

		if (!isSidebarOpen) return;

		if (response.status === 200) {
			const data = await response.json();
			if (data && data.is_playing) {
				pauseGracePeriodUntil = null;
				sendMessageToSidebar({ state: 'playing', data: data });
				scheduleNextPoll(settings.playingInterval);
			} else {
				if (!pauseGracePeriodUntil) {
					pauseGracePeriodUntil =
						Date.now() + settings.gracePeriod * 1000;
				}
				if (Date.now() >= pauseGracePeriodUntil) {
					sendMessageToSidebar({ state: 'paused', data: data });
					scheduleNextPoll(settings.idleInterval);
				} else {
					sendMessageToSidebar({ state: 'paused', data: data });
					scheduleNextPoll(settings.playingInterval);
				}
			}
		} else if (response.status === 204) {
			pauseGracePeriodUntil = null;
			sendMessageToSidebar({ state: 'idle' });
			scheduleNextPoll(settings.idleInterval);
		} else if (response.status === 401) {
			await browser.storage.local.remove('spotify_access_token');
			sendMessageToSidebar({ state: 're-login' });
			stopPolling();
			return;
		} else if (response.status >= 500) {
			pauseGracePeriodUntil = null;
			sendMessageToSidebar({ state: 'api_error' });
			scheduleNextPoll(settings.idleInterval);
		}
	} catch (error) {
		if (isSidebarOpen) {
			console.error('Network error while fetching song:', error);
			pauseGracePeriodUntil = null;
			sendMessageToSidebar({ state: 'network_error' });
			scheduleNextPoll(settings.idleInterval);
		}
	}
}

function sendMessageToSidebar(message) {
	if (isSidebarOpen) {
		browser.runtime.sendMessage({ action: 'update-ui', ...message });
	}
}

// --- Listeners ---
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === 'get-auth-token') {
		getAccessToken(true).then(sendResponse);
		return true;
	}
	if (request.action === 'force-poll') {
		browser.alarms.create(POLLING_ALARM_NAME, { when: Date.now() });
	}
    if (request.action === 'open-setup-page') {
        browser.tabs.create({ url: 'setup.html' });
    }
	// --- MODIFIED: This is the definitive iframe logic ---
	if (request.action === 'open-spotify-uri') {
		// Get the background page's document context
		const backgroundDocument = document;

		// Create the invisible iframe
		const iframe = backgroundDocument.createElement('iframe');
		iframe.style.display = 'none';
		iframe.src = request.uri;
		
		// Add it to the background page's body to trigger the navigation
		backgroundDocument.body.appendChild(iframe);
		
		// Set a timer to clean it up after a short delay
		setTimeout(() => {
			backgroundDocument.body.removeChild(iframe);
		}, 500);
	}
});

browser.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === POLLING_ALARM_NAME) {
		const result = await browser.storage.local.get('spotify_access_token');
		if (result.spotify_access_token) {
			fetchCurrentlyPlaying(result.spotify_access_token);
		} else {
			const settings = await browser.storage.local.get('clientId');
			stopPolling();
			if (!settings.clientId) {
				sendMessageToSidebar({ state: 'setup_required' });
			} else {
				sendMessageToSidebar({ state: 'login' });
			}
		}
	}
});

browser.runtime.onConnect.addListener((port) => {
	if (port.name !== 'sidebar-port') return;

	isSidebarOpen = true;
	console.log('Sidebar opened. Polling started.');
	startPolling();

	port.onDisconnect.addListener(() => {
		isSidebarOpen = false;
		stopPolling();
	});
});