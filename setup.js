document.addEventListener('DOMContentLoaded', () => {
	const clientIdInput = document.getElementById('client-id-input');
	const redirectUriDisplay = document.getElementById('options-redirect-uri');
	const copyUriButton = document.getElementById('options-copy-uri-button');
	const saveButton = document.getElementById('save-button');
	const statusEl = document.getElementById('status');

	function showStatusMessage(message, isError = false, duration = 2500) {
		statusEl.textContent = message;
		statusEl.style.color = isError ? '#ff6b6b' : '#1ed760';
		statusEl.classList.add('is-visible');
		setTimeout(() => {
			statusEl.classList.remove('is-visible');
		}, duration);
	}

	// Display the redirect URI for the user to copy
	function displayRedirectUri() {
		try {
			const uri = browser.identity.getRedirectURL();
			redirectUriDisplay.textContent = uri;
		} catch (e) {
			redirectUriDisplay.textContent = 'Error loading Redirect URI.';
			console.error(e);
		}
	}

	// Load existing Client ID if it's already in storage
	function restoreOptions() {
		browser.storage.local.get('clientId').then((settings) => {
			clientIdInput.value = settings.clientId || '';
		});
	}

	// Save the Client ID and close the setup tab
	function saveAndFinish() {
		const clientId = clientIdInput.value.trim();
		if (!clientId) {
			showStatusMessage('Client ID cannot be empty.', true);
			return;
		}

		browser.storage.local.set({ clientId: clientId }).then(() => {
			showStatusMessage('Saved! You can close this tab.');
			// Close the setup tab after a short delay
			setTimeout(() => {
				browser.tabs.getCurrent().then((tab) => {
					browser.tabs.remove(tab.id);
				});
			}, 1000);
		});
	}

	// Wire up event listeners
	copyUriButton.addEventListener('click', () => {
		navigator.clipboard.writeText(redirectUriDisplay.textContent).then(() => {
			copyUriButton.textContent = 'Copied!';
			setTimeout(() => (copyUriButton.textContent = 'Copy'), 2000);
		});
	});

	saveButton.addEventListener('click', saveAndFinish);

	// Initialize the page
	displayRedirectUri();
	restoreOptions();
});