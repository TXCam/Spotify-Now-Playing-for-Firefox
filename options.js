document.addEventListener('DOMContentLoaded', () => {
    // Selectors for the layout
    const navSettingsButton = document.getElementById('nav-settings');
    const navHelpButton = document.getElementById('nav-help');
    const columnsContainer = document.getElementById('columns-container');
    // MODIFIED: Add selectors for the columns themselves
    const settingsColumn = document.getElementById('settings-column');
    const helpColumn = document.getElementById('help-column');

	const form = document.getElementById('options-form');
	const statusEl = document.getElementById('status');
	const resetButton = document.getElementById('reset-button');
	const clientIdInput = document.getElementById('client-id-input');
	const clearStorageButton = document.getElementById('clear-storage-button');

	const sliders = [
		{
			input: document.getElementById('playing-interval'),
			display: document.getElementById('playing-interval-value'),
			storageKey: 'playingInterval',
			defaultValue: 2,
		},
		{
			input: document.getElementById('idle-interval'),
			display: document.getElementById('idle-interval-value'),
			storageKey: 'idleInterval',
			defaultValue: 5,
		},
		{
			input: document.getElementById('grace-period'),
			display: document.getElementById('grace-period-value'),
			storageKey: 'gracePeriod',
			defaultValue: 10,
		},
	];

	const radioGroups = [
		{
			group: document.getElementById('album-display-group'),
			storageKey: 'albumDisplay',
			defaultValue: 'smart_show',
		},
	];

    // --- Layout Navigation Logic ---
    function showSettingsView() {
        columnsContainer.classList.add('settings-active');
        columnsContainer.classList.remove('help-active');
        navSettingsButton.classList.add('active');
        navHelpButton.classList.remove('active');
    }

    function showHelpView() {
        columnsContainer.classList.add('help-active');
        columnsContainer.classList.remove('settings-active');
        navHelpButton.classList.add('active');
        navSettingsButton.classList.remove('active');
    }

	// --- Helper Functions ---
	function updateSliderFill(sliderInput) {
		const min = sliderInput.min;
		const max = sliderInput.max;
		const val = sliderInput.value;
		const percentage = ((val - min) * 100) / (max - min);
		const fill = getComputedStyle(document.documentElement).getPropertyValue(
			'--slider-fill-color'
		);
		const track = getComputedStyle(document.documentElement).getPropertyValue(
			'--slider-track-color'
		);
		sliderInput.style.background = `linear-gradient(to right, ${fill} ${percentage}%, ${track} ${percentage}%)`;
	}

	function updateValueDisplay(slider) {
		slider.display.textContent = slider.input.value;
	}

	function showStatusMessage(message, duration = 2500) {
		statusEl.textContent = message;
		statusEl.classList.add('is-visible');
		setTimeout(() => {
			statusEl.classList.remove('is-visible');
		}, duration);
	}

	function updateRadioSelection(groupElement) {
		const radios = groupElement.querySelectorAll('input[type="radio"]');
		radios.forEach((radio) => {
			if (radio.checked) {
				radio.parentElement.classList.add('selected');
			} else {
				radio.parentElement.classList.remove('selected');
			}
		});
	}

	// --- Main Logic ---
	sliders.forEach((slider) => {
		slider.input.addEventListener('input', () => {
			updateValueDisplay(slider);
			updateSliderFill(slider.input);
		});
	});

	radioGroups.forEach((radio) => {
		radio.group.addEventListener('change', () => updateRadioSelection(radio.group));
	});

	function saveOptions(e) {
		e.preventDefault();
		const settingsToSave = {
			clientId: clientIdInput.value.trim()
		};

		sliders.forEach((slider) => {
			settingsToSave[slider.storageKey] = parseInt(slider.input.value, 10);
		});

		radioGroups.forEach((radio) => {
			const selected = radio.group.querySelector('input:checked');
			if (selected) {
				settingsToSave[radio.storageKey] = selected.value;
			}
		});

		browser.storage.local.set(settingsToSave).then(() => {
			showStatusMessage('Saved!');
		});
	}

	function restoreOptions() {
		const keysToGet = {
			clientId: '',
			playingInterval: 2,
			idleInterval: 5,
			gracePeriod: 10,
			albumDisplay: 'smart_show',
		};

		browser.storage.local.get(keysToGet).then((settings) => {
			clientIdInput.value = settings.clientId || '';
			
			sliders.forEach((slider) => {
				slider.input.value = settings[slider.storageKey];
				updateValueDisplay(slider);
				updateSliderFill(slider.input);
			});

			radioGroups.forEach((radio) => {
				const savedValue = settings[radio.storageKey];
				const inputToSelect = radio.group.querySelector(
					`input[value="${savedValue}"]`
				);
				if (inputToSelect) {
					inputToSelect.checked = true;
				}
				updateRadioSelection(radio.group);
			});
		});
	}

	function resetToDefaults() {
		sliders.forEach((slider) => {
			slider.input.value = slider.defaultValue;
			updateValueDisplay(slider);
			updateSliderFill(slider.input);
		});

		radioGroups.forEach((radio) => {
			const defaultInput = radio.group.querySelector(
				`input[value="${radio.defaultValue}"]`
			);
			if (defaultInput) {
				defaultInput.checked = true;
			}
			updateRadioSelection(radio.group);
		});
		showStatusMessage('Default settings restored');
	}
    
    function clearAllData() {
        if (window.confirm("Are you sure you want to delete all stored data?\nThis includes your settings and Client ID, and cannot be undone.")) {
            browser.storage.local.clear().then(() => {
                clientIdInput.value = '';
                resetToDefaults();
                showStatusMessage("All data cleared. Settings have been reset.");
            });
        }
    }

    // --- Add Event Listeners ---
    navSettingsButton.addEventListener('click', showSettingsView);
    navHelpButton.addEventListener('click', showHelpView);
	form.addEventListener('submit', saveOptions);
	resetButton.addEventListener('click', resetToDefaults);
    clearStorageButton.addEventListener('click', clearAllData);
	
    // MODIFIED: Add event listeners to the columns to allow clicking the inactive one
    settingsColumn.addEventListener('click', () => {
        if (!columnsContainer.classList.contains('settings-active')) {
            showSettingsView();
        }
    });

    helpColumn.addEventListener('click', () => {
        if (!columnsContainer.classList.contains('help-active')) {
            showHelpView();
        }
    });

    // --- Initialize Page ---
	restoreOptions();
    showSettingsView(); // Default to the settings view on load

    browser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.clientId) {
            clientIdInput.value = changes.clientId.newValue || '';
        }
    });
});